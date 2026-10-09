import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { pingServer } from '../src/main/server';

async function fixture(handler: (socket: net.Socket) => void, run: (port: number) => Promise<void>) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); handler(socket);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run((server.address() as net.AddressInfo).port); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function packet(value: unknown) {
  const text = Buffer.from(JSON.stringify(value));
  assert.ok(text.length < 125);
  return Buffer.concat([Buffer.from([text.length + 2, 0, text.length]), text]);
}
test('server status accepts a fragmented valid reply from an actual TCP server', async () => {
  await fixture(socket => socket.once('data', () => {
    const data = packet({ players: { online: 6, max: 10 } });
    socket.write(data.subarray(0, 2));
    setTimeout(() => socket.end(data.subarray(2)), 15);
  }), async port => {
    const result = await pingServer('127.0.0.1', port);
    assert.equal(result.status, 'online'); assert.equal(result.players, 6); assert.equal(result.maxPlayers, 10);
  });
});
test('server connection closing without a reply settles as offline', async () => {
  await fixture(socket => socket.destroy(), async port => {
    assert.equal((await pingServer('127.0.0.1', port)).status, 'offline');
  });
});
test('slow partial replies cannot extend the overall server deadline', async () => {
  await fixture(socket => {
    socket.write(Buffer.from([100, 0, 98]));
    const timer = setInterval(() => socket.write(' '), 20);
    socket.once('close', () => clearInterval(timer));
  }, async port => {
    const start = Date.now();
    assert.equal((await pingServer('127.0.0.1', port, { timeoutMs: 120 })).status, 'offline');
    assert.ok(Date.now() - start < 1500, 'must finish before the continuously active reply completes');
  });
});
test('a JSON string outside the declared packet boundary is rejected', async () => {
  await fixture(socket => socket.once('data', () => socket.end(Buffer.from([2, 0, 2, 123, 125]))), async port => {
    assert.equal((await pingServer('127.0.0.1', port)).status, 'offline');
  });
});
test('unconfigured and invalid endpoints settle without an unhandled rejection', async () => {
  assert.equal((await pingServer('', 25565)).status, 'unconfigured');
  assert.equal((await pingServer('127.0.0.1', -1)).status, 'offline');
});
