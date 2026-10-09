import net from 'node:net';
import type { LauncherState } from '../shared/types';

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value);
  return Buffer.from(bytes);
}
function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buffer.length) return null;
    const byte = buffer[offset + i];
    if (i === 4 && (byte & 0xf0)) throw new Error('Invalid server packet');
    value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return { value, offset: offset + i + 1 };
  }
  throw new Error('Invalid server packet');
}

export async function pingServer(host: string, port: number, options: { timeoutMs?: number } = {}): Promise<LauncherState['server']> {
  if (!host) return { status: 'unconfigured' };
  return new Promise(resolve => {
    const started = Date.now(), socket = new net.Socket();
    let data = Buffer.alloc(0), done = false;
    const finish = (value: LauncherState['server']) => {
      if (done) return;
      done = true; clearTimeout(deadline); socket.destroy(); resolve(value);
    };
    // An inactivity timeout can be extended forever by partial replies.
    // Bound DNS, connect and response time together, including slow trickles.
    const deadline = setTimeout(() => finish({ status: 'offline' }), options.timeoutMs ?? 4000);
    socket.once('error', () => finish({ status: 'offline' }));
    socket.once('close', () => finish({ status: 'offline' }));
    socket.once('end', () => finish({ status: 'offline' }));
    socket.once('connect', () => {
      const name = Buffer.from(host, 'utf8'), portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      const packet = Buffer.concat([varint(0), varint(767), varint(name.length), name, portBuf, varint(1)]);
      socket.write(Buffer.concat([varint(packet.length), packet, Buffer.from([1, 0])]));
    });
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 65536) return finish({ status: 'offline' });
      try {
        const length = readVarint(data, 0);
        if (!length) return;
        if (length.value < 2 || length.value > 65536) return finish({ status: 'offline' });
        const end = length.offset + length.value;
        if (data.length < end) return;
        const frame = data.subarray(0, end);
        const id = readVarint(frame, length.offset);
        if (!id || id.value !== 0) return finish({ status: 'offline' });
        const text = readVarint(frame, id.offset);
        if (!text || text.value < 0 || text.offset + text.value !== end) return finish({ status: 'offline' });
        const status = JSON.parse(frame.subarray(text.offset, end).toString('utf8'));
        if (!status || typeof status !== 'object' || Array.isArray(status)) return finish({ status: 'offline' });
        const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        finish({ status: 'online', players: count(status.players?.online), maxPlayers: count(status.players?.max), latencyMs: Date.now() - started });
      } catch { finish({ status: 'offline' }); }
    });
    try { socket.connect({ host, port }); } catch { finish({ status: 'offline' }); }
  });
}
