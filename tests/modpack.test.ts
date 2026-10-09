import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { inspectPackArchive, validateArchiveEntries, validateArchivePath, isCurseForgeDownloadUrl,
  resolveCurseForgeFiles, installModpack, recoverModpack, ensurePackArchive, ModpackInstallError, type PackCatalog } from '../src/main/modpack';

const sha = (data: Buffer | string, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cobble-pack-test-'));
  const game = path.join(root, 'game'); await fs.mkdir(game);
  const records = [
    { projectID: 10, fileID: 100, required: true, isLocked: false },
    { projectID: 20, fileID: 200, required: true, isLocked: false },
    { projectID: 30, fileID: 300, required: true, isLocked: false }
  ];
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ manifestType: 'minecraftModpack', manifestVersion: 1,
    version: '1.0.0', overrides: 'overrides', minecraft: { version: '1.21.1', modLoaders: [{ id: 'neoforge-21.1.252', primary: true }] }, files: records })));
  zip.addFile('overrides/config/example.toml', Buffer.from('seed = true'));
  zip.addFile('overrides/kubejs/server_scripts/recipe.js', Buffer.from('ServerEvents.recipes(() => {})'));
  const data = zip.toBuffer(), archive = path.join(root, 'pack.zip'); await fs.writeFile(archive, data);
  const pack: PackCatalog = { id: 'fixture', name: 'Fixture', version: '1.0.0', minecraftVersion: '1.21.1', javaMajorVersion: 21,
    loader: { type: 'neoforge', version: '21.1.252', id: 'neoforge-21.1.252' },
    sourceArchive: { fileName: 'pack.zip', sha256: sha(data), size: data.length }, overrides: 'overrides', files: records };
  const binaries = new Map([
    ['https://edge.forgecdn.net/files/1/0/mod.jar', Buffer.from('fixture mod binary')],
    ['https://mediafilez.forgecdn.net/files/2/0/resource.zip', Buffer.from('fixture resource pack')],
    ['https://edge.forgecdn.net/files/3/0/shader.zip', Buffer.from('fixture shader pack')]
  ]);
  const mods = [{ id: 10, classId: 6, allowModDistribution: true }, { id: 20, classId: 12, allowModDistribution: true }, { id: 30, classId: 6552, allowModDistribution: true }];
  const files = [...binaries.entries()].map(([url, data], index) => ({ id: records[index].fileID, modId: records[index].projectID,
    fileName: path.posix.basename(url), isAvailable: true, fileLength: data.length, downloadUrl: url, hashes: [{ algo: 1, value: sha(data, 'sha1') }] }));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; key: string | null }> = [];
  function mockNetwork(blockProject?: number, corruptDownload = false) {
    globalThis.fetch = async (input, init) => {
      const url = String(input), headers = new Headers(init?.headers);
      requests.push({ url, key: headers.get('x-api-key') });
      assert.equal(headers.get('x-api-key'), 'fixture-key');
      if (url === 'https://api.curseforge.com/v1/mods') return Response.json({ data: mods.map(mod => mod.id === blockProject ? { ...mod, allowModDistribution: false } : mod) });
      if (url === 'https://api.curseforge.com/v1/mods/files') return Response.json({ data: files });
      const binary = binaries.get(url);
      if (binary) return new Response(corruptDownload ? Buffer.alloc(binary.length, 0) : binary, { status: 200, headers: { 'Content-Length': String(binary.length) } });
      throw new Error(`Unexpected network request: ${url}`);
    };
  }
  return { root, game, archive, pack, mods, files, binaries, requests, mockNetwork,
    cleanup: async () => { globalThis.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); } };
}

test('provided 6.2.0 archive matches catalog hash, loader and all 345 original file records', async () => {
  const catalog = JSON.parse(await fs.readFile(path.resolve('resources/pack.json'), 'utf8')) as PackCatalog;
  const actual = await inspectPackArchive(catalog, path.resolve('../modpack', catalog.sourceArchive.fileName));
  assert.equal(catalog.files.length, 345);
  assert.equal(catalog.loader.id, 'neoforge-21.1.252');
  assert.equal(actual.overrides.length, 3268);
  assert.equal(actual.zip.getEntries().length, 3270);
});

