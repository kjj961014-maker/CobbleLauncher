import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, Bell, BookOpen, Check, CheckCircle2, ChevronRight,
  CircleHelp, Cloud, Compass, Download, ExternalLink, FolderOpen, Gamepad2,
  HardDrive, Home, Info, KeyRound, LoaderCircle, LogIn, LogOut, MemoryStick,
  Monitor, Newspaper, Play, RefreshCw, Settings, ShieldCheck, Sparkles, UserRound,
  Wifi, X,
} from 'lucide-react';
import type { LauncherAPI, LauncherState } from '../shared/types';

type Page = 'home' | 'guide' | 'updates' | 'account' | 'settings';
type SettingsSection = 'game' | 'connection' | 'maintenance';
const api = (window as unknown as { launcher?: LauncherAPI }).launcher;
const navigation = [
  { id: 'home' as const, label: '홈', icon: Home },
  { id: 'guide' as const, label: '게임 가이드', icon: BookOpen },
  { id: 'updates' as const, label: '업데이트 소식', icon: Newspaper },
  { id: 'account' as const, label: '계정', icon: UserRound },
  { id: 'settings' as const, label: '설정', icon: Settings },
];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function dateLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true"><span /><span /><span /><span /></span>;
}

function WorldIllustration() {
  return <div className="world-illustration" aria-hidden="true">
    <svg viewBox="0 0 600 400" fill="none" className="world-svg">
      <defs>
        <linearGradient id="landSide" x1="250" y1="260" x2="370" y2="378" gradientUnits="userSpaceOnUse"><stop stopColor="#7199B8" /><stop offset="1" stopColor="#406885" /></linearGradient>
        <linearGradient id="landTop" x1="300" y1="190" x2="300" y2="295" gradientUnits="userSpaceOnUse"><stop stopColor="#BDE7B2" /><stop offset="1" stopColor="#78C49D" /></linearGradient>
        <linearGradient id="water" x1="340" y1="220" x2="395" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#A4F0FA" /><stop offset="1" stopColor="#5AC9EC" /></linearGradient>
        <linearGradient id="tower" x1="270" y1="155" x2="320" y2="233" gradientUnits="userSpaceOnUse"><stop stopColor="#F9FDFF" /><stop offset="1" stopColor="#D6E9F4" /></linearGradient>
        <filter id="islandShadow" x="0" y="0" width="600" height="500" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>
      <ellipse cx="326" cy="367" rx="142" ry="15" fill="#5788A2" opacity=".16" filter="url(#islandShadow)" />
      <path d="M186 286 332 202 477 286 332 370Z" fill="url(#landSide)" />
      <path d="M186 248 332 164 477 248 332 332Z" fill="url(#landTop)" />
      <path d="M186 248v38l146 84v-38Z" fill="#7397A8" /><path d="m332 332 145-84v38l-145 84Z" fill="#567D91" />
      <path d="m187 248 145 84v10l-145-84Z" fill="#88B899" /><path d="m332 332 145-84v10l-145 84Z" fill="#6CA58C" />
      <path d="m203 258 27 16v18l-27-15ZM253 299l25 14v17l-25-14ZM298 334l20 12v17l-20-12Z" fill="#90A8B7" />
      <path d="m358 336 24-14v16l-24 14ZM419 301l27-15v15l-27 16Z" fill="#3E647E" />
      <path d="m338 202 62 36-32 19 60 34-33 19-94-54 34-20-27-15Z" fill="url(#water)" />
      <path d="m359 254 46 27-9 5-46-26ZM344 214l32 18-10 6-31-18Z" fill="#DCF9FE" opacity=".8" />
      <path d="m395 310 32-19v42l-32 19Z" fill="#79D9F1" opacity=".9" /><path d="m402 309 8-5v40l-8 5Z" fill="#C9F7FF" />
      <path d="m248 222 46-27 48 27-48 28Z" fill="#D6E6EC" /><path d="m248 222 46 28v11l-46-27Z" fill="#A8C7D5" /><path d="m294 250 48-28v11l-48 28Z" fill="#86AEC1" />
      <path d="m262 182 33-19 34 19v43l-34 20-33-20Z" fill="url(#tower)" /><path d="m295 202 34-20v43l-34 20Z" fill="#A5C7DC" />
      <path d="m254 180 41-24 42 24-42 24Z" fill="#F3FBFF" /><path d="m254 180 41 24v8l-41-24Z" fill="#B6D9EC" /><path d="m295 204 42-24v8l-42 24Z" fill="#91BBD2" />
      <path d="m277 177 18-10 18 10-18 11Z" fill="#529EE5" /><path d="m277 177 18 11v6l-18-10Z" fill="#2876C6" /><path d="m295 188 18-11v6l-18 11Z" fill="#398BCF" />
      <path d="m273 202 11 6v16l-11-6Z" fill="#65A8DA" /><path d="m304 210 12-7v18l-12 7Z" fill="#DDF6FF" />
      <path d="m298 137 0 25" stroke="#7BB1CB" strokeWidth="3" /><path d="m298 136 29-9v17l-29 8Z" fill="#3B99EC" /><path d="m313 132 14-5v17l-14 4Z" fill="#6CC6F5" />
      <path d="m231 224 0-42" stroke="#7A9674" strokeWidth="7" /><path d="m202 181 29-17 29 17-29 17Z" fill="#78B4A0" /><path d="m202 181 29 17v25l-29-17Z" fill="#64A28D" /><path d="m231 198 29-17v25l-29 17Z" fill="#4C8D80" />
      <path d="m389 221 0-45" stroke="#7A9674" strokeWidth="7" /><path d="m360 175 29-17 29 17-29 17Z" fill="#8EC5A8" /><path d="m360 175 29 17v25l-29-17Z" fill="#6CAA95" /><path d="m389 192 29-17v25l-29 17Z" fill="#519584" />
      <path d="m438 255 0-31" stroke="#7A9674" strokeWidth="5" /><path d="m416 219 22-13 22 13-22 13Z" fill="#A4D2B5" /><path d="m416 219 22 13v20l-22-13Z" fill="#82B7A2" /><path d="m438 232 22-13v20l-22 13Z" fill="#6FA58F" />
      <path d="m239 259 14-8 15 8-15 9Z" fill="#F6FBFF" /><path d="m239 259 14 9v14l-14-9Z" fill="#DFEDF6" /><path d="m253 268 15-9v14l-15 9Z" fill="#A9CCDF" />
      <path d="m272 278 12-7 13 7-13 8Z" fill="#F4C571" /><path d="m272 278 12 8v10l-12-7Z" fill="#E7AB57" /><path d="m284 286 13-8v10l-13 8Z" fill="#DCA057" />
      <path d="m220 150 22-13 22 13-22 13Z" fill="#E8FAFF" /><path d="m220 150 22 13v11l-22-13Z" fill="#CFEDF8" /><path d="m242 163 22-13v11l-22 13Z" fill="#B4DDEB" />
      <path d="m397 111 29-17 30 17-30 17Z" fill="#ECFAFF" /><path d="m397 111 29 17v13l-29-17Z" fill="#D6EFF8" /><path d="m426 128 30-17v13l-30 17Z" fill="#BFDFEC" />
      <path d="m346 93 7-4 7 4-7 4Z" fill="#70B8ED" /><path d="m346 93 7 4v9l-7-4Z" fill="#4998D4" /><path d="m353 97 7-4v9l-7 4Z" fill="#347CB9" />
      <circle cx="182" cy="199" r="3" fill="#F4FCFF" /><circle cx="442" cy="156" r="3" fill="#F4FCFF" />
      <path d="M461 209v10m-5-5h10M264 114v10m-5-5h10" stroke="#FFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </div>;
}

