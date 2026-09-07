/**
 * relativeTime.ts
 * "อัปเดต 3 นาทีที่แล้ว" — the age of a reading, from a real stamp.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every card on this dashboard prints a number, and on a ceremony screen a
 * number with no age on it is indistinguishable from a number that stopped
 * moving an hour ago. The age line is what tells the two apart.
 *
 * It has to come from the reading's OWN timestamp — SolarEdge's
 * `lastUpdateTime`, which is when the inverter was actually sampled — and not
 * from when the browser last ran a fetch. Those differ by up to a quarter of an
 * hour: SolarEdge's power series is quarter-hourly, so a fetch that lands at
 * 14:07 is still reporting the 14:00 sample. Printing the fetch time would
 * claim a freshness the figures do not have.
 *
 * `null` in, `null` out. A card with no stamp shows no age line rather than
 * inventing "just now" — same rule as `NO_DATA` in metricDisplay.tsx.
 */

/**
 * The UTC offset a bare wall-clock stamp is read at, in minutes.
 *
 * SolarEdge v2 normally answers with an explicit offset
 * ("2026-08-01T00:00:00+07:00") and that path wins below. The fallbacks do not:
 * `site.lastUpdateTime` and the mock generator both produce a bare
 * "YYYY-MM-DD HH:mm:ss" in SITE-local time. Handing that to `new Date()` reads
 * it in the BROWSER's zone, so a laptop on UTC would have shown every Thai site
 * as seven hours stale. Every site on this dashboard is in Thailand, which is
 * UTC+7 year-round with no DST, so the offset is a constant rather than a
 * lookup.
 */
const SITE_UTC_OFFSET_MIN = 7 * 60;

/** Trailing "Z" or "+07:00"/"+0700" — the stamp already says which zone it is in. */
const HAS_EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** "2026-09-05", "2026-09-05 14:30:00", "2026-09-05T14:30" — no zone attached. */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A SolarEdge timestamp as epoch milliseconds, or `null` if it cannot be read.
 *
 * Never throws and never guesses a time for an unparseable string: the caller
 * renders nothing at all rather than an age computed from `Date.now()`.
 */
export function parseReadingTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (HAS_EXPLICIT_ZONE.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T'));
    return Number.isFinite(ms) ? ms : null;
  }

  const parts = WALL_CLOCK.exec(text);
  if (!parts) {
    // Something else entirely (an RFC-1123 date, say). Let the platform try;
    // an unparseable string still lands on null rather than on NaN.
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }

  const [, y, mo, d, hh, mi, ss] = parts;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0));
  if (!Number.isFinite(utc)) return null;
  return utc - SITE_UTC_OFFSET_MIN * 60_000;
}

/** The newest of a set of stamps, ignoring the ones that could not be read. */
export function newestTimestamp(raw: Array<string | null | undefined>): number | null {
  let newest: number | null = null;
  for (const entry of raw) {
    const ms = parseReadingTimestamp(entry);
    if (ms === null) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How old a reading is, in Thai. `null` when there is no stamp to age.
 *
 * A stamp slightly AHEAD of the browser clock reads as "เมื่อสักครู่" rather
 * than as a negative age: an unattended kiosk drifts, and a card announcing
 * "-2 นาที" is a worse answer than rounding a few seconds of skew to zero.
 */
export function formatAgeThai(at: number | null, now: number = Date.now()): string | null {
  if (at === null || !Number.isFinite(at)) return null;

  const delta = now - at;
  if (delta < MINUTE_MS) return 'อัปเดตเมื่อสักครู่';

  const minutes = Math.floor(delta / MINUTE_MS);
  if (minutes < 60) return `อัปเดต ${minutes} นาทีที่แล้ว`;

  const hours = Math.floor(delta / HOUR_MS);
  if (hours < 24) return `อัปเดต ${hours} ชม.ที่แล้ว`;

  const days = Math.floor(delta / DAY_MS);
  return `อัปเดต ${days} วันที่แล้ว`;
}

/**
 * The stamp itself, for the hover title behind the age line.
 *
 * The age is the glanceable half; anyone who wants to check it against the
 * SolarEdge portal needs the actual clock time, and a `title` costs no space
 * on a card that was asked to stay quiet.
 */
export function formatClockThai(at: number | null): string | null {
  if (at === null || !Number.isFinite(at)) return null;
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ข้อมูล ณ ${d.getDate()}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
}
