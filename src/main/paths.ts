import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function safePath(root: string, relative: string): string {
  if (!relative || relative.length > 1024 || /[\x00-\x1f<>:"|?*]/.test(relative) || path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative)) throw new Error('허용되지 않은 파일 경로입니다.');
  const segments = relative.replace(/\\/g, '/').split('/');
  if (segments.some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw new Error('안전하지 않은 파일 경로입니다.');
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (!target.startsWith(resolvedRoot + path.sep)) throw new Error('설치 폴더 밖의 경로입니다.');
  return target;
}

export async function assertNoLinks(root: string, target: string): Promise<void> {
  const base = path.resolve(root);
  const rel = path.relative(base, path.resolve(target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('설치 폴더 밖의 경로입니다.');
  // Check the root too: Windows junctions and symlinks must never redirect writes.
  let current = path.parse(base).root;
  const segments = base.slice(current.length).split(path.sep).filter(Boolean).concat(rel.split(path.sep).filter(Boolean));
  for (const segment of segments) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('연결된 폴더/파일에는 설치할 수 없습니다.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
  try { await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
