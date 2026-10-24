/**
 * The departments (areas of law) the system supports, with each one's
 * matter types and the stages a matter moves through.
 *
 * A matter stores its department, its type and the index of its current
 * stage, so the order of each `stages` list matters: add new stages only
 * before "Closed", and don't reorder existing ones once matters use them.
 * The last stage is always "Closed".
 *
 * Conveyancing is the original workflow. The other departments' stages are
 * a first version, to be refined as each area is built out (a type can
 * later have its own `stages` list overriding its department's).
 */

const CONVEYANCING_STAGES = [
  "Instructed", "ID & AML Checks", "Contract Pack", "Searches", "Enquiries",
  "Mortgage Offer", "Report on Title", "Pre-Exchange Review", "Exchange", "Completion",
  "Post-Completion", "Closed",
];

const AREAS = [
  {
    key: "conveyancing",
    name: "Conveyancing",
    prefix: "CV",
    types: ["Purchase", "Sale", "Remortgage"],
    stages: CONVEYANCING_STAGES,
  },
  {
    key: "private_client",
    name: "Wills, Trusts & Probate",
    prefix: "PC",
    types: ["Will", "Lasting power of attorney", "Probate / estate administration", "Trust", "Other private client"],
    stages: [
      "Instructed", "ID & AML Checks", "Information gathering", "Drafting / valuations",
      "Signing / tax & applications", "Grant or registration", "Administration & distribution", "Closed",
    ],
    // Each kind of private client work runs differently, so has its own stages
    // ("Other private client" uses the department's list above).
    typeStages: {
      Will: [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Instructions taken", "Family, assets, wishes, executors and guardians recorded; capacity considered"],
        ["Draft will sent", "Draft and explanation sent to the client"],
        ["Approved & signing arranged", "Client approved the draft; signing appointment booked"],
        ["Signed & witnessed", "Executed with two independent witnesses; attestation checked"],
        ["Stored", "Original in safe custody, copy and storage certificate to client"],
        ["Closed", "File closed"],
      ],
      "Lasting power of attorney": [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Instructions taken", "Type(s) of LPA, attorneys, replacements, how they act, people to notify"],
        ["Draft LPAs sent", "Drafts sent to the donor for approval"],
        ["Signed", "Donor, certificate provider and attorneys signed, in the right order"],
        ["Sent to OPG", "Application and fee sent to the Office of the Public Guardian"],
        ["Registered", "Registered LPA received; copies certified and sent"],
        ["Closed", "File closed"],
      ],
      "Probate / estate administration": [
        ["Instructed", "Client care letter and terms sent to the executors"],
        ["ID & AML Checks", "Executors' identity verified"],
        ["Assets & liabilities", "Asset holders notified of the death; date-of-death values requested"],
        ["IHT & valuations", "Estate valued; IHT reported (excepted estate or IHT400) and any tax paid"],
        ["Grant applied for", "Probate application submitted to HMCTS"],
        ["Grant received", "Grant of representation issued"],
        ["Collecting in & paying debts", "Assets realised or transferred; debts, funeral and tax paid; s.27 notices"],
        ["Estate accounts & distribution", "Estate accounts approved; legacies and residue paid"],
        ["Closed", "File closed"],
      ],
      Trust: [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Settlor and trustees' identity verified"],
        ["Instructions & advice", "Purpose, beneficiaries and tax consequences advised on"],
        ["Drafting trust deed", "Draft deed sent for approval"],
        ["Signed & set up", "Deed executed; assets transferred into the trust"],
        ["Registered (TRS)", "Registered on HMRC's Trust Registration Service"],
        ["Ongoing administration", "Trust accounts, returns and periodic charges"],
        ["Closed", "File closed"],
      ],
    },
  },
  {
    key: "family",
    name: "Family",
    prefix: "FAM",
    types: ["Divorce", "Financial settlement", "Children", "Injunction / domestic abuse", "Other family"],
    stages: [
      "Instructed", "ID & AML Checks", "Advice & strategy", "Application issued", "Disclosure & evidence",
      "Hearings / negotiation", "Agreement or order", "Final order", "Closed",
    ],
    typeStages: {
      Divorce: [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Application drafted", "Marriage certificate obtained; sole or joint application prepared"],
        ["Application issued", "Issued online; the 20-week period runs from here"],
        ["Served & acknowledged", "Served on the respondent; acknowledgment of service filed"],
        ["20-week waiting period", "Finances and arrangements for children dealt with in the meantime"],
        ["Conditional order", "Applied for after 20 weeks and pronounced"],
        ["Final order", "Applied for 6 weeks and 1 day after the conditional order (finances considered first)"],
        ["Closed", "File closed"],
      ],
      "Financial settlement": [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Advice & voluntary disclosure", "Advice given; financial information gathered and exchanged; mediation considered"],
        ["Form A / negotiation", "MIAM attended or exempt; Form A issued, or negotiations under way"],
        ["Form E exchange", "Form E and documents exchanged; questionnaires and statements of issues"],
        ["First appointment", "Directions given; valuations and experts"],
        ["FDR appointment", "Financial dispute resolution — settlement attempted"],
        ["Consent order / final hearing", "Order agreed and sealed, or decided at the final hearing"],
        ["Implementation", "Property transfers, lump sums, pension sharing implemented"],
        ["Closed", "File closed"],
      ],
      Children: [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Advice & MIAM", "Advice on arrangements; mediation (MIAM) attended or exemption"],
        ["C100 application issued", "Application issued; Cafcass notified"],
        ["First hearing (FHDRA)", "First hearing and dispute resolution appointment"],
        ["Safeguarding & reports", "Cafcass safeguarding letter; section 7 report; any fact-finding"],
        ["Dispute resolution appointment", "DRA — agreement attempted on the evidence"],
        ["Final hearing / order", "Order made by consent or after a final hearing"],
        ["Closed", "File closed"],
      ],
      "Injunction / domestic abuse": [
        ["Instructed", "Urgent instructions taken; safety plan considered"],
        ["ID & AML Checks", "Identity verified"],
        ["Statement & application", "Witness statement and FL401 drafted"],
        ["Issued / first hearing", "Issued; without-notice or on-notice hearing"],
        ["Order served", "Order personally served on the respondent; copy to the police"],
        ["Return hearing", "Return (on-notice) hearing"],
        ["Final order", "Order made or continued; expiry diarised"],
        ["Closed", "File closed"],
      ],
    },
  },
  {
    key: "employment",
    name: "Employment",
    prefix: "EMP",
    types: ["Tribunal claim — for employee", "Tribunal claim — for employer", "Settlement agreement", "Employment advice"],
    stages: [
      "Instructed", "ID & AML Checks", "Advice & ACAS conciliation", "Claim / response filed",
      "Case management & disclosure", "Witness statements", "Hearing / settlement", "Outcome", "Closed",
    ],
  },
  {
    key: "litigation",
    name: "Litigation",
    prefix: "LIT",
    types: ["Contract / debt dispute", "Property dispute", "Professional negligence", "Other dispute"],
    stages: [
      "Instructed", "ID & AML Checks", "Pre-action", "Claim issued & served", "Defence & directions",
      "Disclosure", "Witnesses & experts", "Trial / settlement", "Enforcement & costs", "Closed",
    ],
  },
  {
    key: "personal_injury",
    name: "Personal Injury",
    prefix: "PI",
    types: ["Road traffic accident", "Accident at work", "Public liability", "Clinical negligence", "Other injury"],
    stages: [
      "Instructed", "ID & AML Checks", "Letter of claim / Portal", "Liability decision", "Medical evidence",
      "Offers & negotiation", "Proceedings issued", "Settlement / trial", "Closed",
    ],
  },
  {
    key: "corporate",
    name: "Corporate & Commercial",
    prefix: "CC",
    types: ["Share sale", "Share purchase", "Company formation", "Commercial contract", "Shareholders' agreement", "Other corporate"],
    stages: [
      "Instructed", "ID & AML Checks", "Heads of terms / scoping", "Due diligence",
      "Drafting & negotiation", "Signing / completion", "Post-completion filings", "Closed",
    ],
  },
  {
    key: "crime",
    name: "Criminal",
    prefix: "CRI",
    types: ["Police station", "Magistrates' court", "Crown Court", "Appeal"],
    stages: [
      "Instructed", "ID & conflict checks", "Police station / investigation", "Charge & legal aid",
      "First hearing", "Case preparation", "Trial or sentence", "Appeal / outcome", "Closed",
    ],
  },
];

