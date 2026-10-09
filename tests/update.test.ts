import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { applyUpdate, recoverUpdate, verifyFeed, type Feed, type PatchFile } from '../src/main/update';

// Ephemeral in-memory signing material only. No private key is exported or written to disk.
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({format:'pem',type:'spki'}).toString();
const expected = {packId:'test-pack',minecraftVersion:'1.21.1',loaderVersion:'21.1.252'};
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
const file = (relative:string,body:string,policy:'managed'|'seed'='managed'):PatchFile => ({path:relative,url:`https://updates.example.com/${relative}`,sha256:digest(body),size:Buffer.byteLength(body),policy});
function rawFeed(sequence:number,files:PatchFile[]=[],removedPaths:string[]=[]):Feed {
  return {schemaVersion:1,...expected,version:`test-${sequence}`,sequence,files,removedPaths,announcements:[],patchNotes:[]};
}
function envelope(feed:Feed) {
  const payload=Buffer.from(JSON.stringify(feed));
  return {payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')};
}
const verified = (feed:Feed) => verifyFeed(envelope(feed),publicKey,expected);
async function root(t:TestContext):Promise<string> {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cobble-update-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('cobble-update-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  });
  return directory;
}
async function write(root:string,relative:string,body:string):Promise<void> {
  const destination=path.join(root,...relative.split('/'));
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,body);
}
const read = (root:string,relative:string) => fs.readFile(path.join(root,...relative.split('/')),'utf8');
async function present(root:string,relative:string):Promise<boolean> {
  try {await fs.stat(path.join(root,...relative.split('/')));return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
function network(t:TestContext,bodies:Record<string,string>,hook?:(url:string)=>Promise<void>):string[] {
  const original=globalThis.fetch,calls:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);assert.equal(new URL(url).protocol,'https:');calls.push(url);await hook?.(url);
    assert.equal(new Headers(init?.headers).has('x-api-key'),false,'operator API key must not leak to an update host');
    const body=bodies[new URL(url).pathname.slice(1)];
    if(body===undefined)return new Response('missing',{status:404});
    return new Response(body,{headers:{'Content-Length':String(Buffer.byteLength(body))}});
  }) as typeof fetch;
  t.after(()=>{globalThis.fetch=original;});return calls;
}

test('valid Ed25519 feed is frozen; payload tampering and malformed signatures are rejected',()=>{
  const signed=envelope(rawFeed(1,[file('mods/a.jar','a')]));
  const feed=verifyFeed(signed,publicKey,expected);
  assert.ok(Object.isFrozen(feed));assert.ok(Object.isFrozen(feed.files));assert.ok(Object.isFrozen(feed.files[0]));
  const changed={...signed,payload:Buffer.from(JSON.stringify(rawFeed(2,[file('mods/a.jar','a')]))).toString('base64')};
  assert.throws(()=>verifyFeed(changed,publicKey,expected),/서명/);
  for(const signature of [signed.signature+'!',signed.signature.slice(0,-1),Buffer.alloc(32).toString('base64'),'====']) {
    assert.throws(()=>verifyFeed({...signed,signature},publicKey,expected));
  }
  assert.throws(()=>verifyFeed(signed,publicKey,{...expected,loaderVersion:'21.1.1'}));
});

test('signed traversal, worlds, directory roots, case aliases and ancestor collisions fail before installation',()=>{
  for(const relative of ['../mods/a.jar','mods/../../worlds/a','worlds/save/level.dat','saves/world/level.dat','options.txt','mods','mods\\a.jar','config/CON.txt']) {
    assert.throws(()=>verified(rawFeed(1,[file(relative,'bad')])));
    assert.throws(()=>verified(rawFeed(1,[],[relative])));
  }
  assert.throws(()=>verified(rawFeed(1,[file('mods/A.jar','a'),file('mods/a.jar','b')])));
  assert.throws(()=>verified(rawFeed(1,[file('config/a','a'),file('config/a/x.json','b')])));
  assert.throws(()=>verified(rawFeed(1,[file('config/a/x.json','b')],['config/a'])));
  assert.throws(()=>verified(rawFeed(1,[],['mods/a.jar','mods/a.jar'])));
});

