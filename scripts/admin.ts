import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safePath, assertNoLinks, writeJsonAtomic } from '../src/main/paths';
import { hashFile } from '../src/main/download';
import { validateManagedPath, verifyFeed, type Feed } from '../src/main/update';

async function main() {
  const [command,...args]=process.argv.slice(2);
  if(command==='init-keys') {
    if(!args[0])throw new Error('사용법: npm run admin -- init-keys private/signing');
    const directory=path.resolve(args[0]);await fs.mkdir(directory,{recursive:true});
    const keys=generateKeyPairSync('ed25519');
    const privateFile=path.join(directory,'private.pem'),publicFile=path.join(directory,'public.pem');
    await fs.writeFile(privateFile,keys.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
    await fs.writeFile(publicFile,keys.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
    console.log('서명키를 생성했습니다. private.pem은 오프라인 보관하며 배포물에 포함하지 마세요.');return;
  }
  if(command==='sign') {
    const [draftPath,keyPath,contentPath,permissionsPath,outputPath]=args;
    if(!outputPath)throw new Error('사용법: npm run admin -- sign draft.json private.pem content permissions.json manifest.json');
    const draft=JSON.parse(await fs.readFile(draftPath,'utf8')) as Feed;
    const permissions=JSON.parse(await fs.readFile(permissionsPath,'utf8')) as Array<{path:string;redistributionAllowed:boolean;license:string;sourceUrl:string;reviewedBy:string}>;
    if(!Array.isArray(permissions))throw new Error('개별 배포 권한 확인 목록이 필요합니다.');
    const root=path.resolve(contentPath);
    for(const file of draft.files) {
      validateManagedPath(file.path);const target=safePath(root,file.path);await assertNoLinks(root,target);
      const permission=permissions.find(p=>p.path===file.path);
      if(!permission?.redistributionAllowed||!permission.license||!permission.reviewedBy||!permission.sourceUrl.startsWith('https:'))throw new Error(`재배포 권한 검토가 기록되지 않았습니다: ${file.path}`);
      file.sha256=await hashFile(target);file.size=(await fs.stat(target)).size;
    }
    const privateKey=createPrivateKey(await fs.readFile(keyPath));if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Ed25519 서명키가 필요합니다.');
    const payload=Buffer.from(JSON.stringify(draft),'utf8');
    const envelope={payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
    verifyFeed(envelope,createPublicKey(privateKey).export({type:'spki',format:'pem'}).toString(),{packId:draft.packId,minecraftVersion:draft.minecraftVersion,loaderVersion:draft.loaderVersion});
    await writeJsonAtomic(path.resolve(outputPath),envelope);console.log(`검증·서명 완료: ${path.resolve(outputPath)}`);return;
  }
  throw new Error('명령: init-keys, sign. docs/administrator.md의 배포 절차를 확인하세요.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
