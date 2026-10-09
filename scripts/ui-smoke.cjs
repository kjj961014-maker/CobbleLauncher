/* Runs the real Electron renderer and IPC bridge with an isolated --ui-test profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); }
  catch {
    const bundled = process.env.CODEX_PLAYWRIGHT_PATH || path.join(
      process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime',
      'dependencies', 'node', 'node_modules', 'playwright',
    );
    try { return require(bundled); }
    catch { throw new Error('UI smoke needs Playwright. Set CODEX_PLAYWRIGHT_PATH to its package directory or install the playwright dev dependency.'); }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results', 'ui-electron');
  await fs.mkdir(output, { recursive: true });
  const { _electron } = loadPlaywright();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({
    executablePath: require('electron'), args: [root, '--ui-test'], cwd: root, env,
    timeout: 45000,
  });
  const report = { passed: [], errors: [], screenshots: [], initial: null, final: null, security: { expectedDenials: [], networkRequests: 0, encryptedCredentialBytes: 0 } };
  let page;
  let fixtureStored = false;
  const capture = async (name) => {
    const filename = path.join(output, `${name}.png`);
    const closeToast = page.getByRole('button', { name: '알림 닫기', exact: true });
    if (await closeToast.isVisible()) await closeToast.click();
    await page.mouse.move(0, 0);
    const png = await electron.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:'));
      await window.webContents.insertCSS('*{animation:none!important;transition:none!important}');
      window.webContents.invalidate();
      await window.webContents.capturePage();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const image = await window.webContents.capturePage();
      return image.toPNG().toString('base64');
    });
    await fs.writeFile(filename, Buffer.from(png, 'base64'));
    report.screenshots.push(filename);
  };
  const check = (condition, message) => { assert.ok(condition, message); report.passed.push(message); };
  try {
    page = await electron.firstWindow({ timeout: 45000 });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await page.waitForFunction(() => Boolean(window.launcher));
    const userData = await electron.evaluate(({ app }) => app.getPath('userData'));
    check(path.resolve(userData) === path.join(root, 'test-results', 'ui-data'), 'isolated Electron userData directory');
    await page.evaluate(() => localStorage.removeItem('cobble-onboarding-seen'));
    await page.reload();
    await page.getByRole('dialog').waitFor();
    report.initial = await page.evaluate(() => window.launcher.getState());
    check(report.initial.auth.status === 'signed-out' && report.initial.profile === null, 'real signed-out account state');
    check(report.initial.server.status === 'unconfigured', 'unconfigured server shown honestly');
    await capture('onboarding');
    await page.getByRole('button', { name: '로그인 설정 시작하기', exact: true }).click();
    await page.getByLabel('애플리케이션 Client ID').waitFor();
    check(await page.getByRole('button', { name: '계정 및 연결', exact: true }).getAttribute('class') === 'active', 'onboarding opens Microsoft configuration directly');
    await page.getByLabel('애플리케이션 Client ID').fill('invalid-client-id');
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'UUID' }).waitFor();
    check((await page.evaluate(() => window.launcher.getState())).settings.microsoftClientId === '', 'invalid Client ID prevented before IPC save');
    await page.getByLabel('애플리케이션 Client ID').fill('');
    await page.getByRole('button', { name: '게임 환경', exact: true }).click();
    const memory = page.getByRole('slider', { name: '게임 메모리 할당량' });
    const before = Number(await memory.inputValue());
    await memory.focus();
    await memory.press(before > 2048 ? 'ArrowLeft' : 'ArrowRight');
    const desired = Number(await memory.inputValue());
    check(desired !== before, 'memory slider changes draft value');
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '설정을 저장했습니다.' }).waitFor();
    const saved = await page.evaluate(() => window.launcher.getState());
    check(saved.settings.memoryMb === desired, 'real IPC setting saved without readonly-field rejection');
    await page.getByRole('button', { name: '파일 및 진단', exact: true }).click();
    await page.getByRole('heading', { name: '최근 실행 기록' }).waitFor();
    check(await page.getByRole('button', { name: '파일 검사 및 복구', exact: true }).isDisabled(), 'repair disabled before installation');
    await capture('diagnostics');
    const menu = page.getByRole('navigation', { name: '주 메뉴' });
    await menu.getByRole('button', { name: '게임 가이드', exact: true }).click();
    await page.getByRole('heading', { name: /첫 모험을 위한 안내/ }).waitFor();
    await page.getByText('Minecraft를 별도로 구매해야 하나요?', { exact: true }).click();
    check(await page.getByText('네. Minecraft Java Edition을 플레이할 수 있는 정식 Microsoft 계정이 필요합니다.', { exact: false }).isVisible(), 'guide FAQ expands');
    await capture('guide');
    await menu.getByRole('button', { name: '업데이트 소식', exact: true }).click();
    await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '업데이트 확인을 완료했습니다.' }).waitFor();
    check((await page.evaluate(() => window.launcher.getState())).update.status === 'unconfigured', 'real update check preserves unconfigured status');
    await page.getByRole('button', { name: /^패치 노트/ }).click();
    await page.getByText('패치 노트를 기다리고 있어요', { exact: true }).waitFor();
    await capture('updates');
    await menu.getByRole('button', { name: '계정', exact: true }).click();
    await page.getByRole('heading', { name: /내 계정/ }).waitFor();
    await capture('account');
    await menu.getByRole('button', { name: '홈', exact: true }).click();
    await page.getByText('나만의 모험이 시작되는 곳', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: '로그인하고 시작하기', exact: true }).isVisible(), 'real home action asks for login before launch');
    await capture('home');
    await electron.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(1000, 700);
    });
    await page.waitForFunction(() => window.innerWidth <= 1000);
    const layout = await page.evaluate(() => {
      const documentWidth = document.documentElement.scrollWidth;
      const header = document.querySelector('.header-account').getBoundingClientRect();
      const dock = document.querySelector('.launch-button').getBoundingClientRect();
      return {
        overflow: documentWidth > window.innerWidth,
        controlsClear: header.right <= window.innerWidth - 140,
        actionVisible: dock.bottom <= window.innerHeight && dock.right <= window.innerWidth,
        width: window.innerWidth, height: window.innerHeight,
      };
    });
    check(!layout.overflow, '1000x700 layout has no horizontal overflow');
    check(layout.controlsClear, 'native Windows titlebar control area remains clear');
    check(layout.actionVisible, 'primary action remains visible at minimum tested window');
    await capture('home-1000x700');
    report.final = await page.evaluate(() => window.launcher.getState());
    check(report.errors.length === 0, 'no renderer JavaScript errors');
    check(!report.final.logs.some((log) => ['error', 'renderer'].includes(log.level)), 'no Electron renderer or backend errors in UI flow');

    // Deliberately invalid requests below must be rejected by main-process IPC,
    // independently of disabled buttons and renderer-side validation.
    const reject = async (method, argument) => {
      const result = await page.evaluate(async ({ method, argument }) => {
        try { await window.launcher[method](argument); return { rejected: false, message: '' }; }
        catch (error) { return { rejected: true, message: String(error) }; }
      }, { method, argument });
      if (result.rejected) report.security.expectedDenials.push({ method, message: result.message });
      return result;
    };
    const fixtureKey = 'cobble-ui-safe-storage-fixture-not-a-real-key-20261009';
    check(await electron.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), 'Windows safeStorage encryption available');
    await page.evaluate((key) => window.launcher.saveSettings({ curseforgeApiKey: key }), fixtureKey);
    fixtureStored = true;
    const configured = await page.evaluate(() => window.launcher.getState());
    check(configured.settings.curseforgeApiKeyConfigured === true, 'dummy credential configures real encrypted vault');
    check(!JSON.stringify(configured).includes(fixtureKey), 'getState and in-memory logs exclude plaintext credential');
    const settingsText = await fs.readFile(path.join(userData, 'settings.json'), 'utf8');
    check(!settingsText.includes(fixtureKey) && !Object.hasOwn(JSON.parse(settingsText), 'curseforgeApiKey'), 'settings JSON excludes plaintext credential field and value');
    const encryptedFile = path.join(userData, 'credentials', 'curseforge.encrypted');
    const encrypted = await fs.readFile(encryptedFile);
    report.security.encryptedCredentialBytes = encrypted.length;
    check(encrypted.length > 0 && !encrypted.includes(Buffer.from(fixtureKey)) && !encrypted.includes(Buffer.from(fixtureKey, 'utf16le')), 'credential file bytes exclude UTF-8 and UTF-16 plaintext');
    const logText = await fs.readFile(path.join(userData, 'logs', 'launcher.log'), 'utf8');
    check(!logText.includes(fixtureKey), 'persisted launcher logs exclude plaintext credential');

    await electron.evaluate(({ BrowserWindow }) => {
      globalThis.__cobbleUiOutgoing = [];
      globalThis.__cobbleUiOriginalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => {
        globalThis.__cobbleUiOutgoing.push(String(args[0]));
        return Promise.reject(new Error('UI security test blocks unexpected Node fetch.'));
      };
      BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (details, callback) => { globalThis.__cobbleUiOutgoing.push(details.url); callback({ cancel: true }); },
      );
    });
    try {
      const deniedInstall = await reject('install');
      check(deniedInstall.rejected && /Microsoft.*로그인/.test(deniedInstall.message), 'main IPC rejects installation while signed out before downloads');
      const deniedLaunch = await reject('launch');
      check(deniedLaunch.rejected && /먼저 설치/.test(deniedLaunch.message), 'main IPC rejects launch before game installation');
      report.security.networkRequests = await electron.evaluate(() => globalThis.__cobbleUiOutgoing.length);
      check(report.security.networkRequests === 0, 'signed-out install and premature launch make no network requests');
    } finally {
      await electron.evaluate(({ BrowserWindow }) => {
        globalThis.fetch = globalThis.__cobbleUiOriginalFetch;
        BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest(null);
      });
    }
    const deniedUnknown = await reject('saveSettings', { arbitraryUntrustedProperty: true });
    check(deniedUnknown.rejected && /unrecognized|Unrecognized/.test(deniedUnknown.message), 'main IPC rejects arbitrary settings properties');
    const deniedHttp = await reject('saveSettings', { updateUrl: 'http://example.invalid/manifest.json' });
    check(deniedHttp.rejected, 'main IPC rejects an HTTP update channel');
    const afterDenials = await page.evaluate(() => window.launcher.getState());
    check(afterDenials.settings.updateUrl === '' && afterDenials.operation === null && !afterDenials.game.running && afterDenials.installation.status === 'not-installed', 'rejected IPC requests leave settings and installation unchanged');
    check(!JSON.stringify(afterDenials).includes(fixtureKey), 'state and rejection logs still exclude dummy credential');

    // A real isolated popup, with only its network navigation replaced by a
    // stalled fixture. Never visit or inject scripts into an account page.
    await electron.evaluate(({ BrowserWindow, shell, clipboard }) => {
      globalThis.__cobbleOriginalOpener = shell.openExternal;
      globalThis.__cobbleOriginalClipboardWrite = clipboard.writeText;
      globalThis.__cobbleOriginalLoadURL = BrowserWindow.prototype.loadURL;
      globalThis.__cobbleOriginalAuthFetch = globalThis.fetch;
      globalThis.__cobbleCopiedLogin = '';
      globalThis.__cobblePopupUrl = '';
      globalThis.__cobbleExternalCount = 0;
      shell.openExternal = () => { globalThis.__cobbleExternalCount++; return new Promise(() => {}); };
      BrowserWindow.prototype.loadURL = function(url, ...args) {
        if (url.startsWith('https://login.microsoftonline.com/')) {
          globalThis.__cobblePopupUrl = url;
          globalThis.__cobblePopupId = this.id;
          return new Promise(() => {});
        }
        return globalThis.__cobbleOriginalLoadURL.call(this, url, ...args);
      };
      clipboard.writeText = value => { globalThis.__cobbleCopiedLogin = value; };
    });
    try {
      await page.evaluate(() => window.launcher.saveSettings({ microsoftClientId: '11111111-2222-4333-8444-555555555555' }));
      await page.getByRole('button', { name: '알림 닫기', exact: true }).click().catch(() => {});
      await page.getByRole('button', { name: '로그인하고 시작하기', exact: true }).click();
      await page.getByRole('button', { name: '로그인 주소 복사', exact: true }).waitFor();
      const popupSecurity = await electron.evaluate(({ BrowserWindow }) => {
        const popup = BrowserWindow.fromId(globalThis.__cobblePopupId);
        const preferences = popup.webContents.getLastWebPreferences();
        const owner = popup.getParentWindow();
        let blocked = false;
        popup.webContents.emit('will-navigate', { preventDefault() { blocked = true; } }, 'https://evil.invalid/');
        return { exists:!!popup, parent:!!owner, isolated:popup.webContents.session !== owner.webContents.session,
          preload:preferences.preload, node:preferences.nodeIntegration, sandbox:preferences.sandbox,
          context:preferences.contextIsolation, webSecurity:preferences.webSecurity, blocked,
          external:globalThis.__cobbleExternalCount };
      });
      check(popupSecurity.exists && popupSecurity.parent && popupSecurity.external === 0, 'login opens a dedicated child popup without invoking the system browser');
      check(popupSecurity.isolated && !popupSecurity.preload && !popupSecurity.node && popupSecurity.sandbox && popupSecurity.context && popupSecurity.webSecurity, 'remote login popup has isolated storage, sandbox, and no launcher preload or Node access');
      check(popupSecurity.blocked, 'login popup rejects navigation to an unrelated site');
      check(await page.getByRole('button', { name: '로그인 주소 복사', exact: true }).evaluate(element => element.getBoundingClientRect().bottom < document.querySelector('.launch-dock').getBoundingClientRect().top), 'browser fallback remains visible above the dock at minimum window size');
      check(await page.getByRole('button', { name: '로그인 진행 중', exact: true }).isDisabled(), 'pending login is identified as login, not game preparation');
      await capture('login-browser-fallback');
      await menu.getByRole('button', { name: '설정', exact: true }).click();
      check(await page.getByRole('button', { name: '설정 저장', exact: true }).locator('.spin').count() === 0, 'unrelated settings save button does not spin during login');
      await menu.getByRole('button', { name: '계정', exact: true }).click();
      await page.getByRole('button', { name: '로그인 주소 복사', exact: true }).click();
      check(await electron.evaluate(() => {
        const url = new URL(globalThis.__cobbleCopiedLogin);
        return url.origin === 'https://login.microsoftonline.com' && url.searchParams.get('client_id') === '11111111-2222-4333-8444-555555555555' && url.searchParams.get('code_challenge_method') === 'S256' && !url.searchParams.has('access_token');
      }), 'manual fallback copies only the current official PKCE authorization link');
      await page.getByRole('button', { name: '로그인 취소', exact: true }).click();
      await page.waitForFunction(async () => !(await window.launcher.getState()).operation && !document.querySelector('.launch-button').disabled);
      check((await page.evaluate(() => window.launcher.getState())).auth.status === 'error', 'cancellation releases pending browser login and enables retry');
      check(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1), 'cancel closes the pending login popup');
      const expiredCopy = await reject('copyLoginLink');
      check(expiredCopy.rejected, 'finished login cannot copy an expired authorization link');
      await page.getByRole('button', { name: 'Microsoft 계정 로그인', exact: true }).click();
      await page.getByRole('button', { name: '로그인 취소', exact: true }).waitFor();
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.fromId(globalThis.__cobblePopupId).close());
      await page.waitForFunction(async () => !(await window.launcher.getState()).operation && !document.querySelector('.launch-button').disabled);
      check((await page.evaluate(() => window.launcher.getState())).operation === null, 'closing the popup cancels login and allows another attempt');
      await capture('login-cancelled');

      // Complete the real loopback/state/PKCE path with fake upstream responses.
      // This proves popup cleanup cannot cancel the subsequent token exchange.
      await electron.evaluate(({ BrowserWindow }) => {
        globalThis.__cobblePopupClosedAtExchange = false;
        globalThis.fetch = async (url) => {
          let body;
          if (url.endsWith('/token')) {
            globalThis.__cobblePopupClosedAtExchange = BrowserWindow.getAllWindows().length === 1;
            body = { access_token:'ui-ms-fixture', refresh_token:'ui-refresh-fixture' };
          } else if (url.includes('user.auth.xboxlive.com') || url.includes('xsts.auth.xboxlive.com')) {
            body = { Token:'ui-xbox-fixture', DisplayClaims:{ xui:[{ uhs:'123456' }] } };
          } else if (url.endsWith('/login_with_xbox')) {
            body = { access_token:'ui-minecraft-fixture', expires_in:3600 };
          } else if (url.endsWith('/entitlements/mcstore')) {
            body = { items:[{ name:'game_minecraft' }] };
          } else if (url.endsWith('/minecraft/profile')) {
            body = { id:'0123456789abcdef0123456789abcdef', name:'PopupFixture' };
          } else throw new Error('Unexpected authentication fixture endpoint');
          return new Response(JSON.stringify(body), { status:200 });
        };
      });
      await page.getByRole('button', { name: 'Microsoft 계정 로그인', exact: true }).click();
      await page.getByRole('button', { name: '로그인 취소', exact: true }).waitFor();
      const callbackStatus = await electron.evaluate(async () => {
        const authorization = new URL(globalThis.__cobblePopupUrl);
        const callback = new URL(authorization.searchParams.get('redirect_uri'));
        callback.hostname = '127.0.0.1';
        callback.search = new URLSearchParams({ code:'ui-code-fixture', state:authorization.searchParams.get('state') });
        return (await globalThis.__cobbleOriginalAuthFetch(callback)).status;
      });
      await page.waitForFunction(async () => (await window.launcher.getState()).auth.status === 'signed-in');
      check(callbackStatus === 200 && await electron.evaluate(() => globalThis.__cobblePopupClosedAtExchange), 'verified callback automatically closes popup before token exchange without cancelling authentication');
      check((await page.evaluate(() => window.launcher.getState())).profile.name === 'PopupFixture', 'popup flow completes ownership and profile validation using explicit test fixtures');
      await page.evaluate(() => window.launcher.logout());

      // A server may reject authentication with an empty body. The real IPC/UI
      // must retain the HTTP stage and release the operation for another login.
      await electron.evaluate(() => {
        const normal = globalThis.fetch;
        globalThis.fetch = (url, init) => url.includes('user.auth.xboxlive.com') ?
          Promise.resolve(new Response('', { status:401 })) : normal(url, init);
      });
      await page.getByRole('button', { name: 'Microsoft 계정 로그인', exact: true }).click();
      await page.getByRole('button', { name: '로그인 취소', exact: true }).waitFor();
      await electron.evaluate(async () => {
        const authorization = new URL(globalThis.__cobblePopupUrl);
        const callback = new URL(authorization.searchParams.get('redirect_uri'));
        callback.hostname = '127.0.0.1';
        callback.search = new URLSearchParams({ code:'ui-code-fixture', state:authorization.searchParams.get('state') });
        await globalThis.__cobbleOriginalAuthFetch(callback);
      });
      await page.waitForFunction(async () => (await window.launcher.getState()).auth.status === 'error' && !(await window.launcher.getState()).operation);
      const deniedAuth = await page.evaluate(() => window.launcher.getState());
      check(deniedAuth.auth.message.includes('Xbox 계정 인증, HTTP 401') && !deniedAuth.profile && !await page.getByRole('button', { name:'Microsoft 계정 로그인', exact:true }).isDisabled(), 'empty Xbox HTTP rejection shows its real stage and allows retry without creating a profile');
      check(deniedAuth.logs.some(entry => entry.message === '인증 응답: Xbox 계정 인증 · HTTP 401 · empty') && !/ui-ms-fixture|ui-refresh-fixture|ui-code-fixture|ui-xbox-fixture|ui-minecraft-fixture/.test(JSON.stringify(deniedAuth)), 'authentication diagnostics identify HTTP failures without codes or tokens in renderer state');
      await capture('login-http-denial');
    } finally {
      await page.evaluate(() => window.launcher.cancelOperation());
      await page.waitForFunction(async () => !(await window.launcher.getState()).operation);
      await page.evaluate(() => window.launcher.logout());
      await electron.evaluate(({ BrowserWindow, shell, clipboard }) => {
        shell.openExternal = globalThis.__cobbleOriginalOpener;
        clipboard.writeText = globalThis.__cobbleOriginalClipboardWrite;
        BrowserWindow.prototype.loadURL = globalThis.__cobbleOriginalLoadURL;
        globalThis.fetch = globalThis.__cobbleOriginalAuthFetch;
        delete globalThis.__cobbleCopiedLogin;
      });
      await page.evaluate(() => window.launcher.saveSettings({ microsoftClientId: '' }));
    }
    await page.evaluate(() => window.launcher.saveSettings({ curseforgeApiKey: '' }));
    fixtureStored = false;
    report.final = await page.evaluate(() => window.launcher.getState());
    check(report.final.settings.curseforgeApiKeyConfigured === false, 'empty credential clears real vault configuration');
    const credentialRemains = await fs.stat(encryptedFile).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
    check(!credentialRemains, 'cleared credential removes encrypted file');
    check(report.errors.length === 0 && !report.final.logs.some((log) => log.level === 'renderer'), 'security rejection tests produce no renderer errors');
  } catch (error) {
    report.errors.push(error.stack || String(error));
    if (page) await capture('failure').catch(() => {});
    throw error;
  } finally {
    if (fixtureStored && page) {
      await page.evaluate(() => window.launcher.saveSettings({ curseforgeApiKey: '' })).catch((error) => report.errors.push(`Fixture cleanup failed: ${error.message}`));
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await electron.close().catch(() => {});
    console.log(JSON.stringify({ passed: report.passed.length, errors: report.errors, output }, null, 2));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
