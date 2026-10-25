/**
 * Personal injury: road traffic, employer's liability, public liability,
 * clinical negligence.
 */
const { addDays, addMonths, addYears, addBusinessDays, daysBetween, ukToday, yearsBetween } = require("../../utils/workingDays");
const fmt = require("../../utils/format");
const { offersList, n, row } = require("./shared");

const CLIN_NEG = "Clinical negligence";
const ROUTES = [
  "OIC (Official Injury Claim) — RTA whiplash",
  "MoJ Portal — RTA",
  "MoJ Portal — employer's liability",
  "MoJ Portal — public liability",
  "Outside the portals (PI protocol)",
  "Clinical negligence protocol",
];

const FIELDS = (type) => [
  { key: "otherParty", label: type === CLIN_NEG ? "Defendant (trust / practitioner)" : "Defendant", kind: "text" },
  { key: "insurer", label: type === CLIN_NEG ? "NHS Resolution / indemnifier" : "Insurer", kind: "text" },
  { key: "insurerRef", label: "Their reference", kind: "text" },
  { key: "dateOfAccident", label: type === CLIN_NEG ? "Date of treatment / negligence" : "Date of accident", kind: "date" },
  { key: "dateOfKnowledge", label: "Date of knowledge (if later)", kind: "date" },
  { key: "clientDob", label: "Client's date of birth", kind: "date" },
  { key: "accidentLocation", label: type === CLIN_NEG ? "Where treated" : "Where it happened", kind: "text" },
  { key: "injuries", label: "Injuries", kind: "text" },
  { key: "route", label: "Claims route", kind: "select", options: ROUTES },
  { key: "claimNotified", label: type === CLIN_NEG ? "Letter of claim sent" : "Claim notified (CNF / letter of claim)", kind: "date" },
  { key: "liability", label: "Liability", kind: "select", options: ["Awaiting decision", "Admitted", "Admitted with contributory negligence", "Denied"] },
  { key: "contributoryPercent", label: "Contributory negligence (%)", kind: "percent" },
  { key: "medicalExpert", label: "Medical expert", kind: "text" },
  { key: "medicalReportDate", label: "Medical report received", kind: "date" },
  { key: "prognosis", label: "Prognosis", kind: "text" },
  { key: "generalDamages", label: "General damages valuation (£)", kind: "money" },
  { key: "cruAmount", label: "CRU recoverable benefits (£)", kind: "money" },
  { key: "interimPayments", label: "Interim payments received (£)", kind: "money" },
  { key: "cfaSigned", label: "CFA signed", kind: "date" },
  { key: "successFeePercent", label: "Success fee (% of base costs)", kind: "percent" },
  { key: "atePremium", label: "ATE premium (£)", kind: "money" },
  { key: "claimIssued", label: "Proceedings issued", kind: "date" },
];
const TYPES = ["Road traffic accident", "Accident at work", "Public liability", CLIN_NEG, "Other injury"];
const details = Object.fromEntries(TYPES.map((t) => [t, FIELDS(t)]));

/** Limitation: 3 years from the accident or knowledge; for a child, 3 years from their 18th birthday. */
function limitation(d) {
  const from = [d.dateOfAccident, d.dateOfKnowledge].filter(Boolean).sort().at(-1);
  if (!from) return null;
  let date = addYears(from, 3);
  let basis = d.dateOfKnowledge && d.dateOfKnowledge > (d.dateOfAccident || "") ? "3 years from the date of knowledge" : "3 years from the accident";
  let child = false;
  if (d.clientDob && yearsBetween(d.clientDob, d.dateOfAccident || from) < 18) {
    child = true;
    const twentyFirst = addYears(d.clientDob, 21);
    if (twentyFirst > date) { date = twentyFirst; basis = "the client's 21st birthday (3 years from turning 18)"; }
  }
  return { date, basis, child };
}

/** When the defendant must answer on liability, by route. */
function liabilityDue(d, type) {
  if (!d.claimNotified) return null;
  switch (d.route) {
    case ROUTES[0]: return { date: addBusinessDays(d.claimNotified, 30), label: "Liability decision due (OIC: 30 business days)" };
    case ROUTES[1]: return { date: addBusinessDays(d.claimNotified, 15), label: "Liability decision due (RTA Portal: 15 business days)" };
    case ROUTES[2]: return { date: addBusinessDays(d.claimNotified, 30), label: "Liability decision due (EL Portal: 30 business days)" };
    case ROUTES[3]: return { date: addBusinessDays(d.claimNotified, 40), label: "Liability decision due (PL Portal: 40 business days)" };
    case ROUTES[5]: return { date: addMonths(d.claimNotified, 4), label: "Letter of response due (4 months)" };
    default:
      if (type === CLIN_NEG) return { date: addMonths(d.claimNotified, 4), label: "Letter of response due (4 months)" };
      return { date: addMonths(addDays(d.claimNotified, 21), 3), label: "Liability response due (21 days to acknowledge + 3 months)" };
  }
}

function track(d, type, injuryValue, total) {
  const whiplash = d.route === ROUTES[0];
  if (whiplash && injuryValue <= 5000 && total <= 10000) return "Small claims track (RTA injury up to £5,000)";
  if (!whiplash && type !== "Road traffic accident" && injuryValue <= 1500 && total <= 10000) return "Small claims track (injury up to £1,500)";
  if (total <= 25000) return "Fast track (up to £25,000)";
  if (total <= 100000) return "Intermediate track (up to £100,000)";
  return "Multi-track";
}

