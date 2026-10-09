import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { MinecraftFolder, Version } from '@xmcl/core';
import {
  createDefaultNodeInstallRuntime, createJavaRuntimeInstallWorkflow,
  createModernForgeInstallWorkflow, executeInstallManifest, executeInstallWorkflow,
  resolveMinecraftJarInstallFile, resolveMinecraftVersionJsonInstallFile,
  resolveLibraryInstallFiles, resolveAssetMetadataInstallFiles, resolveAssetObjectInstallFiles,
  resolveNeoForgedInstallerFile, DEFAULT_RUNTIME_ALL_URL,
  type InstallFile, type InstallManifest, type InstallRuntime, type JavaRuntimes,
} from '@xmcl/installer';
import { downloadFile, fetchSecure } from './download';
import { assertNoLinks, writeJsonAtomic } from './paths';

export interface MinecraftInstallOptions {
  gameDirectory: string; minecraftVersion: string; loaderVersion: string;
  signal?: AbortSignal;
  onProgress: (stage: string, message: string, progress: number, bytes?: {downloaded:number;total:number;speed:number}) => void;
}
const officialHosts = new Set(['piston-meta.mojang.com','piston-data.mojang.com','launchermeta.mojang.com','launcher.mojang.com','libraries.minecraft.net','resources.download.minecraft.net','maven.neoforged.net','maven.minecraftforge.net','repo1.maven.org','repo.maven.apache.org']);
function requireOfficial(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !officialHosts.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new Error('게임 설치에 허용되지 않은 다운로드 주소입니다.');
}
export async function installMinecraft(options: MinecraftInstallOptions): Promise<{ versionId: string; javaPath: string }> {
  const { gameDirectory: root, signal, onProgress } = options;
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('현재 설치기는 Windows 64비트용입니다.');
  await assertNoLinks(root, root);
  await fs.mkdir(root, { recursive: true });
  const folder = new MinecraftFolder(root);
  let stage = '게임 준비';
  const runtime: InstallRuntime = createDefaultNodeInstallRuntime({
    signal,
    maxConcurrency: 6,
    download: async (files: InstallFile[]) => {
      let index = 0, complete = 0;
      const worker = async () => {
        while (index < files.length) {
          const file = files[index++];
          signal?.throwIfAborted();
          await assertNoLinks(root, file.path);
          let checksum = file.checksum;
          const urls = file.urls;
          urls.forEach(requireOfficial);
          if (!checksum && urls[0]) {
            // Maven artifacts without embedded checksums use the publisher's SHA-1 sidecar.
            const res = await fetchSecure(urls[0] + '.sha1', { signal, allowedHosts:officialHosts });
            if (res.ok) {
              const text = (await res.text()).trim().split(/\s/)[0];
              if (/^[a-f0-9]{40}$/i.test(text)) checksum = { algorithm: 'sha1', value: text };
            }
          }
          if (!checksum || (checksum.algorithm !== 'sha1' && checksum.algorithm !== 'sha256')) throw new Error(`공식 무결성 해시가 없는 파일: ${path.basename(file.path)}`);
          let success = false, error: unknown;
          for (const url of urls) {
            try {
              await downloadFile({ url, destination: file.path, hash: { algorithm: checksum.algorithm as 'sha1'|'sha256', value: checksum.value }, size: file.size, signal, allowedHosts:officialHosts,
                onProgress: bytes => onProgress(stage, `${complete}/${files.length} · ${path.basename(file.path)}`, files.length ? complete / files.length : 0, bytes) });
              success = true; break;
            } catch (e) { error = e; signal?.throwIfAborted(); }
          }
          if (!success) throw error;
          complete++;
          onProgress(stage, `${complete}/${files.length} 파일 검증 완료`, complete / files.length);
        }
      };
      const results = await Promise.allSettled(Array.from({ length: Math.min(6, files.length) }, worker));
      const failed = results.find(r => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
    runJava: async command => {
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command.executable, command.args, { cwd: command.cwd, env: { ...process.env, ...command.env }, windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] });
        let tail = '';
        const append = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-4000); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        const abort = () => { child.kill(); };
        signal?.addEventListener('abort', abort, { once: true });
        child.once('error', reject);
        child.once('close', code => { signal?.removeEventListener('abort', abort); if (signal?.aborted) reject(signal.reason); else if (code === 0) resolve(); else reject(new Error(`NeoForge 처리 실패 (${code}): ${tail}`)); });
      });
    },
  });
  const validatePlan = async (plan: InstallManifest) => {
    for (const task of plan.tasks) {
      if (task.type === 'files') for (const file of task.files) { await assertNoLinks(root, file.path); file.urls.forEach(requireOfficial); }
      if (task.type === 'materialize') for (const op of task.operations) {await assertNoLinks(root, op.path);if('source' in op)await assertNoLinks(root,op.source);if('archive' in op)await assertNoLinks(root,op.archive);if('archives' in op)for(const archive of op.archives)await assertNoLinks(root,archive);}
      if (task.type === 'java') {for(const strategy of task.strategies)for(const command of strategy){await assertNoLinks(root,command.executable);if(command.cwd)await assertNoLinks(root,command.cwd);}for(const output of task.outputs)await assertNoLinks(root,output.path);}
    }
  };
  const runPlan = async (plan: InstallManifest) => { await validatePlan(plan); await executeInstallManifest(plan, runtime, { signal, attempts: 2 }); };
  const workflow = async <T>(flow: { next(): Promise<{done:false;plan:InstallManifest}|{done:true;result:T}> }): Promise<T> => {
    for (let i = 0; i < 64; i++) { signal?.throwIfAborted(); const next = await flow.next(); if (next.done) return next.result; await runPlan(next.plan); }
    throw new Error('설치 단계 수가 제한을 초과했습니다.');
  };
  stage = 'Minecraft 다운로드'; onProgress(stage, '공식 버전 목록 확인', 0);
  const listRes = await fetchSecure('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal, allowedHosts:officialHosts });
  if (!listRes.ok) throw new Error('Minecraft 공식 버전 목록을 가져올 수 없습니다.');
  const list = await listRes.json() as {versions:Array<{id:string;url:string;sha1:string}>};
  const info = list.versions.find(v => v.id === options.minecraftVersion);
  if (!info) throw new Error('Minecraft 버전을 공식 목록에서 찾을 수 없습니다.');
  const versionFile = resolveMinecraftVersionJsonInstallFile(info, folder);
  versionFile.checksum = { algorithm: 'sha1', value: info.sha1 };
  await runPlan({ schemaVersion: 1, tasks: [{ id:'vanilla-json',type:'files',files:[versionFile] }] });
  let version = await Version.parse(folder, options.minecraftVersion);
  const jar = resolveMinecraftJarInstallFile(version);
  await runPlan({ schemaVersion:1,tasks:[{id:'vanilla-files',type:'files',files:[...(jar ? [jar] : []),...resolveLibraryInstallFiles(version.libraries, folder),...resolveAssetMetadataInstallFiles(version, folder)]}] });
  stage = '게임 리소스 다운로드';
  const assets = await resolveAssetObjectInstallFiles(version, folder);
  await runPlan({schemaVersion:1,tasks:[{id:'vanilla-assets',type:'files',files:assets}]});
  stage = 'Java 21 준비'; onProgress(stage, 'Mojang 공식 Java 런타임 확인', 0);
  const javaRes = await fetchSecure(DEFAULT_RUNTIME_ALL_URL, { signal, allowedHosts:officialHosts });
  if (!javaRes.ok) throw new Error('공식 Java 런타임 목록을 가져올 수 없습니다.');
  const runtimes = await javaRes.json() as JavaRuntimes;
  const target = runtimes['windows-x64']['java-runtime-delta'].find(v => v.version.name.startsWith('21.'));
  if (!target) throw new Error('Windows Java 21 런타임을 찾을 수 없습니다.');
  const javaRoot = path.join(root, 'runtime', 'java21');
  await workflow(createJavaRuntimeInstallWorkflow({target,destination:javaRoot}));
  const javaPath = path.join(javaRoot,'bin','java.exe');
  stage = 'NeoForge 설치'; onProgress(stage, `NeoForge ${options.loaderVersion} 설치 프로그램 확인`, 0);
  const installOptions = {java:javaPath,side:'client' as const,versionId:`neoforge-${options.loaderVersion}`,inheritsFrom:options.minecraftVersion,signal};
  const installer = await resolveNeoForgedInstallerFile('neoforge', options.loaderVersion, folder, installOptions);
  const forge = await workflow(createModernForgeInstallWorkflow({id:`neoforge-${options.loaderVersion}`,minecraft:folder,minecraftVersion:options.minecraftVersion,installer:installer.file,artifactVersion:options.loaderVersion,java:javaPath,installOptions,side:'client'}));
  version = await Version.parse(folder, forge.version);
  await runPlan({schemaVersion:1,tasks:[{id:'loader-libraries',type:'files',files:resolveLibraryInstallFiles(version.libraries,folder)}]});
  const result = { versionId: forge.version, javaPath };
  await writeJsonAtomic(path.join(root,'.cobble','runtime.json'), result);
  onProgress('기본 게임 준비 완료', 'Minecraft · Java 21 · NeoForge 파일 검증 완료', 1);
  return result;
}