test('unverified objects cannot apply; changed-only updates reuse matching local files and preserve worlds',async t=>{
  const directory=await root(t),calls=network(t,{'mods/a.jar':'a','mods/b.jar':'b'});
  await write(directory,'saves/world/level.dat','world');
  await assert.rejects(applyUpdate(directory,rawFeed(1)),/서명/);
  await applyUpdate(directory,verified(rawFeed(1,[file('mods/a.jar','a')])),{apiKey:'secret'});
  calls.length=0;
  assert.deepEqual(await applyUpdate(directory,verified(rawFeed(2,[file('mods/a.jar','a'),file('mods/b.jar','b')]))),{changed:1,preserved:[]});
  assert.deepEqual(calls,['https://updates.example.com/mods/b.jar']);
  assert.equal(await read(directory,'saves/world/level.dat'),'world');
  assert.equal(await read(directory,'mods/a.jar'),'a');assert.equal(await read(directory,'mods/b.jar'),'b');
});

test('sequence replay is rejected; repair allows only the identical installed signed payload',async t=>{
  const directory=await root(t),calls=network(t,{'mods/a.jar':'a'}),source=rawFeed(1,[file('mods/a.jar','a')]);
  await applyUpdate(directory,verified(source));
  await assert.rejects(applyUpdate(directory,verified(source)),/이미/);
  await write(directory,'mods/a.jar','corrupt');calls.length=0;
  assert.equal((await applyUpdate(directory,verified(source),{repair:true})).changed,1);
  assert.equal(await read(directory,'mods/a.jar'),'a');assert.equal(calls.length,1);
  await assert.rejects(applyUpdate(directory,verified({...source,version:'different'}),{repair:true}),/이미/);
  await applyUpdate(directory,verified(rawFeed(2,[file('mods/a.jar','a')])));
  await assert.rejects(applyUpdate(directory,verified(source),{repair:true}),/이미/);
});

test('edited config and existing seed files survive while unchanged managed config can update',async t=>{
  const directory=await root(t);
  network(t,{'config/user.json':'original','config/default.json':'original','config/seed.json':'default'});
  await applyUpdate(directory,verified(rawFeed(1,[file('config/user.json','original'),file('config/default.json','original')])));
  await write(directory,'config/user.json','personal');await write(directory,'config/seed.json','seed-personal');
  globalThis.fetch=(async()=>new Response('new',{headers:{'Content-Length':'3'}})) as typeof fetch;
  const result=await applyUpdate(directory,verified(rawFeed(2,[file('config/user.json','new'),file('config/default.json','new'),file('config/seed.json','new','seed')])));
  assert.deepEqual(result,{changed:1,preserved:['config/user.json','config/seed.json']});
  assert.equal(await read(directory,'config/user.json'),'personal');assert.equal(await read(directory,'config/default.json'),'new');assert.equal(await read(directory,'config/seed.json'),'seed-personal');
});

test('deletions affect only unchanged managed files, including the initial pack baseline',async t=>{
  const directory=await root(t);network(t,{});
  await write(directory,'mods/managed.jar','managed');await write(directory,'mods/user.jar','personal');await write(directory,'config/edited.json','user-edited');
  await write(directory,'.cobble/managed-pack.json',JSON.stringify({version:'initial',managedFiles:[{path:'mods/managed.jar',sha256:digest('managed')},{path:'config/edited.json',sha256:digest('original')},{path:'journeymap/user.json',sha256:digest('map')}]}));
  const result=await applyUpdate(directory,verified(rawFeed(1,[],['mods/managed.jar','mods/user.jar','config/edited.json'])));
  assert.deepEqual(result,{changed:1,preserved:['mods/user.jar','config/edited.json']});
  assert.equal(await present(directory,'mods/managed.jar'),false);assert.equal(await read(directory,'mods/user.jar'),'personal');assert.equal(await read(directory,'config/edited.json'),'user-edited');
});

