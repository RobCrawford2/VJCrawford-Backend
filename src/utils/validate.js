/** Small shared input checks. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (so not 30 February). */
const validDate = (v) => DATE.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim());
const text = (v) => (isBlank(v) ? null : String(v).trim());

module.exports = { validDate, isBlank, text };
