/**
 * Family calculations that run on screen.
 *
 * Child maintenance: the Child Maintenance Service's 2012 scheme, from the
 * paying parent's gross weekly income. A guide for advising the client —
 * the CMS's own calculation (from HMRC figures, with any variations) is
 * what counts.
 */

const FLAT_RATE = 7;
const MAX_WEEKLY_INCOME = 3000;
// Gross income is first reduced by these % for other children the paying parent supports (1, 2, 3+).
const OTHER_CHILD_REDUCTION = [0, 11, 14, 16];
// Basic rate on the first £800 / basic-plus rate above, by number of qualifying children (1, 2, 3+).
const BASIC = [12, 16, 19];
const BASIC_PLUS = [9, 12, 15];
// Reduced rate (£100.01–£199.99): £7 plus this % of income over £100, by [other children 0–3+][qualifying 1–3+].
const REDUCED = [[17, 25, 31], [14.1, 21.2, 26.4], [13.2, 19.9, 24.9], [12.4, 18.9, 23.8]];

const clampIndex = (n, max) => Math.max(0, Math.min(max, Math.floor(n)));

/** Shared care: the fraction taken off for the nights a year the children stay with the paying parent. */
function sharedCareFraction(nights) {
  if (nights >= 175) return 1 / 2;
  if (nights >= 156) return 3 / 7;
  if (nights >= 104) return 2 / 7;
  if (nights >= 52) return 1 / 7;
  return 0;
}

/**
 * { grossWeekly, children (qualifying, ≥1), otherChildren, nights (per year with the paying parent), onBenefits }
 * → { weekly, monthly, annual, rate, steps: [text] }
 */
export function childMaintenance({ grossWeekly, children, otherChildren = 0, nights = 0, onBenefits = false }) {
  const kids = clampIndex(children, 99);
  if (kids < 1) return { weekly: 0, monthly: 0, annual: 0, rate: "No qualifying children", steps: [] };
  const q = clampIndex(kids, 3) - 1; // 0,1,2 → 1, 2, 3+ children
  const o = clampIndex(otherChildren, 3);
  const income = Math.max(0, Number(grossWeekly) || 0);
  const steps = [];
  let weekly;
  let rate;

  if (onBenefits || (income >= 7 && income <= 100)) {
    rate = "Flat rate";
    weekly = nights >= 52 ? 0 : FLAT_RATE;
    steps.push(onBenefits ? "Paying parent receives a qualifying benefit: flat rate £7 a week." : "Income £100 a week or less: flat rate £7 a week.");
    if (nights >= 52) steps.push("Shared care of 52+ nights a year reduces the flat rate to nil.");
    return finish(weekly, rate, steps);
  }
  if (income < 7) return finish(0, "Nil rate", ["Income under £7 a week: nil rate."]);

  if (income < 200) {
    rate = "Reduced rate";
    weekly = FLAT_RATE + ((income - 100) * REDUCED[o][q]) / 100;
    steps.push(`Reduced rate: £7 + ${REDUCED[o][q]}% of income over £100 = £${weekly.toFixed(2)}.`);
  } else {
    const capped = Math.min(income, MAX_WEEKLY_INCOME);
    if (income > MAX_WEEKLY_INCOME) steps.push(`Income over £${MAX_WEEKLY_INCOME} a week is ignored (the court can order top-up maintenance).`);
    const reduced = capped * (1 - OTHER_CHILD_REDUCTION[o] / 100);
    if (o) steps.push(`Less ${OTHER_CHILD_REDUCTION[o]}% for ${o === 3 ? "3 or more" : o} other child${o === 1 ? "" : "ren"} supported: £${reduced.toFixed(2)} a week.`);
    const first = Math.min(reduced, 800);
    const rest = Math.max(0, reduced - 800);
    weekly = (first * BASIC[q]) / 100 + (rest * BASIC_PLUS[q]) / 100;
    rate = rest > 0 ? "Basic plus rate" : "Basic rate";
    steps.push(`${BASIC[q]}% of the first £${first.toFixed(2)}${rest > 0 ? ` + ${BASIC_PLUS[q]}% of the remaining £${rest.toFixed(2)}` : ""} = £${weekly.toFixed(2)} a week.`);
  }

  const share = sharedCareFraction(nights);
  if (share) {
    const before = weekly;
    weekly *= 1 - share;
    steps.push(`Shared care (${nights} nights a year): less ${share === 0.5 ? "one half" : `${Math.round(share * 7)}/7`} = £${weekly.toFixed(2)}.`);
    if (share === 0.5) {
      weekly = Math.max(0, weekly - 7 * kids);
      steps.push(`Equal-ish care (175+ nights): a further £7 off per child = £${weekly.toFixed(2)}.`);
    }
    // Never below the flat rate after a shared-care reduction.
    if (weekly < FLAT_RATE && before >= FLAT_RATE) {
      weekly = FLAT_RATE;
      steps.push("Never less than the £7 flat rate.");
    }
  }
  return finish(weekly, rate, steps);
}

