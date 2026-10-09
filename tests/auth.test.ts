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

test('PKCE login ignores a forged callback, verifies ownership and exchanges the matching verifier', async () => {
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
