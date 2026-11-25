/**
 * Biometric chunk handling and the vendor blob container.
 *
 * The layout assertions come from a face template captured through
 * `GetUserFaceStr` on a live device: slot size 2,576, a 16-byte descriptor of
 * `[len:u16][01 00][index:u8][01][00 × 10]`, then the chunk, zero padded.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chunkPayload,
  decodeVendorBlob,
  encodeVendorBlob,
  modalityOf,
  VENDOR_SLOT,
} from '../src/protocol/biotemplate.ts';

const makeChunk = (length: number, marker: number): Buffer => {
  const buf = Buffer.alloc(length, marker);
  buf.writeUInt16LE(length, 0);
  buf[2] = 0x6a;
  buf[3] = 0x95;
  buf[4] = 0x01;
  buf[5] = 0x10;
  return buf;
};

describe('biometric modality', () => {
  it('names the types the device actually stores', () => {
    assert.equal(modalityOf(1), 'fingerprint');
    assert.equal(modalityOf(2), 'face');
    assert.equal(modalityOf(8), 'palm');
    assert.equal(modalityOf(99), 'unknown');
  });
});

describe('chunk payload', () => {
  it('strips the 6-byte envelope', () => {
    const chunk = makeChunk(2016, 0x41);
    const payload = chunkPayload(chunk);
    assert.equal(payload.length, 2010);
    assert.equal(payload[0], 0x41);
  });

  it('returns nothing for a truncated chunk rather than throwing', () => {
    assert.equal(chunkPayload(Buffer.from([0x6a, 0x95])).length, 0);
  });
});

describe('vendor blob', () => {
  const chunks = [
    { index: 6, data: makeChunk(1004, 0x22) },
    { index: 5, data: makeChunk(2016, 0x11) },
  ];

  it('writes one fixed-size slot per chunk, in index order', () => {
    const blob = encodeVendorBlob(chunks);
    assert.equal(blob.length, 2 * VENDOR_SLOT);

    assert.equal(blob.readUInt16LE(0), 2016);
    assert.equal(blob[2], 0x01);
    assert.equal(blob[3], 0x00);
    assert.equal(blob[4], 5);
    assert.equal(blob[5], 0x01);

    const second = VENDOR_SLOT;
    assert.equal(blob.readUInt16LE(second), 1004);
    assert.equal(blob[second + 4], 6);
  });

  it('copies the chunk verbatim after the descriptor', () => {
    const blob = encodeVendorBlob(chunks);
    assert.ok(blob.subarray(16, 16 + 2016).equals(chunks[1]!.data));
    assert.ok(blob.subarray(VENDOR_SLOT + 16, VENDOR_SLOT + 16 + 1004).equals(chunks[0]!.data));
  });

  it('leaves the remainder of every slot zeroed', () => {
    const blob = encodeVendorBlob(chunks);
    assert.equal(blob.subarray(16 + 2016, VENDOR_SLOT).every((b) => b === 0), true);
    assert.equal(blob.subarray(VENDOR_SLOT + 16 + 1004).every((b) => b === 0), true);
  });

  it('round-trips through decodeVendorBlob', () => {
    const decoded = decodeVendorBlob(encodeVendorBlob(chunks));
    assert.deepEqual(
      decoded.map((c) => c.index),
      [5, 6],
    );
    assert.ok(decoded[0]!.data.equals(chunks[1]!.data));
    assert.ok(decoded[1]!.data.equals(chunks[0]!.data));
  });

  it('produces an empty blob for no chunks', () => {
    assert.equal(encodeVendorBlob([]).length, 0);
  });
});
