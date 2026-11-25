/**
 * Framing and checksum, verified against frames captured from a live device.
 *
 * The captured frames are the evidence; these tests exist so a future refactor
 * cannot silently change the wire format.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checksum, decodeFrames, encodeFrame, MAGIC } from '../src/protocol/frame.ts';

/** Frames captured from a uFace800 Plus (Ver 6.60 Nov 21 2019). */
const CAPTURED = [
  '5050827d08000000e80317fc00000000',
  '5050827d0c0000004e048aa47aad01003c206f89',
  '5050827d130000000c00b9cc7aad020053444b4275696c643d3100',
  '5050827d160000000b00d1f77aad04005a4b4661636556657273696f6e00',
  '5050827d080000004c04344e7aad0500',
  '5050827d0a0000004500165f7aad060023f3',
  '5050827d0800000010276e2b7aad0700',
  '5050827d1b0000000b00f8b37aad08004d61736b446574656374696f6e46756e4f6e00',
  '5050827d1d0000000b00ad587aad0900495254656d70446574656374696f6e46756e4f6e00',
  '5050827d08000000e903924e7aad0a00',
  '5050827d08000000d507b04a7aad0000',
  '5050827d08000000d007b44a7aad0100',
  '5050827d08000000d007b34a7aad0200',
  '5050827d19000000d007db807aad04005a4b4661636556657273696f6e3d313200',
  '5050827d1d000000d00736e67aad050056657220362e3630204e6f76203231203230313900',
  '5050827d09000000d007a64a7aad060009',
];

describe('frame', () => {
  it('matches the checksum recorded in every captured frame', () => {
    for (const hex of CAPTURED) {
      const buf = Buffer.from(hex, 'hex');
      const command = buf.readUInt16LE(8);
      const stored = buf.readUInt16LE(10);
      const session = buf.readUInt16LE(12);
      const reply = buf.readUInt16LE(14);
      const data = buf.subarray(16);
      assert.equal(checksum(command, session, reply, data), stored, `checksum mismatch for ${hex}`);
    }
  });

  it('re-encodes a captured frame byte for byte', () => {
    for (const hex of CAPTURED) {
      const original = Buffer.from(hex, 'hex');
      const encoded = encodeFrame({
        command: original.readUInt16LE(8),
        session: original.readUInt16LE(12),
        reply: original.readUInt16LE(14),
        data: original.subarray(16),
      });
      if (original.readUInt16LE(8) !== 1000) {
        // The CONNECT frame's captured checksum depends only on the command, so
        // it must round-trip exactly like every other frame.
      }
      assert.equal(encoded.toString('hex'), hex);
    }
  });

  it('declares its own length correctly', () => {
    for (const hex of CAPTURED) {
      const buf = Buffer.from(hex, 'hex');
      assert.ok(buf.subarray(0, 4).equals(MAGIC));
      assert.equal(buf.readUInt32LE(4), buf.length - 8);
    }
  });

  it('reassembles frames split across chunk boundaries', () => {
    const whole = Buffer.concat(CAPTURED.map((hex) => Buffer.from(hex, 'hex')));
    for (let split = 1; split < whole.length; split += 7) {
      let buffer: Buffer = Buffer.alloc(0);
      const frames = [];
      for (const part of [whole.subarray(0, split), whole.subarray(split)]) {
        buffer = Buffer.concat([buffer, part]);
        const result = decodeFrames(buffer);
        frames.push(...result.frames);
        buffer = result.rest;
      }
      assert.equal(frames.length, CAPTURED.length, `split at ${split}`);
      assert.equal(buffer.length, 0);
    }
  });

  it('keeps a trailing partial frame for the next read', () => {
    const whole = Buffer.from(CAPTURED[1]!, 'hex');
    const result = decodeFrames(whole.subarray(0, whole.length - 3));
    assert.equal(result.frames.length, 0);
    assert.equal(result.rest.length, whole.length - 3);
  });
});