test('hash-tampered download never changes current files or the installed sequence',async t=>{
  const directory=await root(t);network(t,{'mods/a.jar':'wrong'});await write(directory,'mods/a.jar','old');
  await assert.rejects(applyUpdate(directory,verified(rawFeed(1,[file('mods/a.jar','right')]))),/해시/);
  assert.equal(await read(directory,'mods/a.jar'),'old');assert.equal(await present(directory,'.cobble/update-installed.json'),false);
});

test('mid-apply failure restores originals and does not delete an unprocessed concurrently created file',async t=>{
  const directory=await root(t);network(t,{'mods/a.jar':'new','mods/b.jar':'planned'});await write(directory,'mods/a.jar','old');
  const feed=verified(rawFeed(1,[file('mods/a.jar','new'),file('mods/b.jar','planned')]));
  // The callback executes synchronously; this simulates an unrelated writer after the first step.
  const {writeFileSync}=await import('node:fs');
  await assert.rejects(applyUpdate(directory,feed,{failAfterStep:1,onProgress(message){if(message==='패치 적용 mods/a.jar')writeFileSync(path.join(directory,'mods/b.jar'),'concurrent-user');}}),/Simulated/);
  assert.equal(await read(directory,'mods/a.jar'),'old');assert.equal(await read(directory,'mods/b.jar'),'concurrent-user');
  assert.equal(await present(directory,'.cobble/update-installed.json'),false);assert.equal(await present(directory,'.cobble/update-journal.json'),false);
});

async function recoveryFixture(directory:string,status:'prepared'|'applied'='prepared') {
  const transaction=path.join(directory,'.cobble','transactions',randomUUID());
  const previous={version:'old',sequence:1,feedDigest:digest('old-feed'),files:[{path:'mods/a.jar',sha256:digest('old')}]};
  const next={version:'new',sequence:2,feedDigest:digest('new-feed'),files:[{path:'mods/a.jar',sha256:digest('new')},{path:'mods/b.jar',sha256:digest('planned')}]};
  const journal={schemaVersion:1,phase:'applying',directory:transaction,previous,next,steps:[
    {path:'mods/a.jar',hadOriginal:true,deletion:false,beforeSha256:digest('old'),afterSha256:digest('new'),status},
    {path:'mods/b.jar',hadOriginal:false,deletion:false,afterSha256:digest('planned'),status:'pending'},
  ]};
  await write(directory,'mods/a.jar','new');await write(directory,'mods/b.jar','concurrent-user');
  await write(directory,path.relative(directory,path.join(transaction,'backup/mods/a.jar')).replace(/\\/g,'/'),'old');
  await write(directory,'.cobble/update-installed.json',JSON.stringify(next));
  await write(directory,'.cobble/update-journal.json',JSON.stringify(journal));return journal;
}

test('restart recovery rolls back a crash between target replacement and applied journal persistence',async t=>{
  const directory=await root(t),journal=await recoveryFixture(directory);
  assert.equal(await recoverUpdate(directory),true);
  assert.equal(await read(directory,'mods/a.jar'),'old');assert.equal(await read(directory,'mods/b.jar'),'concurrent-user');
  assert.deepEqual(JSON.parse(await read(directory,'.cobble/update-installed.json')),journal.previous);
  assert.equal(await present(directory,'.cobble/update-journal.json'),false);assert.equal(await recoverUpdate(directory),false);
});

test('committed restart recovery retains new files and restores its durable marker',async t=>{
  const directory=await root(t),journal=await recoveryFixture(directory,'applied');
  journal.phase='committed';journal.steps[1].status='applied';await write(directory,'mods/b.jar','planned');
  await write(directory,'.cobble/update-journal.json',JSON.stringify(journal));await fs.rm(path.join(directory,'.cobble/update-installed.json'));
  assert.equal(await recoverUpdate(directory),true);assert.equal(await read(directory,'mods/a.jar'),'new');
  assert.deepEqual(JSON.parse(await read(directory,'.cobble/update-installed.json')),journal.next);
});

