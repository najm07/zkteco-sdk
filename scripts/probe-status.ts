/**
 * Probe the status, realtime-event and realtimelog surfaces.
 *
 * These three commands are the last unexplored part of the protocol. Nothing
 * here writes to the device: `GET_STATUS` reads, `REG_EVENT` only changes what
 * the device pushes to this socket, and `realtimelog` is a read.
 *
 * Usage: node scripts/probe-status.ts [host]
 */
import { Command } from '../src/protocol/commands.ts';
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 8_000 });

const hex = (b: Buffer): string => (b.length === 0 ? '(empty)' : b.toString('hex'));

try {
  await device.connect();
  console.log('connected');

  const status = await device.sendRaw(Command.GET_STATUS);
  console.log(`GET_STATUS(69) -> ack ${status.ack} ${hex(status.payload)}`);

  // Watch for unsolicited pushes before and after registering for events.
  const unsolicited: Array<{ command: number; reply: number; data: string }> = [];
  const listener = (device as unknown as { on?: unknown }).on;
  console.log(`device has an event hook: ${typeof listener === 'function'}`);

  const realtime = await device.readTable('realtimelog');
  console.log(`realtimelog rows: ${realtime.length}`);
  for (const row of realtime.slice(0, 5)) {
    console.log(
      '  ',
      Object.entries(row)
        .map(([k, v]) => `${k}=${Buffer.isBuffer(v) ? `0x${v.toString('hex')}` : String(v)}`)
        .join(' '),
    );
  }

  for (const [label, mask] of [
    ['all', 0xffffffff],
    ['attlog', 0x0000ffff],
    ['none', 0x00000000],
  ] as const) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(mask, 0);
    const reply = await device.sendRaw(500, bytes).catch((error: Error) => ({
      ack: -1,
      payload: Buffer.from(error.message),
      error: true,
    }));
    console.log(
      `REG_EVENT(500) mask 0x${mask.toString(16).padStart(8, '0')} (${label}) -> ack ${reply.ack} ${hex(reply.payload)}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log(`unsolicited frames seen: ${unsolicited.length}`);

  const ops = await device.readTable('oplogs');
  console.log(`oplogs rows: ${ops.length}`);
  for (const row of ops.slice(0, 5)) {
    console.log(
      '  ',
      Object.entries(row)
        .map(([k, v]) => `${k}=${Buffer.isBuffer(v) ? `0x${v.toString('hex')}` : String(v)}`)
        .join(' '),
    );
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
