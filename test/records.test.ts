/**
 * Schema parsing and record codec, verified against bytes captured from a live
 * device. The `Name=B3` case is the regression that matters: binary columns use
 * a 16-bit length, and reading it as 8-bit desynchronises every later field.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeRows, encodeRow, parseSchema } from '../src/protocol/records.ts';

const SCHEMA = [
  'user=1,UID=i1,Pin=s2,Name=B3,Password=s4,CardNo=s5,Group=i6,TZ=s7,Pri=i8,f=i9,h=i10,IsGroupTz=i11,verified=i12,valid=i13,VaildCount=i14,StartDatetime=s15,EndDatetime=s16,Timezone1=i17,Timezone2=i18,Timezone3=i19',
  'transaction=2,PIN2=s1,time_second=i2,start_time_second=i3,end_time_second=i4,status=i5,verified=i6,workcode=i7,RESERVED1=i8,RESERVED2=i9,RecordOffset=i10',
].join('\r\n');

/**
 * First two rows of the `user` table, captured from the device and then
 * sanitized: names, passwords and card numbers are synthetic.
 * Row 1 is `UID=1, Pin=1, Name=alice1, Password=000000, CardNo=0000000,
 * Group=1, Pri=14`, row 2 is `UID=2, Pin=2, Name=bob, Group=1, Pri=14`.
 */
const USER_ROWS = Buffer.from(
  '01130102030405060708090a0b0c0d0e0f10111213' +
    '0101' +
    '0131' +
    '0600616c69636531' +
    '06303030303030' +
    '0730303030303030' +
    '0101' +
    '00' +
    '010e' +
    '0100' +
    '0100' +
    '0101' +
    '0100' +
    '0100' +
    '0100' +
    '13313839392d31322d33305430303a30303a3030' +
    '13313839392d31322d33305430303a30303a3030' +
    '0100' +
    '0100' +
    '0100' +
    '0102' +
    '0132' +
    '0300626f62' +
    '00' +
    '00' +
    '0101' +
    '00' +
    '010e' +
    '0100' +
    '0100' +
    '0101' +
    '0100' +
    '0100' +
    '0100' +
    '13313839392d31322d33305430303a30303a3030' +
    '13313839392d31322d33305430303a30303a3030' +
    '0100' +
    '0100' +
    '0100',
  'hex',
);

describe('schema', () => {
  it('parses tables, columns, types and ordinals', () => {
    const tables = parseSchema(SCHEMA);
    assert.equal(tables.length, 2);

    const user = tables[0]!;
    assert.equal(user.id, 1);
    assert.equal(user.name, 'user');
    assert.equal(user.columns.length, 19);
    assert.deepEqual(user.columns.slice(0, 4), ['UID', 'Pin', 'Name', 'Password']);
    assert.deepEqual(user.types.slice(0, 4), ['i', 's', 'B', 's']);
    assert.deepEqual(user.ordinals.slice(0, 4), [1, 2, 3, 4]);
  });

  it('ignores a trailing terminator', () => {
    const tables = parseSchema(`${SCHEMA}\0\0`);
    assert.equal(tables.length, 2);
  });
});

describe('record codec', () => {
  const user = parseSchema(SCHEMA)[0]!;

  it('decodes rows with binary columns without drifting', () => {
    const { tableId, rows } = decodeRows(USER_ROWS, user);
    assert.equal(tableId, 1);
    assert.equal(rows.length, 2);

    assert.equal(rows[0]!.UID, 1);
    assert.equal(rows[0]!.Pin, '1');
    assert.equal((rows[0]!.Name as Buffer).toString('utf8'), 'alice1');
    assert.equal(rows[0]!.Password, '000000');
    assert.equal(rows[0]!.CardNo, '0000000');
    assert.equal(rows[0]!.Group, 1);
    assert.equal(rows[0]!.Pri, 14);
    assert.equal(rows[0]!.Timezone3, 0);

    assert.equal(rows[1]!.UID, 2);
    assert.equal(rows[1]!.Pin, '2');
    assert.equal((rows[1]!.Name as Buffer).toString('utf8'), 'bob');
    assert.equal(rows[1]!.Password, '');
    assert.equal(rows[1]!.Pri, 14);
  });

  it('round-trips a decoded row through encodeRow', () => {
    const row = decodeRows(USER_ROWS, user).rows[0]!;
    const encoded = encodeRow(row, user);
    const expected = USER_ROWS.subarray(21, 21 + encoded.length);
    assert.equal(encoded.toString('hex'), expected.toString('hex'));
  });

  it('uses a 16-bit length for binary columns', () => {
    const encoded = encodeRow({ Name: Buffer.alloc(300, 0x41) }, user, [3]);
    assert.equal(encoded.readUInt16LE(0), 300);
    assert.equal(encoded.length, 302);
  });

  it('stops cleanly on a truncated row instead of emitting garbage', () => {
    const truncated = USER_ROWS.subarray(0, USER_ROWS.length - 10);
    const { rows } = decodeRows(truncated, user);
    assert.equal(rows.length, 1);
  });
});
