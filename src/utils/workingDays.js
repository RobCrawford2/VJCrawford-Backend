/**
 * Date arithmetic for deadlines: calendar days / months, and business days
 * (Monday–Friday, excluding England & Wales bank holidays). Dates are
 * "YYYY-MM-DD" strings throughout, worked out at midday UTC so clock
 * changes never shift a day.
 *
 * Bank holidays: add each new year's list from gov.uk/bank-holidays.
 */

const BANK_HOLIDAYS = new Set([
  // 2024
  "2024-01-01", "2024-03-29", "2024-04-01", "2024-05-06", "2024-05-27", "2024-08-26", "2024-12-25", "2024-12-26",
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05", "2025-05-26", "2025-08-25", "2025-12-25", "2025-12-26",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  // 2028
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
]);

const toDate = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

function addDays(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Adds calendar months; the 31st plus a month lands on the last day of a shorter month. */
function addMonths(iso, months) {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIso(d);
}

const addYears = (iso, years) => addMonths(iso, years * 12);

function isBusinessDay(iso) {
  const day = toDate(iso).getUTCDay();
  return day !== 0 && day !== 6 && !BANK_HOLIDAYS.has(iso);
}

/** The date `n` business days after `iso` (n ≥ 0; 0 = the next business day on or after it). */
function addBusinessDays(iso, n) {
  let d = iso;
  if (n === 0) {
    while (!isBusinessDay(d)) d = addDays(d, 1);
    return d;
  }
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000);

/** Today in the UK. */
const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** Whole years from `dob` to `on`. */
function yearsBetween(from, on) {
  const a = toDate(from);
  const b = toDate(on);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
}

/** "YYYY-MM-DDTHH:MM" plus hours (naive local time — near a clock change, check by hand). */
function addHours(dateTime, hours) {
  const d = new Date(`${dateTime}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + Math.round(hours * 60));
  return d.toISOString().slice(0, 16);
}

module.exports = { addDays, addMonths, addYears, addBusinessDays, isBusinessDay, daysBetween, ukToday, yearsBetween, addHours, BANK_HOLIDAYS };
