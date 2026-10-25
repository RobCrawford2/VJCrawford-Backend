/**
 * Corporate & commercial: share deals, company formations, commercial
 * contracts and shareholders' agreements.
 */
const { addDays, addMonths, addYears, daysBetween, ukToday } = require("../../utils/workingDays");
const fmt = require("../../utils/format");
const { n, row } = require("./shared");

const SALE = "Share sale";
const PURCHASE = "Share purchase";
const FORMATION = "Company formation";
const CONTRACT = "Commercial contract";
const SHA = "Shareholders' agreement";
const OTHER = "Other corporate";
const DEALS = [SALE, PURCHASE];

const DEAL_FIELDS = [
  { key: "weAct", label: "We act for", kind: "select", options: ["Buyer", "Seller"] },
  { key: "otherParty", label: "Counterparty", kind: "text" },
  { key: "targetCompany", label: "Target company", kind: "text" },
  { key: "companyNumber", label: "Company number", kind: "text" },
  { key: "consideration", label: "Consideration at completion (£)", kind: "money" },
  { key: "deferredConsideration", label: "Deferred / earn-out consideration (£)", kind: "money" },
  { key: "headsAgreed", label: "Heads of terms agreed", kind: "date" },
  { key: "exchangeDate", label: "Exchange (signing)", kind: "date" },
  { key: "completionDate", label: "Completion", kind: "date" },
  { key: "longstopDate", label: "Longstop date", kind: "date" },
  { key: "warrantyMonths", label: "Warranty claims period (months)", kind: "number" },
  { key: "taxCovenantYears", label: "Tax covenant claims period (years)", kind: "number" },
  { key: "wiInsurance", label: "Warranty & indemnity insurance", kind: "bool" },
  { key: "nsiNotifiable", label: "Mandatory NSI Act notification needed", kind: "bool" },
  { key: "nsiApproved", label: "NSI clearance received", kind: "date" },
  { key: "stampDutyPaid", label: "Stamp duty paid / stock transfer form stamped", kind: "date" },
  { key: "filingsDone", label: "Companies House filings made", kind: "date" },
];

const details = {
  [SALE]: DEAL_FIELDS,
  [PURCHASE]: DEAL_FIELDS,
  [FORMATION]: [
    { key: "proposedName", label: "Company name", kind: "text" },
    { key: "companyType", label: "Type", kind: "select", options: ["Private limited by shares", "Private limited by guarantee", "LLP", "Public limited company"] },
    { key: "sicCode", label: "SIC code(s)", kind: "text" },
    { key: "directors", label: "Directors / members", kind: "text" },
    { key: "shareholders", label: "Shareholders and shares", kind: "text" },
    { key: "articles", label: "Articles", kind: "select", options: ["Model articles", "Bespoke articles"] },
    { key: "incorporationDate", label: "Incorporated", kind: "date" },
    { key: "companyNumber", label: "Company number", kind: "text" },
    { key: "startedTrading", label: "Started trading", kind: "date" },
  ],
  [CONTRACT]: [
    { key: "otherParty", label: "Counterparty", kind: "text" },
    { key: "contractType", label: "Kind of contract", kind: "select", options: ["Supply of goods", "Services", "Distribution / agency", "Licence", "NDA", "Terms and conditions", "Other"] },
    { key: "contractValue", label: "Value (£)", kind: "money" },
    { key: "signedOn", label: "Signed", kind: "date" },
    { key: "startDate", label: "Starts", kind: "date" },
    { key: "renewalDate", label: "Ends / renews on", kind: "date" },
    { key: "noticeDays", label: "Notice to terminate / prevent renewal (days)", kind: "number" },
    { key: "governingLaw", label: "Governing law", kind: "text" },
  ],
  [SHA]: [
    { key: "targetCompany", label: "Company", kind: "text" },
    { key: "companyNumber", label: "Company number", kind: "text" },
    { key: "shareholders", label: "Shareholders", kind: "text" },
    { key: "articlesUpdated", label: "Articles updated to match", kind: "bool" },
    { key: "signedOn", label: "Signed", kind: "date" },
  ],
  [OTHER]: [
    { key: "otherParty", label: "Other party", kind: "text" },
    { key: "targetCompany", label: "Company", kind: "text" },
    { key: "companyNumber", label: "Company number", kind: "text" },
    { key: "completionDate", label: "Completion / signing", kind: "date" },
  ],
};

