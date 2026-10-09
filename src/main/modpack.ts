import AdmZip from 'adm-zip';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { downloadFile, hashFile, checkFile } from './download';
import { safePath, assertNoLinks, writeJsonAtomic, readJson } from './paths';

export interface PackCatalog {
  id: string; name: string; version: string; minecraftVersion: string;
  javaMajorVersion: number;
  loader: { type: string; version: string; id: string };
  sourceArchive: { fileName: string; sha256: string; size: number };
  curseforge?: { projectId: number; fileId: number };
  overrides: string;
  files: Array<{ projectID: number; fileID: number; required: boolean; isLocked?: boolean }>;
}
export interface ManagedPackFile { path: string; sha256: string }
interface ManagedPack { version: string; managedFiles: ManagedPackFile[] }
interface CfMod { id: number; classId: number; allowModDistribution?: boolean | null; isAvailable?: boolean }
interface CfFile {
  id: number; modId: number; fileName: string; isAvailable: boolean;
  fileLength: number; downloadUrl: string | null;
  hashes: Array<{ value: string; algo: number }>;
}
interface ResolvedFile { file: CfFile; relativePath: string; hash: { algorithm: 'sha1'; value: string } }
type Progress = (stage: string, message: string, progress: number, transfer?: { downloaded: number; total: number; speed: number }) => void;
const ZIP_LIMITS = { entries: 10000, total: 512 * 1024 * 1024, single: 64 * 1024 * 1024, archive: 256 * 1024 * 1024 };
const OVERRIDE_ROOTS = new Set(['config', 'defaultconfigs', 'kubejs', 'journeymap', 'shaderpacks', 'resourcepacks']);
const FILE_ROOTS = new Set(['mods', 'resourcepacks', 'shaderpacks']);
const CF_CDN_HOSTS = new Set(['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net']);

export class ModpackInstallError extends Error {
  constructor(message: string, public readonly blockedFiles: Array<{ projectID: number; fileID: number; reason: string }> = []) {
    super(message); this.name = 'ModpackInstallError';
  }
}

/** Windows-safe relative paths. Validate every ZIP entry before any extraction. */
export function validateArchivePath(name: string): string {
  if (!name || name.includes('\\') || name.startsWith('/') || name.includes(':') || /[\u0000-\u001f<>"|?*]/.test(name)) {
    throw new Error(`안전하지 않은 ZIP 경로: ${name}`);
  }
  const relative = name.endsWith('/') ? name.slice(0, -1) : name;
  const pieces = relative.split('/');
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || /[. ]$/.test(piece) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece))) {
    throw new Error(`안전하지 않은 ZIP 경로: ${name}`);
  }
  return relative;
}

export function validateArchiveEntries(zip: AdmZip, overrides: string): AdmZip.IZipEntry[] {
  validateArchivePath(overrides);
  if (overrides.includes('/')) throw new Error('overrides는 ZIP의 최상위 폴더여야 합니다.');
  const entries = zip.getEntries();
  if (entries.length > ZIP_LIMITS.entries) throw new Error('ZIP 항목 수가 제한을 초과했습니다.');
  let expanded = 0;
  const paths = new Map<string, boolean>();
  const selected: AdmZip.IZipEntry[] = [];
  for (const entry of entries) {
    const name = validateArchivePath(entry.entryName);
    const normalized = name.toLowerCase();
    if (paths.has(normalized)) throw new Error(`ZIP에 중복 경로가 있습니다: ${name}`);
    paths.set(normalized, entry.isDirectory);
    const unixType = (entry.header.attr >>> 16) & 0xf000;
    if (unixType === 0xa000 || (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000)) {
      throw new Error(`ZIP 링크/특수 파일을 설치할 수 없습니다: ${name}`);
    }
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.header.size > ZIP_LIMITS.single) {
      throw new Error(`ZIP 파일 크기가 제한을 초과했습니다: ${name}`);
    }
    expanded += entry.header.size;
    if (expanded > ZIP_LIMITS.total) throw new Error('ZIP 확장 크기가 제한을 초과했습니다.');
    if (!entry.isDirectory && name.startsWith(`${overrides}/`)) {
      const relative = name.slice(overrides.length + 1);
      if (!OVERRIDE_ROOTS.has(relative.split('/')[0])) {
        throw new Error(`개인 파일이나 게임 본체 경로를 overrides로 설치할 수 없습니다: ${relative}`);
      }
      selected.push(entry);
    }
  }
  for (const [name] of paths) {
    const pieces = name.split('/');
    for (let i = 1; i < pieces.length; i++) {
      if (paths.get(pieces.slice(0, i).join('/')) === false) throw new Error(`ZIP 파일/폴더 경로 충돌: ${name}`);
    }
  }
  return selected;
}