function PlayerAvatar({ state, large = false }: { state: LauncherState; large?: boolean }) {
  const [skinError, setSkinError] = useState(false);
  useEffect(() => setSkinError(false), [state.profile?.skinUrl]);
  return <div className={`player-avatar${large ? ' large' : ''}`}>
    {state.profile?.skinUrl && !skinError
      ? <div className="skin-head" style={{ backgroundImage: `url("${state.profile.skinUrl.replace(/["\\]/g, '')}")` }}><img src={state.profile.skinUrl} alt="" className="skin-test" onError={() => setSkinError(true)} /></div>
      : <UserRound size={large ? 46 : 26} strokeWidth={1.5} />}
    {large && <span className="avatar-spark spark-one" />}{large && <span className="avatar-spark spark-two" />}
  </div>;
}

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{children}</p></div>;
}

export default function App() {
  const [state, setState] = useState<LauncherState | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('game');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstState = useRef(true);

  const notify = (message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error: isError });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  useEffect(() => {
    if (!api) { setError('런처 연결을 찾을 수 없습니다. 데스크톱 앱으로 실행해 주세요.'); return; }
    const accept = (next: LauncherState) => {
      setState(next);
      if (firstState.current) {
        firstState.current = false;
        if (next.auth.status !== 'signed-in' && !localStorage.getItem('cobble-onboarding-seen')) setOnboarding(true);
      }
    };
    const unsubscribe = api.onState(accept);
    api.getState().then(accept).catch((cause) => setError(String(cause instanceof Error ? cause.message : cause)));
    return () => { unsubscribe(); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  useEffect(() => {
    if (!onboarding) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.welcome-modal');
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    controls().find((button) => button.classList.contains('primary'))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { localStorage.setItem('cobble-onboarding-seen', '1'); setOnboarding(false); }
      if (event.key !== 'Tab') return;
      const buttons = controls();
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onboarding]);

  const action = async (name: string, callback: () => Promise<unknown>, success?: string) => {
    if (busy) return;
    setBusy(name);
    try { await callback(); if (success) notify(success); }
    catch (cause) { notify(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : String(cause), true); }
    finally { setBusy(''); }
  };
  const dismissOnboarding = () => { localStorage.setItem('cobble-onboarding-seen', '1'); setOnboarding(false); };
  const openSettings = (section: SettingsSection = 'game') => { setSettingsSection(section); setPage('settings'); };
  const login = () => {
    if (!state?.settings.microsoftClientId) { openSettings('connection'); dismissOnboarding(); notify('Microsoft 애플리케이션의 Client ID를 먼저 등록해 주세요.'); return; }
    dismissOnboarding(); void action('login', () => api!.login());
  };
  const cancel = async () => {
    try { await api!.cancelOperation(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : String(cause), true); }
  };

  if (!state) return <div className="loading-screen"><BrandMark /><h1>Cobble Launcher</h1>{error ? <><p className="loading-error">{error}</p><button className="button secondary" onClick={() => window.location.reload()}><RefreshCw size={16} /> 다시 시도</button></> : <p><LoaderCircle className="spin" size={17} /> 모험을 준비하고 있어요</p>}</div>;

  const installed = state.installation.status === 'installed';
  const working = Boolean(state.operation) || Boolean(busy) || state.auth.status === 'signing-in';
  const serverLabel = { unconfigured: '서버 연결 설정 전', checking: '서버 확인 중', online: '서버 온라인', offline: '서버 오프라인' }[state.server.status] || '서버 확인 중';
  const primaryLabel = state.game.running ? '게임 실행 중' : state.operation ? '모험을 준비하는 중' : state.auth.status === 'signing-in' ? '로그인 진행 중' : !state.profile ? '로그인하고 시작하기' : !installed ? '게임 설치하기' : '게임 실행';
  const primary = () => {
    if (!state.profile) login();
    else if (!installed) void action('install', () => api!.install());
    else void action('launch', () => api!.launch());
  };
  const goExternal = (url: string) => void action('external', () => api!.openExternal(url));
  const progress = Math.min(100, Math.max(0, state.operation?.progress || 0));

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setPage('home')} aria-label="Cobble Launcher 홈"><BrandMark /><span>Cobble<span className="brand-light"> Launcher</span></span></button>
      <nav className="navigation" aria-label="주 메뉴">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item${page === id ? ' active' : ''}`} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <button className={`header-account${state.profile ? ' connected' : ''}`} onClick={() => setPage('account')} title="계정 관리"><span className="account-dot" /><UserRound size={17} /><span>{state.profile?.name || '로그인'}</span></button>
    </header>

    <main className="content" key={page}>
      {page === 'home' && <>
        <div className="page-eyebrow"><span><Cloud size={15} /> YOUR NEXT ADVENTURE</span><span className="version-label">LAUNCHER {state.appVersion}</span></div>
        <div className="home-main">
          <section className="hero-panel">
            <div className="sky-grid" /><span className="cloud-shape cloud-one" /><span className="cloud-shape cloud-two" />
            <div className="hero-copy"><span className="hero-kicker"><span /> 나만의 모험이 시작되는 곳</span><h1>Immersive<br /><span>Cobblemon</span><span className="hero-period">.</span></h1><p>새로운 친구를 만나고, 나만의 세계를 탐험하세요.<br />당신의 다음 모험을 이곳에서 준비합니다.</p><div className="hero-tags"><span>MINECRAFT {state.pack.minecraftVersion}</span><span>{state.pack.loader}</span><span>v{state.pack.version}</span></div><button className="hero-link" onClick={() => setPage('guide')}>모험을 시작하기 전에 <ArrowRight size={16} /></button></div>
            <WorldIllustration />
            <div className="hero-caption"><span className="little-cross">+</span> EXPLORE. DISCOVER. CONNECT.</div>
          </section>
          <aside className="home-side">
            <section className="panel profile-card"><div className="section-label"><span>내 플레이어</span><button className="icon-button" onClick={() => setPage('account')} title="계정 관리"><ChevronRight size={18} /></button></div><div className="profile-summary"><PlayerAvatar state={state} /><div><strong>{state.profile?.name || '안녕하세요, 모험가님'}</strong><span>{state.profile ? 'Minecraft Java Edition' : '계정을 연결하고 모험을 떠나요'}</span></div></div><div className="profile-divider" />{state.profile ? <div className="verified-line"><ShieldCheck size={15} /> Microsoft 계정 연결됨 <span className="tiny-dot green" /></div> : <button className="button light full" disabled={working} onClick={login}><MicrosoftLogo /> Microsoft 계정 로그인 <ArrowRight size={15} /></button>}</section>
            <section className="panel server-card"><div className="section-label"><span>서버 상태</span><Wifi size={16} /></div><div className={`server-state ${state.server.status}`}><span className="status-light" /><strong>{serverLabel}</strong></div><p>{state.server.status === 'unconfigured' ? '설정에서 서버 주소를 등록하면 접속 상태를 확인할 수 있어요.' : state.server.status === 'online' ? `${state.server.players ?? 0} / ${state.server.maxPlayers ?? 0}명 접속 중${state.server.latencyMs !== undefined ? ` · ${state.server.latencyMs} ms` : ''}` : state.server.status === 'checking' ? '등록된 서버에 연결을 확인하고 있어요.' : '현재 서버에 연결할 수 없어요.'}</p><button className="text-button" onClick={() => openSettings('connection')}>{state.server.status === 'unconfigured' ? '서버 연결 설정' : '연결 설정 확인'} <ArrowRight size={13} /></button></section>
          </aside>
        </div>
        <div className="home-secondary">
          <section className="panel announcement-card"><div className="section-heading"><h2><Bell size={17} /> 새로운 소식</h2><button className="text-button muted" onClick={() => setPage('updates')}>모두 보기 <ChevronRight size={14} /></button></div>{state.announcements.length ? <div className="news-list">{state.announcements.slice(0, 2).map((notice) => <button className="news-row" key={notice.id} onClick={() => setPage('updates')}><span className="news-category">공지</span><span className="news-title">{notice.title}</span><time>{dateLabel(notice.publishedAt)}</time><ChevronRight size={14} /></button>)}</div> : <div className="inline-empty"><div className="inline-empty-icon"><Newspaper size={23} strokeWidth={1.5} /></div><div><strong>새로운 소식을 기다리고 있어요</strong><p>업데이트 배포 주소가 등록되면 공지가 이곳에 표시돼요.</p></div></div>}</section>
          <section className="panel pack-card"><div className="pack-symbol"><BrandMark small /></div><div className="pack-information"><span className="section-label-text">지금 준비된 모드팩</span><strong>{state.pack.name}</strong><div><span className={`tiny-dot ${installed ? 'green' : 'blue'}`} />{installed ? `v${state.installation.version || state.pack.version} 설치됨` : '아직 설치되지 않았어요'}</div></div><button className="icon-button" title="게임 설정" onClick={() => setPage('settings')}><Settings size={18} /></button></section>
        </div>
        <div className="home-tip"><Info size={14} /><span>게임 파일과 Java, 모드 로더는 런처가 함께 준비해요. 처음 설치할 때는 시간이 조금 걸릴 수 있어요.</span></div>
      </>}

      {page === 'guide' && <Guide state={state} onAccount={() => setPage('account')} onSettings={() => setPage('settings')} onInstall={primary} external={goExternal} />}
      {page === 'updates' && <Updates state={state} working={working} check={() => void action('updates', () => api!.checkUpdates(), '업데이트 확인을 완료했습니다.')} />}
      {page === 'account' && <Account state={state} working={working} login={login} logout={() => void action('logout', () => api!.logout(), '로그아웃했습니다.')} external={goExternal} />}
      {page === 'settings' && <SettingsPage state={state} working={working} action={action} notify={notify} initialSection={settingsSection} />}
    </main>

    <footer className={`launch-dock${state.operation ? ' has-operation' : ''}`}>
      {state.operation && <div className="operation-top"><span><LoaderCircle className="spin" size={14} /><strong>{state.operation.message || state.operation.stage}</strong></span><span>{formatBytes(state.operation.downloadedBytes)}{state.operation.totalBytes > 0 && ` / ${formatBytes(state.operation.totalBytes)}`}<span className="operation-speed">{formatBytes(state.operation.speedBytesPerSecond)}/s</span><strong>{Math.round(progress)}%</strong><button className="cancel-button" title="작업 중단" onClick={() => void cancel()}><X size={15} /></button></span></div>}
      <div className="dock-progress" role={state.operation ? 'progressbar' : undefined} aria-label="설치 및 업데이트 진행률" aria-valuenow={state.operation ? progress : undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
      <div className="dock-main"><div className="dock-status"><span className={`tiny-dot ${state.server.status === 'online' ? 'green' : state.server.status === 'offline' ? 'gray' : 'blue'}`} /><span>{serverLabel}</span><span className="dock-separator" /><span className="dock-pack-version">{installed ? `설치 버전 ${state.installation.version || state.pack.version}` : '게임 설치 전'}</span>{state.game.running && <span className="running-badge"><span />게임 실행 중</span>}</div><div className="launch-controls"><button className="icon-button dock-folder" title="게임 폴더 열기" onClick={() => void action('folder', () => api!.openFolder('game'))}><FolderOpen size={19} /></button><div className="launch-memory"><MemoryStick size={14} /><span>{(state.settings.memoryMb / 1024).toFixed(1)} GB 할당</span></div><button className="launch-button" disabled={working || state.game.running} onClick={primary}>{working ? <LoaderCircle size={20} className="spin" /> : !state.profile ? <LogIn size={20} /> : !installed ? <Download size={20} /> : <Play size={20} fill="currentColor" />}<span>{primaryLabel}</span>{!working && !state.game.running && <ArrowRight size={17} />}</button></div></div>
    </footer>

    {toast && <div className={`toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Info size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="알림 닫기" onClick={() => setToast(null)}><X size={16} /></button></div>}
    {onboarding && <div className="modal-backdrop"><div className="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title"><button className="modal-close icon-button" onClick={dismissOnboarding} aria-label="나중에 로그인"><X size={20} /></button><div className="welcome-art"><BrandMark /><span className="welcome-orbit orbit-one" /><span className="welcome-orbit orbit-two" /><Sparkles className="welcome-spark" size={25} /></div><span className="modal-eyebrow">WELCOME, ADVENTURER</span><h2 id="welcome-title">당신의 새로운 모험에<br />오신 것을 환영해요.</h2><p>Minecraft를 플레이할 Microsoft 계정을 연결해 주세요.<br />공식 인증 페이지에서 로그인하고 게임 소유권을 확인해요.</p><div className="welcome-security"><ShieldCheck size={19} /><span>비밀번호는 Microsoft에서만 입력합니다.<br />런처는 계정 비밀번호를 수집하지 않아요.</span></div>{!state.settings.microsoftClientId && <div className="setup-notice"><KeyRound size={16} /><span>첫 연결을 위해 설정에서 Microsoft Client ID를 등록해야 합니다.</span></div>}<button className="button primary full" disabled={working} onClick={login}>{state.settings.microsoftClientId ? <MicrosoftLogo /> : <Settings size={18} />}{state.settings.microsoftClientId ? 'Microsoft 계정으로 시작하기' : '로그인 설정 시작하기'}<ArrowRight size={17} /></button><button className="welcome-later" onClick={dismissOnboarding}>먼저 런처 둘러보기</button></div></div>}
  </div>;
}

