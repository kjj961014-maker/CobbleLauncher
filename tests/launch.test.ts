import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateArguments, Version, type LaunchOption } from '@xmcl/core';

// These tests inspect argument generation only. No launcher/spawn call or account authentication occurs.
const gameDirectory = path.resolve('private/test-instance');
const fixtureProfile = { id: '00000000000040008000000000000000', name: 'FixturePlayer' };
const fixtureAccessToken = 'fixture-token-for-argument-generation-only';
const fixtureClientId = '00000000-0000-4000-8000-000000000001';
const fixtureXuid = '0000000000000000';
async function installedRuntime(t: { skip(reason: string): void }) {
  const file = path.join(gameDirectory, '.cobble/runtime.json');
  try {
    const runtime = JSON.parse(await fs.readFile(file, 'utf8')) as { versionId: string; javaPath: string };
    const version = await Version.parse(gameDirectory, runtime.versionId);
    return { runtime, version };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { t.skip('Actual private/test-instance is absent; run scripts/verify-install.ts before this integration check.'); return null; }
    throw error;
  }
}
function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag); assert.ok(index >= 0, `Missing required argument ${flag}`); return args[index + 1];
}

test('actual resolved Minecraft 1.21.1 and NeoForge 21.1.252 reference the installed Java 21 runtime', async t => {
  const installed = await installedRuntime(t); if (!installed) return;
  const { runtime, version } = installed;
  assert.equal(runtime.versionId, 'neoforge-21.1.252');
  assert.equal(version.id, runtime.versionId); assert.equal(version.minecraftVersion, '1.21.1');
  assert.equal(version.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
  const expectedJava = path.join(gameDirectory, 'runtime/java21/bin/java.exe');
  assert.equal(path.resolve(runtime.javaPath), expectedJava);
  assert.ok((await fs.stat(expectedJava)).isFile());
  assert.match(await fs.readFile(path.join(gameDirectory, 'runtime/java21/release'), 'utf8'), /JAVA_VERSION="21\./);
  assert.ok(version.libraries.some(library => library.name.startsWith('cpw.mods:bootstraplauncher:2.0.2')));
  assert.ok(version.libraries.some(library => library.name.startsWith('net.neoforged.fancymodloader:loader:4.0.44')));
});

test('generated NeoForge arguments wire Microsoft token/profile, memory, loader and optional server without executing Java', async t => {
  const installed = await installedRuntime(t); if (!installed) return;
  const options: LaunchOption = { javaPath: installed.runtime.javaPath, gamePath: gameDirectory, version: installed.version,
    gameProfile: fixtureProfile, accessToken: fixtureAccessToken, launcherName: 'CobbleLauncher', launcherBrand: 'CobbleLauncher',
    minMemory: 1024, maxMemory: 8192, extraExecOption: { windowsHide: true, shell: false }, quickPlayMultiplayer: 'play.example.test:25565',
    features: { authentication: { clientid: fixtureClientId, auth_xuid: fixtureXuid } } };
  const args = await generateArguments(options);
  assert.equal(args[0], options.javaPath); assert.ok(args.includes('-Xms1024M')); assert.ok(args.includes('-Xmx8192M'));
  assert.equal(args.filter(value => value.startsWith('-Xmx')).length, 1);
  assert.equal(valueAfter(args, '--username'), fixtureProfile.name); assert.equal(valueAfter(args, '--uuid'), fixtureProfile.id);
  // Assert as a boolean so a failing runner never prints token-bearing command arrays.
  assert.ok(valueAfter(args, '--accessToken') === fixtureAccessToken, 'Access token must occupy its own game argument');
  assert.equal(valueAfter(args, '--userType'), 'msa');
  assert.equal(valueAfter(args, '--clientId'), fixtureClientId); assert.equal(valueAfter(args, '--xuid'), fixtureXuid);
  assert.equal(valueAfter(args, '--version'), 'neoforge-21.1.252');
  assert.equal(valueAfter(args, '--fml.neoForgeVersion'), '21.1.252');
  assert.equal(valueAfter(args, '--fml.mcVersion'), '1.21.1'); assert.equal(valueAfter(args, '--launchTarget'), 'forgeclient');
  assert.equal(valueAfter(args, '--quickPlayMultiplayer'), 'play.example.test:25565');
  assert.equal(valueAfter(args, '--gameDir'), gameDirectory.replaceAll('\\', '/'));
  assert.equal(valueAfter(args, '--assetIndex'), '17');
  assert.ok(args.includes(installed.version.mainClass)); assert.ok(args.includes('-p'));
  assert.ok(!args.includes('--demo')); assert.ok(!args.some(argument => argument.includes('${')));
  assert.equal(options.extraExecOption?.shell, false); assert.equal(options.extraExecOption?.windowsHide, true);
});

test('spaced Windows paths and shell metacharacters remain separate unquoted argument elements', async t => {
  const installed = await installedRuntime(t); if (!installed) return;
  const spacedGamePath = path.join(gameDirectory, 'unused instance with spaces');
  const spacedJavaPath = path.join(gameDirectory, 'unused runtime with spaces', 'java.exe');
  const literalValue = 'literal value & echo should-stay-an-argument';
  const options: LaunchOption = { javaPath: spacedJavaPath, gamePath: spacedGamePath, resourcePath: gameDirectory,
    version: installed.version, gameProfile: fixtureProfile, accessToken: fixtureAccessToken,
    minMemory: 1024, maxMemory: 8192, extraExecOption: { shell: false, windowsHide: true }, extraMCArgs: ['--fixtureLiteral', literalValue],
    features: { authentication: { clientid: fixtureClientId, auth_xuid: fixtureXuid } } };
  const args = await generateArguments(options);
  assert.equal(args[0], spacedJavaPath); assert.equal(valueAfter(args, '--gameDir'), spacedGamePath.replaceAll('\\', '/'));
  assert.equal(valueAfter(args, '--fixtureLiteral'), literalValue);
  assert.ok(!args[0].startsWith('"')); assert.ok(!valueAfter(args, '--gameDir').startsWith('"'));
  assert.equal(options.extraExecOption?.shell, false);
  // No fictitious path is created or executed: generateArguments is a pure command construction check.
  await assert.rejects(fs.stat(spacedGamePath), { code: 'ENOENT' });
});