export async function inspectPackArchive(pack: PackCatalog, archivePath: string): Promise<{ zip: AdmZip; overrides: AdmZip.IZipEntry[] }> {
  const info = await fs.lstat(archivePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > ZIP_LIMITS.archive || info.size !== pack.sourceArchive.size) {
    throw new Error('선택한 모드팩 ZIP의 크기/파일 형식이 등록된 파일과 다릅니다.');
  }
  const archiveBuffer = await fs.readFile(archivePath);
  if (!/^[a-f0-9]{64}$/i.test(pack.sourceArchive.sha256) || createHash('sha256').update(archiveBuffer).digest('hex') !== pack.sourceArchive.sha256.toLowerCase()) {
    throw new Error('모드팩 ZIP SHA-256이 등록된 파일과 다릅니다. 공식 6.2.0 파일을 선택해 주세요.');
  }
  const zip = new AdmZip(archiveBuffer);
  const overrides = validateArchiveEntries(zip, pack.overrides);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry || manifestEntry.header.size > 2 * 1024 * 1024) throw new Error('manifest.json이 없거나 너무 큽니다.');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  const loader = manifest.minecraft?.modLoaders?.find((item: { primary?: boolean }) => item.primary);
  if (manifest.manifestType !== 'minecraftModpack' || manifest.manifestVersion !== 1 ||
    manifest.minecraft?.version !== pack.minecraftVersion || loader?.id !== pack.loader.id ||
    manifest.version?.trim() !== pack.version || manifest.overrides !== pack.overrides || !Array.isArray(manifest.files) ||
    JSON.stringify(manifest.files.map(fileRecord)) !== JSON.stringify(pack.files.map(fileRecord))) {
    throw new Error('모드팩 manifest의 버전, 로더 또는 필수 파일 목록이 등록된 팩과 다릅니다.');
  }
  return { zip, overrides };
}

function fileRecord(file: PackCatalog['files'][number]) {
  return { projectID: file.projectID, fileID: file.fileID, required: file.required, isLocked: file.isLocked ?? false };
}
export function isCurseForgeDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && CF_CDN_HOSTS.has(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}

async function apiBatch<T>(endpoint: string, body: object, apiKey: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`https://api.curseforge.com/v1/${endpoint}`, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ModpackInstallError('CurseForge API 키가 없거나 승인되지 않았습니다. 설정에서 개발자 본인의 승인된 키를 입력해 주세요.');
    throw new ModpackInstallError(`CurseForge 메타데이터 조회 실패 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`);
  }
  const payload = await response.json() as { data: T[] };
  if (!Array.isArray(payload.data)) throw new Error('CurseForge 메타데이터 응답 형식이 올바르지 않습니다.');
  return payload.data;
}

