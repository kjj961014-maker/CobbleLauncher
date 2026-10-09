import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type HashAlgorithm = 'sha1' | 'sha256';
export interface DownloadOptions {
  url: string; destination: string;
  hash: { algorithm: HashAlgorithm; value: string }; size?: number;
  headers?: Record<string, string>; signal?: AbortSignal;
  allowedHosts?: ReadonlySet<string>;
  onProgress?: (p: { downloaded: number; total: number; speed: number }) => void;
}
export async function hashFile(file: string, algorithm: HashAlgorithm = 'sha256'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function checkFile(file: string, algorithm: HashAlgorithm, hash: string): Promise<boolean> {
  try { return (await hashFile(file, algorithm)) === hash.toLowerCase(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export function isCurseForgeHost(host: string): boolean {
  return host === 'api.curseforge.com' || host === 'edge.forgecdn.net' || host === 'mediafilez.forgecdn.net' || host === 'media.forgecdn.net';
}
export interface SecureRequestOptions extends RequestInit { allowedHosts?: ReadonlySet<string> }
export async function fetchSecure(url: string, options: SecureRequestOptions = {}, redirects = 0): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('HTTPS 다운로드 주소만 허용됩니다.');
  if (options.allowedHosts && !options.allowedHosts.has(parsed.hostname)) throw new Error(`허용되지 않은 다운로드 호스트입니다: ${parsed.hostname}`);
  if (redirects > 5) throw new Error('다운로드 리디렉션이 너무 많습니다.');
  const headers = new Headers(options.headers);
  if (headers.has('x-api-key') && !isCurseForgeHost(parsed.hostname)) headers.delete('x-api-key');
  const { allowedHosts: _allowedHosts, ...request } = options;
  const response = await fetch(url, { ...request, headers, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(30_000) });
  if ([301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('잘못된 다운로드 리디렉션입니다.');
    const next = new URL(location, url);
    await response.body?.cancel();
    if (next.origin !== parsed.origin) {
      headers.delete('authorization'); headers.delete('cookie'); headers.delete('proxy-authorization');
      if (!isCurseForgeHost(parsed.hostname) || !isCurseForgeHost(next.hostname)) headers.delete('x-api-key');
    }
    let method = options.method;
    let body = options.body;
    if ((response.status === 303 && method?.toUpperCase() !== 'HEAD') || ([301, 302].includes(response.status) && method?.toUpperCase() === 'POST')) {
      method = 'GET'; body = undefined; headers.delete('content-type'); headers.delete('content-length');
    }
    return fetchSecure(next.href, { ...options, method, body, headers }, redirects + 1);
  }
  return response;
}

export async function downloadFile(options: DownloadOptions): Promise<void> {
  const { destination, hash, onProgress, size } = options;
  if (!new RegExp(hash.algorithm === 'sha1' ? '^[a-fA-F0-9]{40}$' : '^[a-fA-F0-9]{64}$').test(hash.value)) throw new Error('다운로드 무결성 해시가 없습니다.');
  if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) throw new Error('다운로드 크기가 올바르지 않습니다.');
  let cachedSize: number | undefined;
  try { const cached = await fs.lstat(destination); if (cached.isSymbolicLink() || !cached.isFile()) throw new Error('다운로드 대상이 일반 파일이 아닙니다.'); cachedSize = cached.size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if ((size === undefined || cachedSize === size) && await checkFile(destination, hash.algorithm, hash.value)) { onProgress?.({ downloaded: cachedSize ?? 0, total: size ?? cachedSize ?? 0, speed: 0 }); return; }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = destination + '.part';
  const metaPath = partial + '.json';
  for (const file of [partial, metaPath]) {
    try { const info = await fs.lstat(file); if (info.isSymbolicLink() || !info.isFile()) throw new Error('이어받기 파일이 일반 파일이 아닙니다.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const identity = JSON.stringify({ url: options.url, hash, size });
  let start = 0;
  try { if (await fs.readFile(metaPath, 'utf8') === identity) start = (await fs.stat(partial)).size; } catch {}
  if (size !== undefined && start === size && await checkFile(partial, hash.algorithm, hash.value)) {
    await fs.rename(partial, destination); await fs.rm(metaPath, { force: true });
    onProgress?.({ downloaded: size, total: size, speed: 0 }); return;
  }
  if (size !== undefined && start >= size) start = 0;
  if (!start) await fs.rm(partial, { force: true });
  await fs.writeFile(metaPath, identity);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const headers = { ...options.headers, ...(start ? { Range: `bytes=${start}-` } : {}) };
      const response = await fetchSecure(options.url, { headers, allowedHosts: options.allowedHosts, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
      if (response.status === 416 && start) {
        await response.body?.cancel(); await fs.rm(partial, { force: true }); start = 0; continue;
      }
      if (!response.ok || !response.body) throw new Error(`다운로드 요청 실패 (HTTP ${response.status})`);
      let rangeTotal: number | undefined;
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (!range || Number(range[1]) !== start || Number(range[2]) < start || Number(range[2]) !== Number(range[3]) - 1 || (size !== undefined && Number(range[3]) !== size)) {
          await response.body.cancel(); throw new Error('이어받기 응답 범위가 잘못되었습니다.');
        }
        rangeTotal = Number(range[3]);
      } else if (start) { start = 0; await fs.rm(partial, { force: true }); }
      const total = size ?? rangeTotal ?? start + Number(response.headers.get('content-length') ?? 0);
      const handle = await fs.open(partial, start ? 'a' : 'w');
      let downloaded = start;
      const began = Date.now();
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          options.signal?.throwIfAborted();
          downloaded += chunk.byteLength;
          if ((size !== undefined && downloaded > size) || (total > 0 && downloaded > total)) throw new Error('다운로드 용량이 지정값을 초과했습니다.');
          await handle.writeFile(chunk);
          onProgress?.({ downloaded, total, speed: (downloaded - start) * 1000 / Math.max(1, Date.now() - began) });
        }
        await handle.sync();
      } finally { await handle.close(); }
      if ((size !== undefined && downloaded !== size) || (total > 0 && downloaded !== total)) throw new Error('다운로드 용량이 일치하지 않습니다.');
      if (!await checkFile(partial, hash.algorithm, hash.value)) { await fs.rm(partial, { force: true }); start = 0; throw new Error('다운로드 파일 해시가 일치하지 않습니다.'); }
      await fs.rename(partial, destination);
      await fs.rm(metaPath, { force: true }).catch(() => {});
      return;
    } catch (error) {
      lastError = error;
      options.signal?.throwIfAborted();
      try { start = (await fs.stat(partial)).size; } catch { start = 0; }
    }
  }
  throw lastError;
}
