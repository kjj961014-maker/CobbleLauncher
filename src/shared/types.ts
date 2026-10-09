export interface Settings {
  gameDirectory: string;
  memoryMb: number;
  microsoftClientId: string;
  curseforgeApiKeyConfigured: boolean;
  updateUrl: string;
  updatePublicKey: string;
  serverHost: string;
  serverPort: number;
  closeOnLaunch: boolean;
  packArchivePath: string;
}
export interface Profile { id: string; name: string; skinUrl?: string }
export interface LauncherState {
  pack: { id: string; name: string; version: string; minecraftVersion: string; loader: string };
  settings: Settings;
  profile: Profile | null;
  auth: { status: 'signed-out'|'signing-in'|'signed-in'|'error'; message?: string };
  installation: { status: 'not-installed'|'installing'|'installed'|'error'; version?: string; message?: string };
  operation: null | { kind: string; stage: string; progress: number; downloadedBytes: number; totalBytes: number; speedBytesPerSecond: number; message: string };
  game: { running: boolean; pid?: number };
  update: { status: string; version?: string; message?: string };
  server: { status: 'unconfigured'|'online'|'offline'|'checking'; players?: number; maxPlayers?: number; latencyMs?: number };
  announcements: Array<{ id: string; title: string; body: string; publishedAt: string }>;
  patchNotes: Array<{ version: string; date: string; body: string }>;
  system: { totalMemoryMb: number; freeMemoryMb: number; platform: string };
  logs: Array<{ time: string; level: string; message: string }>;
  appVersion: string;
  error?: string;
}
export interface LauncherAPI {
  getState(): Promise<LauncherState>;
  onState(listener: (state: LauncherState) => void): () => void;
  login(): Promise<unknown>; logout(): Promise<unknown>;
  install(): Promise<unknown>; repair(): Promise<unknown>; launch(): Promise<unknown>;
  checkUpdates(): Promise<unknown>; cancelOperation(): Promise<unknown>;
  saveSettings(settings: Partial<Settings> & { curseforgeApiKey?: string }): Promise<unknown>;
  chooseDirectory(): Promise<string|null>;
  choosePackArchive(): Promise<string|null>;
  openFolder(kind: 'game'|'logs'): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  minimize(): Promise<unknown>; maximize(): Promise<unknown>; close(): Promise<unknown>;
}