/**
 * Common deadlines per department, offered when adding to the diary. A
 * `rule` works the due date out from a starting date the user enters:
 * add years / months / weeks / days, then (endOfMonth) move to the last day
 * of that month. These are a guide — the fee earner checks the rules that
 * apply to the case (and, for limitation, the date of knowledge,
 * extensions and the like).
 */
const HEARING = { title: "Court / tribunal hearing", kind: "hearing", critical: true };
const DEADLINES = {
  conveyancing: [
    { title: "Completion", kind: "other", critical: true },
    { title: "Contract deadline from the other side", kind: "other" },
  ],
  private_client: [
    { title: "IHT payment due (end of the 6th month after death)", kind: "filing", critical: true, rule: { from: "Date of death", months: 6, endOfMonth: true } },
    { title: "IHT account (IHT400) due (12 months after the end of the month of death)", kind: "filing", critical: true, rule: { from: "Date of death", months: 12, endOfMonth: true } },
    { title: "Inheritance Act claim period ends (6 months after the grant)", kind: "limitation", critical: true, rule: { from: "Date of grant", months: 6 } },
    { title: "Section 27 notice period ends (2 months)", kind: "other", rule: { from: "Date notice published", months: 2 } },
    { title: "LPA registration follow-up", kind: "other", rule: { from: "Date sent to OPG", weeks: 20 } },
    { title: "Register the trust on HMRC's Trust Registration Service (90 days)", kind: "filing", critical: true, rule: { from: "Date trust created", days: 90 } },
    { title: "Trust 10-year anniversary (IHT periodic charge)", kind: "filing", rule: { from: "Date trust created", years: 10 } },
    { title: "Offer the client a will review", kind: "other", rule: { from: "Date will signed", years: 5 } },
    { title: "Deed of variation deadline (2 years after death)", kind: "limitation", rule: { from: "Date of death", years: 2 } },
  ],
  family: [
    { title: "Earliest conditional order application (20 weeks after issue)", kind: "court_deadline", rule: { from: "Date divorce issued", weeks: 20 } },
    { title: "Earliest final order application (6 weeks and 1 day after conditional order)", kind: "court_deadline", rule: { from: "Date of conditional order", weeks: 6, days: 1 } },
    { title: "Form E exchange", kind: "court_deadline", critical: true },
    { title: "First appointment", kind: "hearing", critical: true },
    { title: "FDR appointment", kind: "hearing", critical: true },
    { title: "Respondent can apply for the final order (3 months after the applicant could)", kind: "court_deadline", rule: { from: "Date the applicant could first apply for the final order", months: 3 } },
    { title: "Acknowledgment of service due (14 days after service)", kind: "court_deadline", rule: { from: "Date of service", days: 14 } },
    { title: "Non-molestation / occupation order expires", kind: "limitation", critical: true },
    { title: "Serve the order on the respondent", kind: "court_deadline", critical: true },
    { title: "Section 7 report due", kind: "court_deadline" },
    { title: "Dispute resolution appointment", kind: "hearing", critical: true },
    { title: "Pension sharing: send the order to the pension provider (implementation period 4 months)", kind: "filing", rule: { from: "Date order sealed / decree", months: 4 } },
    HEARING,
  ],
  employment: [
    { title: "Tribunal time limit (3 months less one day — extend for ACAS once certificate received)", kind: "limitation", critical: true, rule: { from: "Date of the act complained of / dismissal", months: 3, days: -1 } },
    { title: "ET3 response due (28 days)", kind: "court_deadline", critical: true, rule: { from: "Date the claim was sent to the employer", days: 28 } },
    { title: "Disclosure / witness statements (tribunal order)", kind: "court_deadline", critical: true },
    HEARING,
  ],
  litigation: [
    { title: "Limitation date — contract / tort (6 years)", kind: "limitation", critical: true, rule: { from: "Date of breach or damage", years: 6 } },
    { title: "Serve the claim form (4 months after issue)", kind: "court_deadline", critical: true, rule: { from: "Date claim issued", months: 4 } },
    { title: "Defence due (28 days after service of particulars, if acknowledged)", kind: "court_deadline", critical: true, rule: { from: "Date particulars deemed served", days: 28 } },
    { title: "Directions deadline (court order)", kind: "court_deadline", critical: true },
    HEARING,
  ],
  personal_injury: [
    { title: "Limitation date (3 years)", kind: "limitation", critical: true, rule: { from: "Date of accident or date of knowledge", years: 3 } },
    { title: "Limitation for a child (21st birthday)", kind: "limitation", critical: true, rule: { from: "Child's date of birth", years: 21 } },
    { title: "Defendant to acknowledge letter of claim (21 days)", kind: "other", rule: { from: "Date letter of claim sent", days: 21 } },
    { title: "Liability decision due (3 months after acknowledgment)", kind: "other", rule: { from: "Date of acknowledgment", months: 3 } },
    HEARING,
  ],
  corporate: [
    { title: "Completion", kind: "other", critical: true },
    { title: "Companies House: share allotment (SH01) due — 1 month", kind: "filing", critical: true, rule: { from: "Date of allotment", months: 1 } },
    { title: "Companies House: change of officers due — 14 days", kind: "filing", rule: { from: "Date of change", days: 14 } },
  ],
  crime: [
    HEARING,
    { title: "Custody time limit — magistrates' court (56 days)", kind: "limitation", critical: true, rule: { from: "Date of first appearance", days: 56 } },
    { title: "Custody time limit — Crown Court (182 days)", kind: "limitation", critical: true, rule: { from: "Date sent to the Crown Court", days: 182 } },
    { title: "Appeal to the Court of Appeal (28 days)", kind: "court_deadline", critical: true, rule: { from: "Date of conviction / sentence", days: 28 } },
  ],
};
for (const area of AREAS) area.deadlines = DEADLINES[area.key] || [];

