// @xmcl/unzip 2.2.0 published workspace metadata rather than publishConfig.
// Fix the entry points only; executable code stays the pinned upstream build.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../node_modules/@xmcl/unzip/package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (pkg.version !== '2.2.0') throw new Error('Review XMCL workaround for a new version.');
if (!fs.existsSync(path.join(path.dirname(file), 'dist/index.js'))) throw new Error('XMCL published build missing.');
pkg.main = './dist/index.js'; pkg.module = './dist/index.mjs'; pkg.types = './dist/index.d.ts';
fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
const coreRoot = path.join(__dirname, '../node_modules/@xmcl/core');
const corePkg = JSON.parse(fs.readFileSync(path.join(coreRoot,'package.json'), 'utf8'));
if (corePkg.version !== '2.16.2') throw new Error('Review XMCL core subpath workaround.');
const map = JSON.parse(fs.readFileSync(path.join(coreRoot,'dist/index.js.map'), 'utf8'));
const source = map.sourcesContent[map.sources.findIndex(s => s.endsWith('/utils.ts'))];
const implementation = /export function isNotNull[^]*?\n\}/.exec(source)?.[0];
if (!implementation) throw new Error('Pinned upstream isNotNull source missing.');
// Rebuild the omitted utils subpath from the exact upstream source map, retaining MIT code.
const esbuild = require('esbuild');
fs.writeFileSync(path.join(coreRoot,'utils.js'), esbuild.transformSync(implementation, {loader:'ts',format:'cjs',target:'node20'}).code);
fs.writeFileSync(path.join(coreRoot,'utils.d.ts'), "export { isNotNull } from './dist/utils';\n");