test('ZIP path validation rejects traversal, Windows device/ADS names and ambiguous paths', () => {
  for (const name of ['../outside', '/absolute', 'C:/outside', 'a\\outside', 'a/../outside', 'a//file', 'config/NUL.txt', 'config/COM1', 'config/file:stream', 'config/name.']) {
    assert.throws(() => validateArchivePath(name), undefined, name);
  }
  assert.equal(validateArchivePath('overrides/config/config.toml'), 'overrides/config/config.toml');
});

test('ZIP refuses symlinks, file/directory collisions, expanded size bombs and personal data overrides', () => {
  const symlink = new AdmZip(); symlink.addFile('overrides/config/link', Buffer.from('outside'));
  symlink.getEntry('overrides/config/link')!.header.attr = (0xa1ff << 16) >>> 0;
  assert.throws(() => validateArchiveEntries(symlink, 'overrides'), /링크/);
  const collision = new AdmZip(); collision.addFile('overrides/config', Buffer.from('file'));
  collision.addFile('overrides/config/name.toml', Buffer.from('other'));
  assert.throws(() => validateArchiveEntries(collision, 'overrides'), /충돌/);
  const bomb = new AdmZip(); bomb.addFile('overrides/config/bomb', Buffer.from('x'));
  bomb.getEntry('overrides/config/bomb')!.header.size = 64 * 1024 * 1024 + 1;
  assert.throws(() => validateArchiveEntries(bomb, 'overrides'), /크기/);
  const personal = new AdmZip(); personal.addFile('overrides/saves/world/level.dat', Buffer.from('x'));
  assert.throws(() => validateArchiveEntries(personal, 'overrides'), /개인 파일/);
});

test('ZIP rejects tampered bytes even when the archive retains the expected size', async () => {
  const env = await fixture();
  try {
    const data = await fs.readFile(env.archive); data[data.length - 1] ^= 1; await fs.writeFile(env.archive, data);
    await assert.rejects(inspectPackArchive(env.pack, env.archive), /SHA-256/);
  } finally { await env.cleanup(); }
});

test('CurseForge metadata routes mods/resources/shaders correctly and rejects author opt-out or missing hashes', async () => {
  const env = await fixture();
  try {
    assert.deepEqual(resolveCurseForgeFiles(env.pack, env.mods, env.files).map(file => file.relativePath), ['mods/mod.jar', 'resourcepacks/resource.zip', 'shaderpacks/shader.zip']);
    assert.throws(() => resolveCurseForgeFiles(env.pack, [{ ...env.mods[0], allowModDistribution: false }, ...env.mods.slice(1)], env.files), error => error instanceof ModpackInstallError && error.blockedFiles[0].projectID === 10);
    assert.throws(() => resolveCurseForgeFiles(env.pack, env.mods, [{ ...env.files[0], hashes: [] }, ...env.files.slice(1)]), /SHA-1/);
    assert.throws(() => resolveCurseForgeFiles(env.pack, env.mods, [{ ...env.files[0], modId: 99 }, ...env.files.slice(1)]), /ID 불일치/);
    for (const url of ['http://edge.forgecdn.net/file', 'https://edge.forgecdn.net.evil.test/file', 'https://user:key@edge.forgecdn.net/file', 'https://edge.forgecdn.net:444/file']) assert.equal(isCurseForgeDownloadUrl(url), false);
  } finally { await env.cleanup(); }
});

test('install verifies all downloads before seeding overrides, preserves user config/worlds, reuses valid cache', async () => {
  const env = await fixture();
  try {
    env.mockNetwork();
    await fs.mkdir(path.join(env.game, 'config')); await fs.mkdir(path.join(env.game, 'saves'));
    await fs.writeFile(path.join(env.game, 'config/example.toml'), 'user = true');
    await fs.writeFile(path.join(env.game, 'saves/level.dat'), 'my world');
    const install = () => installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} });
    const result = await install();
    assert.equal(result.version, '1.0.0');
    assert.equal(await fs.readFile(path.join(env.game, 'config/example.toml'), 'utf8'), 'user = true');
    assert.equal(await fs.readFile(path.join(env.game, 'saves/level.dat'), 'utf8'), 'my world');
    assert.equal(await fs.readFile(path.join(env.game, 'mods/mod.jar'), 'utf8'), 'fixture mod binary');
    assert.equal(await fs.readFile(path.join(env.game, 'resourcepacks/resource.zip'), 'utf8'), 'fixture resource pack');
    const downloads = env.requests.filter(request => !request.url.includes('api.curseforge.com')).length;
    assert.equal(downloads, 3);
    await install();
    assert.equal(env.requests.filter(request => !request.url.includes('api.curseforge.com')).length, downloads);
    assert.deepEqual(await fs.readdir(path.join(env.game, '.cobble/staging')), []);
  } finally { await env.cleanup(); }
});

