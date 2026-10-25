/**
 * Litigation: civil disputes (contract, property, professional negligence…)
 * and debt recovery.
 */
const { addDays, addMonths, addYears, addBusinessDays, daysBetween, ukToday } = require("../../utils/workingDays");
const fmt = require("../../utils/format");
const { offersList, n, row } = require("./shared");

const PROF_NEG = "Professional negligence";
const DEBT = "Debt recovery";

/**
 * Court issue fees for money claims (EX50, from 13 July 2026): fixed fees
 * up to £10,000, then 5% up to £200,000, capped at £10,000. Check the
 * current EX50 — Money Claim Online is slightly cheaper for small claims.
 */
const ISSUE_FEES = [[300, 35], [500, 50], [1000, 70], [1500, 80], [3000, 115], [5000, 205], [10000, 455]];
function issueFee(value) {
  const v = n(value);
  if (v <= 0) return null;
  const band = ISSUE_FEES.find(([upTo]) => v <= upTo);
  if (band) return band[1];
  return Math.min(10000, Math.ceil(v * 0.05 * 100) / 100);
}

/** Track by value (CPR 26, from 1 October 2023). */
function trackFor(value) {
  const v = n(value);
  if (v <= 10000) return "Small claims track (up to £10,000)";
  if (v <= 25000) return "Fast track (£10,000–£25,000)";
  if (v <= 100000) return "Intermediate track (£25,000–£100,000, fixed costs)";
  return "Multi-track (over £100,000)";
}

const details = Object.fromEntries(["Contract / debt dispute", "Property dispute", PROF_NEG, "Other dispute", DEBT].map((type) => [type, [
  { key: "weAct", label: "We act for", kind: "select", options: ["Claimant", "Defendant"] },
  { key: "otherParty", label: "Other party", kind: "text" },
  ...(type === DEBT ? [
    { key: "debtorType", label: "Debtor", kind: "select", options: ["Business", "Individual / sole trader"] },
    { key: "invoiceDue", label: "Debt fell due", kind: "date" },
  ] : []),
  { key: "claimValue", label: "Value of the claim (£)", kind: "money" },
  { key: "causeOfAction", label: type === DEBT ? "Date the debt fell due (cause of action)" : "Date of breach / damage (cause of action)", kind: "date" },
  ...(type === PROF_NEG ? [{ key: "dateOfKnowledge", label: "Date of knowledge (latent damage)", kind: "date" }] : []),
  { key: "letterBeforeClaim", label: "Letter before claim sent / received", kind: "date" },
  { key: "claimIssued", label: "Claim issued", kind: "date" },
  { key: "claimNumber", label: "Claim number", kind: "text" },
  { key: "court", label: "Court", kind: "text" },
  { key: "claimFormServed", label: "Claim form served — step taken (posted, emailed…)", kind: "date" },
  { key: "particularsServed", label: "Particulars of claim deemed served", kind: "date" },
  { key: "aosFiled", label: "Acknowledgment of service filed", kind: "date" },
  { key: "defenceExtension", label: "Defence time extended (by agreement) to", kind: "date" },
  { key: "defenceFiled", label: "Defence filed", kind: "date" },
  { key: "track", label: "Allocated to", kind: "select", options: ["Small claims track", "Fast track", "Intermediate track", "Multi-track"] },
  { key: "cmcDate", label: "Case management conference", kind: "date" },
  { key: "trialDate", label: "Trial / trial window starts", kind: "date" },
  { key: "interestRate", label: "Interest rate claimed (% a year; 8% statutory)", kind: "percent" },
  { key: "interestFrom", label: "Interest runs from", kind: "date" },
  { key: "judgmentDate", label: "Judgment", kind: "date" },
  { key: "judgmentAmount", label: "Judgment sum (£)", kind: "money" },
  { key: "amountRecovered", label: "Recovered so far (£)", kind: "money" },
]]));

function limitation(matter, d) {
  if (!d.causeOfAction) return null;
  const six = addYears(d.causeOfAction, 6);
  if (matter.type !== PROF_NEG || !d.dateOfKnowledge) return { date: six, basis: "6 years from the cause of action (contract / tort)" };
  // Latent damage (Limitation Act s.14A/14B): 3 years from knowledge if later, but never beyond 15 years from the negligence.
  const latent = addYears(d.dateOfKnowledge, 3);
  const longStop = addYears(d.causeOfAction, 15);
  if (latent > six) return latent <= longStop
    ? { date: latent, basis: "3 years from the date of knowledge (latent damage)" }
    : { date: longStop, basis: "15-year long-stop from the negligence" };
  return { date: six, basis: "6 years from the cause of action" };
}

