import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class Vault {
  constructor(private directory: string) {}
  private file(name: 'session'|'curseforge') { return path.join(this.directory, name + '.encrypted'); }
  async get<T>(name: 'session'|'curseforge'): Promise<T|null> {
    let buffer: Buffer;
    try { buffer = await fs.readFile(this.file(name)); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e; }
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 자격 증명 암호화를 사용할 수 없습니다.');
    return JSON.parse(safeStorage.decryptString(buffer)) as T;
  }
  async set(name:'session'|'curseforge', value:unknown):Promise<void> {
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 자격 증명 암호화를 사용할 수 없습니다.');
    await fs.mkdir(this.directory,{recursive:true});
    const target=this.file(name),temporary=target+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,safeStorage.encryptString(JSON.stringify(value)),{flag:'wx'});
    await fs.rename(temporary,target);
  }
  async delete(name:'session'|'curseforge') { await fs.rm(this.file(name),{force:true}); }
}
