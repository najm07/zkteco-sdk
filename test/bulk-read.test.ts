/**
 * DATA_WRRQ (1503) bulk transfer against a fake device.
 *
 * The real protocol was captured from a uFace800 Plus: the request is answered
 * with a 13-byte header, then each DATA_RDY window is answered with
 * PREPARE_DATA + DATA + ACK_OK, and FREE_DATA closes the stream. This test
 * pins the request/response sequence and proves multi-window assembly without
 * touching hardware.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';

import { ZkDevice } from '../src/ZkDevice.ts';
import { Command } from '../src/protocol/commands.ts';
import { decodeFrames, encodeFrame, type Frame } from '../src/protocol/frame.ts';

const STREAM = Buffer.alloc(100_000);
for (let i = 0; i < STREAM.length; i++) STREAM[i] = (i * 7) & 0xff;

const SESSION = 0x1234;

interface FakeDevice {
  port: number;
  requests: Array<{ command: number; data: Buffer }>;
  close(): Promise<void>;
}

function startFakeDevice(options: { rejectBulk?: boolean } = {}): Promise<FakeDevice> {
  const requests: Array<{ command: number; data: Buffer }> = [];
  const server = net.createServer((socket) => {
    let buffered: Buffer = Buffer.alloc(0);
    const reply = (frame: Frame, data = Buffer.alloc(0), command: number = Command.ACK_OK) => {
      socket.write(
        encodeFrame({ command, session: SESSION, reply: frame.reply, data }),
      );
    };
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const { frames, rest } = decodeFrames(buffered);
      buffered = rest;
      for (const frame of frames) {
        requests.push({ command: frame.command, data: frame.data });
        switch (frame.command) {
          case Command.CONNECT:
            reply(frame, Buffer.alloc(0), Command.ACK_CONNECT);
            return;
          case Command.AUTH:
          case Command.EXIT:
          case Command.FREE_DATA:
            reply(frame);
            return;
          case Command.GET_VERSION:
            reply(frame, Buffer.from('Ver 6.60 test\0', 'latin1'));
            return;
          case Command.DATA_WRRQ: {
            if (options.rejectBulk) {
              socket.write(
                encodeFrame({ command: 4991, session: SESSION, reply: frame.reply, data: Buffer.alloc(0) }),
              );
              return;
            }
            const header = Buffer.alloc(13);
            header.writeUInt32LE(STREAM.length, 1);
            header.writeUInt32LE(STREAM.length, 5);
            reply(frame, header);
            return;
          }
          case Command.DATA_RDY: {
            const offset = frame.data.readUInt32LE(0);
            const size = frame.data.readUInt32LE(4);
            const window = STREAM.subarray(offset, Math.min(offset + size, STREAM.length));
            const prepare = Buffer.alloc(8);
            prepare.writeUInt32LE(window.length, 0);
            prepare.writeUInt16LE(0xfff8, 4);
            socket.write(
              encodeFrame({
                command: Command.PREPARE_DATA,
                session: SESSION,
                reply: frame.reply,
                data: prepare,
              }),
            );
            socket.write(
              encodeFrame({
                command: Command.DATA,
                session: SESSION,
                reply: frame.reply,
                data: window,
              }),
            );
            reply(frame);
            return;
          }
          default:
            reply(frame);
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe('DATA_WRRQ bulk transfer', () => {
  let fake: FakeDevice;

  before(async () => {
    fake = await startFakeDevice();
  });

  after(async () => {
    await fake.close();
  });

  it('requests windows, assembles them and frees the device buffer', async () => {
    const device = new ZkDevice({ host: '127.0.0.1', port: fake.port, timeoutMs: 5_000 });
    try {
      await device.connect();
      const payload = await device.bulkRead(Buffer.from('0107000200000000000000', 'hex'));
      assert.equal(payload.length, STREAM.length);
      assert.ok(payload.equals(STREAM));
    } finally {
      await device.disconnect().catch(() => {});
    }

    const commands = fake.requests.map((request) => request.command);
    assert.ok(commands.includes(Command.DATA_WRRQ));
    assert.ok(commands.includes(Command.DATA_RDY));
    assert.ok(commands.includes(Command.FREE_DATA));
    const windows = fake.requests.filter((request) => request.command === Command.DATA_RDY);
    assert.equal(windows.length, 2, '100,000 bytes need two 0xffc0 windows');
    assert.equal(windows[0]!.data.readUInt32LE(0), 0);
    assert.equal(windows[1]!.data.readUInt32LE(0), 0xffc0);
  });

  it('surfaces a rejected bulk request as an error', async () => {
    const rejecting = await startFakeDevice({ rejectBulk: true });
    const device = new ZkDevice({
      host: '127.0.0.1',
      port: rejecting.port,
      timeoutMs: 5_000,
    });
    try {
      await device.connect();
      await assert.rejects(
        device.bulkRead(Buffer.from('0107000200000000000000', 'hex')),
        /bulk read rejected/,
      );
    } finally {
      await device.disconnect().catch(() => {});
      await rejecting.close();
    }
  });
});