function insights(matter) {
  const d = matter.details || {};
  const today = ukToday();
  const cards = [];
  const attention = [];
  const claimant = d.weAct !== "Defendant";

  const lim = limitation(matter, d);
  if (lim) {
    const left = daysBetween(today, lim.date);
    cards.push({
      title: "Limitation", icon: "Hourglass",
      rows: [row("Limitation expires", `${fmt.date(lim.date)}${d.claimIssued ? ` — claim issued ${fmt.date(d.claimIssued)}` : ` (${fmt.relative(left)})`}`, { strong: true, warn: !d.claimIssued && left <= 90 }), row("Basis", lim.basis)],
      note: "A guide: check the right period for each cause of action (deeds 12 years; personal injury 3 years; defamation 1 year; contribution 2 years).",
    });
    if (claimant && !d.claimIssued && left <= 90) attention.push(left < 0 ? `Limitation expired on ${fmt.date(lim.date)} — check urgently` : `Limitation expires ${fmt.date(lim.date)} (${fmt.relative(left)}) — issue protectively if not settled`);
  }

  if (d.letterBeforeClaim && !d.claimIssued) {
    let rows;
    if (matter.type === DEBT && d.debtorType === "Individual / sole trader") rows = [row("Debtor must respond by (Debt PAP: 30 days)", fmt.date(addDays(d.letterBeforeClaim, 30)), { strong: true })];
    else if (matter.type === PROF_NEG) rows = [row("Acknowledgment due (21 days)", fmt.date(addDays(d.letterBeforeClaim, 21))), row("Letter of response due (3 months)", fmt.date(addMonths(d.letterBeforeClaim, 3)), { strong: true })];
    else rows = [row("Response due (14 days — up to 3 months if complex)", fmt.date(addDays(d.letterBeforeClaim, 14)), { strong: true })];
    cards.push({ title: "Pre-action", icon: "Hourglass", rows, note: "Don't issue until the protocol period has passed unless limitation or urgency requires it." });
  }

  if (d.claimIssued) {
    const rows = [row("Claim issued", fmt.date(d.claimIssued))];
    const serveBy = addMonths(d.claimIssued, 4);
    if (!d.claimFormServed) {
      const left = daysBetween(today, serveBy);
      rows.push(row("Serve the claim form by (4 months)", `${fmt.date(serveBy)} (${fmt.relative(left)})`, { strong: true, warn: left <= 21 }));
      if (claimant && left <= 21) attention.push(left < 0 ? `Claim form wasn't served within 4 months of issue (${fmt.date(serveBy)})` : `Serve the claim form by ${fmt.date(serveBy)} (${fmt.relative(left)})`);
    } else {
      rows.push(row("Claim form deemed served (2nd business day after the step)", fmt.date(addBusinessDays(d.claimFormServed, 2))));
    }
    if (d.particularsServed) {
      const aosDue = addDays(d.particularsServed, 14);
      const defenceDue = d.defenceExtension || addDays(d.particularsServed, d.aosFiled ? 28 : 14);
      rows.push(row("Acknowledgment of service due", d.aosFiled ? `filed ${fmt.date(d.aosFiled)}` : fmt.date(aosDue)));
      const left = daysBetween(today, defenceDue);
      rows.push(row(`Defence due${d.defenceExtension ? " (extended)" : d.aosFiled ? " (28 days)" : " (14 days)"}`, d.defenceFiled ? `filed ${fmt.date(d.defenceFiled)}` : `${fmt.date(defenceDue)} (${fmt.relative(left)})`, { strong: true, warn: !d.defenceFiled && left <= 7 }));
      if (!d.defenceFiled) {
        if (!claimant && left <= 7) attention.push(left < 0 ? `Defence was due ${fmt.date(defenceDue)} — risk of default judgment; file now / apply` : `Defence due ${fmt.date(defenceDue)} (${fmt.relative(left)})`);
        if (claimant && left < 0) attention.push(`No defence by ${fmt.date(defenceDue)} — default judgment can be requested`);
      }
    }
    cards.push({ title: "Proceedings", icon: "Gavel", rows, note: "Deemed service under CPR 6.14 and 6.26 (business days exclude weekends and bank holidays). An extension by agreement can't exceed 28 days." });
  }

  if (d.claimValue) {
    const fee = issueFee(d.claimValue);
    const rows = [row("Claim value", fmt.money(d.claimValue)), row("Likely track", trackFor(d.claimValue)), row("Court issue fee (EX50)", fee === null ? "—" : fmt.money(fee))];
    if (d.interestFrom) {
      const rate = d.interestRate === undefined ? 8 : n(d.interestRate);
      const until = d.judgmentDate || today;
      const days = Math.max(0, daysBetween(d.interestFrom, until));
      const daily = (n(d.claimValue) * rate) / 100 / 365;
      rows.push(row(`Interest at ${rate}% (${days} days to ${d.judgmentDate ? "judgment" : "today"})`, fmt.money(daily * days)), row("Daily rate", fmt.money(daily)));
    }
    cards.push({ title: "Value", icon: "Calculator", rows, note: "Fees from the July 2026 EX50 — check before issuing. Interest under s.69 County Courts Act is discretionary; contractual or late-payment interest may be higher." });
  }

  if (d.judgmentDate && d.judgmentAmount) {
    const outstanding = n(d.judgmentAmount) - n(d.amountRecovered);
    const rows = [row("Judgment sum", fmt.money(d.judgmentAmount)), row("Recovered", fmt.money(d.amountRecovered)), row("Outstanding", fmt.money(outstanding), { strong: true })];
    if (n(d.judgmentAmount) >= 5000) rows.push(row("Judgment interest at 8% (county court, £5,000+)", `${fmt.money((outstanding * 0.08) / 365)} a day`));
    cards.push({ title: "Judgment & enforcement", icon: "Scale", rows, note: "Options: writ / warrant of control, attachment of earnings, third party debt order, charging order; order to obtain information first if assets are unclear." });
  }
  return { cards, attention };
}

