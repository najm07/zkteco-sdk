/**
 * Device clock encoding.
 *
 * The reference value is the payload captured from the vendor SDK:
 * 2026-11-18 14:13:34 encoded to 0x337F0E8E (863,964,814).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeDateTime, encodeDateTime } from '../src/protocol/time.ts';

describe('device clock', () => {
  it('reproduces the value captured from the vendor SDK', () => {
    // The captured wall clock is zone-less. Date.UTC states it explicitly, so
    // the test does not depend on the host timezone.
    const when = new Date(Date.UTC(2026, 10, 18, 14, 13, 34, 0));
    assert.equal(encodeDateTime(when), 0x337f0e8e);
  });

  it('round-trips the exact wire value', () => {
    assert.equal(encodeDateTime(decodeDateTime(0x337f0e8e)), 0x337f0e8e);
  });

  it('round-trips through decode', () => {
    const when = new Date(Date.UTC(2026, 10, 18, 14, 13, 34, 0));
    const decoded = decodeDateTime(encodeDateTime(when));
    // decodeDateTime puts the device wall clock in the UTC fields.
    assert.equal(decoded.getUTCFullYear(), 2026);
    assert.equal(decoded.getUTCMonth(), 10);
    assert.equal(decoded.getUTCDate(), 18);
    assert.equal(decoded.getUTCHours(), 14);
    assert.equal(decoded.getUTCMinutes(), 13);
    assert.equal(decoded.getUTCSeconds(), 34);
  });

  it('handles a leap-day style date without inventing days', () => {
    const when = new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 0));
    const decoded = decodeDateTime(encodeDateTime(when));
    assert.equal(decoded.getUTCMonth(), 1);
    assert.equal(decoded.getUTCDate(), 29);
    assert.equal(decoded.getUTCHours(), 23);
    assert.equal(decoded.getUTCSeconds(), 59);
  });

  it('advances by exactly one day per 86400 steps within a month', () => {
    const day = encodeDateTime(new Date(Date.UTC(2026, 0, 15, 0, 0, 0, 0)));
    assert.equal(encodeDateTime(new Date(Date.UTC(2026, 0, 16, 0, 0, 0, 0))) - day, 86_400);
  });
});
