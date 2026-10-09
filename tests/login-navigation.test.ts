import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoginNavigationAllowed } from '../src/main/login-navigation';

const redirect = 'http://localhost:54321/callback';
test('login popup permits Microsoft personal account flows and only its exact callback', () => {
  for (const url of ['https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    'https://login.live.com/oauth20_authorize.srf', 'https://account.live.com/proofs/Manage',
    'https://account.microsoft.com/', 'https://signup.live.com/', `${redirect}?code=fixture&state=fixture`]) {
    assert.ok(isLoginNavigationAllowed(url, redirect), url);
  }
});
test('login popup rejects lookalike hosts, credentials, executable protocols and other local services', () => {
  for (const url of ['https://login.live.com.evil.invalid/', 'https://evil.invalid/?login.live.com',
    'https://login.live.com@evil.invalid/', 'https://evil@login.live.com/',
    'http://login.live.com/', 'https://login.live.com:444/', 'file:///C:/Windows/',
    'javascript:alert(1)', 'data:text/html,test', 'http://localhost:54322/callback',
    'http://localhost:54321/other', `${redirect}/`, `${redirect}#token=fixture`,
    'http://127.0.0.1:54321/callback', 'not a url']) {
    assert.equal(isLoginNavigationAllowed(url, redirect), false, url);
  }
});