const chronology = {
  key: "chronology",
  title: "Chronology",
  singular: "event",
  icon: "ListOrdered",
  intro: "The key events in date order, with where the evidence is — exported to Word for counsel, the court bundle or the client.",
  fields: [
    { key: "date", label: "Date", kind: "date", required: true },
    { key: "event", label: "What happened", kind: "text", required: true },
    { key: "source", label: "Document / evidence", kind: "text" },
    { key: "disputed", label: "Disputed", kind: "bool" },
  ],
  summary(items) {
    const dated = items.filter((i) => i.date).map((i) => i.date).sort();
    return {
      rows: [row("Events", String(items.length)), row("From", dated.length ? fmt.date(dated[0]) : "—"), row("To", dated.length ? fmt.date(dated.at(-1)) : "—"), row("Disputed", String(items.filter((i) => i.disputed).length))],
      note: "The Word export lists events in the order shown — enter them in date order.",
    };
  },
};

const witnesses = {
  key: "witnesses",
  title: "Witnesses & experts",
  singular: "witness",
  icon: "ClipboardList",
  fields: [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "role", label: "Role", kind: "select", options: ["Witness of fact", "Expert (ours)", "Expert (single joint)", "Expert (other side)", "Other side's witness"], required: true },
    { key: "evidence", label: "What they can say / expertise", kind: "text" },
    { key: "contact", label: "Contact details", kind: "text", table: false },
    { key: "status", label: "Statement / report", kind: "select", options: ["To approach", "Proof taken", "Draft sent", "Signed", "Served", "Not using"] },
    { key: "due", label: "Due", kind: "date" },
  ],
  summary(items) {
    const today = ukToday();
    const late = items.filter((i) => i.due && i.due < today && !["Signed", "Served", "Not using"].includes(i.status));
    return {
      rows: [row("Witnesses of fact", String(items.filter((i) => i.role === "Witness of fact").length)), row("Experts", String(items.filter((i) => String(i.role).startsWith("Expert")).length)), row("Overdue", String(late.length), { warn: late.length > 0 })],
      attention: late.map((i) => `Statement / report from ${i.name} was due ${fmt.date(i.due)}`),
    };
  },
};

module.exports = {
  details,
  lists: [offersList(), chronology, witnesses],
  insights,
  issueFee, trackFor, limitation,
};