export function resolveCurseForgeFiles(pack: PackCatalog, mods: CfMod[], files: CfFile[]): ResolvedFile[] {
  const modMap = new Map(mods.map(mod => [mod.id, mod]));
  const fileMap = new Map(files.map(file => [file.id, file]));
  const blocked: ModpackInstallError['blockedFiles'] = [];
  const targets = new Set<string>();
  const resolved: ResolvedFile[] = [];
  for (const record of pack.files) {
    const mod = modMap.get(record.projectID), file = fileMap.get(record.fileID);
    let reason = '';
    if (!mod || !file || file.modId !== record.projectID) reason = '공식 파일 메타데이터 없음 또는 프로젝트 ID 불일치';
    else if (mod.allowModDistribution === false) reason = '저작자가 외부 런처 배포를 허용하지 않음';
    else if (mod.isAvailable === false || file.isAvailable !== true) reason = '현재 다운로드할 수 없는 파일';
    else if (!file.downloadUrl || !isCurseForgeDownloadUrl(file.downloadUrl)) reason = '허용된 공식 CDN 다운로드 URL 없음';
    else if (!Number.isSafeInteger(file.fileLength) || file.fileLength <= 0 || file.fileLength > 1024 * 1024 * 1024) reason = '파일 크기 정보가 올바르지 않음';
    else {
      const root = mod.classId === 6 ? 'mods' : mod.classId === 12 ? 'resourcepacks' : mod.classId === 6552 ? 'shaderpacks' : '';
      const hash = file.hashes?.find(hash => hash.algo === 1 && /^[a-f0-9]{40}$/i.test(hash.value));
      try { validateArchivePath(file.fileName); } catch { reason = '안전하지 않은 파일명'; }
      if (file.fileName.includes('/')) reason = '공식 파일명이 단일 파일명이 아님';
      if (!root || !file.fileName.toLowerCase().endsWith(root === 'mods' ? '.jar' : '.zip')) reason = '지원되지 않는 파일 종류';
      if (!hash) reason = '공식 SHA-1 해시가 없어 무결성을 검증할 수 없음';
      const relativePath = `${root}/${file.fileName}`;
      if (targets.has(relativePath.toLowerCase())) reason = '두 프로젝트가 같은 설치 경로를 사용함';
      if (!reason && hash) {
        targets.add(relativePath.toLowerCase());
        resolved.push({ file, relativePath, hash: { algorithm: 'sha1', value: hash.value.toLowerCase() } });
      }
    }
    if (reason && record.required) blocked.push({ projectID: record.projectID, fileID: record.fileID, reason });
  }
  if (blocked.length) throw new ModpackInstallError(
    `필수 파일 ${blocked.length}개를 자동 설치할 수 없습니다. 제한을 우회하지 않았습니다.\n` + blocked.map(item => `${item.projectID}/${item.fileID}: ${item.reason}`).join('\n'), blocked);
  return resolved;
}

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function assertActive(signal?: AbortSignal) { signal?.throwIfAborted(); }
function managedFilePath(relative: string): boolean {
  try { validateArchivePath(relative); return FILE_ROOTS.has(relative.split('/')[0]) && relative.split('/').length === 2; } catch { return false; }
}

