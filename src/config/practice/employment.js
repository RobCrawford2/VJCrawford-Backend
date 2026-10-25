/**
 * Employment: tribunal claims (for employees or employers), settlement
 * agreements and advice.
 */
const { addDays, addMonths, daysBetween, ukToday, yearsBetween } = require("../../utils/workingDays");
const fmt = require("../../utils/format");
const { offersList, n, row } = require("./shared");

const FOR_EMPLOYEE = "Tribunal claim — for employee";
const FOR_EMPLOYER = "Tribunal claim — for employer";
const SETTLEMENT = "Settlement agreement";
const ADVICE = "Employment advice";
const CLAIMS = [FOR_EMPLOYEE, FOR_EMPLOYER];

/**
 * Statutory limits by the date they apply from (effective date of
 * termination). Add each April's figures from the Employment Rights
 * (Increase of Limits) Order.
 */
const LIMITS = [
  { from: "2025-04-06", weekPay: 719, compensatoryCap: 118223 },
  { from: "2026-04-06", weekPay: 751, compensatoryCap: 123543 },
];
const limitsOn = (iso) => LIMITS.filter((l) => l.from <= iso).at(-1) || LIMITS[0];

// The Employment Rights Act 2025 doubled most tribunal time limits for acts on or after 1 October 2026.
const SIX_MONTH_LIMIT_FROM = "2026-10-01";
// The first £30,000 of a termination payment (not notice pay or holiday pay) is free of income tax.
const TAX_FREE_TERMINATION = 30000;

const CLAIM_FIELDS = [
  { key: "otherParty", label: "Employer / claimant (other party)", kind: "text" },
  { key: "jobTitle", label: "Job title", kind: "text" },
  { key: "claims", label: "Claims (unfair dismissal, discrimination…)", kind: "text" },
  { key: "dateOfBirth", label: "Employee's date of birth", kind: "date" },
  { key: "startDate", label: "Employment started", kind: "date" },
  { key: "edt", label: "Effective date of termination", kind: "date" },
  { key: "dateOfAct", label: "Last act complained of (if not dismissal)", kind: "date" },
  { key: "grossWeeklyPay", label: "Gross weekly pay (£)", kind: "money" },
  { key: "netWeeklyPay", label: "Net weekly pay (£)", kind: "money" },
  { key: "acasDayA", label: "ACAS early conciliation started (Day A)", kind: "date" },
  { key: "acasDayB", label: "ACAS certificate issued (Day B)", kind: "date" },
  { key: "acasCertificate", label: "ACAS certificate number", kind: "text" },
  { key: "et1Presented", label: "ET1 claim presented", kind: "date" },
  { key: "claimSentToRespondent", label: "Claim sent to the employer by the tribunal", kind: "date" },
  { key: "et3Filed", label: "ET3 response filed", kind: "date" },
  { key: "tribunal", label: "Tribunal office", kind: "text" },
  { key: "caseNumber", label: "Case number", kind: "text" },
  { key: "hearingDate", label: "Final hearing", kind: "date" },
  { key: "hearingDays", label: "Hearing length (days)", kind: "number" },
  { key: "newJobStart", label: "New job started", kind: "date" },
  { key: "newWeeklyPay", label: "New job net weekly pay (£)", kind: "money" },
];

const details = {
  [FOR_EMPLOYEE]: CLAIM_FIELDS,
  [FOR_EMPLOYER]: CLAIM_FIELDS,
  [SETTLEMENT]: [
    { key: "otherParty", label: "Employer", kind: "text" },
    { key: "dateOfBirth", label: "Employee's date of birth", kind: "date" },
    { key: "startDate", label: "Employment started", kind: "date" },
    { key: "terminationDate", label: "Termination date", kind: "date" },
    { key: "grossWeeklyPay", label: "Gross weekly pay (£)", kind: "money" },
    { key: "noticePay", label: "Notice pay / PENP (£, taxable)", kind: "money" },
    { key: "holidayPay", label: "Accrued holiday pay (£, taxable)", kind: "money" },
    { key: "settlementPayment", label: "Compensation for loss of employment (£)", kind: "money" },
    { key: "legalFeesContribution", label: "Employer's contribution to legal fees (£ + VAT)", kind: "money" },
    { key: "receivedOn", label: "Agreement received", kind: "date" },
    { key: "signedOn", label: "Signed by the employee", kind: "date" },
    { key: "certificateSigned", label: "Adviser's certificate signed", kind: "bool" },
    { key: "paymentDue", label: "Payment due by", kind: "date" },
  ],
  [ADVICE]: [
    { key: "otherParty", label: "Employer / employee", kind: "text" },
    { key: "topic", label: "What the advice is about", kind: "text" },
    { key: "adviceSent", label: "Advice sent", kind: "date" },
  ],
};

