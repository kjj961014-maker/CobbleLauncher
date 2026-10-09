import { installMinecraft } from '../src/main/minecraft';
import path from 'node:path';
import { writeJsonAtomic } from '../src/main/paths';
const root = path.resolve('private/test-instance');
let last = '';
let lastTime = 0;
const started = Date.now();
async function main() { try {
  const result = await installMinecraft({gameDirectory:root,minecraftVersion:'1.21.1',loaderVersion:'21.1.252',onProgress:(stage,message,progress)=>{
    if (stage !== last || Date.now()-lastTime>15000 || progress===1) { console.log(stage, message, Math.round(progress*100)+'%'); last=stage;lastTime=Date.now(); }
  }});
  await writeJsonAtomic(path.resolve('test-results/minecraft-install.json'), {success:true,root,...result,elapsedMs:Date.now()-started,date:new Date().toISOString()});
  console.log('INSTALLATION VERIFIED', result);
} catch(error) {
  await writeJsonAtomic(path.resolve('test-results/minecraft-install.json'), {success:false,root,error:String(error),elapsedMs:Date.now()-started,date:new Date().toISOString()});
  throw error;
} }
main().catch(error => { console.error(error); process.exitCode = 1; });
