/**
 * Family: the details recorded on each type of matter, and the financial
 * remedy asset schedule (who owns what now, and who gets what under the
 * proposal).
 */

const DIVORCE = "Divorce";
const FINANCES = "Financial settlement";
const CHILDREN = "Children";
const INJUNCTION = "Injunction / domestic abuse";

// On every family matter.
const COMMON = [
  { key: "otherParty", label: "Other party", kind: "text" },
  { key: "court", label: "Court", kind: "text" },
  { key: "caseNumber", label: "Case number", kind: "text" },
  { key: "confidentialAddress", label: "Client's address and contact details are confidential — never disclose", kind: "bool" },
];

const DETAIL_FIELDS = {
  [DIVORCE]: [
    { key: "weAct", label: "We act for", kind: "select", options: ["Applicant", "Respondent", "Joint applicants"] },
    { key: "applicationType", label: "Application", kind: "select", options: ["Divorce", "Dissolution of civil partnership", "Judicial separation", "Nullity"] },
    { key: "dateOfMarriage", label: "Date of marriage / civil partnership", kind: "date" },
    { key: "placeOfMarriage", label: "Place of marriage", kind: "text" },
    { key: "dateOfSeparation", label: "Date of separation", kind: "date" },
    { key: "applicationIssued", label: "Application issued", kind: "date" },
    { key: "acknowledgmentFiled", label: "Acknowledgment of service filed", kind: "date" },
    { key: "conditionalOrderApplied", label: "Conditional order applied for", kind: "date" },
    { key: "conditionalOrderPronounced", label: "Conditional order pronounced", kind: "date" },
    { key: "finalOrderApplied", label: "Final order applied for", kind: "date" },
    { key: "finalOrderMade", label: "Final order made", kind: "date" },
    { key: "financialOrderInPlace", label: "Financial order made, or advice given on finances and pensions before the final order", kind: "bool" },
    ...COMMON,
  ],
  [FINANCES]: [
    { key: "miam", label: "MIAM", kind: "select", options: ["MIAM attended", "Exemption — domestic abuse", "Exemption — urgency", "Exemption — other", "Not needed (consent order)"] },
    { key: "formAIssued", label: "Form A issued", kind: "date" },
    { key: "formEExchanged", label: "Form E exchanged", kind: "date" },
    { key: "firstAppointment", label: "First appointment", kind: "date" },
    { key: "fdrDate", label: "FDR appointment", kind: "date" },
    { key: "finalHearing", label: "Final hearing", kind: "date" },
    { key: "consentOrderSealed", label: "Order sealed", kind: "date" },
    { key: "pensionSharing", label: "Pension sharing order", kind: "bool" },
    { key: "spousalMaintenance", label: "Spousal maintenance", kind: "select", options: ["Clean break", "Nominal", "Term-limited", "Joint lives"] },
    ...COMMON,
  ],
  [CHILDREN]: [
    { key: "miam", label: "MIAM", kind: "select", options: ["MIAM attended", "Exemption — domestic abuse", "Exemption — urgency", "Exemption — other"] },
    { key: "c100Issued", label: "C100 application issued", kind: "date" },
    { key: "cafcassLetter", label: "Cafcass safeguarding letter received", kind: "date" },
    { key: "fhdraDate", label: "First hearing (FHDRA)", kind: "date" },
    { key: "section7Due", label: "Section 7 report due", kind: "date" },
    { key: "draDate", label: "Dispute resolution appointment", kind: "date" },
    { key: "finalHearing", label: "Final hearing", kind: "date" },
    { key: "orderMade", label: "Order made", kind: "select", options: ["Child arrangements — lives with", "Child arrangements — spends time with", "Specific issue", "Prohibited steps", "Consent order", "No order"] },
    { key: "orderDate", label: "Date of order", kind: "date" },
    ...COMMON,
  ],
  [INJUNCTION]: [
    { key: "orderType", label: "Order sought", kind: "select", options: ["Non-molestation order", "Occupation order", "Both"] },
    { key: "withoutNotice", label: "Applied for without notice", kind: "bool" },
    { key: "applicationIssued", label: "Application (FL401) issued", kind: "date" },
    { key: "orderMade", label: "Order made", kind: "date" },
    { key: "orderExpires", label: "Order expires", kind: "date" },
    { key: "powerOfArrest", label: "Power of arrest attached (occupation order)", kind: "bool" },
    { key: "servedOnRespondent", label: "Served on the respondent", kind: "date" },
    { key: "policeNotified", label: "Copy sent to the police", kind: "bool" },
    { key: "returnHearing", label: "Return hearing", kind: "date" },
    ...COMMON,
  ],
};

// ---- Asset schedule (financial remedy) ----

const OWNERS = ["client", "other", "joint"];
const ITEM_KINDS = ["asset", "liability", "pension"];
const CATEGORIES = {
  asset: ["Family home", "Other property", "Bank / savings", "Investments / shares", "Business interest", "Vehicle", "Other asset"],
  liability: ["Mortgage", "Loan / credit card", "Tax", "Other debt"],
  pension: ["Defined benefit (final salary)", "Defined contribution", "State pension (additional)", "Other pension"],
};

const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

/** The client's share of an item under the proposal, %: as set, or by default the client's own 100%, joint 50%, other party's 0%. */
function proposedPercent(item) {
  if (item.proposed_client_percent !== null && item.proposed_client_percent !== undefined && item.proposed_client_percent !== "") return n(item.proposed_client_percent);
  return item.owner === "client" ? 100 : item.owner === "joint" ? 50 : 0;
}
const currentPercent = (item) => (item.owner === "client" ? 100 : item.owner === "joint" ? 50 : 0);

/**
 * Totals for the schedule: capital (assets less debts) and pensions (CETVs)
 * kept separate, as the court does — each with who has what now and under
 * the proposal.
 */
function assetSchedule(items) {
  const sign = (i) => (i.kind === "liability" ? -1 : 1);
  const group = (rows) => {
    const total = rows.reduce((s, i) => s + sign(i) * n(i.value), 0);
    const byOwner = Object.fromEntries(OWNERS.map((o) => [o, round2(rows.filter((i) => i.owner === o).reduce((s, i) => s + sign(i) * n(i.value), 0))]));
    const clientNow = rows.reduce((s, i) => s + (sign(i) * n(i.value) * currentPercent(i)) / 100, 0);
    const clientProposed = rows.reduce((s, i) => s + (sign(i) * n(i.value) * proposedPercent(i)) / 100, 0);
    const pct = (v) => (Math.abs(total) > 0.005 ? round2((v / total) * 100) : null);
    return {
      total: round2(total), byOwner,
      clientNow: round2(clientNow), otherNow: round2(total - clientNow), clientNowPercent: pct(clientNow),
      clientProposed: round2(clientProposed), otherProposed: round2(total - clientProposed), clientProposedPercent: pct(clientProposed),
    };
  };
  const capitalRows = items.filter((i) => i.kind !== "pension");
  const pensionRows = items.filter((i) => i.kind === "pension");
  const capital = group(capitalRows);
  const pensions = group(pensionRows);
  const all = group(items);
  return {
    capital, pensions, overall: all,
    // Value that has to move to the client (positive) or from them (negative) to reach the proposal.
    capitalTransferToClient: round2(capital.clientProposed - capital.clientNow),
    pensionShareToClient: round2(pensions.clientProposed - pensions.clientNow),
  };
}

module.exports = { DIVORCE, FINANCES, CHILDREN, INJUNCTION, DETAIL_FIELDS, OWNERS, ITEM_KINDS, CATEGORIES, assetSchedule, proposedPercent };
