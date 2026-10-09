import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Profile, AuthErrorCode } from '../shared/types';
export type { AuthErrorCode } from '../shared/types';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const XBOX_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT = 'https://api.minecraftservices.com';

export interface Session {
  profile: Profile;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthOptions {
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  onDiagnostic?: (result: AuthDiagnostic) => void;
}

export interface AuthDiagnostic {
  stage: string;
  status: number;
  format: 'json' | 'empty' | 'non-json';
}

function authStage(url: string): string {
  if (url === `${AUTHORITY}/token`) return 'Microsoft 토큰 교환';
  if (url === XBOX_AUTH) return 'Xbox 계정 인증';
  if (url === XSTS_AUTH) return 'Xbox 게임 권한 확인';
  if (url === `${MINECRAFT}/authentication/login_with_xbox`) return 'Minecraft 로그인';
  if (url === `${MINECRAFT}/entitlements/mcstore`) return 'Minecraft 소유권 확인';
  if (url === `${MINECRAFT}/minecraft/profile`) return 'Minecraft 프로필 확인';
  return '계정 인증';
}

function responseError(url: string, status: number, payload?: Record<string, unknown>): AuthError {
  const detail = `${authStage(url)}, HTTP ${status}`;
  if (status === 429) return new AuthError('OAUTH', `인증 요청이 너무 많습니다 (${detail}). 잠시 후 다시 로그인하세요.`);
  if (status >= 500) return new AuthError('NETWORK', `인증 서비스에 일시적인 오류가 있습니다 (${detail}). 잠시 후 다시 시도하세요.`);
  if (url === XSTS_AUTH && payload?.XErr === 2148916233) {
    return new AuthError('XBOX_PROFILE', `Xbox 프로필을 먼저 생성한 뒤 다시 로그인하세요 (${detail}).`);
  }
  if (url === XSTS_AUTH && payload?.XErr === 2148916238) {
    return new AuthError('XBOX_FAMILY', `Microsoft 가족의 보호자 계정에서 Xbox 이용 권한을 확인하세요 (${detail}).`);
  }
  if (url === `${MINECRAFT}/authentication/login_with_xbox` && status === 403) {
    return new AuthError('APP_APPROVAL', `Minecraft 인증 접근이 거부되었습니다 (${detail}). 운영자의 Minecraft Services 앱 승인과 계정 권한을 확인하세요.`);
  }
  if (url === `${MINECRAFT}/minecraft/profile` && status === 404) {
    return new AuthError('OWNERSHIP', `Minecraft Java Edition 프로필을 찾을 수 없습니다 (${detail}). 게임 소유권과 프로필 생성을 확인하세요.`);
  }
  if (url === `${AUTHORITY}/token`) {
    // Never copy error_description: it can echo codes, tokens or account data.
    const codes = Array.isArray(payload?.error_codes) ? payload.error_codes.filter((value): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 999999999).slice(0, 3) : [];
    const suffix = codes.length ? `, ${codes.map(code => `AADSTS${code}`).join(', ')}` : '';
    if (payload?.error === 'invalid_grant') {
      return new AuthError('SESSION_EXPIRED', `저장된 로그인 정보가 만료되거나 취소되었습니다 (${detail}${suffix}). Microsoft 계정으로 다시 로그인하세요.`);
    }
    if (codes.includes(7000218) || payload?.error === 'unauthorized_client') {
      return new AuthError('CONFIGURATION', `Microsoft 앱 설정을 확인하세요 (${detail}${suffix}). 반환 주소를 모바일 및 데스크톱 애플리케이션에 등록해야 합니다.`);
    }
    return new AuthError('OAUTH', `Microsoft 인증 요청이 거부되었습니다 (${detail}${suffix}). 새 로그인 창에서 다시 시도하세요.`);
  }
  if (url === XBOX_AUTH || url === XSTS_AUTH) {
    return new AuthError('OAUTH', `Xbox 인증이 거부되었습니다 (${detail}). Xbox 계정의 프로필·이용 권한과 런처 앱 설정을 확인하세요.`);
  }
  return new AuthError('OAUTH', `인증 서버가 요청을 거부했습니다 (${detail}). 다시 로그인하세요.`);
}

export interface AuthenticateOptions extends AuthOptions {
  openExternal: (url: string) => Promise<void> | void;
  loginTimeoutMs?: number;
  onAuthorizationUrl?: (url: string) => void;
  onProgress?: (stage: 'opening' | 'waiting' | 'verifying') => void;
}

function configuredClient(clientId: string): string {
  const value = clientId.trim();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new AuthError('CONFIGURATION', '운영자의 Microsoft 앱 Client ID를 설정하세요. Minecraft API 승인이 필요합니다.');
  }
  return value;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AuthError('CANCELLED', '로그인이 취소되었습니다.');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('RESPONSE', '인증 서버의 응답 형식이 올바르지 않습니다.');
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536) {
    throw new AuthError('RESPONSE', '인증 서버에서 유효한 정보를 받지 못했습니다.');
  }
  return value;
}