function MicrosoftLogo() {
  return <span className="microsoft-logo" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="page-overline">{eyebrow}</span><h1>{title}<span>.</span></h1><p>{description}</p></div>{action}</div>;
}

function Guide({ state, onAccount, onSettings, onInstall, external }: { state: LauncherState; onAccount: () => void; onSettings: () => void; onInstall: () => void; external: (url: string) => void }) {
  const steps = [
    { icon: UserRound, title: '계정 연결하기', text: 'Minecraft Java Edition을 소유한 Microsoft 계정으로 로그인해요.', action: onAccount, done: Boolean(state.profile), label: '계정 확인' },
    { icon: FolderOpen, title: '모험을 위한 공간 준비', text: '설치 경로와 메모리 할당량을 확인해요. 기본값으로도 시작할 수 있어요.', action: onSettings, done: false, label: '설정 열기' },
    { icon: ArrowDownToLine, title: '모드팩 설치하기', text: 'Minecraft, Java, NeoForge와 모드팩을 런처가 다운로드해요.', action: onInstall, done: state.installation.status === 'installed', label: '시작하기' },
  ];
  return <><PageHeading eyebrow="ADVENTURE GUIDE" title="첫 모험을 위한 안내" description="세 가지 준비만 마치면 새로운 세계가 열립니다." /><div className="guide-steps">{steps.map((step, i) => <section className="panel guide-step" key={step.title}><div className="step-top"><span className="step-number">0{i + 1}</span>{step.done ? <CheckCircle2 size={19} className="green-text" /> : <step.icon size={21} />}</div><h2>{step.title}</h2><p>{step.text}</p><button className="text-button" onClick={step.action}>{step.label}<ArrowRight size={15} /></button></section>)}</div><section className="panel guide-about"><div className="guide-about-symbol"><Compass size={45} strokeWidth={1.2} /><span className="tiny-star">✦</span></div><div><span className="page-overline">IMMERSIVE COBBLEMON</span><h2>탐험은 자유롭게, 준비는 간편하게.</h2><p>Cobblemon을 중심으로 구성된 Minecraft 모드팩입니다. 제공된 모드팩의 설정과 리소스가 함께 적용되며, 업데이트는 게임을 종료한 뒤 안전하게 설치합니다.</p><div className="guide-meta"><span>Minecraft {state.pack.minecraftVersion}</span><span>{state.pack.loader}</span><span>모드팩 {state.pack.version}</span></div></div></section><div className="guide-faq"><h2><CircleHelp size={19} /> 궁금할 수 있는 것들</h2>{[
    ['Minecraft를 별도로 구매해야 하나요?', '네. Minecraft Java Edition을 플레이할 수 있는 정식 Microsoft 계정이 필요합니다. 런처에서 로그인할 때 사용 권한을 확인합니다.'],
    ['첫 설치에 얼마나 걸리나요?', '인터넷 속도와 디스크 상태에 따라 달라요. 다운로드 진행률과 속도를 하단에서 확인할 수 있습니다. 중단된 파일은 다음 설치에서 다시 검사해요.'],
    ['업데이트하면 내 월드가 사라지나요?', '월드, 스크린샷 같은 개인 데이터는 업데이트 대상에서 보호됩니다. 소중한 월드는 게임 폴더에서 별도로 백업하는 것도 좋아요.'],
    ['게임이 실행되지 않을 때는 어떻게 하나요?', '설정의 파일 검사 및 복구를 먼저 실행해 보세요. 문제가 계속되면 로그 폴더의 기록으로 오류를 확인할 수 있습니다.'],
  ].map(([title, text]) => <details key={title}><summary>{title}<ChevronRight size={17} /></summary><p>{text}</p></details>)}</div><button className="text-button guide-official" onClick={() => external('https://www.curseforge.com/minecraft/modpacks/immersive-cobblemon')}>모드팩 공식 페이지 <ExternalLink size={14} /></button></>;
}