/** Basic award / statutory redundancy: up to 20 complete years, counted back from the EDT, by age in each year. */
function basicAward(d) {
  if (!d.startDate || !d.edt || !d.dateOfBirth || !d.grossWeeklyPay) return null;
  const years = Math.min(20, Math.max(0, yearsBetween(d.startDate, d.edt)));
  const cap = limitsOn(d.edt).weekPay;
  const weekPay = Math.min(n(d.grossWeeklyPay), cap);
  let multiplier = 0;
  for (let y = 1; y <= years; y++) {
    const yearStart = addMonths(d.edt, -12 * y);
    const age = yearsBetween(d.dateOfBirth, yearStart);
    multiplier += age >= 41 ? 1.5 : age >= 22 ? 1 : 0.5;
  }
  return { years, cap, weekPay, multiplier, amount: Math.round(multiplier * weekPay * 100) / 100 };
}

/** Last day to present the claim, with the ACAS early conciliation extension. */
function timeLimit(d) {
  const base = d.edt || d.dateOfAct;
  if (!base) return null;
  const months = base >= SIX_MONTH_LIMIT_FROM ? 6 : 3;
  const primary = addDays(addMonths(base, months), -1);
  let last = primary;
  let lateAcas = false;
  if (d.acasDayA && d.acasDayA > primary) lateAcas = true;
  if (d.acasDayA && d.acasDayB) {
    if (lateAcas) { /* no extension */ }
    else {
      // The days from Day A to Day B don't count; and if the limit would end within a month of Day B, it's a month after Day B.
      const stopped = addDays(primary, daysBetween(d.acasDayA, d.acasDayB));
      const monthAfterB = addMonths(d.acasDayB, 1);
      last = stopped <= monthAfterB ? monthAfterB : stopped;
    }
  }
  return { base, months, primary, last, lateAcas };
}