/**
 * Standard document folders each new matter starts with (admins can set the
 * firm's own list per department in Settings). For conveyancing, documents
 * that pre-date folders are filed by their category (FOLDER_FOR_CATEGORY).
 */
const FOLDERS = {
  conveyancing: ["Client care & ID", "Contract pack", "Title", "Searches", "Enquiries", "Mortgage", "Report on Title",
    "Exchange & completion", "SDLT & Land Registry", "Correspondence", "Accounts"],
  private_client: ["Client care & ID", "Will / LPA drafts", "Death certificate & will", "Assets & liabilities", "IHT & HMRC",
    "Grant of probate", "Estate accounts", "Correspondence", "Accounts"],
  family: ["Client care & ID", "Court papers", "Financial disclosure (Form E)", "Evidence", "Orders", "Correspondence", "Accounts"],
  employment: ["Client care & ID", "Contract & policies", "ACAS", "Tribunal papers (ET1 / ET3)", "Disclosure", "Witness statements",
    "Settlement", "Correspondence", "Accounts"],
  litigation: ["Client care & ID", "Pre-action", "Statements of case", "Disclosure", "Witness statements", "Experts",
    "Court orders & hearings", "Costs", "Correspondence", "Accounts"],
  personal_injury: ["Client care & ID", "Letter of claim / Portal", "Liability", "Medical evidence", "Losses & special damages",
    "Offers & settlement", "Court papers", "Correspondence", "Accounts"],
  corporate: ["Client care & ID", "Heads of terms", "Due diligence", "Transaction documents", "Disclosure letter", "Completion",
    "Companies House filings", "Correspondence", "Accounts"],
  crime: ["Client care & legal aid", "Police station", "Charge & prosecution papers", "Evidence & disclosure", "Defence statement",
    "Court hearings", "Sentencing", "Correspondence"],
};
for (const area of AREAS) area.folders = FOLDERS[area.key] || ["Correspondence", "Documents"];
const FOLDER_FOR_CATEGORY = {
  Contract: "Contract pack", Title: "Title", Search: "Searches", "ID / AML": "Client care & ID", Mortgage: "Mortgage",
  Correspondence: "Correspondence", "SDLT / LR": "SDLT & Land Registry",
};

