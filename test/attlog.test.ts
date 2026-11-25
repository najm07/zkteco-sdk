/**
 * Attendance log decoding (command 13).
 *
 * Fixture: first two records of the 541-record log captured from the live
 * device. The layout and verify codes were confirmed against the vendor app's
 * `att_punches` table (20/20 matches).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ATTLOG_RECORD_SIZE, decodeAttendanceLog, verifyModeOf } from '../src/protocol/attlog.ts';

// 2 records (80 bytes) + 4-byte declared length prefix.
const FIXTURE = Buffer.from(
  '88540000' +
    '010033300000000000000000000000000000000000000000000001b8136733000000000000000000' +
    '02003330370000000000000000000000000000000000000000000f8c146733000000000000000000',
  'hex',
);

describe('attendance log', () => {
  it('rejects a body that is not a multiple of the record size', () => {
    assert.throws(() => decodeAttendanceLog(Buffer.from('88540000' + '00'.repeat(5), 'hex')));
  });

  it('decodes the declared length prefix and skips it', () => {
    const records = decodeAttendanceLog(FIXTURE);
    assert.equal(records.length, 2);
  });

  it('reads the sequence index and pin', () => {
    const records = decodeAttendanceLog(FIXTURE);
    assert.equal(records[0]!.index, 1);
    assert.equal(records[0]!.pin, '30');
    assert.equal(records[1]!.index, 2);
    assert.equal(records[1]!.pin, '307');
  });

  it('maps verify codes to modalities', () => {
    const records = decodeAttendanceLog(FIXTURE);
    assert.equal(records[0]!.verify, 1);
    assert.equal(records[0]!.verifyMode, 'fingerprint');
    assert.equal(records[1]!.verify, 15);
    assert.equal(records[1]!.verifyMode, 'face');
  });

  it('decodes the device-calendar timestamp', () => {
    const records = decodeAttendanceLog(FIXTURE);
    assert.equal(records[0]!.timeValue, 862393272);
    assert.equal(records[1]!.timeValue, 862393484);
  });

  it('exposes verifyModeOf for unknown codes', () => {
    assert.equal(verifyModeOf(99), 'unknown');
    assert.equal(verifyModeOf(25), 'palm');
  });

  it('record size is 40 bytes', () => {
    assert.equal(ATTLOG_RECORD_SIZE, 40);
  });
});