function Updates({ state, working, check }: { state: LauncherState; working: boolean; check: () => void }) {
  const [tab, setTab] = useState<'news' | 'patches'>('news');
  const checking = ['checking', 'downloading', 'applying'].includes(state.update.status);
  return <><PageHeading eyebrow="WHAT'S NEW" title="모험의 새로운 소식" description="서버 공지와 모드팩의 변경 사항을 한곳에서 확인하세요." action={<button className="button secondary" disabled={working || checking} onClick={check}><RefreshCw size={16} className={checking ? 'spin' : ''} />업데이트 확인</button>} /><div className="update-summary panel"><div className="update-summary-icon"><Download size={23} /></div><div><strong>{state.update.status === 'unconfigured' ? '업데이트 배포 주소를 설정해 주세요' : state.update.status === 'available' ? `새 버전 ${state.update.version || ''}을 사용할 수 있어요` : state.update.status === 'error' ? '업데이트를 확인하지 못했어요' : checking ? '업데이트를 확인하고 있어요' : state.update.status === 'up-to-date' || state.update.status === 'current' ? '현재 최신 버전이에요' : '업데이트 상태'}</strong><p>{state.update.message || `준비된 모드팩 버전 ${state.pack.version}`}</p></div><span className="version-chip">v{state.installation.version || state.pack.version}</span></div><div className="subtabs"><button className={tab === 'news' ? 'active' : ''} onClick={() => setTab('news')}>공지사항<span>{state.announcements.length}</span></button><button className={tab === 'patches' ? 'active' : ''} onClick={() => setTab('patches')}>패치 노트<span>{state.patchNotes.length}</span></button></div>{tab === 'news' ? state.announcements.length ? <div className="article-list">{state.announcements.map((notice) => <article className="panel update-article" key={notice.id}><div className="article-meta"><span className="news-category">공지</span><time>{dateLabel(notice.publishedAt)}</time></div><h2>{notice.title}</h2><div className="article-body">{notice.body}</div></article>)}</div> : <section className="panel"><EmptyState icon={<Bell size={27} />} title="아직 등록된 공지가 없어요">배포 서버에서 전달된 공지가 여기에 표시됩니다.<br />배포 주소는 설정에서 등록할 수 있어요.</EmptyState></section> : state.patchNotes.length ? <div className="article-list">{state.patchNotes.map((patch) => <article className="panel update-article" key={`${patch.version}-${patch.date}`}><div className="article-meta"><span className="version-chip">v{patch.version}</span><time>{dateLabel(patch.date)}</time></div><h2>모드팩 {patch.version} 업데이트</h2><div className="article-body">{patch.body}</div></article>)}</div> : <section className="panel"><EmptyState icon={<Newspaper size={27} />} title="패치 노트를 기다리고 있어요">배포된 버전의 변경 사항을 여기에서 확인할 수 있습니다.</EmptyState></section>}</>;
}

