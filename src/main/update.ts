import { verify, createPublicKey, createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { downloadFile, hashFile } from './download';
import { assertNoLinks, safePath, readJson } from './paths';

export interface PatchFile { path: string; url: string; sha256: string; size: number; policy: 'managed'|'seed' }
export interface Feed {
  schemaVersion: 1; packId: string; version: string; sequence: number;
  minecraftVersion: string; loaderVersion: string;
  files: PatchFile[]; removedPaths: string[];
  announcements: Array<{id:string;title:string;body:string;publishedAt:string}>;
  patchNotes: Array<{version:string;date:string;body:string}>;
}
interface UpdateInstalled { version: string; sequence: number; files: Array<{path:string;sha256:string}>; feedDigest?:string }
interface Step {
  path:string; hadOriginal:boolean; deletion:boolean;
  beforeSha256?:string; afterSha256?:string; status:'pending'|'prepared'|'applied';
}
interface Journal {
  schemaVersion:1; phase:'applying'|'committed'; directory:string;
  previous:UpdateInstalled|null; steps:Step[]; next:UpdateInstalled;
}
export interface UpdateOptions {
  signal?:AbortSignal;
  onProgress?:(message:string,progress:number,bytes?:{downloaded:number;total:number;speed:number})=>void;
  apiKey?:string;
  repair?:boolean;
  /** Test-only failure injection after a completed filesystem step. */
  failAfterStep?:number;
}
const ALLOWED_ROOTS = new Set(['mods','config','defaultconfigs','kubejs','resourcepacks','shaderpacks']);
const verifiedFeeds = new WeakMap<Feed,string>();
const activeRoots = new Set<string>();
const HASH = /^[a-f0-9]{64}$/i;
const markerPath = (root:string) => path.join(root,'.cobble','update-installed.json');
const journalPath = (root:string) => path.join(root,'.cobble','update-journal.json');
const keyPath = (relative:string) => relative.toLowerCase();
function record(value:unknown):value is Record<string,unknown> { return Boolean(value) && typeof value==='object' && !Array.isArray(value); }
function text(value:unknown,max:number):value is string { return typeof value==='string' && value.length>0 && value.length<=max; }

export function validateManagedPath(relative:string):void {
  if (!text(relative,1024) || relative.includes('\\')) throw new Error('업데이트 경로가 올바르지 않습니다.');
  safePath(path.resolve('.'),relative);
  const pieces=relative.split('/');
  if (pieces.length<2 || !ALLOWED_ROOTS.has(pieces[0])) throw new Error('업데이트로 변경할 수 없는 경로입니다.');
}
function validateDistinctPaths(names:string[]):void {
  const paths=new Set<string>();
  for (const name of names) {
    validateManagedPath(name); const key=keyPath(name);
    if (paths.has(key)) throw new Error('업데이트에 중복 경로가 있습니다.'); paths.add(key);
  }
  for (const name of paths) {
    const pieces=name.split('/');
    for (let i=1;i<pieces.length;i++) if(paths.has(pieces.slice(0,i).join('/'))) throw new Error('업데이트 파일과 상위 경로가 충돌합니다.');
  }
}
function base64(value:unknown,max:number,requiredBytes?:number):Buffer {
  if(!text(value,max) || value.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('업데이트 인코딩 형식이 올바르지 않습니다.');
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value || (requiredBytes!==undefined && bytes.length!==requiredBytes)) throw new Error('업데이트 인코딩 형식이 올바르지 않습니다.');
  return bytes;
}
export function verifyFeed(envelope:unknown,publicKey:string,expected:{packId:string;minecraftVersion:string;loaderVersion:string}):Feed {
  if(!record(envelope)) throw new Error('서명된 업데이트 문서가 필요합니다.');
  const payload=base64(envelope.payload,4*1024*1024),signature=base64(envelope.signature,88,64),key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519' || !verify(null,payload,key,signature)) throw new Error('업데이트 서명을 검증할 수 없습니다.');
  const feed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
  if(!record(feed) || feed.schemaVersion!==1 || feed.packId!==expected.packId || feed.minecraftVersion!==expected.minecraftVersion || feed.loaderVersion!==expected.loaderVersion || !text(feed.version,80) || !Number.isSafeInteger(feed.sequence) || Number(feed.sequence)<1) throw new Error('이 모드팩에 적용할 수 없는 업데이트입니다.');
  if(!Array.isArray(feed.files) || feed.files.length>5000 || !Array.isArray(feed.removedPaths) || feed.removedPaths.length>5000) throw new Error('업데이트 파일 목록이 올바르지 않습니다.');
  let total=0;
  for(const file of feed.files) {
    if(!record(file) || !text(file.path,1024) || !text(file.url,4096) || !text(file.sha256,64) || !HASH.test(file.sha256) || !Number.isSafeInteger(file.size) || Number(file.size)<0 || Number(file.size)>2*1024*1024*1024 || !['managed','seed'].includes(String(file.policy))) throw new Error('업데이트 파일 정보가 올바르지 않습니다.');
    const url=new URL(file.url); if(url.protocol!=='https:' || url.username || url.password) throw new Error('HTTPS 업데이트 주소만 허용됩니다.'); total+=Number(file.size);
  }
  if(total>20*1024*1024*1024) throw new Error('업데이트 용량 제한을 초과했습니다.');
  if(feed.removedPaths.some(name=>!text(name,1024))) throw new Error('업데이트 삭제 경로가 올바르지 않습니다.');
  validateDistinctPaths([...feed.files.map(file=>file.path as string),...feed.removedPaths]);
  if(!Array.isArray(feed.announcements) || feed.announcements.length>100 || feed.announcements.some(a=>!record(a)||!text(a.id,80)||!text(a.title,200)||typeof a.body!=='string'||a.body.length>20000||!text(a.publishedAt,80))) throw new Error('공지 형식이 올바르지 않습니다.');
  if(!Array.isArray(feed.patchNotes) || feed.patchNotes.length>100 || feed.patchNotes.some(a=>!record(a)||!text(a.version,80)||!text(a.date,80)||typeof a.body!=='string'||a.body.length>20000)) throw new Error('패치 내역 형식이 올바르지 않습니다.');
  const result=feed as unknown as Feed;
  for(const file of result.files){file.sha256=file.sha256.toLowerCase();Object.freeze(file);}
  result.announcements.forEach(Object.freeze);result.patchNotes.forEach(Object.freeze);
  Object.freeze(result.files);Object.freeze(result.removedPaths);Object.freeze(result.announcements);Object.freeze(result.patchNotes);Object.freeze(result);
  verifiedFeeds.set(result,createHash('sha256').update(payload).digest('hex')); return result;
}
export function getFeedDigest(feed:Feed):string {
  const digest=verifiedFeeds.get(feed);
  if(!digest)throw new Error('서명 검증을 완료한 업데이트만 사용할 수 있습니다.');
  return digest;
}

async function fileHash(root:string,file:string):Promise<string|undefined> {
  await assertNoLinks(root,file);
  try { const stat=await fs.lstat(file);if(!stat.isFile())throw new Error('업데이트 대상은 일반 파일이어야 합니다.');return await hashFile(file); }
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
async function durableJson(root:string,file:string,value:unknown):Promise<void> {
  await assertNoLinks(root,file);await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temp,'wx');
  try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
  try{await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function durableCopy(root:string,source:string,destination:string):Promise<void> {
  await assertNoLinks(root,source);await assertNoLinks(root,destination);
  if(await fileHash(root,source)===undefined)throw new Error('업데이트 복구에 필요한 파일이 없습니다.');
  await fs.mkdir(path.dirname(destination),{recursive:true});
  const temp=destination+'.'+randomUUID()+'.tmp';
  try{
    // Replace the destination name atomically instead of writing through any existing hard link.
    await fs.copyFile(source,temp,constants.COPYFILE_EXCL);
    const handle=await fs.open(temp,'r+');try{await handle.sync();}finally{await handle.close();}
    await fs.rename(temp,destination);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
function installed(value:unknown):UpdateInstalled {
  if(!record(value)||!text(value.version,80)||!Number.isSafeInteger(value.sequence)||Number(value.sequence)<0||!Array.isArray(value.files)||value.files.length>20000)throw new Error('설치된 업데이트 기록이 올바르지 않습니다.');
  if(value.feedDigest!==undefined && (!text(value.feedDigest,64)||!HASH.test(value.feedDigest)))throw new Error('설치된 업데이트 서명 기록이 올바르지 않습니다.');
  for(const file of value.files)if(!record(file)||!text(file.path,1024)||!text(file.sha256,64)||!HASH.test(file.sha256))throw new Error('설치된 파일 기록이 올바르지 않습니다.');
  validateDistinctPaths(value.files.map(file=>file.path as string));return value as unknown as UpdateInstalled;
}
function validateJournal(root:string,value:unknown):Journal {
  if(!record(value)||value.schemaVersion!==1||!['applying','committed'].includes(String(value.phase))||!text(value.directory,4096)||!Array.isArray(value.steps)||value.steps.length>10000)throw new Error('업데이트 복구 기록이 올바르지 않습니다.');
  const transactions=path.join(root,'.cobble','transactions'),directory=path.resolve(value.directory);
  if(path.dirname(directory).toLowerCase()!==transactions.toLowerCase()||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path.basename(directory)))throw new Error('업데이트 복구 경로가 올바르지 않습니다.');
  const previous=value.previous===null?null:installed(value.previous),next=installed(value.next);
  if(previous && (next.sequence<previous.sequence || (next.sequence===previous.sequence && (!next.feedDigest || next.feedDigest!==previous.feedDigest))))throw new Error('업데이트 복구 순서가 올바르지 않습니다.');
  let unfinished=false,prepared=false;
  for(const step of value.steps){
    if(!record(step)||!text(step.path,1024)||typeof step.hadOriginal!=='boolean'||typeof step.deletion!=='boolean'||!['pending','prepared','applied'].includes(String(step.status)))throw new Error('업데이트 복구 단계가 올바르지 않습니다.');
    if(step.hadOriginal?!text(step.beforeSha256,64)||!HASH.test(step.beforeSha256):step.beforeSha256!==undefined)throw new Error('업데이트 원본 해시가 올바르지 않습니다.');
    if(step.deletion?!step.hadOriginal||step.afterSha256!==undefined:!text(step.afterSha256,64)||!HASH.test(step.afterSha256))throw new Error('업데이트 대상 해시가 올바르지 않습니다.');
    if(step.status==='applied' && unfinished)throw new Error('업데이트 복구 단계 순서가 올바르지 않습니다.');
    if(step.status==='prepared' && (unfinished||prepared))throw new Error('업데이트 복구 단계 순서가 올바르지 않습니다.');
    if(step.status==='prepared')prepared=true;if(step.status!=='applied')unfinished=true;
    if(value.phase==='committed' && step.status!=='applied')throw new Error('완료되지 않은 업데이트 복구 기록입니다.');
    const target=next.files.find(file=>keyPath(file.path)===keyPath(step.path as string));
    if(step.deletion?target!==undefined:target?.sha256.toLowerCase()!==String(step.afterSha256).toLowerCase())throw new Error('업데이트 복구 파일 기록이 충돌합니다.');
  }
  validateDistinctPaths(value.steps.map(step=>step.path as string));return {...value,directory,previous,next} as unknown as Journal;
}
async function rollback(root:string,journal:Journal):Promise<void> {
  for(const step of [...journal.steps].reverse()){
    if(step.status==='pending')continue;
    const target=safePath(root,step.path),current=await fileHash(root,target);
    if(step.hadOriginal){
      const backup=safePath(journal.directory,'backup/'+step.path),saved=await fileHash(root,backup);
      if(saved!==step.beforeSha256?.toLowerCase())throw new Error('원본 백업이 없거나 손상되었습니다. 복구 기록을 보존합니다.');
      if(current!==undefined && current!==step.beforeSha256?.toLowerCase() && current!==step.afterSha256?.toLowerCase())throw new Error('사용자가 변경한 파일은 자동 복구로 덮어쓸 수 없습니다.');
      if(current!==step.beforeSha256?.toLowerCase()){
        const restored=safePath(journal.directory,'restore/'+step.path);await durableCopy(root,backup,restored);
        await assertNoLinks(root,target);await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(restored,target);
      }
    }else if(current!==undefined){
      if(current!==step.afterSha256?.toLowerCase())throw new Error('사용자가 변경한 새 파일은 자동 복구로 삭제할 수 없습니다.');await fs.rm(target,{force:true});
    }
  }
  await assertNoLinks(root,markerPath(root));
  if(journal.previous)await durableJson(root,markerPath(root),journal.previous);else await fs.rm(markerPath(root),{force:true});
}
async function recover(root:string):Promise<boolean> {
  await assertNoLinks(root,journalPath(root));const raw=await readJson<unknown>(journalPath(root),null);if(raw===null)return false;
  const journal=validateJournal(root,raw);await assertNoLinks(root,journal.directory);await assertNoLinks(root,markerPath(root));
  if(journal.phase==='applying')await rollback(root,journal);else await durableJson(root,markerPath(root),journal.next);
  // Keep backups for explicit recovery. Never recurse into user files.
  await fs.rm(journalPath(root),{force:true});return true;
}
async function guarded<T>(root:string,operation:(resolved:string)=>Promise<T>):Promise<T> {
  const resolved=path.resolve(root),key=resolved.toLowerCase();if(activeRoots.has(key))throw new Error('이 게임 폴더에서 다른 업데이트 작업이 진행 중입니다.');activeRoots.add(key);
  try{return await operation(resolved);}finally{activeRoots.delete(key);}
}
export async function recoverUpdate(root:string):Promise<boolean>{return guarded(root,recover);}
async function initialFiles(root:string):Promise<Array<{path:string;sha256:string}>> {
  const file=path.join(root,'.cobble','managed-pack.json');await assertNoLinks(root,file);const value=await readJson<unknown>(file,null);if(value===null)return [];
  if(!record(value)||!Array.isArray(value.managedFiles)||value.managedFiles.length>20000)throw new Error('기본 모드팩 파일 기록이 올바르지 않습니다.');
  const files:Array<{path:string;sha256:string}>=[];
  for(const item of value.managedFiles){
    if(!record(item)||!text(item.path,1024)||!text(item.sha256,64)||!HASH.test(item.sha256))throw new Error('기본 모드팩 파일 기록이 올바르지 않습니다.');
    if(!ALLOWED_ROOTS.has(item.path.split('/')[0]))continue;validateManagedPath(item.path);files.push({path:item.path,sha256:item.sha256.toLowerCase()});
  }
  validateDistinctPaths(files.map(file=>file.path));return files;
}

/** Only frozen signature-verified feeds are accepted; repair reuses the identical installed signed payload. */
export async function applyUpdate(root:string,feed:Feed,options:UpdateOptions={}):Promise<{changed:number;preserved:string[]}> {
  const feedDigest=verifiedFeeds.get(feed);if(!feedDigest)throw new Error('서명 검증을 완료한 업데이트만 적용할 수 있습니다.');
  return guarded(root,async root=>{
    await recover(root);await assertNoLinks(root,markerPath(root));const rawPrevious=await readJson<unknown>(markerPath(root),null),previous=rawPrevious===null?null:installed(rawPrevious);
    if(previous && (feed.sequence<previous.sequence || (feed.sequence===previous.sequence && (!options.repair||previous.feedDigest!==feedDigest))))throw new Error('이미 적용했거나 이전 순서인 업데이트입니다.');
    const baselineFiles=previous?.files??await initialFiles(root),baselines=new Map(baselineFiles.map(file=>[keyPath(file.path),file])),nextFiles=new Map(baselines);
    const directory=path.join(root,'.cobble','transactions',randomUUID());await assertNoLinks(root,directory);await fs.mkdir(directory,{recursive:true});
    const steps:Step[]=[],preserved:string[]=[];
    for(const file of feed.files){
      options.signal?.throwIfAborted();const target=safePath(root,file.path),localHash=await fileHash(root,target),key=keyPath(file.path),baseline=baselines.get(key);
      if(localHash===file.sha256){nextFiles.set(key,{path:file.path,sha256:file.sha256});continue;}
      const personalized=localHash!==undefined && file.path.split('/')[0]!=='mods' && (!baseline||baseline.sha256.toLowerCase()!==localHash);
      if(localHash!==undefined && (file.policy==='seed'||personalized)){preserved.push(file.path);continue;}
      const staged=safePath(directory,'stage/'+file.path);await assertNoLinks(root,staged);
      await downloadFile({url:file.url,destination:staged,hash:{algorithm:'sha256',value:file.sha256},size:file.size,signal:options.signal,headers:options.apiKey?{'x-api-key':options.apiKey}:undefined,
        onProgress:bytes=>options.onProgress?.(`업데이트 준비 ${file.path}`,steps.length/Math.max(1,feed.files.length),bytes)});
      steps.push({path:file.path,hadOriginal:localHash!==undefined,beforeSha256:localHash,afterSha256:file.sha256,deletion:false,status:'pending'});nextFiles.set(key,{path:file.path,sha256:file.sha256});
    }
    for(const relative of feed.removedPaths){
      options.signal?.throwIfAborted();const key=keyPath(relative),baseline=baselines.get(key),target=safePath(root,relative),localHash=await fileHash(root,target);
      if(!baseline){if(localHash!==undefined)preserved.push(relative);continue;}
      if(localHash===undefined){nextFiles.delete(key);continue;}
      if(localHash!==baseline.sha256.toLowerCase()){preserved.push(relative);continue;}
      steps.push({path:relative,hadOriginal:true,beforeSha256:localHash,deletion:true,status:'pending'});nextFiles.delete(key);
    }
    const next:UpdateInstalled={version:feed.version,sequence:feed.sequence,files:[...nextFiles.values()],feedDigest};installed(next);options.signal?.throwIfAborted();
    const journal:Journal={schemaVersion:1,phase:'applying',directory,previous,steps,next};await durableJson(root,journalPath(root),journal);let committed=false;
    try{
      for(let i=0;i<steps.length;i++){
        options.signal?.throwIfAborted();const step=steps[i],target=safePath(root,step.path),localHash=await fileHash(root,target);
        if(localHash!==step.beforeSha256)throw new Error('준비 중 파일이 변경되어 업데이트를 중단했습니다.');
        if(step.hadOriginal){const backup=safePath(directory,'backup/'+step.path);await durableCopy(root,target,backup);if(await fileHash(root,backup)!==step.beforeSha256)throw new Error('업데이트 원본 백업을 검증하지 못했습니다.');}
        step.status='prepared';await durableJson(root,journalPath(root),journal);await assertNoLinks(root,target);
        if(await fileHash(root,target)!==step.beforeSha256)throw new Error('적용 중 파일이 변경되어 업데이트를 중단했습니다.');
        if(step.deletion)await fs.rm(target);else{const staged=safePath(directory,'stage/'+step.path);if(await fileHash(root,staged)!==step.afterSha256)throw new Error('준비된 업데이트 파일이 손상되었습니다.');await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(staged,target);}
        step.status='applied';await durableJson(root,journalPath(root),journal);options.onProgress?.(`패치 적용 ${step.path}`,(i+1)/Math.max(1,steps.length));if(options.failAfterStep===i+1)throw new Error('Simulated update failure');
      }
      await durableJson(root,markerPath(root),next);journal.phase='committed';await durableJson(root,journalPath(root),journal);committed=true;await fs.rm(journalPath(root),{force:true});return {changed:steps.length,preserved};
    }catch(error){if(committed)throw error;await rollback(root,journal);await fs.rm(journalPath(root),{force:true});throw error;}
  });
}
