import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fetchSecure, downloadFile } from '../src/main/download';

const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cobble-download-test-'));
  const destination = path.join(root, 'artifact.jar'), url = 'https://edge.forgecdn.net/files/fixture.jar';
  const data = Buffer.from('0123456789abcdef');
  const options = { url, destination, hash: { algorithm: 'sha256' as const, value: digest(data) }, size: data.length, allowedHosts: new Set(['edge.forgecdn.net']) };
  const originalFetch = globalThis.fetch;
  const seed = async (partial: Buffer) => {
    await fs.writeFile(destination + '.part', partial);
    await fs.writeFile(destination + '.part.json', JSON.stringify({ url, hash: options.hash, size: options.size }));
  };
  return { root, destination, data, options, seed, cleanup: async () => { globalThis.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); } };
}

test('redirects enforce the official allowlist before contacting an unrelated host', async () => {
  const env = await fixture();
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.test/payload' } }); };
    await assert.rejects(fetchSecure(env.options.url, { allowedHosts: env.options.allowedHosts, headers: { 'x-api-key': 'secret' } }), /허용되지 않은/);
    assert.equal(calls, 1);
  } finally { await env.cleanup(); }
});

test('cross-origin redirects retain API keys only within official CF hosts and strip account credentials', async () => {
  const env = await fixture();
  try {
    const seen: Headers[] = [];
    globalThis.fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://mediafilez.forgecdn.net/file' } }) : new Response('ok');
    };
    await fetchSecure(env.options.url, { allowedHosts: new Set(['edge.forgecdn.net', 'mediafilez.forgecdn.net']), headers: { 'x-api-key': 'secret', Authorization: 'Bearer private', Cookie: 'session=private' } });
    assert.equal(seen[1].get('x-api-key'), 'secret'); assert.equal(seen[1].get('authorization'), null); assert.equal(seen[1].get('cookie'), null);
    seen.length = 0;
    globalThis.fetch = async (_input, init) => { seen.push(new Headers(init?.headers)); return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://another.test/file' } }) : new Response('ok'); };
    await fetchSecure(env.options.url, { headers: { 'x-api-key': 'secret', Authorization: 'Bearer private' } });
    assert.equal(seen[1].get('x-api-key'), null); assert.equal(seen[1].get('authorization'), null);
  } finally { await env.cleanup(); }
});

test('HTTP downgrade and excessive redirects are rejected', async () => {
  const env = await fixture();
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://edge.forgecdn.net/file' } });
    await assert.rejects(fetchSecure(env.options.url), /HTTPS/);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 307, headers: { location: env.options.url } }); };
    await assert.rejects(fetchSecure(env.options.url), /리디렉션이 너무/); assert.equal(calls, 6);
  } finally { await env.cleanup(); }
});

test('valid 206 responses append a partial download and verify the complete hash', async () => {
  const env = await fixture();
  try {
    await env.seed(env.data.subarray(0, 5));
    const progress: number[] = [];
    globalThis.fetch = async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=5-');
      return new Response(env.data.subarray(5), { status: 206, headers: { 'content-range': `bytes 5-${env.data.length - 1}/${env.data.length}`, 'content-length': String(env.data.length - 5) } });
    };
    await downloadFile({ ...env.options, onProgress: value => progress.push(value.downloaded) });
    assert.deepEqual(await fs.readFile(env.destination), env.data); assert.equal(progress.at(-1), env.data.length);
    await assert.rejects(fs.stat(env.destination + '.part'), { code: 'ENOENT' });
  } finally { await env.cleanup(); }
});

test('a server ignoring Range restarts safely instead of appending a full file twice', async () => {
  const env = await fixture();
  try {
    await env.seed(env.data.subarray(0, 5));
    globalThis.fetch = async () => new Response(env.data, { status: 200, headers: { 'content-length': String(env.data.length) } });
    await downloadFile(env.options); assert.deepEqual(await fs.readFile(env.destination), env.data);
  } finally { await env.cleanup(); }
});

test('malformed 206 ranges never write bytes into the partial or destination', async () => {
  const env = await fixture();
  try {
    const partial = env.data.subarray(0, 5); await env.seed(partial);
    globalThis.fetch = async () => new Response(env.data.subarray(5), { status: 206, headers: { 'content-range': `bytes 4-${env.data.length - 1}/${env.data.length}` } });
    await assert.rejects(downloadFile(env.options), /범위/);
    assert.deepEqual(await fs.readFile(env.destination + '.part'), partial);
    await assert.rejects(fs.stat(env.destination), { code: 'ENOENT' });
  } finally { await env.cleanup(); }
});

test('a broken stream resumes from persisted bytes on the next bounded attempt', async () => {
  const env = await fixture();
  try {
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls++;
      if (calls === 1) {
        let sent = false;
        return new Response(new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(env.data.subarray(0, 5)); } else controller.error(new Error('connection interrupted')); } }), { headers: { 'content-length': String(env.data.length) } });
      }
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=5-');
      return new Response(env.data.subarray(5), { status: 206, headers: { 'content-range': `bytes 5-${env.data.length - 1}/${env.data.length}` } });
    };
    await downloadFile(env.options); assert.equal(calls, 2); assert.deepEqual(await fs.readFile(env.destination), env.data);
  } finally { await env.cleanup(); }
});

test('corrupt download never replaces an existing valid installation file', async () => {
  const env = await fixture();
  try {
    await fs.writeFile(env.destination, 'old valid installation');
    globalThis.fetch = async () => new Response(Buffer.alloc(env.data.length, 0));
    await assert.rejects(downloadFile(env.options), /해시/);
    assert.equal(await fs.readFile(env.destination, 'utf8'), 'old valid installation');
  } finally { await env.cleanup(); }
});

test('fully downloaded valid partial and valid cached destination require no network', async () => {
  const env = await fixture();
  try {
    await env.seed(env.data); globalThis.fetch = async () => { throw new Error('network should not be used'); };
    await downloadFile(env.options); assert.deepEqual(await fs.readFile(env.destination), env.data);
    await downloadFile(env.options);
  } finally { await env.cleanup(); }
});

test('416 on a stale partial resets it and retries a complete download', async () => {
  const env = await fixture();
  try {
    await env.seed(env.data.subarray(0, 5)); let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls++; if (calls === 1) return new Response(null, { status: 416 });
      assert.equal(new Headers(init?.headers).get('range'), null); return new Response(env.data);
    };
    await downloadFile(env.options); assert.equal(calls, 2); assert.deepEqual(await fs.readFile(env.destination), env.data);
  } finally { await env.cleanup(); }
});

test('zero-byte signed patch files install, verify and cache while nonempty responses are rejected', async () => {
  const env = await fixture();
  try {
    const empty = { ...env.options, hash: { algorithm: 'sha256' as const, value: digest('') }, size: 0 };
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(Buffer.alloc(0)); };
    await downloadFile(empty); assert.equal((await fs.stat(env.destination)).size, 0);
    await downloadFile(empty); assert.equal(calls, 1);
    await fs.rm(env.destination);
    globalThis.fetch = async () => new Response('unexpected bytes');
    await assert.rejects(downloadFile(empty), /용량/);
    await assert.rejects(fs.stat(env.destination), { code: 'ENOENT' });
  } finally { await env.cleanup(); }
});