function Account({ state, working, login, logout, external }: { state: LauncherState; working: boolean; login: () => void; logout: () => void; external: (url: string) => void }) {
  return <><PageHeading eyebrow="YOUR PLAYER" title="내 계정" description="Minecraft 계정을 연결하고 플레이어 정보를 확인하세요." /><div className="account-layout"><section className="panel player-card"><div className="player-card-grid" /><PlayerAvatar state={state} large /><h2>{state.profile?.name || '다음 모험의 주인공'}</h2><p>{state.profile ? 'Minecraft Java Edition' : '아직 연결된 계정이 없어요'}</p>{state.profile ? <span className="verified-badge"><ShieldCheck size={14} /> Microsoft 인증 계정</span> : <span className="signed-out-badge">로그인이 필요해요</span>}<div className="player-card-bottom">{state.profile ? <button className="button secondary full" disabled={working || state.game.running} onClick={logout}><LogOut size={16} />로그아웃 및 계정 전환</button> : <button className="button primary full" disabled={working} onClick={login}>{working ? <LoaderCircle className="spin" size={17} /> : <MicrosoftLogo />}Microsoft 계정 로그인</button>}</div></section><div className="account-information"><section className="panel account-details"><div className="section-heading"><h2><ShieldCheck size={18} /> 안전한 공식 인증</h2></div><p>Microsoft의 공식 로그인 페이지에서 계정을 인증합니다. Minecraft 소유권을 확인한 뒤 프로필과 스킨 정보를 가져옵니다.</p><div className="security-list"><span><Check size={16} />비밀번호를 런처에 저장하지 않습니다</span><span><Check size={16} />로그인 토큰은 운영체제의 보호 기능으로 보관합니다</span><span><Check size={16} />계정 연결은 언제든 해제할 수 있습니다</span></div>{state.auth.message && <div className={`auth-message ${state.auth.status === 'error' ? 'error' : ''}`}><Info size={16} /><span>{state.auth.message}</span></div>}{state.profile && <div className="profile-id"><span>플레이어 ID</span><code>{state.profile.id}</code></div>}</section><section className="panel account-help"><div className="help-icon"><CircleHelp size={23} /></div><div><h3>계정 연결이 처음인가요?</h3><p>Java Edition을 소유한 계정을 사용해 주세요.<br />로그인 창에서 안내에 따라 인증하면 됩니다.</p><button className="text-button" onClick={() => external('https://www.minecraft.net/ko-kr/msaprofile')}>Minecraft 계정 관리 <ExternalLink size={14} /></button></div></section></div></div></>;
}