function finish(weekly, rate, steps) {
  const w = Math.round(weekly * 100) / 100;
  return { weekly: w, monthly: Math.round(((w * 52) / 12) * 100) / 100, annual: Math.round(w * 52 * 100) / 100, rate, steps };
}

// ---- Dates ----

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso, months) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

/** Key divorce dates (no-fault divorce): when each step can first be taken. */
export function divorceDates(d = {}) {
  const out = {};
  if (d.applicationIssued) out.conditionalOrderFrom = addDays(d.applicationIssued, 20 * 7);
  if (d.conditionalOrderPronounced) {
    out.finalOrderFrom = addDays(d.conditionalOrderPronounced, 6 * 7 + 1);
    // If the applicant doesn't apply, the respondent can 3 months after that.
    out.respondentFinalOrderFrom = addMonths(out.finalOrderFrom, 3);
    // After 12 months from the conditional order, an explanation for the delay is needed.
    out.delayExplanationAfter = addMonths(d.conditionalOrderPronounced, 12);
  }
  return out;
}

export const daysBetween = (fromIso, toIso) => Math.round((new Date(`${toIso}T12:00:00Z`) - new Date(`${fromIso}T12:00:00Z`)) / 86400000);

/** Age in whole years on a date. */
export function ageOn(dob, onIso) {
  if (!dob) return null;
  const b = new Date(`${String(dob).slice(0, 10)}T12:00:00Z`);
  const t = new Date(`${onIso}T12:00:00Z`);
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Needs attention" items for family matters (from their details). */
export function familyAttention(matter, today) {
  const d = matter.details;
  if (!d) return [];
  const reasons = [];
  if (matter.type === "Injunction / domestic abuse") {
    if (d.orderMade && !d.servedOnRespondent) reasons.push("Injunction order not yet recorded as served on the respondent — it can't be enforced until served");
    if (d.orderExpires) {
      const left = daysBetween(today, d.orderExpires);
      if (left < 0) reasons.push(`Injunction order expired on ${fmt(d.orderExpires)}`);
      else if (left <= 28) reasons.push(`Injunction order expires in ${left} day${left === 1 ? "" : "s"} (${fmt(d.orderExpires)}) — consider applying to extend it`);
    }
  }
  if (matter.type === "Divorce") {
    const k = divorceDates(d);
    if (k.conditionalOrderFrom && !d.conditionalOrderApplied && today >= k.conditionalOrderFrom) {
      reasons.push(`Conditional order can be applied for (20 weeks passed on ${fmt(k.conditionalOrderFrom)})`);
    }
    if (k.finalOrderFrom && !d.finalOrderApplied && today >= k.finalOrderFrom) {
      reasons.push(d.financialOrderInPlace
        ? `Final order can be applied for (from ${fmt(k.finalOrderFrom)})`
        : `Final order can be applied for — but no financial order or advice is recorded; check finances and pensions before applying`);
    }
  }
  return reasons;
}
