/**
 * Device clock encoding, verified against a live device.
 *
 * `SetDeviceTime2` put `8e 0e 7f 33` on the wire for 2026-11-18 14:13:34, which
 * is 863,964,814 and decomposes exactly as:
 *
 *   days = ((year - 2000) * 12 + (month - 1)) * 31 + (day - 1)
 *   value = days * 86400 + hour * 3600 + minute * 60 + second
 *
 * Month arithmetic uses 31 days per month, so this is a device-specific
 * calendar, not a Unix timestamp. Round-tripping through days is therefore not
 * the same as adding a duration.
 */

const SECONDS_PER_DAY = 86_400;
const DAYS_PER_MONTH = 31;

export function encodeDateTime(when: Date): number {
  // Read the UTC fields, matching decodeDateTime: a Date produced by decode
  // carries the device's wall clock in its UTC fields, so encoding must use
  // the same fields or the two are only inverses on a UTC host.
  const year = when.getUTCFullYear() - 2000;
  const days = (year * 12 + when.getUTCMonth()) * DAYS_PER_MONTH + (when.getUTCDate() - 1);
  return (
    days * SECONDS_PER_DAY +
    when.getUTCHours() * 3600 +
    when.getUTCMinutes() * 60 +
    when.getUTCSeconds()
  );
}

export function decodeDateTime(value: number): Date {
  const days = Math.floor(value / SECONDS_PER_DAY);
  let rest = value % SECONDS_PER_DAY;
  const hour = Math.floor(rest / 3600);
  rest -= hour * 3600;
  const minute = Math.floor(rest / 60);
  const second = rest - minute * 60;

  const year = 2000 + Math.floor(days / (12 * DAYS_PER_MONTH));
  const monthIndex = Math.floor(days / DAYS_PER_MONTH) % 12;
  const day = (days % DAYS_PER_MONTH) + 1;

  // Device time is wall-clock time. Keep it in the UTC fields so it survives
  // storage in `timestamp without time zone` columns without a host-timezone
  // shift.
  return new Date(
    Date.UTC(year, monthIndex, day, hour, minute, second, 0),
  );
}
