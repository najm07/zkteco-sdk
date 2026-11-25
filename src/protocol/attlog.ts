/**
 * Attendance log (command 13, `ATTLOG_RRQ`).
 *
 * The modern `transaction` table returns no rows on this firmware even though
 * the device reports 541 records, because it is a cursor that the vendor app
 * already drained. The legacy `ATTLOG_RRQ` command returns the whole log at
 * once, in a fixed 40-byte record format that was verified against the vendor
 * app's `att_punches` table: 20 of 20 terminal-6 punches matched byte for byte
 * on pin, verify code and timestamp (the app stores them shifted to local time).
 *
 * Verified verify codes come from the app's own labels:
 *   1  = fingerprint (FP)
 *   15 = face (FACE)
 *   25 = palm (Palm)
 * Other values are returned verbatim and labelled `unknown`.
 */
import { decodeDateTime } from './time.ts';

export const ATTLOG_RECORD_SIZE = 40;
export const ATTLOG_COMMAND = 13;

export const VERIFY_MODE = {
  fingerprint: 1,
  face: 15,
  palm: 25,
} as const;

export type VerifyModeName = 'fingerprint' | 'face' | 'palm' | 'unknown';

export function verifyModeOf(code: number): VerifyModeName {
  if (code === VERIFY_MODE.fingerprint) return 'fingerprint';
  if (code === VERIFY_MODE.face) return 'face';
  if (code === VERIFY_MODE.palm) return 'palm';
  return 'unknown';
}

export interface AttendanceLogRecord {
  /** 1-based sequence index as stored by the device. */
  index: number;
  /** Employee pin, as stored on the device. */
  pin: string;
  /** Raw verify code. */
  verify: number;
  /** Friendly name for the verify code, where known. */
  verifyMode: VerifyModeName;
  /** Device wall-clock time of the punch. */
  time: Date;
  /** Raw device-calendar value, kept for round-tripping. */
  timeValue: number;
  /** Reserved bytes 31..39, all zero on this firmware. */
  reserved: Buffer;
}

export function decodeAttendanceLog(payload: Buffer): AttendanceLogRecord[] {
  const records: AttendanceLogRecord[] = [];
  const body = payload.length >= 4 ? payload.subarray(4) : payload;
  if (body.length % ATTLOG_RECORD_SIZE !== 0) {
    throw new Error(
      `attendance log body is ${body.length} bytes, not a multiple of ${ATTLOG_RECORD_SIZE}`,
    );
  }
  const count = body.length / ATTLOG_RECORD_SIZE;
  for (let i = 0; i < count; i += 1) {
    const rec = body.subarray(i * ATTLOG_RECORD_SIZE, (i + 1) * ATTLOG_RECORD_SIZE);
    records.push({
      index: rec.readUInt16LE(0),
      pin: rec.subarray(2, 26).toString('latin1').replace(/\x00+$/, ''),
      verify: rec[26]!,
      verifyMode: verifyModeOf(rec[26]!),
      time: decodeDateTime(rec.readUInt32LE(27)),
      timeValue: rec.readUInt32LE(27),
      reserved: Buffer.from(rec.subarray(31)),
    });
  }
  return records;
}