function SettingsPage({ state, working, action, notify, initialSection }: { state: LauncherState; working: boolean; action: (name: string, callback: () => Promise<unknown>, success?: string) => Promise<void>; notify: (message: string, error?: boolean) => void; initialSection: SettingsSection }) {
  const [draft, setDraft] = useState(state.settings);
  const [apiKey, setApiKey] = useState('');
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(state.settings); }, [state.settings, dirty]);
  useEffect(() => setSection(initialSection), [initialSection]);
  const update = <K extends keyof LauncherState['settings']>(key: K, value: LauncherState['settings'][K]) => { setDraft((previous) => ({ ...previous, [key]: value })); setDirty(true); };
  const save = async () => {
    const clientId = draft.microsoftClientId.trim();
    if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) { notify('Microsoft Client ID는 등록된 애플리케이션의 UUID 형식이어야 합니다.', true); return; }
    if (draft.updateUrl) { try { if (new URL(draft.updateUrl).protocol !== 'https:') throw new Error(); } catch { notify('업데이트 배포 주소는 올바른 HTTPS 주소를 입력해 주세요.', true); return; } }
    if (!Number.isInteger(draft.serverPort) || draft.serverPort < 1 || draft.serverPort > 65535) { notify('서버 포트는 1~65535 사이의 숫자로 입력해 주세요.', true); return; }
    const { curseforgeApiKeyConfigured: _configured, ...editable } = draft;
    await action('settings', async () => { await api!.saveSettings({ ...editable, microsoftClientId: clientId, ...(apiKey ? { curseforgeApiKey: apiKey } : {}) }); setApiKey(''); setDirty(false); }, '설정을 저장했습니다.');
  };
  const memoryMax = Math.max(2048, Math.min(32768, Math.floor((state.system.totalMemoryMb || 16384) * .8 / 512) * 512));
  return <><PageHeading eyebrow="MAKE IT YOURS" title="런처 설정" description="내 PC에 맞게 모험을 준비하세요." action={<button className="button primary save-button" disabled={working || !dirty} onClick={() => void save()}>{working ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}설정 저장</button>} /><div className="settings-layout"><aside className="settings-nav">{[{ id: 'game' as const, icon: Gamepad2, label: '게임 환경' }, { id: 'connection' as const, icon: KeyRound, label: '계정 및 연결' }, { id: 'maintenance' as const, icon: HardDrive, label: '파일 및 진단' }].map(({ id, icon: Icon, label }) => <button className={section === id ? 'active' : ''} key={id} onClick={() => setSection(id)}><Icon size={17} />{label}<ChevronRight size={14} /></button>)}<div className="settings-version"><BrandMark small /><span>Cobble Launcher<br /><strong>{state.appVersion}</strong></span></div></aside><div className="settings-content">{section === 'game' && <>
    <section className="panel settings-panel"><h2><FolderOpen size={18} />게임 설치 경로</h2><p>게임과 모드팩이 저장되는 전용 폴더입니다.</p><label className="field-label" htmlFor="directory">설치 폴더</label><div className="input-with-button"><input id="directory" value={draft.gameDirectory} onChange={(event) => update('gameDirectory', event.target.value)} spellCheck={false} /><button className="button secondary" disabled={working || Boolean(state.operation) || state.game.running} onClick={() => void action('choose-directory', async () => { const directory = await api!.chooseDirectory(); if (directory) update('gameDirectory', directory); })}><FolderOpen size={16} />변경</button></div><div className="field-hint"><Info size={13} />경로를 변경하면 새 폴더에 게임을 설치해야 합니다.</div></section>
    <section className="panel settings-panel memory-panel"><div className="settings-panel-heading"><h2><MemoryStick size={18} />메모리 할당</h2><span className="memory-value">{(draft.memoryMb / 1024).toFixed(1)} <small>GB</small></span></div><p>게임에서 사용할 RAM을 조절합니다. 다른 프로그램을 위한 여유를 남겨 주세요.</p><input className="memory-slider" type="range" aria-label="게임 메모리 할당량" min={2048} max={memoryMax} step={512} value={Math.min(draft.memoryMb, memoryMax)} onChange={(event) => update('memoryMb', Number(event.target.value))} style={{ '--slider-fill': `${Math.max(0, Math.min(100, (draft.memoryMb - 2048) / (memoryMax - 2048 || 1) * 100))}%` } as CSSProperties} /><div className="slider-labels"><span>2 GB</span><span>전체 RAM {(state.system.totalMemoryMb / 1024).toFixed(1)} GB</span><span>{(memoryMax / 1024).toFixed(1)} GB</span></div><div className="memory-note"><Monitor size={16} /><span>현재 사용 가능한 메모리 <strong>{(state.system.freeMemoryMb / 1024).toFixed(1)} GB</strong></span></div></section>
    <section className="panel settings-panel"><h2><Gamepad2 size={18} />모드팩 원본 파일</h2><p>{state.pack.name} {state.pack.version}의 공식 CurseForge ZIP 파일입니다. 다른 PC에서는 다운로드한 모드팩 파일을 선택해 주세요.</p><label className="field-label" htmlFor="pack-archive">모드팩 ZIP 파일 경로</label><div className="input-with-button"><input id="pack-archive" value={draft.packArchivePath} onChange={(event) => update('packArchivePath', event.target.value)} spellCheck={false} /><button className="button secondary" disabled={working || Boolean(state.operation) || state.game.running} onClick={() => void action('choose-pack', async () => { const path = await api!.choosePackArchive(); if (path) update('packArchivePath', path); })}><FolderOpen size={16} />선택</button></div><div className="field-hint"><Info size={13} />설치 전에 원본 파일의 버전과 구성을 검사합니다.</div></section>
    <section className="panel settings-panel setting-toggle-row"><div><h2>게임 실행 후 런처 숨기기</h2><p>게임이 실행되면 런처 창을 숨깁니다.</p></div><button className={`toggle${draft.closeOnLaunch ? ' on' : ''}`} role="switch" aria-checked={draft.closeOnLaunch} aria-label="게임 실행 후 런처 숨기기" onClick={() => update('closeOnLaunch', !draft.closeOnLaunch)}><span /></button></section>
  </>}{section === 'connection' && <>
    <section className="panel settings-panel"><h2><MicrosoftLogo />Microsoft 공식 로그인</h2><p>등록된 Microsoft 애플리케이션의 Client ID를 입력합니다. 비밀번호나 계정 이메일을 입력하는 칸이 아닙니다.</p><label className="field-label" htmlFor="client-id">애플리케이션 Client ID</label><input id="client-id" value={draft.microsoftClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(event) => update('microsoftClientId', event.target.value)} spellCheck={false} /><div className="field-hint"><ShieldCheck size={13} />Minecraft Services 사용 승인이 포함된 애플리케이션이 필요합니다.</div></section>
    <section className="panel settings-panel"><div className="settings-panel-heading"><h2><KeyRound size={18} />CurseForge 다운로드 연결</h2><span className={`configuration-badge${state.settings.curseforgeApiKeyConfigured ? ' configured' : ''}`}>{state.settings.curseforgeApiKeyConfigured ? '키 등록됨' : '등록 전'}</span></div><p>제공된 모드팩에 포함된 파일을 CurseForge에서 가져올 때 사용하는 API 키입니다.</p><label className="field-label" htmlFor="curseforge-key">CurseForge API 키</label><input id="curseforge-key" type="password" value={apiKey} placeholder={state.settings.curseforgeApiKeyConfigured ? '새 키로 변경하려면 입력하세요' : 'CurseForge 개발자 콘솔에서 발급한 키'} onChange={(event) => { setApiKey(event.target.value); setDirty(true); }} autoComplete="off" /><div className="field-hint"><ShieldCheck size={13} />등록한 키는 화면에 다시 표시하지 않습니다.</div></section>
    <section className="panel settings-panel"><h2><Wifi size={18} />게임 서버</h2><p>등록된 서버의 접속 가능 여부를 홈에서 확인합니다.</p><div className="server-fields"><div><label className="field-label" htmlFor="server-host">서버 주소</label><input id="server-host" value={draft.serverHost} placeholder="play.example.com" onChange={(event) => update('serverHost', event.target.value.trim())} spellCheck={false} /></div><div><label className="field-label" htmlFor="server-port">포트</label><input id="server-port" type="number" value={draft.serverPort} min={1} max={65535} onChange={(event) => update('serverPort', Number(event.target.value))} /></div></div></section>
    <section className="panel settings-panel"><h2><RefreshCw size={18} />업데이트 배포 연결</h2><p>관리자가 제공한 HTTPS 매니페스트 주소와 서명 공개키를 등록합니다. 변경된 게임 파일은 게임 종료 후 적용됩니다.</p><label className="field-label" htmlFor="update-url">업데이트 매니페스트 URL</label><input id="update-url" value={draft.updateUrl} placeholder="https://example.com/updates/manifest.json" onChange={(event) => update('updateUrl', event.target.value.trim())} spellCheck={false} /><label className="field-label" htmlFor="public-key">업데이트 서명 공개키</label><textarea id="public-key" value={draft.updatePublicKey} placeholder="관리자가 제공한 Ed25519 공개키" onChange={(event) => update('updatePublicKey', event.target.value)} rows={3} spellCheck={false} /><div className="field-hint"><ShieldCheck size={13} />공개키로 배포 출처와 파일 무결성을 검증합니다.</div></section>
  </>}{section === 'maintenance' && <>
    <section className="panel settings-panel"><h2><ShieldCheck size={18} />게임 파일 검사 및 복구</h2><p>설치된 파일을 확인하고 누락되거나 손상된 파일을 다시 준비합니다. 게임을 종료한 상태에서 실행해 주세요.</p><div className="maintenance-status"><span className={`tiny-dot ${state.installation.status === 'installed' ? 'green' : 'gray'}`} />{state.installation.status === 'installed' ? `설치 버전 ${state.installation.version || state.pack.version}` : state.installation.message || '설치된 게임이 없습니다.'}</div><button className="button secondary" disabled={working || state.game.running || state.installation.status === 'not-installed'} onClick={() => void action('repair', () => api!.repair(), '파일 검사 및 복구를 완료했습니다.')}><RefreshCw size={16} />파일 검사 및 복구</button></section>
    <section className="panel settings-panel"><h2><FolderOpen size={18} />폴더 바로가기</h2><p>게임 파일과 진단 로그를 직접 확인할 수 있습니다.</p><div className="folder-actions"><button className="button secondary" disabled={working} onClick={() => void action('game-folder', () => api!.openFolder('game'))}><FolderOpen size={16} />게임 폴더</button><button className="button secondary" disabled={working} onClick={() => void action('logs-folder', () => api!.openFolder('logs'))}><Newspaper size={16} />로그 폴더</button></div></section>
    <section className="panel settings-panel log-panel"><div className="settings-panel-heading"><h2><Monitor size={18} />최근 실행 기록</h2><span className="configuration-badge">{state.logs.length}개 기록</span></div>{state.logs.length ? <div className="log-list">{state.logs.slice(-30).reverse().map((log, i) => <div className={`log-entry ${log.level}`} key={`${log.time}-${i}`}><time>{log.time.includes('T') ? new Date(log.time).toLocaleTimeString('ko-KR') : log.time}</time><span className="log-level">{log.level}</span><span>{log.message}</span></div>)}</div> : <p className="no-logs">아직 실행 기록이 없습니다.</p>}</section>
  </>}{dirty && <div className="unsaved-hint"><span className="tiny-dot blue" />변경 사항을 적용하려면 설정을 저장해 주세요.</div>}</div></div></>;
}
