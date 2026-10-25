/** Pieces shared by several departments. */
const { addDays, daysBetween, ukToday } = require("../../utils/workingDays");
const fmt = require("../../utils/format");

const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const row = (label, value, opts = {}) => ({ label, value, ...opts });

/**
 * Settlement offers register. Part 36 offers get their 21-day relevant
 * period worked out and flagged as it runs out.
 */
function offersList({ offerTypes, types } = {}) {
  return {
    key: "offers",
    title: "Offers",
    singular: "offer",
    icon: "Handshake",
    types,
    intro: "Every settlement offer made or received, so the best offer and any Part 36 deadlines are always in view.",
    fields: [
      { key: "date", label: "Date made", kind: "date", required: true },
      { key: "madeBy", label: "Made by", kind: "select", options: ["Us", "Other side"], required: true },
      { key: "offerType", label: "Type", kind: "select", options: offerTypes || ["Part 36", "Calderbank (WP save as to costs)", "Without prejudice", "Open offer"], required: true },
      { key: "amount", label: "Amount (£)", kind: "money" },
      { key: "terms", label: "Terms", kind: "text" },
      { key: "status", label: "Status", kind: "select", options: ["Open", "Accepted", "Rejected", "Withdrawn", "Lapsed"] },
      { key: "respondedOn", label: "Responded on", kind: "date", table: false },
    ],
    summary(items) {
      const today = ukToday();
      const theirs = items.filter((o) => o.madeBy === "Other side" && o.amount !== undefined);
      const ours = items.filter((o) => o.madeBy === "Us" && o.amount !== undefined);
      const best = theirs.reduce((b, o) => (b === null || n(o.amount) > n(b.amount) ? o : b), null);
      const latestOurs = ours.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const rows = [
        row("Offers made / received", `${ours.length} / ${theirs.length}`),
        row("Best offer received", best ? `${fmt.money(best.amount)} (${fmt.date(best.date)}${best.status ? `, ${best.status.toLowerCase()}` : ""})` : "—", { strong: true }),
        row("Our latest offer", latestOurs ? `${fmt.money(latestOurs.amount)} (${fmt.date(latestOurs.date)})` : "—"),
      ];
      const attention = [];
      for (const o of items.filter((x) => x.offerType === "Part 36" && (x.status || "Open") === "Open" && x.date)) {
        const end = addDays(o.date, 21);
        const left = daysBetween(today, end);
        rows.push(row(`Part 36 ${o.madeBy === "Us" ? "made by us" : "from the other side"}${o.amount !== undefined ? ` (${fmt.money(o.amount)})` : ""}`,
          `relevant period ${left >= 0 ? "ends" : "ended"} ${fmt.date(end)}`, { warn: left >= 0 && left <= 7 }));
        if (o.madeBy === "Other side" && left >= 0 && left <= 7) {
          attention.push(`Part 36 offer${o.amount !== undefined ? ` of ${fmt.money(o.amount)}` : ""} from the other side: relevant period ends ${fmt.date(end)} (${fmt.relative(left)}) — advise the client on accepting and the costs risk`);
        }
      }
      return { rows, attention, note: "Part 36: 21-day relevant period from the date the offer is served; accepting later usually means paying the other side's costs from the end of it." };
    },
  };
}

module.exports = { offersList, n, row };
