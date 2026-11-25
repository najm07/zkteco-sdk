/**
 * Fingerprint store bulk payload.
 *
 * Firmware `Ver 6.60 Nov 21 2019` keeps fingerprints out of `pers_biotemplate`;
 * `READ_TABLE` returns zero Type=1 rows (the vendor COM SDK synthesises
 * Type=1 rows from this store, which is why its read looks different). The
 * store is exposed through the vendor "SSR" bulk command instead:
 *
 *   DATA_WRRQ(1503) with request 01 07 00 02 00 00 00 00 00 00 00
 *
 * The reply is a 4-byte declared length followed by variable-length records:
 *
 *   [size:u16 LE][uid:u16 LE][fid:u8][valid:u8][template:size-6 bytes]
 *
 * `size` counts the whole record, header included. Captured from the live
 * device: 308 records / 171,760 bytes. The template for uid 5 / fid 6 matched
 * `USERTEMP_RRQ` (cmd 9) up to its last six bytes — that command pads the
 * reply with the next record's header, so its length is not a reliable data
 * length. The bulk record is authoritative.
 */

export interface FingerprintSlot {
  /** Device-internal user id (not the PIN). */
  uid: number;
  /** Finger slot 0-9. */
  fid: number;
  valid: boolean;
  /** Raw template bytes, as returned by USERTEMP_RRQ. */
  data: Buffer;
}

/** Wire request body for the fingerprint bulk stream. */
export const FINGERPRINTS_BULK_REQUEST = Buffer.from(
  '0107000200000000000000',
  'hex',
);

export function parseFingerprintSlots(payload: Buffer): FingerprintSlot[] {
  if (payload.length < 4) return [];
  const declared = payload.readUInt32LE(0);
  const end = Math.min(payload.length, 4 + declared);
  const slots: FingerprintSlot[] = [];
  let offset = 4;
  while (offset + 6 <= end) {
    const size = payload.readUInt16LE(offset);
    if (size < 6 || offset + size > end) break;
    slots.push({
      uid: payload.readUInt16LE(offset + 2),
      fid: payload[offset + 4]!,
      valid: payload[offset + 5] === 1,
      data: payload.subarray(offset + 6, offset + size),
    });
    offset += size;
  }
  return slots;
}