test('blocked author distribution fails with exact file IDs before any download or override writes', async () => {
  const env = await fixture();
  try {
    env.mockNetwork(20);
    await assert.rejects(installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} }), /20\/200/);
    assert.deepEqual(await fs.readdir(env.game), []);
    assert.equal(env.requests.length, 2);
  } finally { await env.cleanup(); }
});

test('hash mismatch and an unmanaged mod collision preserve the previous installation', async () => {
  const env = await fixture();
  try {
    await fs.mkdir(path.join(env.game, 'mods')); await fs.writeFile(path.join(env.game, 'mods/mod.jar'), 'my mod');
    env.mockNetwork(undefined, true);
    await assert.rejects(installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} }), /해시/);
    assert.equal(await fs.readFile(path.join(env.game, 'mods/mod.jar'), 'utf8'), 'my mod');
    await assert.rejects(fs.stat(path.join(env.game, 'config')), { code: 'ENOENT' });
    env.mockNetwork();
    await assert.rejects(installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} }), /덮어쓰지/);
    assert.equal(await fs.readFile(path.join(env.game, 'mods/mod.jar'), 'utf8'), 'my mod');
  } finally { await env.cleanup(); }
});

test('update deletes only unchanged previously managed packs and preserves unrelated or edited mods', async () => {
  const env = await fixture();
  try {
    env.mockNetwork();
    await fs.mkdir(path.join(env.game, 'mods')); await fs.mkdir(path.join(env.game, '.cobble'));
    await fs.writeFile(path.join(env.game, 'mods/old.jar'), 'old managed');
    await fs.writeFile(path.join(env.game, 'mods/edited.jar'), 'edited by user');
    await fs.writeFile(path.join(env.game, 'mods/personal.jar'), 'personal mod');
    await fs.writeFile(path.join(env.game, '.cobble/managed-pack.json'), JSON.stringify({ version: '0.9', managedFiles: [
      { path: 'mods/old.jar', sha256: sha('old managed') }, { path: 'mods/edited.jar', sha256: sha('original file') },
      { path: '../outside.jar', sha256: sha('anything') }
    ] }));
    await installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} });
    await assert.rejects(fs.stat(path.join(env.game, 'mods/old.jar')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(env.game, 'mods/edited.jar'), 'utf8'), 'edited by user');
    assert.equal(await fs.readFile(path.join(env.game, 'mods/personal.jar'), 'utf8'), 'personal mod');
  } finally { await env.cleanup(); }
});

test('an apply-time disk error restores the previous managed binary and manifest', async () => {
  const env = await fixture();
  const originalRename = fs.rename.bind(fs);
  try {
    env.mockNetwork();
    await fs.mkdir(path.join(env.game, 'mods')); await fs.mkdir(path.join(env.game, '.cobble'));
    const target = path.join(env.game, 'mods/mod.jar');
    await fs.writeFile(target, 'old working binary');
    const previousManifest = JSON.stringify({ version: '0.9', managedFiles: [{ path: 'mods/mod.jar', sha256: sha('old working binary') }] });
    await fs.writeFile(path.join(env.game, '.cobble/managed-pack.json'), previousManifest);
    let injected = false;
    const renameMock = mock.method(fs, 'rename', async (from: string, to: string) => {
      if (!injected && to === target && String(from).includes(`${path.sep}new${path.sep}`)) {
        injected = true; throw new Error('Injected disk failure');
      }
      return originalRename(from, to);
    });
    try {
      await assert.rejects(installModpack({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: 'fixture-key', onProgress: () => {} }), /Injected disk failure/);
    } finally { renameMock.mock.restore(); }
    assert.equal(injected, true);
    assert.equal(await fs.readFile(target, 'utf8'), 'old working binary');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(env.game, '.cobble/managed-pack.json'), 'utf8')), JSON.parse(previousManifest));
    await assert.rejects(fs.stat(path.join(env.game, 'resourcepacks/resource.zip')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(env.game, 'kubejs/server_scripts/recipe.js')), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(path.join(env.game, '.cobble/staging')), []);
  } finally { await env.cleanup(); }
});