test('restart rollback restores a deleted original and removes only its prepared new file',async t=>{
  const directory=await root(t),transaction=path.join(directory,'.cobble','transactions',randomUUID());
  const previous={version:'old',sequence:1,feedDigest:digest('old-feed'),files:[{path:'mods/deleted.jar',sha256:digest('original')}]};
  const next={version:'new',sequence:2,feedDigest:digest('new-feed'),files:[{path:'mods/created.jar',sha256:digest('created')}]};
  await write(directory,path.relative(directory,path.join(transaction,'backup/mods/deleted.jar')).replace(/\\/g,'/'),'original');
  await write(directory,'mods/created.jar','created');await write(directory,'saves/world/level.dat','world');
  await write(directory,'.cobble/update-journal.json',JSON.stringify({schemaVersion:1,phase:'applying',directory:transaction,previous,next,steps:[
    {path:'mods/deleted.jar',hadOriginal:true,deletion:true,beforeSha256:digest('original'),status:'applied'},
    {path:'mods/created.jar',hadOriginal:false,deletion:false,afterSha256:digest('created'),status:'prepared'},
  ]}));
  await recoverUpdate(directory);
  assert.equal(await read(directory,'mods/deleted.jar'),'original');assert.equal(await present(directory,'mods/created.jar'),false);
  assert.equal(await read(directory,'saves/world/level.dat'),'world');
  assert.deepEqual(JSON.parse(await read(directory,'.cobble/update-installed.json')),previous);
});

test('restart recovery refuses to overwrite a file edited after the interrupted update',async t=>{
  const directory=await root(t);await recoveryFixture(directory);await write(directory,'mods/a.jar','user-after-crash');
  await assert.rejects(recoverUpdate(directory),/사용자가 변경/);
  assert.equal(await read(directory,'mods/a.jar'),'user-after-crash');assert.equal(await present(directory,'.cobble/update-journal.json'),true);
});

test('corrupt journals and damaged backups are retained without unsafe restoration',async t=>{
  const directory=await root(t),journal=await recoveryFixture(directory);
  for(const malformed of [{...journal,directory:path.dirname(directory)},{...journal,steps:null},{...journal,phase:'anything'},{...journal,steps:[{...journal.steps[0],path:'worlds/level.dat'}]},{...journal,steps:[journal.steps[1],{...journal.steps[0],status:'applied'}]}]) {
    await write(directory,'.cobble/update-journal.json',JSON.stringify(malformed));await assert.rejects(recoverUpdate(directory));assert.equal(await read(directory,'mods/a.jar'),'new');
  }
  await write(directory,'.cobble/update-journal.json',JSON.stringify(journal));await fs.writeFile(path.join(journal.directory,'backup/mods/a.jar'),'bad-backup');
  await assert.rejects(recoverUpdate(directory),/백업/);assert.equal(await read(directory,'mods/a.jar'),'new');assert.equal(await present(directory,'.cobble/update-journal.json'),true);
});

test('recovery rejects linked backup directories and preserves external contents',async t=>{
  const directory=await root(t),journal=await recoveryFixture(directory),external=path.join(directory,'external');
  await fs.mkdir(external);await fs.writeFile(path.join(external,'a.jar'),'old');
  await fs.rm(path.join(journal.directory,'backup/mods/a.jar'));await fs.rmdir(path.join(journal.directory,'backup/mods'));
  try{await fs.symlink(external,path.join(journal.directory,'backup/mods'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('OS link creation is unavailable');return;}throw error;}
  await assert.rejects(recoverUpdate(directory),/연결/);assert.equal(await read(directory,'mods/a.jar'),'new');assert.equal(await fs.readFile(path.join(external,'a.jar'),'utf8'),'old');
});

test('a second operation cannot race a download or recovery in the same game root',async t=>{
  const directory=await root(t);let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
  network(t,{'mods/a.jar':'a'},async()=>{started();await gate;});
  const first=applyUpdate(directory,verified(rawFeed(1,[file('mods/a.jar','a')])));await ready;
  await assert.rejects(applyUpdate(directory,verified(rawFeed(2))),/진행 중/);await assert.rejects(recoverUpdate(directory),/진행 중/);
  release();await first;
});
