const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const pieces=['Cobble Launcher third-party notices\nGenerated from the pinned production dependency lockfile.\nThe modpack, shaders and third-party game files are not bundled with the launcher.\n'];
for(const [relative,entry]of Object.entries(lock.packages)) {
  if(!relative||entry.dev||!relative.includes('node_modules'))continue;
  const folder=path.join(root,relative);
  if(!fs.existsSync(path.join(folder,'package.json')))continue;
  const pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
  pieces.push('\n'+pkg.name+' '+pkg.version+'\nLicense: '+(pkg.license||'See upstream package')+'\nSource: '+(typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url||pkg.homepage||'npm registry')+'\n');
  for(const name of fs.readdirSync(folder))if(/^(license|licence|copying|notice)([.\-_]|$)/i.test(name)&&fs.statSync(path.join(folder,name)).isFile())pieces.push(fs.readFileSync(path.join(folder,name),'utf8')+'\n');
  if(pkg.name==='@xmcl/unzip')pieces.push(fs.readFileSync(path.join(root,'node_modules/@xmcl/core/LICENSE'),'utf8')+'\n');
}
pieces.push('\nElectron binary third-party licenses are included in the packaged application directory (LICENSE.electron.txt and LICENSES.chromium.html).\n');
fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),pieces.join(''));
console.log('Production dependency notices generated.');