function insights(matter) {
  const d = matter.details || {};
  const today = ukToday();
  const cards = [];
  const attention = [];

  if (CLAIMS.includes(matter.type)) {
    const t = timeLimit(d);
    if (t) {
      const left = daysBetween(today, t.last);
      const rows = [
        row(t.base === d.edt ? "Effective date of termination" : "Last act complained of", fmt.date(t.base)),
        row(`Primary limit (${t.months} months less a day)`, fmt.date(t.primary)),
      ];
      if (d.acasDayA && d.acasDayB && !t.lateAcas) rows.push(row(`ACAS early conciliation (${fmt.date(d.acasDayA)} – ${fmt.date(d.acasDayB)})`, "extends the limit"));
      if (d.acasDayA && !d.acasDayB) rows.push(row("ACAS early conciliation", `started ${fmt.date(d.acasDayA)} — limit extends once the certificate is issued`, { warn: d.acasDayA > t.primary }));
      rows.push(row("Last day to present the ET1", d.et1Presented ? `${fmt.date(t.last)} — presented ${fmt.date(d.et1Presented)}` : `${fmt.date(t.last)} (${fmt.relative(left)})`, { strong: true, warn: !d.et1Presented && left <= 21 }));
      const note = t.lateAcas
        ? "ACAS was contacted after the primary limit had already passed, so there is no extension — the claim is likely out of time unless the tribunal extends it."
        : !d.acasDayA ? "ACAS early conciliation must start before the primary limit to get the extension."
        : !d.acasDayB ? "Until the ACAS certificate is issued, work to the primary limit; add Day B when it arrives."
        : "Check each claim's own time limit (equal pay, redundancy pay and some others differ).";
      cards.push({ title: "Tribunal time limit", icon: "Hourglass", rows, note });
      if (!d.et1Presented && matter.type === FOR_EMPLOYEE) {
        if (t.lateAcas) attention.push("ACAS early conciliation started after the primary time limit — check whether the claim is in time");
        else if (left < 0) attention.push(`Time limit for the ET1 passed on ${fmt.date(t.last)}`);
        else if (left <= 21) attention.push(`ET1 must be presented by ${fmt.date(t.last)} (${fmt.relative(left)})`);
        if (!d.acasDayA && daysBetween(today, t.primary) <= 21) attention.push(`ACAS early conciliation not started — must begin before ${fmt.date(t.primary)}`);
      }
    }
    if (d.claimSentToRespondent) {
      const due = addDays(d.claimSentToRespondent, 28);
      const left = daysBetween(today, due);
      cards.push({ title: "Response (ET3)", icon: "Hourglass", rows: [row("ET3 due", d.et3Filed ? `${fmt.date(due)} — filed ${fmt.date(d.et3Filed)}` : `${fmt.date(due)} (${fmt.relative(left)})`, { strong: true, warn: !d.et3Filed && left <= 7 })] });
      if (!d.et3Filed && matter.type === FOR_EMPLOYER && left <= 14) attention.push(left < 0 ? `ET3 response was due on ${fmt.date(due)} — apply for an extension / reconsideration` : `ET3 response due ${fmt.date(due)} (${fmt.relative(left)})`);
    }
    const b = basicAward(d);
    if (b) {
      const limits = limitsOn(d.edt);
      const capWeeks = Math.round(n(d.grossWeeklyPay) * 52 * 100) / 100;
      const rows = [
        row("Complete years of service (max 20)", String(b.years)),
        row("Week's pay used", `${fmt.money(b.weekPay)}${n(d.grossWeeklyPay) > b.cap ? ` (capped at ${fmt.money(b.cap)})` : ""}`),
        row("Basic award (unfair dismissal)", fmt.money(b.amount), { strong: true }),
        row("Statutory redundancy pay", b.years >= 2 ? fmt.money(b.amount) : "Not due (under 2 years)"),
        row("Compensatory award cap", fmt.money(Math.min(capWeeks, limits.compensatoryCap)) + (capWeeks < limits.compensatoryCap ? " (52 weeks' pay)" : " (statutory cap)")),
      ];
      if (d.netWeeklyPay && d.edt) {
        const until = d.newJobStart && d.newJobStart < today ? d.newJobStart : today;
        const weeks = Math.max(0, daysBetween(d.edt, until) / 7);
        rows.push(row(`Loss of earnings to ${d.newJobStart && d.newJobStart < today ? "new job" : "today"} (${weeks.toFixed(1)} weeks)`, fmt.money(weeks * n(d.netWeeklyPay))));
        if (d.newJobStart && d.newWeeklyPay !== undefined && n(d.newWeeklyPay) < n(d.netWeeklyPay)) rows.push(row("Continuing weekly loss in new job", fmt.money(n(d.netWeeklyPay) - n(d.newWeeklyPay))));
      }
      cards.push({ title: "Awards", icon: "Calculator", rows, note: `Statutory limits for dismissals from ${fmt.date(limits.from)}. Discrimination and whistleblowing compensation is uncapped. Unfair dismissal needs 2 years' service (some automatic unfair dismissals don't).` });
    }
  }

  if (matter.type === SETTLEMENT) {
    const comp = n(d.settlementPayment);
    const taxable = Math.max(0, comp - TAX_FREE_TERMINATION);
    const rows = [
      row("Notice pay / PENP (taxed as earnings)", fmt.money(d.noticePay)),
      row("Holiday pay (taxed as earnings)", fmt.money(d.holidayPay)),
      row("Compensation for loss of employment", fmt.money(comp)),
      row("— tax-free (first £30,000)", fmt.money(Math.min(comp, TAX_FREE_TERMINATION))),
      row("— taxable above £30,000", fmt.money(taxable), { warn: taxable > 0 }),
      row("Total gross", fmt.money(n(d.noticePay) + n(d.holidayPay) + comp), { strong: true }),
      row("Legal fees contribution", d.legalFeesContribution ? `${fmt.money(d.legalFeesContribution)} + VAT` : "—"),
    ];
    const b = basicAward({ ...d, edt: d.terminationDate });
    if (b && b.years >= 2) rows.push(row("Statutory redundancy for comparison", fmt.money(b.amount)));
    cards.push({ title: "The settlement", icon: "Calculator", rows, note: "Check the employer's tax indemnity and that the agreement is signed by the employee and the adviser's certificate is completed." });
    if (d.signedOn && !d.certificateSigned) attention.push("Settlement agreement signed but the adviser's certificate isn't recorded as signed");
    if (d.paymentDue && daysBetween(today, d.paymentDue) < 0) attention.push(`Settlement payment was due by ${fmt.date(d.paymentDue)} — check it has been received`);
  }
  return { cards, attention };
}

const scheduleOfLoss = {
  key: "schedule",
  title: "Schedule of loss",
  singular: "item",
  icon: "ListOrdered",
  types: [FOR_EMPLOYEE, FOR_EMPLOYER],
  intro: "The claimant's losses, head by head. Mark anything that reduces the claim (earnings from a new job, payments already made) as a deduction.",
  fields: [
    { key: "head", label: "Head of loss", kind: "select", required: true, options: ["Basic award", "Loss of earnings to date", "Future loss of earnings", "Loss of statutory rights", "Pension loss", "Injury to feelings", "ACAS Code uplift", "Interest", "Other"] },
    { key: "description", label: "How it's worked out", kind: "text" },
    { key: "amount", label: "Amount (£)", kind: "money", required: true },
    { key: "deduction", label: "Deduction", kind: "bool" },
  ],
  summary(items) {
    const plus = items.filter((i) => !i.deduction).reduce((s, i) => s + n(i.amount), 0);
    const minus = items.filter((i) => i.deduction).reduce((s, i) => s + n(i.amount), 0);
    return { rows: [row("Total claimed", fmt.money(plus)), row("Less deductions", fmt.money(-minus)), row("Net claim", fmt.money(plus - minus), { strong: true })] };
  },
};

module.exports = {
  details,
  lists: [scheduleOfLoss, offersList({ types: CLAIMS, offerTypes: ["COT3 / ACAS", "Without prejudice", "Without prejudice save as to costs", "Open offer"] })],
  insights,
  basicAward, timeLimit, LIMITS,
};
