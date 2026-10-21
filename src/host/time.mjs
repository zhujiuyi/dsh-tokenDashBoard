/**
 * Local-time helpers shared by the host engine.
 *
 * Every statistic in this plugin is bucketed by the machine's **local calendar
 * day**: a day is `00:00–24:00` in the machine's time zone, and a day key is
 * `YYYY-MM-DD` in local time. Event timestamps are epoch milliseconds, so all
 * conversions go through `Date` with local getters — this keeps DST transitions
 * correct (a day still starts at local midnight, a "hour bucket" is still the
 * local wall clock hour).
 *
 * This module is deliberately dependency-free and pure so tests can assert the
 * day/hour bucketing without touching the file system.
 */

/** @type {string | null} */
let cachedTimeZone = null

/**
 * The IANA time zone name reported by the engine, e.g. `Asia/Shanghai`.
 * Falls back to `'UTC'` when Intl is unavailable (never throws).
 * @returns {string}
 */
export function timeZoneOf() {
  if (cachedTimeZone !== null) return cachedTimeZone
  try {
    cachedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    cachedTimeZone = 'UTC'
  }
  return cachedTimeZone
}

/**
 * Local day key of an epoch-ms timestamp: `YYYY-MM-DD`.
 * @param {number} timestamp epoch ms
 * @returns {string}
 */
export function localDay(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Local hour of an epoch-ms timestamp: `0`–`23`.
 * @param {number} timestamp epoch ms
 * @returns {number}
 */
export function localHour(timestamp) {
  return new Date(timestamp).getHours()
}

/**
 * Parse a `YYYY-MM-DD` day key into local midnight.
 * @param {string} day
 * @returns {Date}
 */
export function dayToDate(day) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/**
 * Shift a day key by whole local days, e.g. `addDays('2026-03-31', 1)` →
 * `'2026-04-01'`. Uses local `Date` arithmetic so month/year/DST roll over.
 * @param {string} day
 * @param {number} delta
 * @returns {string}
 */
export function addDays(day, delta) {
  const date = dayToDate(day)
  date.setDate(date.getDate() + delta)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** @param {number} value @returns {string} */
function pad2(value) {
  return String(value).padStart(2, '0')
}