async function requestJson(url: string, init: RequestInit, options: AuthOptions): Promise<Record<string, unknown>> {
  checkCancelled(options.signal);
  const stage = authStage(url);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 30000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      ...init, signal: controller.signal, redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers },
    });
    const text = await response.text();
    checkCancelled(options.signal);
    let payload: Record<string, unknown> | undefined;
    if (text.length <= 1024 * 1024) {
      try { payload = object(JSON.parse(text)); } catch { /* Error responses may be empty or HTML. */ }
    }
    const format = payload ? 'json' : text.trim() ? 'non-json' : 'empty';
    options.onDiagnostic?.({ stage, status: response.status, format });
    // Preserve HTTP errors even when the server sends no JSON response body.
    if (!response.ok) throw responseError(url, response.status, payload);
    if (text.length > 1024 * 1024) throw new AuthError('RESPONSE', `인증 서버 응답이 너무 큽니다 (${stage}, HTTP ${response.status}).`);
    if (!payload) throw new AuthError('RESPONSE', `인증 서버의 응답 형식이 올바르지 않습니다 (${stage}, HTTP ${response.status}, ${format === 'empty' ? '빈 응답' : 'JSON 아님'}). 다시 시도하세요.`);
    checkCancelled(options.signal);
    return payload;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (options.signal?.aborted) throw new AuthError('CANCELLED', '로그인이 취소되었습니다.');
    if (controller.signal.aborted) throw new AuthError('TIMEOUT', `인증 서버 연결 시간이 초과되었습니다 (${stage}).`);
    throw new AuthError('NETWORK', `인증 서버에 연결하지 못했습니다 (${stage}). 네트워크 상태를 확인하세요.`);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function xboxHash(response: Record<string, unknown>): string {
  const claims = object(response.DisplayClaims);
  if (!Array.isArray(claims.xui) || claims.xui.length !== 1) {
    throw new AuthError('RESPONSE', 'Xbox 사용자 정보를 확인하지 못했습니다.');
  }
  const hash = nonempty(object(claims.xui[0]).uhs);
  if (!/^\d{1,32}$/.test(hash)) throw new AuthError('RESPONSE', 'Xbox 사용자 정보가 올바르지 않습니다.');
  return hash;
}