test('restart recovery restores backups, removes verified new files and tolerates operations not yet started', async () => {
  const env = await fixture();
  try {
    const stageRelative = '.cobble/staging/pack-00000000-0000-4000-8000-000000000001';
    const stage = path.join(env.game, stageRelative);
    await fs.mkdir(path.join(stage, 'backup/mods'), { recursive: true });
    await fs.mkdir(path.join(env.game, 'mods')); await fs.mkdir(path.join(env.game, 'shaderpacks'));
    await fs.writeFile(path.join(stage, 'backup/mods/working.jar'), 'original');
    await fs.writeFile(path.join(env.game, 'mods/working.jar'), 'new binary');
    await fs.writeFile(path.join(env.game, 'shaderpacks/new.zip'), 'new shader');
    await fs.writeFile(path.join(env.game, '.cobble/pack-journal.json'), JSON.stringify({ schemaVersion: 1, stageRelative, phase: 'applying', previousManifest: null,
      result: { version: '1.0.0', managedFiles: [] }, actions: [
        { path: 'mods/working.jar', originalSha256: sha('original'), newSha256: sha('new binary') },
        { path: 'shaderpacks/new.zip', newSha256: sha('new shader') },
        { path: 'config/pending.toml', newSha256: sha('not installed yet') }
      ] }));
    assert.equal(await recoverModpack(env.game), true);
    assert.equal(await fs.readFile(path.join(env.game, 'mods/working.jar'), 'utf8'), 'original');
    await assert.rejects(fs.stat(path.join(env.game, 'shaderpacks/new.zip')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(stage), { code: 'ENOENT' });
    assert.equal(await recoverModpack(env.game), false);
  } finally { await env.cleanup(); }
});

test('restart after an atomic manifest commit keeps the valid new installation', async () => {
  const env = await fixture();
  try {
    const stageRelative = '.cobble/staging/pack-00000000-0000-4000-8000-000000000002', stage = path.join(env.game, stageRelative);
    await fs.mkdir(path.join(stage, 'backup/mods'), { recursive: true }); await fs.mkdir(path.join(env.game, 'mods'));
    await fs.writeFile(path.join(stage, 'backup/mods/working.jar'), 'original');
    await fs.writeFile(path.join(env.game, 'mods/working.jar'), 'new binary');
    const result = { version: '1.0.0', managedFiles: [{ path: 'mods/working.jar', sha256: sha('new binary') }] };
    await fs.writeFile(path.join(env.game, '.cobble/managed-pack.json'), JSON.stringify(result));
    await fs.writeFile(path.join(env.game, '.cobble/pack-journal.json'), JSON.stringify({ schemaVersion: 1, stageRelative, phase: 'applying', previousManifest: null,
      result, actions: [{ path: 'mods/working.jar', originalSha256: sha('original'), newSha256: sha('new binary') }] }));
    await recoverModpack(env.game);
    assert.equal(await fs.readFile(path.join(env.game, 'mods/working.jar'), 'utf8'), 'new binary');
    await assert.rejects(fs.stat(stage), { code: 'ENOENT' });
  } finally { await env.cleanup(); }
});

test('recovery refuses unsafe journal paths and preserves backups when a user edits a crashed-install target', async () => {
  const env = await fixture();
  try {
    const stageRelative = '.cobble/staging/pack-00000000-0000-4000-8000-000000000003', stage = path.join(env.game, stageRelative);
    await fs.mkdir(path.join(stage, 'backup/mods'), { recursive: true }); await fs.mkdir(path.join(env.game, 'mods'));
    const journal = { schemaVersion: 1, stageRelative, phase: 'applying', previousManifest: null,
      result: { version: '1.0.0', managedFiles: [] }, actions: [{ path: '../outside', originalSha256: sha('original'), newSha256: sha('new binary') }] };
    const journalPath = path.join(env.game, '.cobble/pack-journal.json');
    await fs.writeFile(journalPath, JSON.stringify(journal));
    await assert.rejects(recoverModpack(env.game), /경로\/해시/);
    journal.actions[0].path = 'mods/working.jar';
    await fs.writeFile(path.join(stage, 'backup/mods/working.jar'), 'original');
    await fs.writeFile(path.join(env.game, 'mods/working.jar'), 'user changed this');
    await fs.writeFile(journalPath, JSON.stringify(journal));
    await assert.rejects(recoverModpack(env.game), /백업을 보존/);
    assert.equal(await fs.readFile(path.join(env.game, 'mods/working.jar'), 'utf8'), 'user changed this');
    assert.equal(await fs.readFile(path.join(stage, 'backup/mods/working.jar'), 'utf8'), 'original');
  } finally { await env.cleanup(); }
});

test('a verified local modpack ZIP works without an API key or metadata request', async () => {
  const env = await fixture();
  try {
    globalThis.fetch = async () => { throw new Error('network should not be used'); };
    assert.equal(await ensurePackArchive({ pack: env.pack, archivePath: env.archive, gameDirectory: env.game, apiKey: '' }), env.archive);
  } finally { await env.cleanup(); }
});

test('official automatic pack acquisition uses returned metadata URL, registered SHA256 and verified offline cache', async () => {
  const env = await fixture();
  try {
    env.pack.curseforge = { projectId: 1000, fileId: 10000 };
    const archiveBytes = await fs.readFile(env.archive), returnedUrl = 'https://edge.forgecdn.net/files/author-chosen-opaque-url.zip';
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input); calls.push(url); assert.equal(new Headers(init?.headers).get('x-api-key'), 'fixture-key');
      if (url === 'https://api.curseforge.com/v1/mods') return Response.json({ data: [{ id: 1000, classId: 4471, allowModDistribution: true }] });
      if (url === 'https://api.curseforge.com/v1/mods/files') return Response.json({ data: [{ id: 10000, modId: 1000, isAvailable: true, fileLength: archiveBytes.length, downloadUrl: returnedUrl }] });
      assert.equal(url, returnedUrl); return new Response(archiveBytes);
    };
    const result = await ensurePackArchive({ pack: env.pack, gameDirectory: env.game, apiKey: 'fixture-key' });
    assert.equal(path.basename(result), `10000-${env.pack.sourceArchive.sha256}.zip`);
    assert.deepEqual(await fs.readFile(result), archiveBytes); assert.equal(calls.length, 3);
    globalThis.fetch = async () => { throw new Error('verified offline cache should be used'); };
    assert.equal(await ensurePackArchive({ pack: env.pack, gameDirectory: env.game, apiKey: '' }), result);
  } finally { await env.cleanup(); }
});

test('automatic pack acquisition respects author opt-out and refuses a metadata URL outside CF', async () => {
  const env = await fixture();
  try {
    env.pack.curseforge = { projectId: 1000, fileId: 10000 };
    let allowed = false, calls = 0;
    globalThis.fetch = async input => {
      calls++;
      return String(input).endsWith('/mods') ? Response.json({ data: [{ id: 1000, classId: 4471, allowModDistribution: allowed }] }) :
        Response.json({ data: [{ id: 10000, modId: 1000, isAvailable: true, fileLength: env.pack.sourceArchive.size, downloadUrl: 'https://evil.test/stolen.zip' }] });
    };
    await assert.rejects(ensurePackArchive({ pack: env.pack, gameDirectory: env.game, apiKey: 'fixture-key' }), /허용하지/);
    allowed = true;
    await assert.rejects(ensurePackArchive({ pack: env.pack, gameDirectory: env.game, apiKey: 'fixture-key' }), /다운로드 URL/);
    assert.equal(calls, 4); assert.deepEqual(await fs.readdir(env.game), []);
  } finally { await env.cleanup(); }
});
