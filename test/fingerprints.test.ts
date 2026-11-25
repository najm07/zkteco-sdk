/**
 * Fingerprint bulk payload (`DATA_WRRQ` 1503, request `01 07 00 02 …`).
 *
 * The device returns a 4-byte declared length followed by variable-length
 * records:
 *
 *   [size:u16 LE][uid:u16 LE][fid:u8][valid:u8][template:size bytes]
 *
 * Verified against the live uFace800: 308 records, and the record for
 * uid 5 / fid 6 matched the USERTEMP_RRQ (cmd 9) payload byte for byte.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFingerprintSlots } from '../src/protocol/fingerprints.ts';

function record(uid: number, fid: number, valid: number, data: Buffer): Buffer {
  const head = Buffer.alloc(6);
  // `size` counts the whole record, header included.
  head.writeUInt16LE(6 + data.length, 0);
  head.writeUInt16LE(uid, 2);
  head[4] = fid;
  head[5] = valid;
  return Buffer.concat([head, data]);
}

function payload(records: Buffer[]): Buffer {
  const body = Buffer.concat(records);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

describe('fingerprint bulk payload', () => {
  it('parses every record and preserves template bytes', () => {
    const a = Buffer.from('4be7535332310000', 'hex');
    const b = Buffer.from('4be7535332310001', 'hex');
    const slots = parseFingerprintSlots(
      payload([record(5, 6, 1, a), record(7, 0, 1, b)]),
    );

    assert.equal(slots.length, 2);
    assert.deepEqual(slots[0], { uid: 5, fid: 6, valid: true, data: a });
    assert.deepEqual(slots[1], { uid: 7, fid: 0, valid: true, data: b });
  });

  it('marks a non-1 valid flag as false', () => {
    const slots = parseFingerprintSlots(
      payload([record(9, 1, 0, Buffer.from('aa', 'hex'))]),
    );
    assert.equal(slots[0]!.valid, false);
  });

  it('honours the declared length and ignores trailing bytes', () => {
    const body = record(1, 0, 1, Buffer.from('0102', 'hex'));
    const declared = Buffer.alloc(4);
    declared.writeUInt32LE(body.length, 0);
    const slots = parseFingerprintSlots(
      Buffer.concat([declared, body, Buffer.from('ffff', 'hex')]),
    );
    assert.equal(slots.length, 1);
  });

  it('reads the size field as the whole record length', () => {
    const data = Buffer.alloc(490, 0x5a);
    const framed = record(323, 6, 1, data);
    assert.equal(framed.readUInt16LE(0), 496);
    const declared = Buffer.alloc(4);
    declared.writeUInt32LE(framed.length, 0);
    const slots = parseFingerprintSlots(Buffer.concat([declared, framed]));
    assert.equal(slots.length, 1);
    assert.equal(slots[0]!.data.length, 490);
  });

  it('stops instead of emitting a truncated record', () => {
    const body = record(1, 0, 1, Buffer.from('01020304', 'hex'));
    const truncated = body.subarray(0, body.length - 2);
    const declared = Buffer.alloc(4);
    declared.writeUInt32LE(truncated.length, 0);
    assert.deepEqual(
      parseFingerprintSlots(Buffer.concat([declared, truncated])),
      [],
    );
  });

  it('returns an empty list for an empty payload', () => {
    assert.deepEqual(parseFingerprintSlots(Buffer.alloc(0)), []);
    assert.deepEqual(parseFingerprintSlots(Buffer.from([0, 0, 0, 0])), []);
  });
});
