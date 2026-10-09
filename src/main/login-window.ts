import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { isLoginNavigationAllowed } from './login-navigation';

export interface LoginWindow {
  ready: Promise<void>;
  close(): void;
}

/** Remote Microsoft content never receives the launcher's preload or IPC bridge. */
export function openLoginWindow(url: string, options: {
  parent: BrowserWindow;
  onClose: () => void;
  onProblem: (message: string) => void;
  show?: boolean;
}): LoginWindow {
  const authorization = new URL(url);
  const redirect = authorization.searchParams.get('redirect_uri') ?? '';
  if (authorization.origin !== 'https://login.microsoftonline.com' ||
      authorization.pathname !== '/consumers/oauth2/v2.0/authorize' ||
      !isLoginNavigationAllowed(redirect, redirect)) throw new Error('로그인 주소가 올바르지 않습니다.');

  // No persist: prefix: browser cookies/storage belong to this attempt only.
  const isolated = session.fromPartition(`microsoft-login-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  const popup = new BrowserWindow({
    parent: options.parent, width:520, height:720, minWidth:460, minHeight:580,
    title:'Microsoft 계정 로그인 · Cobble Launcher', backgroundColor:'#ffffff',
    show:false, autoHideMenuBar:true, minimizable:false, maximizable:false,
    webPreferences: {
      session:isolated, contextIsolation:true, nodeIntegration:false,
      nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false,
      sandbox:true, webSecurity:true, webviewTag:false, devTools:false,
      safeDialogs:true, navigateOnDragDrop:false, spellcheck:false,
    },
  });
  popup.setMenu(null);
  let finishing = false;
  const problem = () => {
    if (!finishing) options.onProblem('이 로그인 방식은 별도 브라우저가 필요합니다. 로그인 주소를 복사해 Chrome 또는 Edge에서 계속해 주세요.');
  };
  const guard = (event: Electron.Event, target: string) => {
    if (!isLoginNavigationAllowed(target, redirect)) { event.preventDefault(); problem(); }
  };
  popup.webContents.on('will-navigate', guard);
  popup.webContents.on('will-redirect', guard);
  popup.webContents.on('will-attach-webview', event => event.preventDefault());
  popup.on('page-title-updated', event => event.preventDefault());
  // Also guard programmatic and window.open navigations, not only link clicks.
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const cancel = details.resourceType === 'mainFrame' && !isLoginNavigationAllowed(details.url, redirect);
    callback({ cancel });
    if (cancel) problem();
  });
  popup.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLoginNavigationAllowed(target, redirect)) void popup.loadURL(target).catch(problem);
    else problem();
    return { action:'deny' };
  });
  popup.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) problem();
  });
  popup.webContents.on('render-process-gone', problem);
  popup.once('closed', () => {
    isolated.webRequest.onBeforeRequest(null);
    void Promise.allSettled([isolated.clearStorageData(), isolated.closeAllConnections()]);
    if (!finishing) options.onClose();
  });
  const ready = popup.loadURL(url).catch(() => {
    // Keep the attempt active so the current PKCE link can be opened externally.
    problem();
  });
  if (options.show !== false) { popup.show(); popup.focus(); }
  return {
    ready,
    close() { finishing = true; if (!popup.isDestroyed()) popup.destroy(); },
  };
}