/** Stamp duty on a transfer of shares: 0.5%, rounded up to the next £5; nothing if the consideration is £1,000 or less. */
function shareStampDuty(consideration) {
  const c = n(consideration);
  if (c <= 1000) return 0;
  return Math.ceil((c * 0.005) / 5) * 5;
}

function insights(matter, lists) {
  const d = matter.details || {};
  const today = ukToday();
  const cards = [];
  const attention = [];

  if (DEALS.includes(matter.type)) {
    const total = n(d.consideration) + n(d.deferredConsideration);
    if (total) {
      const duty = shareStampDuty(total);
      const rows = [row("Total consideration", fmt.money(total)), row("Stamp duty (0.5%, rounded up to £5)", duty ? fmt.money(duty) : "None (£1,000 or less)", { strong: true })];
      if (d.completionDate && duty) {
        const due = addDays(d.completionDate, 30);
        const left = daysBetween(today, due);
        rows.push(row("Stamp the transfer within 30 days", d.stampDutyPaid ? `paid ${fmt.date(d.stampDutyPaid)}` : `${fmt.date(due)} (${fmt.relative(left)})`, { warn: !d.stampDutyPaid && left <= 7 }));
        if (!d.stampDutyPaid && d.weAct !== "Seller" && left <= 7) attention.push(left < 0 ? `Stamp duty was due ${fmt.date(due)} — interest and penalties run` : `Stamp duty due ${fmt.date(due)} (${fmt.relative(left)})`);
      }
      cards.push({ title: "Stamp duty", icon: "Calculator", rows, note: "Deferred and contingent consideration count. HMRC's online service for stamping stock transfer forms; the buyer pays." });
    }
    const rows = [];
    if (d.longstopDate && !d.completionDate) {
      const left = daysBetween(today, d.longstopDate);
      rows.push(row("Longstop date", `${fmt.date(d.longstopDate)} (${fmt.relative(left)})`, { strong: true, warn: left <= 14 }));
      if (left <= 14) attention.push(left < 0 ? `Longstop date (${fmt.date(d.longstopDate)}) has passed without completion — either side may be able to terminate` : `Longstop date ${fmt.date(d.longstopDate)} (${fmt.relative(left)}) — conditions still outstanding?`);
    }
    if (d.completionDate) {
      rows.push(row("Completed", fmt.date(d.completionDate)));
      if (d.warrantyMonths) rows.push(row(`Warranty claims must be notified by (${d.warrantyMonths} months)`, fmt.date(addMonths(d.completionDate, n(d.warrantyMonths))), { strong: true }));
      if (d.taxCovenantYears) rows.push(row(`Tax covenant claims by (${d.taxCovenantYears} years)`, fmt.date(addYears(d.completionDate, n(d.taxCovenantYears)))));
      const filingsBy = addDays(d.completionDate, 14);
      rows.push(row("Companies House: officer and PSC changes (14 days)", d.filingsDone ? `filed ${fmt.date(d.filingsDone)}` : fmt.date(filingsBy), { warn: !d.filingsDone && daysBetween(today, filingsBy) < 0 }));
      if (!d.filingsDone && daysBetween(today, filingsBy) < 0) attention.push(`Companies House filings after completion were due by ${fmt.date(filingsBy)}`);
    }
    if (d.nsiNotifiable) {
      rows.push(row("NSI Act notification", d.nsiApproved ? `cleared ${fmt.date(d.nsiApproved)}` : "needed — the deal is void without clearance", { warn: !d.nsiApproved }));
      if (!d.nsiApproved && !d.completionDate) attention.push("Mandatory NSI Act notification: don't complete until clearance is received");
    }
    if (rows.length) cards.push({ title: "Deal timetable", icon: "Hourglass", rows });
  }

  if (matter.type === FORMATION && d.incorporationDate) {
    const rows = [
      row("Incorporated", fmt.date(d.incorporationDate)),
      row("First confirmation statement due", fmt.date(addDays(addYears(d.incorporationDate, 1), 14)), { strong: true }),
      row("First accounts due (21 months)", fmt.date(addMonths(d.incorporationDate, 21))),
    ];
    if (d.startedTrading) rows.push(row("Register for corporation tax (3 months from trading)", fmt.date(addMonths(d.startedTrading, 3))));
    cards.push({ title: "Company deadlines", icon: "Hourglass", rows, note: "Keep the statutory registers (members, directors, PSC) and issue share certificates within 2 months of allotment." });
  }

  if (matter.type === CONTRACT && d.renewalDate) {
    const rows = [row("Ends / renews", fmt.date(d.renewalDate))];
    if (d.noticeDays) {
      const by = addDays(d.renewalDate, -n(d.noticeDays));
      const left = daysBetween(today, by);
      rows.push(row(`Give notice by (${d.noticeDays} days before)`, `${fmt.date(by)} (${fmt.relative(left)})`, { strong: true, warn: left <= 30 }));
      if (left >= 0 && left <= 30) attention.push(`Notice to end or renegotiate the contract must be given by ${fmt.date(by)} (${fmt.relative(left)})`);
    }
    cards.push({ title: "Renewal", icon: "Hourglass", rows });
  }

  const checklist = lists.checklist || [];
  if (checklist.length) {
    const done = checklist.filter((i) => ["Signed", "Delivered / satisfied", "Not needed"].includes(i.status)).length;
    cards.push({ title: "Transaction checklist", icon: "ClipboardList", rows: [row("Complete", `${done} of ${checklist.length} (${Math.round((done / checklist.length) * 100)}%)`, { strong: true })] });
  }
  return { cards, attention };
}