/** Obtain the exact registered author archive through official metadata, or validate a local copy. */
export async function ensurePackArchive(options: {
  pack: PackCatalog; archivePath?: string; gameDirectory: string; apiKey: string;
  signal?: AbortSignal; onProgress?: Progress;
}): Promise<string> {
  const { pack, archivePath, gameDirectory, apiKey, signal } = options;
  const progress = options.onProgress ?? (() => {});
  assertActive(signal);
  let localError: unknown;
  if (archivePath?.trim()) {
    try { await inspectPackArchive(pack, archivePath); progress('pack-archive', '선택한 모드팩 ZIP의 무결성을 확인했습니다.', 100); return archivePath; }
    catch (error) { localError = error; }
  }
  const source = pack.curseforge;
  if (!source || !Number.isSafeInteger(source.projectId) || source.projectId <= 0 || !Number.isSafeInteger(source.fileId) || source.fileId <= 0 || !validSha(pack.sourceArchive.sha256)) {
    throw new ModpackInstallError('등록된 공식 모드팩 프로젝트/파일 정보가 없습니다. 검증된 로컬 ZIP을 선택해 주세요.');
  }
  const cachePath = safePath(gameDirectory, `.cobble/cache/packs/${source.fileId}-${pack.sourceArchive.sha256}.zip`);
  await assertNoLinks(gameDirectory, cachePath);
  try { await inspectPackArchive(pack, cachePath); progress('pack-archive', '검증된 모드팩 ZIP 캐시를 사용합니다.', 100); return cachePath; }
  catch { /* Only a verified cache can replace a selected source. */ }
  if (!apiKey.trim()) {
    const reason = localError ? `선택한 ZIP을 검증할 수 없습니다: ${(localError as Error).message}\n` : '';
    throw new ModpackInstallError(reason + '공식 모드팩 자동 다운로드에는 승인된 CurseForge API 키가 필요합니다. 설정에서 키를 입력하거나 공식 ZIP을 선택해 주세요.');
  }
  progress('pack-archive', 'CurseForge에서 등록된 모드팩의 공식 정보를 확인하고 있습니다.', 0);
  const [mods, files] = await Promise.all([
    apiBatch<CfMod>('mods', { modIds: [source.projectId] }, apiKey, signal),
    apiBatch<CfFile>('mods/files', { fileIds: [source.fileId] }, apiKey, signal)
  ]);
  const mod = mods.find(mod => mod.id === source.projectId), file = files.find(file => file.id === source.fileId && file.modId === source.projectId);
  let reason = '';
  if (!mod || !file) reason = '공식 프로젝트/파일 정보가 없거나 ID가 일치하지 않습니다.';
  else if (mod.allowModDistribution === false) reason = '모드팩 저작자가 외부 런처 다운로드를 허용하지 않았습니다.';
  else if (mod.isAvailable === false || file.isAvailable !== true) reason = '등록된 모드팩을 현재 다운로드할 수 없습니다.';
  else if (!file.downloadUrl || !isCurseForgeDownloadUrl(file.downloadUrl)) reason = '허용된 공식 모드팩 다운로드 URL이 없습니다.';
  else if (file.fileLength !== pack.sourceArchive.size) reason = '공식 모드팩 파일 크기가 등록된 ZIP과 다릅니다.';
  if (reason || !file) throw new ModpackInstallError(reason, [{ projectID: source.projectId, fileID: source.fileId, reason }]);
  await assertNoLinks(gameDirectory, cachePath); await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await downloadFile({ url: file.downloadUrl!, destination: cachePath, hash: { algorithm: 'sha256', value: pack.sourceArchive.sha256 },
    size: pack.sourceArchive.size, headers: { 'x-api-key': apiKey }, allowedHosts: CF_CDN_HOSTS, signal,
    onProgress: bytes => progress('pack-archive', '공식 모드팩 ZIP 다운로드 중', bytes.total ? bytes.downloaded / bytes.total * 100 : 0, bytes) });
  await inspectPackArchive(pack, cachePath);
  progress('pack-archive', '공식 모드팩 ZIP과 manifest를 검증했습니다.', 100);
  return cachePath;
}

interface PackJournalAction { path: string; originalSha256?: string; newSha256?: string }
interface PackJournal {
  schemaVersion: 1; stageRelative: string; phase: 'applying' | 'committed';
  actions: PackJournalAction[]; previousManifest: ManagedPack | null; result: ManagedPack;
}
function journalActionPath(relative: string): boolean {
  try { validateArchivePath(relative); return FILE_ROOTS.has(relative.split('/')[0]) || OVERRIDE_ROOTS.has(relative.split('/')[0]); } catch { return false; }
}
function validSha(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }

