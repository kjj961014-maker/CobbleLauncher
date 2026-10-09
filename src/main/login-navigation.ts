const MICROSOFT_LOGIN_HOSTS = new Set([
  'login.microsoftonline.com', 'login.live.com', 'account.live.com',
  'account.microsoft.com', 'signup.live.com', 'consent.live.com',
  'login.microsoft.com', 'login.windows.net',
]);

/** Only Microsoft account pages and this attempt's exact loopback callback. */
export function isLoginNavigationAllowed(value: string, redirect: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:' && !url.port && MICROSOFT_LOGIN_HOSTS.has(url.hostname)) return true;
    const callback = new URL(redirect);
    return callback.protocol === 'http:' && callback.hostname === 'localhost' &&
      callback.pathname === '/callback' && url.origin === callback.origin &&
      url.pathname === callback.pathname && !url.hash;
  } catch { return false; }
}
