import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fs, appendFile } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launch as launchGame, Version } from '@xmcl/core';
import { z } from 'zod';
import type { LauncherState, Settings } from '../shared/types';
import { authenticate, refresh, type Session, type AuthDiagnostic } from './auth';
import { openLoginWindow, type LoginWindow } from './login-window';
import { installMinecraft } from './minecraft';
import { installModpack, ensurePackArchive, recoverModpack, type PackCatalog } from './modpack';
import { fetchSecure, checkFile } from './download';
import { readJson, writeJsonAtomic, assertNoLinks, safePath } from './paths';
import { verifyFeed, getFeedDigest, applyUpdate, recoverUpdate, type Feed } from './update';
import { Vault } from './vault';
import { pingServer } from './server';

let window:BrowserWindow|null=null, state:LauncherState, vault:Vault, pack:PackCatalog, session:Session|null=null;
let operation:AbortController|null=null;
let settingsFile:string,logsDirectory:string,rootDirectory:string;
let lastPublish=0,feed:Feed|null=null,sessionClientId='';
let configurationRevision=0;
let pendingLoginUrl:string|null=null;
const isSmoke=process.argv.includes('--smoke-test');
const isUITest=process.argv.includes('--ui-test');
const qaOutput=process.env.COBBLE_QA_OUTPUT?path.resolve(process.env.COBBLE_QA_OUTPUT):path.resolve(__dirname,'../../test-results');
if(isSmoke)app.setPath('userData',path.join(qaOutput,'smoke-data'));
if(isUITest)app.setPath('userData',path.join(qaOutput,'ui-data'));
const installMarker=()=>path.join(state.settings.gameDirectory,'.cobble','install.json');
type Installation={versionId:string;javaPath:string;packVersion:string;installedAt:string};
function publish(force=false) {
  if(!state)return;const now=Date.now();if(!force&&now-lastPublish<100)return;lastPublish=now;
  state.system.freeMemoryMb=Math.round(os.freemem()/1048576);
  window?.webContents.send('launcher:state',structuredClone(state));
}
function redact(message:string) {
  for(const secret of [session?.accessToken,session?.refreshToken]) if(secret)message=message.replaceAll(secret,'[보호된 토큰]');
  return message.replace(/(Bearer\s+)[\w.\-]+/gi,'$1[보호된 토큰]').slice(0,6000);
}
function log(level:string,message:string) {
  const entry={time:new Date().toISOString(),level,message:redact(message)};
  state.logs.push(entry);state.logs=state.logs.slice(-120);publish();
  appendFile(path.join(logsDirectory,'launcher.log'),JSON.stringify(entry)+'\n',()=>{});
}
async function syncInstallation() {
  const marker=await readJson<Installation|null>(installMarker(),null);
  const current=await readJson<{version?:string}>(path.join(state.settings.gameDirectory,'.cobble','update-installed.json'),{});
  state.installation=marker?{status:'installed',version:current.version??marker.packVersion}:{status:'not-installed'};
}
async function runOperation(kind:string,fn:(signal:AbortSignal)=>Promise<unknown>) {
  if(operation)throw new Error('다른 작업이 진행 중입니다. 완료하거나 취소한 뒤 다시 시도하세요.');
  if(state.game.running)throw new Error('게임이 실행 중입니다. 종료한 뒤 파일 작업을 진행하세요.');
  const controller=new AbortController();operation=controller;state.error=undefined;
  state.operation={kind,stage:'준비',progress:0,downloadedBytes:0,totalBytes:0,speedBytesPerSecond:0,message:'작업 준비 중'};publish(true);
  try{return await fn(controller.signal);}
  catch(error){const message=controller.signal.aborted?(kind==='login'?'Microsoft 로그인을 취소했습니다.':'작업을 취소했습니다. 다운로드된 정상 파일은 다음 시도에 재사용합니다.'):redact(error instanceof Error?error.message:String(error));state.error=message;log('error',message);throw new Error(message);}
  finally{try{if(kind!=='login')await syncInstallation();}finally{operation=null;state.operation=null;publish(true);}}
}
function progress(stage:string,message:string,amount:number,bytes?:{downloaded:number;total:number;speed:number}) {
  if(!state.operation)return;
  Object.assign(state.operation,{stage,message,progress:Math.max(0,Math.min(100,amount)),...(bytes?{downloadedBytes:bytes.downloaded,totalBytes:bytes.total,speedBytesPerSecond:bytes.speed}:{})});publish();
}
async function install() {
  return runOperation('install',async signal=>{
    await refreshSession(signal);
    const root=state.settings.gameDirectory;
    await assertNoLinks(root,root);
    const apiKey=await vault.get<string>('curseforge');
    if(!apiKey)throw new Error('모드팩 다운로드에 필요한 개발자 본인의 CurseForge API 키를 설정하세요. 배포용 권한 확인이 필요합니다.');
    const archivePath=await ensurePackArchive({pack,archivePath:state.settings.packArchivePath||undefined,gameDirectory:root,apiKey,signal,onProgress:(stage,message,amount,bytes)=>progress(stage,message,amount*.05,bytes)});
    state.installation={status:'installing'};publish(true);
    const runtime=await installMinecraft({gameDirectory:root,minecraftVersion:pack.minecraftVersion,loaderVersion:pack.loader.version,signal,onProgress:(stage,message,amount,bytes)=>{const range=stage==='Minecraft 다운로드'?[5,10]:stage==='게임 리소스 다운로드'?[15,15]:stage==='Java 21 준비'?[30,8]:stage==='NeoForge 설치'?[38,7]:[45,0];progress(stage,message,range[0]+amount*range[1],bytes);}});
    const installed=await installModpack({pack,archivePath,gameDirectory:root,apiKey,signal,onProgress:(stage,message,amount,bytes)=>{const range=stage==='pack-download'?[50,42]:stage==='pack-overrides'?[92,3]:stage==='pack-apply'?[95,5]:stage==='pack-complete'?[100,0]:[45,5];progress(stage,message,range[0]+amount*.01*range[1],bytes);}});
    await writeJsonAtomic(installMarker(),{...runtime,packVersion:installed.version,installedAt:new Date().toISOString()});
    const updateMarker=path.join(root,'.cobble','update-installed.json');
    if(!await readJson(updateMarker,null))await writeJsonAtomic(updateMarker,{version:installed.version,sequence:0,files:installed.managedFiles.filter(file=>/^(mods|config|defaultconfigs|kubejs|resourcepacks|shaderpacks)\//.test(file.path))});
    log('info','Minecraft와 모드팩 설치·파일 검증을 완료했습니다.');
  });
}
async function readRemoteFeed():Promise<Feed|null> {
  if(!state.settings.updateUrl||!state.settings.updatePublicKey){state.update={status:'unconfigured',message:'운영자의 서명된 업데이트 채널을 연결하세요.'};publish(true);return null;}
  const url=new URL(state.settings.updateUrl);
  const revision=configurationRevision,publicKey=state.settings.updatePublicKey;
  const response=await fetchSecure(url.href,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`업데이트 채널 요청 실패 (HTTP ${response.status})`);
  const body=await response.text();if(body.length>5*1024*1024)throw new Error('업데이트 문서 용량이 너무 큽니다.');
  if(revision!==configurationRevision)return null;
  const result=verifyFeed(JSON.parse(body),publicKey,{packId:pack.id,minecraftVersion:pack.minecraftVersion,loaderVersion:pack.loader.version});
  const installed=await readJson<{sequence?:number;version?:string;feedDigest?:string}>(path.join(state.settings.gameDirectory,'.cobble','update-installed.json'),{});
  if(revision!==configurationRevision)return null;
  if(result.sequence<(installed.sequence??0))throw new Error('이전 버전의 공지/업데이트 문서를 거부했습니다.');
  if(result.sequence===installed.sequence&&installed.feedDigest!==getFeedDigest(result))throw new Error('같은 배포 순서에 다른 내용을 넣은 업데이트를 거부했습니다.');
  feed=result;state.announcements=result.announcements;state.patchNotes=result.patchNotes;
  const current=installed.sequence===result.sequence&&installed.version===result.version;
  state.update={status:current?'current':'available',version:result.version,message:current?'최신 버전입니다.':'새 패치가 준비되었습니다.'};publish(true);return result;
}
async function checkUpdates(apply=true,repair=false):Promise<void> {
  try {
    const revision=configurationRevision,gameDirectory=state.settings.gameDirectory;
    const result=await readRemoteFeed();if(!result)return;
    if(revision!==configurationRevision)return;
    if(state.game.running){state.update={status:'pending',version:result.version,message:'새 공지를 반영했습니다. 게임 종료 후 패치를 적용합니다.'};publish(true);return;}
    if(!apply||operation||state.installation.status!=='installed'||(!repair&&state.update.status==='current'))return;
    await runOperation('update',async signal=>{
      if(revision!==configurationRevision)throw new Error('업데이트 설정이 변경되었습니다. 다시 확인하세요.');
      const patched=await applyUpdate(gameDirectory,result,{signal,repair,apiKey:await vault.get<string>('curseforge')??undefined,onProgress:(message,amount,bytes)=>progress('업데이트',message,amount*100,bytes)});
      state.update={status:'current',version:result.version,message:patched.preserved.length?`개인 변경 파일 ${patched.preserved.length}개를 보존했습니다.`:'최신 버전입니다.'};log('info',`패치 ${result.version}: 변경 ${patched.changed}개, 개인 파일 보존 ${patched.preserved.length}개`);
    });
  }catch(error){state.update={status:'error',message:redact(error instanceof Error?error.message:String(error))};publish(true);throw error;}
}
async function validateInstalled() {
  const manifest=await readJson<{files:Array<{path:string;sha256:string}>}|null>(path.join(state.settings.gameDirectory,'.cobble','update-installed.json'),null);
  if(!manifest||!Array.isArray(manifest.files))throw new Error('게임 파일 검사 기록이 없습니다. 설치/복구를 진행하세요.');
  let index=0;
  for(const file of manifest.files){const target=safePath(state.settings.gameDirectory,file.path);await assertNoLinks(state.settings.gameDirectory,target);
    // Overrides are seeded personal settings; executable mods must match their verified installation.
    if(file.path.startsWith('mods/')&&!await checkFile(target,'sha256',file.sha256))throw new Error(`모드 무결성 검사 실패: ${file.path}. 파일 복구를 실행하세요.`);
    progress('게임 파일 검사',`${++index}/${manifest.files.length} 파일`,index/manifest.files.length*100);
  }
}
async function launch() {
  if(state.game.running)throw new Error('게임이 이미 실행 중입니다.');
  if(state.installation.status!=='installed')throw new Error('게임을 먼저 설치하세요.');
  if(!session)throw new Error('Microsoft 정품 계정으로 로그인하세요.');
  await checkUpdates();
  return runOperation('launch',async signal=>{
    progress('계정 확인','Minecraft 사용 권한과 프로필을 확인하고 있습니다.',0);
    await refreshSession(signal);
    state.profile=session!.profile;state.auth={status:'signed-in'};
    await validateInstalled();signal.throwIfAborted();
    const installed=await readJson<Installation|null>(installMarker(),null);if(!installed)throw new Error('게임 설치 정보가 없습니다.');
    const version=await Version.parse(state.settings.gameDirectory,installed.versionId);
    const child=await launchGame({javaPath:installed.javaPath,gamePath:state.settings.gameDirectory,version,gameProfile:session!.profile,accessToken:session!.accessToken,launcherName:'CobbleLauncher',launcherBrand:'CobbleLauncher',minMemory:1024,maxMemory:state.settings.memoryMb,features:{authentication:{clientid:state.settings.microsoftClientId,auth_xuid:''}},extraExecOption:{windowsHide:true,shell:false},...(state.settings.serverHost?{quickPlayMultiplayer:`${state.settings.serverHost}:${state.settings.serverPort}`}:{})});
    state.game={running:true,pid:child.pid};log('info',`게임 프로세스 시작 (PID ${child.pid})`);publish(true);
    child.stdout?.on('data',chunk=>log('game',chunk.toString()));child.stderr?.on('data',chunk=>log('game',chunk.toString()));
    child.once('error',error=>{state.game={running:false};state.error=redact(error.message);log('error',error.message);publish(true);});
    child.once('close',code=>{state.game={running:false};log(code===0?'info':'error',`게임 종료 (코드 ${code})`);window?.show();publish(true);checkUpdates().catch(error=>log('warn',String(error)));});
    if(state.settings.closeOnLaunch)window?.hide();
  });
}
async function refreshSession(signal:AbortSignal):Promise<void> {
  if(!session||sessionClientId!==state.settings.microsoftClientId)throw new Error('Microsoft 정품 계정으로 로그인하세요.');
  const identity=session;const clientId=state.settings.microsoftClientId;
  const next=await refresh(clientId,identity.refreshToken,{signal,onDiagnostic:authDiagnostic});
  if(session!==identity||clientId!==state.settings.microsoftClientId)throw new Error('계정이 변경되었습니다. 다시 로그인하세요.');
  session=next;sessionClientId=clientId;state.profile=next.profile;state.auth={status:'signed-in'};
  await vault.set('session',{session:next,clientId});publish(true);
}
function authDiagnostic(result:AuthDiagnostic) {
  log('info',`인증 응답: ${result.stage} · HTTP ${result.status} · ${result.format}`);
}
const settingsSchema=z.object({gameDirectory:z.string().min(3).max(500).optional(),packArchivePath:z.string().max(1000).optional(),memoryMb:z.number().int().min(2048).max(65536).optional(),microsoftClientId:z.union([z.literal(''),z.string().uuid()]).optional(),curseforgeApiKey:z.string().max(1000).optional(),updateUrl:z.union([z.literal(''),z.url().refine(v=>new URL(v).protocol==='https:')]).optional(),updatePublicKey:z.string().max(4000).optional(),serverHost:z.string().max(253).regex(/^[a-zA-Z0-9.\-:]*$/).optional(),serverPort:z.number().int().min(1).max(65535).optional(),closeOnLaunch:z.boolean().optional()}).strict();
const externalHosts=new Set(['login.microsoftonline.com','www.curseforge.com','console.curseforge.com','learn.microsoft.com','aka.ms','help.minecraft.net','www.minecraft.net']);
function handle(name:string,fn:(...args:any[])=>unknown) {
  ipcMain.handle('launcher:'+name,async(event,...args)=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('신뢰하지 않는 요청입니다.');
    try{return await fn(...args);}catch(error){const message=redact(error instanceof Error?error.message:String(error));state.error=message;publish(true);throw new Error(message);}
  });
}
async function initialize() {
  rootDirectory=app.getAppPath();logsDirectory=path.join(app.getPath('userData'),'logs');settingsFile=path.join(app.getPath('userData'),'settings.json');
  await fs.mkdir(logsDirectory,{recursive:true});vault=new Vault(path.join(app.getPath('userData'),'credentials'));
  pack=JSON.parse(await fs.readFile(path.join(rootDirectory,'resources','pack.json'),'utf8'));
  const deployment=JSON.parse(await fs.readFile(path.join(rootDirectory,'resources','deployment.json'),'utf8'));
  const content=JSON.parse(await fs.readFile(path.join(rootDirectory,'resources','default-content.json'),'utf8'));
  const defaults:Settings={gameDirectory:path.join(app.getPath('userData'),'instances',pack.id),memoryMb:Math.min(deployment.memoryMb,Math.max(2048,Math.floor(os.totalmem()/1048576)-2048)),microsoftClientId:deployment.microsoftClientId,curseforgeApiKeyConfigured:false,updateUrl:deployment.updateUrl,updatePublicKey:deployment.updatePublicKey,serverHost:deployment.serverHost,serverPort:deployment.serverPort,closeOnLaunch:false,packArchivePath:app.isPackaged?'':path.resolve(rootDirectory,'../modpack',pack.sourceArchive.fileName)};
  const saved=await readJson<Partial<Settings>>(settingsFile,{});const {curseforgeApiKeyConfigured:_configured,...editableSaved}=saved;
  const preferences=settingsSchema.parse(editableSaved);const {curseforgeApiKey:_discarded,...savedPreferences}=preferences;
  const settings={...defaults,...savedPreferences};
  if(!path.isAbsolute(settings.gameDirectory)||path.parse(settings.gameDirectory).root===path.resolve(settings.gameDirectory))throw new Error('저장된 게임 설치 경로가 올바르지 않습니다.');
  await assertNoLinks(settings.gameDirectory,settings.gameDirectory);
  if(deployment.updatePublicKey){settings.updatePublicKey=deployment.updatePublicKey;settings.updateUrl=deployment.updateUrl;}
  try{settings.curseforgeApiKeyConfigured=!!await vault.get('curseforge');const stored=await vault.get<{session:Session;clientId:string}>('session');if(stored&&stored.clientId===settings.microsoftClientId){session=stored.session;sessionClientId=stored.clientId;}}catch{}
  state={pack:{id:pack.id,name:'Immersive Cobblemon',version:pack.version,minecraftVersion:pack.minecraftVersion,loader:`NeoForge ${pack.loader.version}`},settings,profile:session?.profile??null,auth:{status:session?'signed-in':'signed-out'},installation:{status:'not-installed'},operation:null,game:{running:false},update:{status:'unconfigured'},server:{status:'unconfigured'},...content,system:{totalMemoryMb:Math.round(os.totalmem()/1048576),freeMemoryMb:Math.round(os.freemem()/1048576),platform:process.platform},logs:[],appVersion:app.getVersion()};
  if(await recoverUpdate(settings.gameDirectory))log('info','중단된 업데이트를 안전하게 복구했습니다.');await syncInstallation();
  if(await recoverModpack(settings.gameDirectory))log('info','중단된 모드팩 설치를 안전하게 복구했습니다.');
  handle('getState',()=>structuredClone(state));handle('install',install);handle('launch',launch);handle('checkUpdates',()=>checkUpdates());
  handle('repair',async()=>{const current=await readJson<{version?:string;sequence?:number}>(path.join(state.settings.gameDirectory,'.cobble','update-installed.json'),{});if((current.sequence??0)>0){await runOperation('repair-runtime',async signal=>{await installMinecraft({gameDirectory:state.settings.gameDirectory,minecraftVersion:pack.minecraftVersion,loaderVersion:pack.loader.version,signal,onProgress:(stage,message,amount,bytes)=>progress(stage,message,amount*100,bytes)});});await checkUpdates(true,true);await runOperation('repair',async()=>{await validateInstalled();log('info','현재 서명된 패치 파일을 검사했습니다.');});}else await install();});
  handle('login',()=>runOperation('login',async signal=>{
    state.auth={status:'signing-in'};publish(true);
    let loginWindow:LoginWindow|undefined;
    let loginProblem:string|undefined;
    try{
      session=await authenticate(state.settings.microsoftClientId,{
        openExternal:url=>{
          loginWindow=openLoginWindow(url,{
            parent:window!,show:!isUITest,
            onClose:()=>{if(!signal.aborted)operation?.abort();},
            onProblem:message=>{if(pendingLoginUrl&&!signal.aborted){loginProblem=message;state.auth={status:'signing-in',message};publish(true);}},
          });
          return loginWindow.ready;
        },signal,onDiagnostic:authDiagnostic,
        onAuthorizationUrl:url=>{pendingLoginUrl=url;},
        onProgress:stage=>{
          const message=stage==='opening'?'Microsoft 로그인 팝업을 열고 있습니다.':stage==='waiting'?(loginProblem??'별도 팝업에서 Microsoft 로그인을 완료해 주세요.'):'Minecraft 사용 권한과 프로필을 확인하고 있습니다.';
          if(stage==='verifying'){pendingLoginUrl=null;loginWindow?.close();}
          state.auth={status:'signing-in',message};
          progress(stage==='verifying'?'계정 확인':'Microsoft 로그인',message,0);publish(true);
        }
      });
      sessionClientId=state.settings.microsoftClientId;await vault.set('session',{session,clientId:sessionClientId});state.profile=session.profile;state.auth={status:'signed-in'};log('info',`${session.profile.name} 정품 프로필 확인 완료`);
    }catch(error){state.auth={status:'error',message:redact(error instanceof Error?error.message:String(error))};throw error;}
    finally{pendingLoginUrl=null;loginWindow?.close();}
  }));
  handle('copyLoginLink',()=>{
    if(!pendingLoginUrl||state.operation?.kind!=='login')throw new Error('진행 중인 Microsoft 로그인이 없습니다. 다시 로그인을 시작하세요.');
    clipboard.writeText(pendingLoginUrl);
  });
  handle('logout',async()=>{if(operation||state.game.running)throw new Error('게임과 진행 중인 작업을 종료한 뒤 계정을 전환하세요.');session=null;sessionClientId='';state.profile=null;state.auth={status:'signed-out'};await vault.delete('session');publish(true);});
  handle('cancelOperation',()=>{operation?.abort();});
  handle('saveSettings',async value=>{
    if(operation||state.game.running)throw new Error('게임과 파일 작업을 종료한 뒤 설정을 변경하세요.');
    const changes=settingsSchema.parse(value);const {curseforgeApiKey,...preferences}=changes;
    if(preferences.gameDirectory){if(!path.isAbsolute(preferences.gameDirectory)||path.parse(preferences.gameDirectory).root===path.resolve(preferences.gameDirectory))throw new Error('게임 전용 하위 폴더를 선택하세요.');await assertNoLinks(preferences.gameDirectory,preferences.gameDirectory);}
    if(preferences.memoryMb&&preferences.memoryMb>state.system.totalMemoryMb-1024)throw new Error('운영체제에 최소 1 GB 메모리를 남겨 주세요.');
    if(deployment.updatePublicKey && (preferences.updatePublicKey!==undefined||preferences.updateUrl!==undefined)){if(preferences.updatePublicKey!==undefined&&preferences.updatePublicKey!==deployment.updatePublicKey)throw new Error('운영자가 고정한 업데이트 서명 키는 변경할 수 없습니다.');if(preferences.updateUrl!==undefined&&preferences.updateUrl!==deployment.updateUrl)throw new Error('운영자가 고정한 업데이트 채널은 변경할 수 없습니다.');}
    if(curseforgeApiKey!==undefined){if(curseforgeApiKey.trim())await vault.set('curseforge',curseforgeApiKey.trim());else await vault.delete('curseforge');}
    if(preferences.microsoftClientId!==undefined&&preferences.microsoftClientId!==state.settings.microsoftClientId){session=null;state.profile=null;state.auth={status:'signed-out'};await vault.delete('session');}
    state.settings={...state.settings,...preferences,curseforgeApiKeyConfigured:!!await vault.get('curseforge')};configurationRevision++;await writeJsonAtomic(settingsFile,state.settings);await syncInstallation();feed=null;publish(true);refreshServer();
  });
  handle('chooseDirectory',async()=>{const result=await dialog.showOpenDialog(window!,{title:'게임 전용 설치 폴더 선택',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];});
  handle('choosePackArchive',async()=>{const result=await dialog.showOpenDialog(window!,{title:'공식 Immersive Cobblemon 6.2.0 ZIP 선택',properties:['openFile'],filters:[{name:'CurseForge 모드팩',extensions:['zip']}]});return result.canceled?null:result.filePaths[0];});
  handle('openFolder',async kind=>{if(kind!=='game'&&kind!=='logs')throw new Error('폴더 종류가 올바르지 않습니다.');const dir=kind==='game'?state.settings.gameDirectory:logsDirectory;await fs.mkdir(dir,{recursive:true});const error=await shell.openPath(dir);if(error)throw new Error(error);});
  handle('openExternal',async value=>{const url=new URL(z.string().max(2000).parse(value));if(url.protocol!=='https:'||!externalHosts.has(url.hostname)||url.username||url.password)throw new Error('허용되지 않은 외부 주소입니다.');await shell.openExternal(url.href);});
  handle('minimize',()=>window?.minimize());handle('maximize',()=>window?.isMaximized()?window.unmaximize():window?.maximize());handle('close',()=>window?.close());
  window=new BrowserWindow({width:1260,height:820,minWidth:980,minHeight:680,title:'Cobble Launcher',backgroundColor:'#edf7ff',show:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#edf7ff',symbolColor:'#294b70',height:42},webPreferences:{preload:path.join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.webContents.on('render-process-gone',(_event,details)=>log('error',`화면 프로세스 종료: ${details.reason}`));
  window.once('ready-to-show',()=>{if(!isSmoke&&!isUITest)window?.show();});
  window.on('close',event=>{if(operation||state.game.running){event.preventDefault();if(state.game.running){window?.hide();return;}dialog.showMessageBox(window!,{type:'question',buttons:['작업 계속','취소하고 종료'],defaultId:0,cancelId:0,message:'작업이 진행 중입니다.',detail:'종료하면 진행 중인 파일 작업을 취소합니다.'}).then(result=>{if(result.response===1){operation?.abort();const timer=setInterval(()=>{if(!operation){clearInterval(timer);app.quit();}},100);}});}});
  window.on('closed',()=>{window=null;});
  window.webContents.on('console-message',details=>{if(details.level==='error')log('renderer',details.message);});
  await window.loadFile(path.join(rootDirectory,'dist','index.html'));
  log('info','Cobble Launcher 시작');
  if(isSmoke){setTimeout(async()=>{try{const ui=await window!.webContents.executeJavaScript("({title:document.title,text:document.body.innerText,hasBridge:!!window.launcher,width:window.innerWidth,height:window.innerHeight})");const screenshot=await window!.webContents.capturePage();await fs.mkdir(qaOutput,{recursive:true});await fs.writeFile(path.join(qaOutput,'launcher.png'),screenshot.toPNG());await writeJsonAtomic(path.join(qaOutput,'smoke.json'),{ui,state,errors:state.logs.filter(l=>['error','renderer'].includes(l.level))});app.quit();}catch(error){console.error(error);app.exit(1);}},1500);}
  else if(!isUITest) {refreshServer();checkUpdates(false).catch(error=>log('warn',String(error)));setInterval(()=>{refreshServer();if(!operation)checkUpdates(!state.game.running).catch(error=>log('warn',String(error)));},90000).unref();}
}
async function refreshServer(){if(!state)return;state.server=state.settings.serverHost?{status:'checking'}:{status:'unconfigured'};publish();state.server=await pingServer(state.settings.serverHost,state.settings.serverPort);publish(true);}
if(!app.requestSingleInstanceLock())app.quit();else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(initialize).catch(error=>{console.error(error);dialog.showErrorBox('런처 시작 실패',String(error));app.exit(1);});
  app.on('window-all-closed',()=>{if(!state?.game.running)app.quit();});
}