/** The write-ahead journal describes all intended changes before the first rename. */
export async function recoverModpack(gameDirectory: string): Promise<boolean> {
  const journalPath = safePath(gameDirectory, '.cobble/pack-journal.json');
  await assertNoLinks(gameDirectory, journalPath);
  const journal = await readJson<PackJournal | null>(journalPath, null);
  if (!journal) return false;
  if (journal.schemaVersion !== 1 || !/^\.cobble\/staging\/pack-[0-9a-f-]{36}$/.test(journal.stageRelative) ||
    !Array.isArray(journal.actions) || journal.actions.length > ZIP_LIMITS.entries || !['applying', 'committed'].includes(journal.phase) ||
    !journal.result || !Array.isArray(journal.result.managedFiles)) throw new Error('모드팩 복구 기록이 올바르지 않습니다. 백업을 보존했습니다.');
  const seen = new Set<string>();
  for (const action of journal.actions) {
    if (typeof action.path !== 'string' || !journalActionPath(action.path) || seen.has(action.path.toLowerCase()) ||
      (action.originalSha256 !== undefined && !validSha(action.originalSha256)) ||
      (action.newSha256 !== undefined && !validSha(action.newSha256)) || (!action.originalSha256 && !action.newSha256)) {
      throw new Error('모드팩 복구 경로/해시가 올바르지 않습니다. 백업을 보존했습니다.');
    }
    seen.add(action.path.toLowerCase());
  }
  const stage = safePath(gameDirectory, journal.stageRelative);
  const manifestPath = safePath(gameDirectory, '.cobble/managed-pack.json');
  await assertNoLinks(gameDirectory, stage); await assertNoLinks(gameDirectory, manifestPath);
  let committed = journal.phase === 'committed';
  if (!committed) {
    const current = await readJson<ManagedPack | null>(manifestPath, null);
    committed = JSON.stringify(current) === JSON.stringify(journal.result);
    if (committed) for (const action of journal.actions) {
      const target = safePath(gameDirectory, action.path); await assertNoLinks(gameDirectory, target);
      if (action.newSha256 ? !await checkFile(target, 'sha256', action.newSha256) : await exists(target)) { committed = false; break; }
    }
  }
  if (!committed) {
    const errors: unknown[] = [];
    for (const action of [...journal.actions].reverse()) {
      try {
        const target = safePath(gameDirectory, action.path), backup = safePath(stage, `backup/${action.path}`);
        await assertNoLinks(gameDirectory, target); await assertNoLinks(gameDirectory, backup);
        const targetExists = await exists(target), backupExists = await exists(backup);
        if (backupExists) {
          if (!action.originalSha256 || !await checkFile(backup, 'sha256', action.originalSha256)) throw new Error(`원본 백업 해시가 일치하지 않습니다: ${action.path}`);
          if (targetExists && (!action.newSha256 || !await checkFile(target, 'sha256', action.newSha256))) throw new Error(`복구 중 변경된 파일을 보존했습니다: ${action.path}`);
          if (targetExists) await fs.rm(target, { force: true });
          await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(backup, target);
        } else if (action.originalSha256) {
          if (!targetExists || !await checkFile(target, 'sha256', action.originalSha256)) throw new Error(`원본 파일/백업을 찾을 수 없습니다: ${action.path}`);
        } else if (targetExists) {
          if (!action.newSha256 || !await checkFile(target, 'sha256', action.newSha256)) throw new Error(`복구 중 사용자가 변경한 파일을 보존했습니다: ${action.path}`);
          await fs.rm(target, { force: true });
        }
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `자동 복구를 완료하지 못했습니다. 원본 백업을 보존했습니다: ${stage}`);
    if (journal.previousManifest) await writeJsonAtomic(manifestPath, journal.previousManifest);
    else await fs.rm(manifestPath, { force: true });
  }
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
  return true;
}

export async function installModpack(options: {
  pack: PackCatalog; archivePath: string; gameDirectory: string; apiKey: string;
  signal?: AbortSignal; onProgress: Progress;
}): Promise<ManagedPack> {
  const { pack, archivePath, gameDirectory, apiKey, signal, onProgress } = options;
  assertActive(signal);
  await recoverModpack(gameDirectory);
  onProgress('pack-verify', '모드팩 ZIP과 manifest를 검사하고 있습니다.', 0);
  const archive = await inspectPackArchive(pack, archivePath);
  if (!apiKey.trim()) throw new ModpackInstallError('필수 CurseForge 파일을 다운로드하려면 승인된 API 키가 필요합니다. 설정에서 개발자 본인의 키를 입력해 주세요.');
  onProgress('pack-resolve', `필수 파일 ${pack.files.length}개의 공식 정보를 확인하고 있습니다.`, 0);
  const mods: CfMod[] = [], files: CfFile[] = [];
  for (let offset = 0; offset < pack.files.length; offset += 50) {
    assertActive(signal);
    const batch = pack.files.slice(offset, offset + 50);
    const values = await Promise.all([
      apiBatch<CfMod>('mods', { modIds: batch.map(item => item.projectID) }, apiKey, signal),
      apiBatch<CfFile>('mods/files', { fileIds: batch.map(item => item.fileID) }, apiKey, signal)
    ]);
    mods.push(...values[0]); files.push(...values[1]);
    onProgress('pack-resolve', 'CurseForge 공식 메타데이터 확인 중', Math.min(100, (offset + batch.length) / pack.files.length * 100));
  }
  const resolved = resolveCurseForgeFiles(pack, mods, files);
  const stageRelative = `.cobble/staging/pack-${randomUUID()}`;
  const stage = safePath(gameDirectory, stageRelative);
  const cache = safePath(gameDirectory, '.cobble/cache/mods');
  await assertNoLinks(gameDirectory, stage); await assertNoLinks(gameDirectory, cache);
  await fs.mkdir(stage, { recursive: true }); await fs.mkdir(cache, { recursive: true });
  const manifestPath = safePath(gameDirectory, '.cobble/managed-pack.json');
  await assertNoLinks(gameDirectory, manifestPath);
  const previous = await readJson<ManagedPack>(manifestPath, { version: '', managedFiles: [] });
  const previousFiles = new Map((Array.isArray(previous.managedFiles) ? previous.managedFiles : [])
    .filter(file => managedFilePath(file.path) && /^[a-f0-9]{64}$/i.test(file.sha256))
    .map(file => [file.path, file.sha256]));
  const prepared: Array<{ path: string; sha256: string; source: string; seed?: boolean }> = [];
  const transferTotal = resolved.reduce((total, item) => total + item.file.fileLength, 0);
  const transfers = new Map<number, { downloaded: number; total: number; speed: number }>();
  const aggregateTransfer = () => ({ downloaded: [...transfers.values()].reduce((total, value) => total + value.downloaded, 0),
    total: transferTotal, speed: [...transfers.values()].reduce((total, value) => total + value.speed, 0) });
  let next = 0, completed = 0;
  const failures: Array<{ projectID: number; fileID: number; reason: string }> = [];
  const worker = async () => {
    while (next < resolved.length) {
      const item = resolved[next++]; assertActive(signal);
      try {
        const cachePath = safePath(cache, `${item.file.id}-${item.hash.value}${path.extname(item.file.fileName)}`);
        await assertNoLinks(gameDirectory, cachePath);
        await downloadFile({ url: item.file.downloadUrl!, destination: cachePath, hash: item.hash, size: item.file.fileLength,
          headers: { 'x-api-key': apiKey }, allowedHosts: CF_CDN_HOSTS, signal,
          onProgress: progress => {
            transfers.set(item.file.id, progress);
            onProgress('pack-download', `${item.file.fileName} 다운로드 중 (${completed}/${resolved.length})`, completed / resolved.length * 100, aggregateTransfer());
          } });
        transfers.set(item.file.id, { downloaded: item.file.fileLength, total: item.file.fileLength, speed: 0 });
        const stagedFile = safePath(stage, `new/${item.relativePath}`);
        await fs.mkdir(path.dirname(stagedFile), { recursive: true }); await fs.copyFile(cachePath, stagedFile);
        prepared.push({ path: item.relativePath, sha256: await hashFile(stagedFile, 'sha256'), source: stagedFile });
        completed++;
        onProgress('pack-download', `필수 파일 확인 완료 (${completed}/${resolved.length})`, completed / resolved.length * 100, aggregateTransfer());
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ projectID: item.file.modId, fileID: item.file.id, reason: (error as Error).message.replaceAll(apiKey, '[보호된 키]') });
      }
    }
  };
  const journalPath = safePath(gameDirectory, '.cobble/pack-journal.json');
  let journalWritten = false;
  let committed = false;
  let preserveStage = false;
  try {
    // Keep all workers settled before rollback/cleanup; a rejected worker must not keep writing into deleted staging.
    const workerResults = await Promise.allSettled(Array.from({ length: Math.min(4, resolved.length) }, worker));
    assertActive(signal);
    const failedWorker = workerResults.find(result => result.status === 'rejected');
    if (failedWorker?.status === 'rejected') throw failedWorker.reason;
    if (failures.length) throw new ModpackInstallError(`모드팩 파일 다운로드 실패 ${failures.length}개:\n` + failures.map(file => `${file.projectID}/${file.fileID}: ${file.reason}`).join('\n'), failures);
    onProgress('pack-overrides', '기본 설정과 리소스를 준비하고 있습니다.', 0);
    for (const entry of archive.overrides) {
      assertActive(signal);
      const relative = entry.entryName.slice(pack.overrides.length + 1);
      const target = safePath(gameDirectory, relative);
      await assertNoLinks(gameDirectory, target);
      // All overrides seed the first installation; existing user settings/resources are preserved.
      if (await exists(target)) continue;
      const data = entry.getData();
      if (data.length !== entry.header.size) throw new Error(`ZIP 확장 크기가 일치하지 않습니다: ${relative}`);
      const source = safePath(stage, `new/${relative}`);
      await fs.mkdir(path.dirname(source), { recursive: true }); await fs.writeFile(source, data, { flag: 'wx' });
      prepared.push({ path: relative, sha256: createHash('sha256').update(data).digest('hex'), source, seed: true });
    }
    // Preflight every destination and deletion before touching the previous valid installation.
    const nextFiles = new Set(prepared.filter(file => !file.seed).map(file => file.path));
    const deletions: string[] = [];
    for (const file of prepared) {
      const target = safePath(gameDirectory, file.path);
      await assertNoLinks(gameDirectory, target);
      if (await exists(target)) {
        if (await checkFile(target, 'sha256', file.sha256)) continue;
        if (file.seed) continue;
        const oldHash = previousFiles.get(file.path);
        if (!oldHash || !await checkFile(target, 'sha256', oldHash)) throw new Error(`사용자가 변경하거나 직접 설치한 파일을 덮어쓰지 않았습니다: ${file.path}`);
      }
    }
    for (const [relative, hash] of previousFiles) {
      if (nextFiles.has(relative)) continue;
      const target = safePath(gameDirectory, relative); await assertNoLinks(gameDirectory, target);
      if (await exists(target) && await checkFile(target, 'sha256', hash)) deletions.push(relative);
    }
    onProgress('pack-apply', '검증된 모드팩 파일을 적용하고 있습니다.', 0);
    const result: ManagedPack = { version: pack.version, managedFiles: prepared.map(file => ({ path: file.path, sha256: file.sha256 })) };
    const actions: PackJournalAction[] = [];
    for (const file of prepared) {
      const target = safePath(gameDirectory, file.path);
      const present = await exists(target);
      if (present && (file.seed || await checkFile(target, 'sha256', file.sha256))) continue;
      actions.push({ path: file.path, newSha256: file.sha256, ...(present ? { originalSha256: await hashFile(target, 'sha256') } : {}) });
    }
    for (const relative of deletions) actions.push({ path: relative, originalSha256: previousFiles.get(relative)! });
    const journal: PackJournal = { schemaVersion: 1, stageRelative, phase: 'applying', actions,
      previousManifest: await exists(manifestPath) ? previous : null, result };
    await assertNoLinks(gameDirectory, journalPath); await writeJsonAtomic(journalPath, journal); journalWritten = true;
    for (const file of prepared) {
      assertActive(signal);
      const destination = safePath(gameDirectory, file.path);
      await assertNoLinks(gameDirectory, destination);
      const present = await exists(destination);
      if (present && (file.seed || await checkFile(destination, 'sha256', file.sha256))) continue;
      let backup: string | undefined;
      if (present) {
        backup = safePath(stage, `backup/${file.path}`); await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.rename(destination, backup);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.rename(file.source, destination);
    }
    for (const relative of deletions) {
      assertActive(signal);
      const destination = safePath(gameDirectory, relative), backup = safePath(stage, `backup/${relative}`);
      await assertNoLinks(gameDirectory, destination);
      await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.rename(destination, backup);
    }
    await writeJsonAtomic(manifestPath, result);
    committed = true;
    journal.phase = 'committed'; await writeJsonAtomic(journalPath, journal);
    onProgress('pack-complete', '모드팩 설치와 무결성 검사를 완료했습니다.', 100);
    return result;
  } catch (error) {
    if (!committed) {
      try { if (journalWritten) await recoverModpack(gameDirectory); }
      catch (rollbackError) {
        preserveStage = true;
        throw new AggregateError([error, rollbackError], `설치 복구 중 오류가 발생했습니다. 원본 백업을 보존했습니다: ${stage}`);
      }
    }
    throw error;
  } finally {
    if (!preserveStage) {
      await assertNoLinks(gameDirectory, stage);
      await fs.rm(stage, { recursive: true, force: true });
      if (journalWritten) await fs.rm(journalPath, { force: true });
    }
  }
}
