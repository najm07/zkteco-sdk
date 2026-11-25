/**
 * Free sizes / device status (command 50, `GET_FREE_SIZES`).
 *
 * The device answers with 28 u32 words (112 bytes). The counts were cross-
 * checked against `count()` and the user table on a live device:
 *
 *   [4]  users used          (499)   [15] user capacity  (10000)   [18] user free (9501)
 *   [6]  fingerprints used   (309)   [14] fp capacity     (4000)   [17] fp free   (3691)
 *   [8]  attendance used     (541)   [16] att capacity   (100000)  [19] att free  (99459)
 *   [10] operation logs used (225)
 *   [20] face templates used (124)   [22] face capacity   (3000)   [21] face free (2876)
 *   [12] admin users         (8)
 *   [13] users with password (1)
 *
 * Words [0..3] and [23..27] are always zero on this firmware.
 */
export interface DeviceCapacity {
  used: number;
  capacity: number;
  free: number;
}

export interface DeviceStatus {
  users: DeviceCapacity;
  fingerprints: DeviceCapacity;
  faces: DeviceCapacity;
  attendanceLogs: DeviceCapacity;
  operationLogs: number;
  adminUsers: number;
  passwordUsers: number;
  raw: Uint32Array;
}

export function decodeDeviceStatus(payload: Buffer): DeviceStatus {
  if (payload.length < 112) {
    throw new Error(`status payload is ${payload.length} bytes, expected 112`);
  }
  const words = new Uint32Array(28);
  for (let i = 0; i < 28; i += 1) words[i] = payload.readUInt32LE(i * 4);

  return {
    users: { used: words[4]!, capacity: words[15]!, free: words[18]! },
    fingerprints: { used: words[6]!, capacity: words[14]!, free: words[17]! },
    faces: { used: words[20]!, capacity: words[22]!, free: words[21]! },
    attendanceLogs: { used: words[8]!, capacity: words[16]!, free: words[19]! },
    operationLogs: words[10]!,
    adminUsers: words[12]!,
    passwordUsers: words[13]!,
    raw: words,
  };
}
