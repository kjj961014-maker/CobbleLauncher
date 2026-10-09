import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { authenticate, refresh, AuthError } from '../src/main/auth';

const clientId = '11111111-2222-3333-4444-555555555555';
const profileId = '0123456789abcdef0123456789abcdef';

function authFetch(options: { ownsGame?: boolean; xstsError?: number; xstsHash?: string; refreshToken?: string; tokenCheck?: (form: URLSearchParams) => void } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let value: unknown;
    let status = 200;
    if (url.endsWith('/token')) {
      const form = new URLSearchParams(String(init?.body));
      options.tokenCheck?.(form);
      assert.equal(form.get('client_id'), clientId);
      assert.equal(form.has('client_secret'), false);
      value = { access_token: 'microsoft-access', ...(options.refreshToken === '' ? {} : { refresh_token: options.refreshToken ?? 'rotated-refresh' }) };
    } else if (url.includes('user.auth.xboxlive.com')) {
      assert.equal(JSON.parse(String(init?.body)).Properties.RpsTicket, 'd=microsoft-access');
      value = { Token: 'xbox-token', DisplayClaims: { xui: [{ uhs: '1234' }] } };
    } else if (url.includes('xsts.auth.xboxlive.com')) {
      // Protocol contract, independently specified by the Minecraft XSTS flow.
      // Reject a web API URL used as the audience, just as the live service did.
      const request = JSON.parse(String(init?.body));
      if (request.RelyingParty !== 'rp://api.minecraftservices.com/' ||
          request.TokenType !== 'JWT' || request.Properties?.SandboxId !== 'RETAIL' ||
          JSON.stringify(request.Properties?.UserTokens) !== JSON.stringify(['xbox-token'])) {
        return new Response('', { status:400 });
      }
      if (options.xstsError) { status = 401; value = { XErr: options.xstsError, Message: 'private server detail' }; }
      else value = { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: options.xstsHash ?? '1234' }] } };
    } else if (url.endsWith('/login_with_xbox')) {
      assert.equal(JSON.parse(String(init?.body)).identityToken, 'XBL3.0 x=1234;xsts-token');
      value = { access_token: 'minecraft-access', expires_in: 86400 };
    } else if (url.endsWith('/entitlements/mcstore')) {
      value = { items: options.ownsGame === false ? [] : [{ name: 'game_minecraft' }] };
    } else if (url.endsWith('/minecraft/profile')) {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer minecraft-access');
      value = { id: profileId, name: 'CobblePlayer', skins: [{ state: 'ACTIVE', url: 'http://textures.minecraft.net/texture/test' }] };
    } else throw new Error('Unexpected endpoint');
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('PKCE login ignores a forged callback, uses the Minecraft XSTS audience and verifies ownership', async () => {
  let authorization: URL | undefined;
  const session = await authenticate(clientId, {
    fetch: authFetch({ tokenCheck(form) {
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'auth-code');
      assert.equal(form.get('redirect_uri'), authorization!.searchParams.get('redirect_uri'));
      const hash = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
      assert.equal(hash, authorization!.searchParams.get('code_challenge'));
    } }),
    now: () => 1000,
    async openExternal(url) {
      authorization = new URL(url);
      assert.equal(authorization.origin, 'https://login.microsoftonline.com');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('code', 'attacker-code');
      callback.searchParams.set('state', 'bad-state');
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', '가'.repeat(authorization.searchParams.get('state')!.length));
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('code', 'auth-code');
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  assert.equal(session.profile.id, profileId);
  assert.equal(session.profile.skinUrl, 'https://textures.minecraft.net/texture/test');
  assert.equal(session.refreshToken, 'rotated-refresh');
  assert.equal(session.expiresAt, 86401000);
});

test('revoked refresh credentials are distinguished from a temporary server failure without exposing secrets', async () => {
  await assert.rejects(refresh(clientId, 'private-refresh-token', {
    fetch: (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'private-refresh-token' }), { status: 400 })) as typeof fetch,
  }), (error: unknown) => error instanceof AuthError && error.code === 'SESSION_EXPIRED' && !error.message.includes('private-refresh-token'));
});

