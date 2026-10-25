/** Plain-English formatting for figures the server works out (calculation cards, list summaries). */
const money = (v) => {
  const n = Number(v) || 0;
  return `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const date = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const dateTime = (dt) => {
  if (!dt) return "—";
  const [d, t] = String(dt).split("T");
  return `${date(d)} ${t ? t.slice(0, 5) : ""}`.trim();
};
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "in 5 days" / "today" / "3 days ago" */
function relative(days) {
  if (days === 0) return "today";
  if (days > 0) return `in ${plural(days, "day")}`;
  return `${plural(-days, "day")} ago`;
}

module.exports = { money, date, dateTime, plural, relative };