/** How new matters in each department are usually funded (can be changed per matter). */
const DEFAULT_FUNDING = { conveyancing: "fixed_fee", personal_injury: "cfa", crime: "legal_aid" };
for (const area of AREAS) area.defaultFunding = DEFAULT_FUNDING[area.key] || "hourly";
const FUNDING_TYPES = ["hourly", "fixed_fee", "cfa", "legal_aid"];

// Null prototype, so names like "constructor" or "__proto__" aren't mistaken for departments.
const AREA_BY_KEY = Object.assign(Object.create(null), Object.fromEntries(AREAS.map((a) => [a.key, a])));
const AREA_KEYS = AREAS.map((a) => a.key);

// A type's stages are written as [name, hint]; keep the names in typeStages and the hints in typeStageHints.
for (const area of AREAS) {
  if (!area.typeStages) continue;
  area.typeStageHints = {};
  for (const [type, list] of Object.entries(area.typeStages)) {
    area.typeStages[type] = list.map(([name]) => name);
    area.typeStageHints[type] = list.map(([, hint]) => hint);
  }
}

/** Stage names for a matter's department and type. */
function stagesFor(department, type) {
  const area = AREA_BY_KEY[department] || AREA_BY_KEY.conveyancing;
  const typeDef = area.typeStages && Object.hasOwn(area.typeStages, type) ? area.typeStages[type] : null;
  return typeDef || area.stages;
}

const closedIndexFor = (department, type) => stagesFor(department, type).length - 1;

module.exports = { AREAS, AREA_BY_KEY, AREA_KEYS, stagesFor, closedIndexFor, CONVEYANCING_STAGES, FUNDING_TYPES, FOLDER_FOR_CATEGORY };