test('refresh retains the previous refresh token if no replacement is returned', async () => {
  const session = await refresh(clientId, 'previous-refresh', {
    fetch: authFetch({ refreshToken: '', tokenCheck(form) {
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'previous-refresh');
    } }),
  });
  assert.equal(session.refreshToken, 'previous-refresh');
});

test('a Microsoft account without Java entitlement cannot become a launcher session', async () => {
  await assert.rejects(refresh(clientId, 'refresh', { fetch: authFetch({ ownsGame: false }) }),
    error => error instanceof AuthError && error.code === 'OWNERSHIP');
});

test('mismatched Xbox identities are rejected before Minecraft access', async () => {
  await assert.rejects(refresh(clientId, 'refresh', { fetch: authFetch({ xstsHash: '5678' }) }),
    error => error instanceof AuthError && error.code === 'RESPONSE');
});

test('Xbox family restrictions have a useful error without leaking server data', async () => {
  await assert.rejects(refresh(clientId, 'refresh', { fetch: authFetch({ xstsError: 2148916238 }) }),
    error => error instanceof AuthError && error.code === 'XBOX_FAMILY' && !error.message.includes('private server detail'));
});

for (const entry of [
  { endpoint:'user.auth.xboxlive.com', status:401, body:'', stage:'Xbox 계정 인증', code:'OAUTH' },
  { endpoint:'xsts.auth.xboxlive.com', status:400, body:'', stage:'Xbox 게임 권한 확인', code:'OAUTH' },
  { endpoint:'/login_with_xbox', status:403, body:'<html>private-denial-token</html>', stage:'Minecraft 로그인', code:'APP_APPROVAL' },
  { endpoint:'/login_with_xbox', status:403, body:'', stage:'Minecraft 로그인', code:'APP_APPROVAL' },
  { endpoint:'/minecraft/profile', status:404, body:'', stage:'Minecraft 프로필 확인', code:'OWNERSHIP' },
  { endpoint:'/token', status:503, body:'<html>private-denial-token</html>', stage:'Microsoft 토큰 교환', code:'NETWORK' },
  { endpoint:'/token', status:429, body:'', stage:'Microsoft 토큰 교환', code:'OAUTH' },
]) {
  test(`HTTP ${entry.status} at ${entry.stage} survives an empty/non-JSON response`, async () => {
    const normal = authFetch();
    const diagnostic: unknown[] = [];
    await assert.rejects(refresh(clientId, 'private-refresh-token', {
      fetch: (input, init) => String(input).includes(entry.endpoint) ?
        Promise.resolve(new Response(entry.body, { status:entry.status })) : normal(input, init),
      onDiagnostic: result => diagnostic.push(result),
    }), error => error instanceof AuthError && error.code === entry.code &&
      error.message.includes(entry.stage) && error.message.includes(`HTTP ${entry.status}`) &&
      !error.message.includes('private-denial-token') && !error.message.includes('private-refresh-token'));
    assert.deepEqual(diagnostic.at(-1), {stage:entry.stage, status:entry.status, format:entry.body ? 'non-json' : 'empty'});
  });
}

test('HTTP 200 with HTML is never accepted as a valid authentication result', async () => {
  await assert.rejects(refresh(clientId, 'private-refresh-token', {
    fetch: async () => new Response('<html>private-denial-token</html>', { status:200 }),
  }), error => error instanceof AuthError && error.code === 'RESPONSE' &&
    error.message.includes('Microsoft 토큰 교환') && error.message.includes('HTTP 200') &&
    !error.message.includes('private-denial-token'));
});