function insights(matter, lists) {
  const d = matter.details || {};
  const today = ukToday();
  const cards = [];
  const attention = [];

  const lim = limitation(d);
  if (lim) {
    const left = daysBetween(today, lim.date);
    const rows = [row("Limitation expires", `${fmt.date(lim.date)}${d.claimIssued ? ` — issued ${fmt.date(d.claimIssued)}` : ` (${fmt.relative(left)})`}`, { strong: true, warn: !d.claimIssued && left <= 120 }), row("Basis", lim.basis)];
    if (lim.child) rows.push(row("Child claimant", "Settlement needs court approval (CPR 21); act through a litigation friend"));
    cards.push({ title: "Limitation", icon: "Hourglass", rows, note: "No limitation runs for a protected party (lacking capacity). Fatal accidents: 3 years from death or knowledge." });
    if (!d.claimIssued && left <= 120) attention.push(left < 0 ? `Limitation expired on ${fmt.date(lim.date)} — check urgently` : `Limitation expires ${fmt.date(lim.date)} (${fmt.relative(left)}) — issue protectively if not settled`);
  }

  const due = liabilityDue(d, matter.type);
  if (due) {
    const left = daysBetween(today, due.date);
    const decided = d.liability && d.liability !== "Awaiting decision";
    cards.push({
      title: "Protocol", icon: "Hourglass",
      rows: [row(matter.type === CLIN_NEG ? "Letter of claim sent" : "Claim notified", fmt.date(d.claimNotified)), row(due.label, decided ? `${fmt.date(due.date)} — ${d.liability.toLowerCase()}` : `${fmt.date(due.date)} (${fmt.relative(left)})`, { strong: true, warn: !decided && left < 0 })],
      note: d.route && d.route.startsWith("MoJ") ? "If liability isn't admitted in time (or the claim leaves the portal), it continues under the PI protocol." : null,
    });
    if (!decided && left < 0) attention.push(`${due.label.split(" (")[0]} was ${fmt.date(due.date)} — chase, or move the claim on`);
  }

  const specials = lists.specials || [];
  const past = specials.filter((s) => s.period !== "Future").reduce((t, s) => t + n(s.amount), 0);
  const future = specials.filter((s) => s.period === "Future").reduce((t, s) => t + n(s.amount), 0);
  const general = n(d.generalDamages);
  if (general || past || future) {
    const gross = general + past + future;
    const cn = n(d.contributoryPercent);
    const net = gross * (1 - cn / 100);
    const rows = [
      row("General damages (pain, suffering, loss of amenity)", fmt.money(general)),
      row("Special damages — past", fmt.money(past)),
      row("Special damages — future", fmt.money(future)),
      row("Full value", fmt.money(gross), { strong: true }),
    ];
    if (cn) rows.push(row(`Less contributory negligence (${cn}%)`, fmt.money(net - gross)), row("Value after contributory negligence", fmt.money(net), { strong: true }));
    if (n(d.interimPayments)) rows.push(row("Less interim payments", fmt.money(-n(d.interimPayments))));
    rows.push(row("Likely track", track(d, matter.type, general, gross)));
    cards.push({ title: "Valuation", icon: "Calculator", rows, note: "General damages from the Judicial College Guidelines (or the whiplash tariff for OIC claims). CRU benefits are deducted from the matching heads of special damages." });

    if (d.cfaSigned || d.successFeePercent) {
      // A CFA success fee can't take more than 25% of general damages and past losses (net of CRU).
      const protectedPool = Math.max(0, (general + past) * (1 - cn / 100) - n(d.cruAmount));
      const cap = protectedPool * 0.25;
      const ate = n(d.atePremium);
      cards.push({
        title: "Client's deductions (CFA)", icon: "PoundSterling",
        rows: [
          row("Success fee", d.successFeePercent ? `${d.successFeePercent}% of base costs` : "—"),
          row("Most the success fee can take (25% of general + past losses)", fmt.money(cap), { strong: true }),
          row("ATE premium", fmt.money(ate)),
          row("Client receives at least", fmt.money(Math.max(0, net - cap - ate)), { strong: true }),
        ],
        note: "Worst case, before any shortfall in recovered costs agreed in the CFA. Future losses are protected from the success fee.",
      });
    }
  }
  return { cards, attention };
}

const specials = {
  key: "specials",
  title: "Special damages",
  singular: "loss",
  icon: "PoundSterling",
  intro: "The client's financial losses and expenses, past and future, with the evidence for each.",
  fields: [
    { key: "head", label: "Head of loss", kind: "select", required: true, options: ["Loss of earnings", "Care and assistance", "Medical / treatment", "Prescriptions", "Travel", "Vehicle repair / hire", "Damaged property", "Adaptations / equipment", "Other"] },
    { key: "description", label: "Details", kind: "text" },
    { key: "period", label: "Past / future", kind: "select", options: ["Past", "Future"], required: true },
    { key: "amount", label: "Amount (£)", kind: "money", required: true },
    { key: "evidence", label: "Evidence", kind: "text" },
    { key: "agreed", label: "Agreed by the other side", kind: "bool" },
  ],
  summary(items) {
    const sum = (f) => items.filter(f).reduce((t, i) => t + n(i.amount), 0);
    const total = sum(() => true);
    const noEvidence = items.filter((i) => !i.evidence).length;
    return {
      rows: [
        row("Past losses", fmt.money(sum((i) => i.period !== "Future"))),
        row("Future losses", fmt.money(sum((i) => i.period === "Future"))),
        row("Total", fmt.money(total), { strong: true }),
        row("Agreed", fmt.money(sum((i) => i.agreed))),
        row("Without evidence", String(noEvidence), { warn: noEvidence > 0 }),
      ],
    };
  },
};

module.exports = { details, lists: [specials, offersList()], insights, limitation, liabilityDue, ROUTES };