const DONE = ["Signed", "Delivered / satisfied", "Not needed"];
const checklist = {
  key: "checklist",
  title: "Checklist",
  singular: "item",
  icon: "ClipboardList",
  intro: "Every condition, document and deliverable, who is responsible, and where it's got to — the completion agenda.",
  fields: [
    { key: "item", label: "Document / condition", kind: "text", required: true },
    { key: "category", label: "Category", kind: "select", options: ["Condition precedent", "Transaction document", "Ancillary document", "Board / shareholder approval", "Completion deliverable", "Post-completion"] },
    { key: "responsible", label: "Responsible", kind: "select", options: ["Us", "Other side", "Client", "Third party"] },
    { key: "status", label: "Status", kind: "select", options: ["Not started", "Drafting", "With other side", "Agreed", "Signed", "Delivered / satisfied", "Not needed"] },
    { key: "due", label: "Due", kind: "date" },
    { key: "notes", label: "Notes", kind: "text", table: false },
  ],
  summary(items) {
    const today = ukToday();
    const done = items.filter((i) => DONE.includes(i.status));
    const overdue = items.filter((i) => i.due && i.due < today && !DONE.includes(i.status));
    const ours = items.filter((i) => i.responsible === "Us" && !DONE.includes(i.status));
    return {
      rows: [
        row("Complete", `${done.length} of ${items.length}`, { strong: true }),
        row("Outstanding with us", String(ours.length)),
        row("With the other side", String(items.filter((i) => i.responsible === "Other side" && !DONE.includes(i.status)).length)),
        row("Overdue", String(overdue.length), { warn: overdue.length > 0 }),
      ],
      attention: overdue.filter((i) => i.responsible === "Us" || i.responsible === "Client").map((i) => `Checklist: “${i.item}” was due ${fmt.date(i.due)}`),
    };
  },
};

const dueDiligence = {
  key: "dd",
  title: "Due diligence",
  singular: "issue",
  icon: "Scale",
  types: [SALE, PURCHASE, OTHER],
  intro: "Issues found in due diligence, rated red / amber / green, and how each is being dealt with in the deal.",
  fields: [
    { key: "area", label: "Area", kind: "select", required: true, options: ["Corporate", "Commercial contracts", "Employment", "Property", "IP", "IT & data protection", "Litigation", "Tax", "Finance", "Regulatory", "Other"] },
    { key: "issue", label: "Issue", kind: "text", required: true },
    { key: "risk", label: "Risk", kind: "select", options: ["Red", "Amber", "Green"], required: true },
    { key: "protection", label: "How dealt with", kind: "select", options: ["Price reduction", "Specific indemnity", "Warranty", "Condition precedent", "Further enquiry", "Accept"] },
    { key: "status", label: "Status", kind: "select", options: ["Open", "Resolved"] },
  ],
  summary(items) {
    const open = items.filter((i) => i.status !== "Resolved");
    const reds = open.filter((i) => i.risk === "Red");
    return {
      rows: [
        row("Red (open)", String(reds.length), { warn: reds.length > 0, strong: true }),
        row("Amber (open)", String(open.filter((i) => i.risk === "Amber").length)),
        row("Green", String(items.filter((i) => i.risk === "Green").length)),
        row("Resolved", String(items.length - open.length)),
      ],
      note: "The Word export is the basis of the due diligence report.",
      attention: reds.length ? [`${reds.length} red due diligence issue${reds.length === 1 ? "" : "s"} still open`] : [],
    };
  },
};

module.exports = { details, lists: [checklist, dueDiligence], insights, shareStampDuty };