test('Microsoft configuration diagnostics expose only numeric AADSTS codes', async () => {
  await assert.rejects(refresh(clientId, 'private-refresh-token', {
    fetch: async () => new Response(JSON.stringify({
      error:'invalid_client', error_codes:[7000218, 'private-denial-token', -1, 1.5, Infinity],
      error_description:'private-denial-token private-refresh-token',
    }), { status:400 }),
  }), error => error instanceof AuthError && error.code === 'CONFIGURATION' &&
    error.message.includes('AADSTS7000218') && error.message.includes('HTTP 400') &&
    !error.message.includes('private-denial-token') && !error.message.includes('private-refresh-token'));
});

test('successful authentication diagnostics contain only stage, HTTP status and response format', async () => {
  const diagnostics: unknown[] = [];
  await refresh(clientId, 'private-refresh-token', { fetch:authFetch(), onDiagnostic:result => diagnostics.push(result) });
  assert.equal(diagnostics.length, 6);
  for (const result of diagnostics as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(result).sort(), ['format','stage','status']);
    assert.equal(result.status, 200);
    assert.equal(result.format, 'json');
  }
  assert.doesNotMatch(JSON.stringify(diagnostics), /access|refresh|1234|CobblePlayer|https?:/);
});

test('cancellation and timeout release the loopback listener', async () => {
  const controller = new AbortController();
  let callback: URL | undefined;
  await assert.rejects(authenticate(clientId, {
    signal: controller.signal, fetch: authFetch(),
    openExternal(url) { callback = new URL(new URL(url).searchParams.get('redirect_uri')!); controller.abort(); },
  }), error => error instanceof AuthError && error.code === 'CANCELLED');
  await assert.rejects(fetch(callback!));
  await assert.rejects(authenticate(clientId, { fetch: authFetch(), openExternal() {}, loginTimeoutMs: 5 }),
    error => error instanceof AuthError && error.code === 'TIMEOUT');
});

test('missing operator client ID is rejected before opening any browser', async () => {
  let opened = false;
  await assert.rejects(authenticate('', { openExternal() { opened = true; } }),
    error => error instanceof AuthError && error.code === 'CONFIGURATION');
  assert.equal(opened, false);
});

test('a stalled browser opener cannot block cancellation or the login deadline', async () => {
  const controller = new AbortController();
  let callback: URL | undefined;
  let finishOpening!: () => void;
  const stages: string[] = [];
  await assert.rejects(authenticate(clientId, {
    signal: controller.signal,
    onProgress: stage => stages.push(stage),
    openExternal(url) {
      callback = new URL(new URL(url).searchParams.get('redirect_uri')!);
      queueMicrotask(() => controller.abort());
      return new Promise<void>(resolve => { finishOpening = resolve; });
    },
  }), error => error instanceof AuthError && error.code === 'CANCELLED');
  finishOpening();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stages, ['opening']);
  await assert.rejects(fetch(callback!));
  await assert.rejects(authenticate(clientId, {
    openExternal: () => new Promise<void>(() => {}), loginTimeoutMs: 5,
  }), error => error instanceof AuthError && error.code === 'TIMEOUT');
});

test('a valid manual-browser callback completes login while OS activation is stalled', async () => {
  let authorizationUrl = '';
  let finishOpening!: () => void;
  const stages: string[] = [];
  const result = authenticate(clientId, {
    fetch: authFetch(), loginTimeoutMs: 1000,
    onAuthorizationUrl: url => { authorizationUrl = url; },
    onProgress: stage => stages.push(stage),
    openExternal() { return new Promise<void>(resolve => { finishOpening = resolve; }); },
  });
  while (!authorizationUrl) await new Promise(resolve => setImmediate(resolve));
  const authorization = new URL(authorizationUrl);
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!);
  callback.searchParams.set('code', 'manual-browser-code');
  assert.equal((await fetch(callback)).status, 200);
  assert.equal((await result).profile.id, profileId);
  finishOpening();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stages, ['opening', 'verifying']);
});

test('browser launch errors do not expose OS details or the authorization URL', async () => {
  await assert.rejects(authenticate(clientId, {
    openExternal() { throw new Error('private OS detail with credentials'); },
  }), error => error instanceof AuthError && error.code === 'BROWSER' && !error.message.includes('private OS detail'));
});