async function minecraftSession(oauth: Record<string, unknown>, previousRefreshToken: string | undefined, options: AuthOptions): Promise<Session> {
  const microsoftToken = nonempty(oauth.access_token);
  const refreshToken = nonempty(oauth.refresh_token ?? previousRefreshToken);
  const xbox = await requestJson(XBOX_AUTH, jsonPost({
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${microsoftToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }), options);
  const xboxUserHash = xboxHash(xbox);
  const xsts = await requestJson(XSTS_AUTH, jsonPost({
    Properties: { SandboxId: 'RETAIL', UserTokens: [nonempty(xbox.Token)] },
    // This is an audience identifier, not the HTTPS Minecraft API endpoint.
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  }), options);
  const userHash = xboxHash(xsts);
  if (xboxUserHash !== userHash) throw new AuthError('RESPONSE', 'Xbox 인증 사용자가 일치하지 않습니다.');
  const minecraft = await requestJson(`${MINECRAFT}/authentication/login_with_xbox`, jsonPost({
    identityToken: `XBL3.0 x=${userHash};${nonempty(xsts.Token)}`,
  }), options);
  const accessToken = nonempty(minecraft.access_token);
  const expiry = minecraft.expires_in;
  if (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= 0 || expiry > 7 * 86400) {
    throw new AuthError('RESPONSE', 'Minecraft 토큰 만료 정보를 확인하지 못했습니다.');
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  const entitlements = await requestJson(`${MINECRAFT}/entitlements/mcstore`, { headers }, options);
  if (!Array.isArray(entitlements.items) || !entitlements.items.some(item => {
    const name = object(item).name;
    return name === 'game_minecraft' || name === 'product_minecraft';
  })) {
    throw new AuthError('OWNERSHIP', '이 계정의 Minecraft Java Edition 소유권을 확인하지 못했습니다.');
  }
  const data = await requestJson(`${MINECRAFT}/minecraft/profile`, { headers }, options);
  const id = nonempty(data.id);
  const name = nonempty(data.name);
  if (!/^[a-f0-9]{32}$/i.test(id) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw new AuthError('RESPONSE', 'Minecraft 프로필 형식이 올바르지 않습니다.');
  }
  const profile: Profile = { id, name };
  if (Array.isArray(data.skins)) {
    const active = data.skins.find(skin => object(skin).state === 'ACTIVE');
    if (active) {
      try {
        const url = new URL(nonempty(object(active).url));
        if (url.hostname === 'textures.minecraft.net' && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
          url.protocol = 'https:';
          profile.skinUrl = url.href;
        }
      } catch { /* A cosmetic skin URL must not prevent a verified login. */ }
    }
  }
  return { profile, accessToken, refreshToken, expiresAt: (options.now ?? Date.now)() + expiry * 1000 };
}

function sameState(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const supplied = Buffer.from(actual);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function close(server: Server): void {
  server.close();
  server.closeAllConnections();
}

/** Uses the operator's registered public-client ID; no client secret or shared ID. */
export async function authenticate(clientId: string, options: AuthenticateOptions): Promise<Session> {
  clientId = configuredClient(clientId);
  checkCancelled(options.signal);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: unknown) => void;
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // A browser opener can fail while a cancellation arrives; keep rejection handled until awaited.
  void codePromise.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let callback: URL;
    try { callback = new URL(request.url ?? '/', 'http://localhost'); }
    catch { response.writeHead(400).end('Invalid request'); return; }
    if (request.method !== 'GET' || callback.pathname !== '/callback') {
      response.writeHead(404).end('Not found'); return;
    }
    if (!sameState(callback.searchParams.get('state'), state)) {
      response.writeHead(400).end('Invalid login state'); return;
    }
    if (callback.searchParams.has('error')) {
      response.writeHead(400).end('로그인이 완료되지 않았습니다. 런처로 돌아가세요.');
      rejectCode(new AuthError('OAUTH', 'Microsoft 로그인이 거부되거나 취소되었습니다.'));
      return;
    }
    const code = callback.searchParams.get('code');
    if (!code || code.length > 8192) { response.writeHead(400).end('Missing code'); return; }
    response.writeHead(200).end('로그인이 완료되었습니다. 이 탭을 닫고 Cobble Launcher로 돌아가세요.');
    resolveCode(code);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  const redirect = `http://localhost:${address.port}/callback`;
  const cancel = () => rejectCode(new AuthError('CANCELLED', '로그인이 취소되었습니다.'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => rejectCode(new AuthError('TIMEOUT', '로그인 시간이 초과되었습니다. 다시 로그인하세요.')), options.loginTimeoutMs ?? 5 * 60 * 1000);
  let browserProgressActive = true;
  try {
    checkCancelled(options.signal);
    const url = new URL(`${AUTHORITY}/authorize`);
    url.search = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query',
      scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    options.onAuthorizationUrl?.(url.href);
    options.onProgress?.('opening');
    const opening = Promise.resolve().then(() => options.openExternal(url.href)).then(() => {
      if (browserProgressActive) options.onProgress?.('waiting');
    }, () => {
      throw new AuthError('BROWSER', 'Microsoft 로그인 창을 열지 못했습니다. Windows 기본 브라우저 설정을 확인한 뒤 다시 시도하세요.');
    });
    // OS browser activation may never settle. A callback, cancellation, or the
    // login deadline must still release the listener and finish the operation.
    await Promise.race([opening, codePromise.then(() => undefined)]);
    browserProgressActive = false;
    const code = await codePromise;
    options.onProgress?.('verifying');
    close(server);
    const oauth = await requestJson(`${AUTHORITY}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPE, grant_type: 'authorization_code',
        code, redirect_uri: redirect, code_verifier: verifier }).toString(),
    }, options);
    return await minecraftSession(oauth, undefined, options);
  } finally {
    browserProgressActive = false;
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    close(server);
  }
}

export async function refresh(clientId: string, refreshToken: string, options: AuthOptions = {}): Promise<Session> {
  clientId = configuredClient(clientId);
  nonempty(refreshToken);
  const oauth = await requestJson(`${AUTHORITY}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  }, options);
  return minecraftSession(oauth, refreshToken, options);
}
