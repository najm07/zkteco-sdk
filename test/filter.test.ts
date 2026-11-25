/**
 * Filter encoding, checked against bytes the vendor shim actually sent.
 *
 * The fixtures below are the complete tails of the vendor's READ_TABLE
 * requests, captured through a logging TCP proxy, so a change that alters the
 * wire format fails here instead of on a customer's device.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TableDefinition } from '../src/protocol/commands.ts';
import { encodeCountFilter, encodeFilter, parseFilter } from '../src/protocol/filter.ts';
import { parseSchema } from '../src/protocol/records.ts';

const SCHEMA = [
  'user=1,UID=i1,Pin=s2,Name=B3,Password=s4,CardNo=s5,Group=i6,TZ=s7,Pri=i8,f=i9,h=i10,IsGroupTz=i11,verified=i12,valid=i13,VaildCount=i14,StartDatetime=s15,EndDatetime=s16,Timezone1=i17,Timezone2=i18,Timezone3=i19',
  'pers_biotemplate=27,Pin=s1,Valid=i2,Duress=i3,Type=i4,MajorVer=i5,MinorVer=i6,Format=i7,No=i8,Index=i9,Tmp=B10',
].join('\r\n');

const tables = parseSchema(SCHEMA);
const user = tables[0]!;
const bio = tables[1]!;

describe('filter encoding', () => {
  it('encodes an empty filter as two zero bytes', () => {
    assert.equal(encodeFilter('', user).toString('hex'), '0000');
  });

  it('reproduces `Pin=1` exactly as captured', () => {
    assert.equal(encodeFilter('Pin=1', user).toString('hex'), '0001020131');
  });

  it('reproduces `Pin=12` exactly as captured', () => {
    assert.equal(encodeFilter('Pin=12', user).toString('hex'), '000102023132');
  });

  it('reproduces `Pin=1<TAB>Pri=14` exactly as captured', () => {
    assert.equal(encodeFilter('Pin=1\tPri=14', user).toString('hex'), '00020208013101 0e'.replace(/ /g, ''));
  });

  it('reproduces `Pin=1<TAB>Type=2` on the biometric table', () => {
    assert.equal(encodeFilter('Pin=1\tType=2', bio).toString('hex'), '0002010401310102');
  });

  it('matches the captured GET_RECORD_COUNT body for `Pin=65000`', () => {
    assert.equal(encodeCountFilter('Pin=65000', user).toString('hex'), '0102053635303030');
  });

  it('encodes an empty count filter as a single zero byte', () => {
    assert.equal(encodeCountFilter('', user).toString('hex'), '00');
  });
});

describe('filter validation', () => {
  it('rejects an unknown column instead of sending it', () => {
    assert.throws(() => encodeFilter('Nope=1', user), /not in table user/);
  });

  it('rejects comparison operators', () => {
    assert.throws(() => encodeFilter('Pri>=1', user), /operator other than equality/);
    assert.throws(() => encodeFilter('Pri!=1', user), /operator other than equality/);
  });

  it('rejects a term without a value separator', () => {
    assert.throws(() => encodeFilter('Pin', user), /not Column=value/);
  });

  it('rejects a repeated column', () => {
    assert.throws(() => encodeFilter('Pin=1\tPin=2', user), /repeated/);
  });

  it('allows an empty value', () => {
    assert.equal(encodeFilter('TZ=', user).toString('hex'), '00010700');
  });

  it('sends integer filter values as binary, not ASCII', () => {
    // `Pri=14` captured as `01 0e`, while the string column `Pin=14` is `01 31 34`.
    assert.equal(encodeFilter('Pri=14', user).toString('hex'), '00010801 0e'.replace(/ /g, ''));
    assert.equal(encodeFilter('Pin=14', user).toString('hex'), '000102023134');
  });

  it('widens an integer filter value when it needs more bytes', () => {
    assert.equal(encodeFilter('Group=300', user).toString('hex'), '000106022c01');
  });

  it('rejects a non-numeric value for an integer column', () => {
    assert.throws(() => encodeFilter('Type=abc', bio), /must be a non-negative integer/);
    assert.throws(() => encodeFilter('Type=-1', bio), /must be a non-negative integer/);
  });

  it('keeps conditions in the order they were written', () => {
    assert.deepEqual(
      parseFilter('Pri=1\tPin=2', user).map((c) => c.column),
      ['Pri', 'Pin'],
    );
  });
});
