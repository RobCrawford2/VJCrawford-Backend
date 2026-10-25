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
    // A sale runs differently from a purchase. Same number of stages, lined up
    // so Pre-Exchange Review, Exchange and Completion are in the same places
    // (exchange checks, warnings and existing files rely on that).
    typeStages: {
      Sale: [
        ["Instructed", "Client care letter and terms; memorandum of sale from the estate agent"],
        ["ID & AML Checks", "Seller's identity verified; checked they are the registered owner(s)"],
        ["Title & property forms", "Official copies obtained; TA6, TA10 (and TA7 / management pack if leasehold) from the client"],
        ["Contract pack issued", "Draft contract, title and property forms sent to the buyer's solicitors"],
        ["Buyer's enquiries", "The buyer's enquiries answered with the client"],
        ["Redemption figures", "Redemption statements for the mortgage and any other charges"],
        ["Contract & transfer signed", "Client signs the contract and transfer (TR1), held ready for exchange"],
        ["Pre-Exchange Review", "File checked; completion date agreed through the chain"],
        ["Exchange", "Contracts exchanged; client and estate agent told"],
        ["Completion", "Completion money received; mortgage redeemed; keys released"],
        ["Post-Completion", "Discharge (DS1) sent, undertakings met, agent paid, proceeds to the client"],
        ["Closed", "File closed and archived"],
      ],
    },
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
    typeStages: {
      "Tribunal claim — for employee": [
        ["Instructed", "Client care letter and terms sent; time limit diarised"],
        ["ID & AML Checks", "Identity verified"],
        ["Advice & merits", "Claims identified and merits advised on; schedule of loss started"],
        ["ACAS early conciliation", "EC notification made (Day A); certificate received (Day B)"],
        ["ET1 presented", "Claim presented within the time limit"],
        ["Response & case management", "ET3 received; preliminary hearing and directions"],
        ["Disclosure & schedule of loss", "Documents exchanged; updated schedule of loss"],
        ["Witness statements & bundle", "Statements exchanged; hearing bundle agreed"],
        ["Hearing / settlement", "Final hearing, or settled (COT3 / settlement agreement)"],
        ["Remedy & outcome", "Judgment and remedy; payment or appeal considered"],
        ["Closed", "File closed"],
      ],
      "Tribunal claim — for employer": [
        ["Instructed", "Client care letter and terms sent"],
        ["ID & AML Checks", "Identity verified"],
        ["Advice & merits", "Claim reviewed; documents and witnesses gathered"],
        ["ACAS early conciliation", "Conciliation considered with ACAS"],
        ["ET3 response filed", "Response filed within 28 days of the claim being sent"],
        ["Case management", "Preliminary hearing and directions; strike-out / deposit considered"],
        ["Disclosure", "Documents exchanged"],
        ["Witness statements & bundle", "Statements exchanged; hearing bundle prepared"],
        ["Hearing / settlement", "Final hearing, or settled (COT3 / settlement agreement)"],
        ["Outcome", "Judgment; costs or appeal considered"],
        ["Closed", "File closed"],
      ],
      "Settlement agreement": [
        ["Instructed", "Terms agreed, often with the employer contributing to fees"],
        ["ID & AML Checks", "Identity verified"],
        ["Agreement reviewed", "Terms, payments, tax and restrictions checked"],
        ["Advice given", "Advice on the terms and on the claims being waived"],
        ["Negotiation", "Improvements negotiated, if instructed"],
        ["Signed & certified", "Employee signs; adviser's certificate completed"],
        ["Payment confirmed", "Settlement payment received"],
        ["Closed", "File closed"],
      ],
    },
  },
  {
    key: "litigation",
    name: "Litigation",
    prefix: "LIT",
    types: ["Contract / debt dispute", "Property dispute", "Professional negligence", "Debt recovery", "Other dispute"],
    stages: [
      "Instructed", "ID & AML Checks", "Pre-action", "Claim issued & served", "Defence & directions",
      "Disclosure", "Witnesses & experts", "Trial / settlement", "Enforcement & costs", "Closed",
    ],
    typeStages: {
      "Debt recovery": [
        ["Instructed", "Invoices, contract and statement of account received"],
        ["ID & AML Checks", "Identity verified"],
        ["Letter before claim", "Sent (Debt PAP: 30 days for individuals and sole traders)"],
        ["Claim issued", "Claim issued (Money Claim Online / County Court) and served"],
        ["Response", "Admission, defence, or nothing (default judgment)"],
        ["Judgment", "Judgment entered; payment terms"],
        ["Enforcement", "Warrant / writ of control, attachment of earnings, charging order…"],
        ["Closed", "File closed"],
      ],
    },
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
    // Clinical negligence runs differently (same number of stages, so existing matters keep their place).
    typeStages: {
      "Clinical negligence": [
        ["Instructed", "Client care letter and CFA / funding; limitation diarised"],
        ["ID & AML Checks", "Identity verified"],
        ["Records & screening", "Medical records obtained and screened"],
        ["Expert evidence", "Breach of duty and causation reports"],
        ["Letter of claim", "Letter of claim sent under the clinical negligence protocol"],
        ["Letter of response", "Response due within 4 months"],
        ["Negotiation / proceedings", "Offers, or proceedings issued"],
        ["Settlement / trial", "Settled (court approval if a child) or tried"],
        ["Closed", "File closed"],
      ],
    },
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
    typeStages: (() => {
      const deal = [
        ["Instructed", "Client care letter and terms; conflict check on all parties"],
        ["ID & AML Checks", "Identity verified, including beneficial owners"],
        ["Heads of terms", "Heads agreed; exclusivity and confidentiality in place"],
        ["Due diligence", "Questionnaire, data room review and due diligence report"],
        ["SPA & disclosure", "SPA, disclosure letter and ancillaries drafted"],
        ["Negotiation", "Terms negotiated; conditions and approvals obtained"],
        ["Exchange / completion", "Signed and completed; consideration paid"],
        ["Post-completion", "Stamp duty, Companies House filings, registers updated"],
        ["Closed", "File closed"],
      ];
      return {
        "Share sale": deal,
        "Share purchase": deal,
        "Company formation": [
          ["Instructed", "Client care letter and terms"],
          ["ID & AML Checks", "Directors, shareholders and PSCs verified"],
          ["Structure agreed", "Name, share structure, officers and articles agreed"],
          ["Documents prepared", "Incorporation application (IN01) and articles"],
          ["Incorporated", "Certificate of incorporation received"],
          ["Post-incorporation", "Registers, share certificates, bank account, HMRC registrations"],
          ["Closed", "File closed"],
        ],
        "Commercial contract": [
          ["Instructed", "Client care letter and terms"],
          ["ID & AML Checks", "Identity verified"],
          ["Scoping", "Commercial terms and risks understood"],
          ["Drafting", "Contract drafted or the other side's draft reviewed"],
          ["Negotiation", "Mark-ups exchanged and issues agreed"],
          ["Signed", "Signed; key dates diarised"],
          ["Closed", "File closed"],
        ],
        "Shareholders' agreement": [
          ["Instructed", "Client care letter and terms"],
          ["ID & AML Checks", "Identity verified"],
          ["Instructions", "Decision-making, transfers, leavers, deadlock and dividends agreed"],
          ["Drafting", "Agreement (and articles) drafted"],
          ["Negotiation", "Comments from all shareholders agreed"],
          ["Signed", "Signed; articles adopted by special resolution and filed"],
          ["Closed", "File closed"],
        ],
      };
    })(),
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
    typeStages: {
      "Police station": [
        ["Instructed", "Call received (DSCC / own client); attendance arranged"],
        ["Conflict check", "Conflict check on co-suspects"],
        ["Disclosure & consultation", "Custody record and disclosure obtained; private consultation"],
        ["Interview", "Interview attended; advice given"],
        ["Outcome", "Charge, bail, RUI, NFA or caution"],
        ["Closed", "File closed (or continues as a court case)"],
      ],
      "Magistrates' court": [
        ["Instructed", "Instructions taken"],
        ["ID & conflict checks", "Identity and conflict checks"],
        ["Legal aid", "Representation order applied for / granted"],
        ["First hearing", "IDPC reviewed; plea and allocation"],
        ["Case management & disclosure", "Trial directions; initial disclosure"],
        ["Trial preparation", "Witnesses, defence statement (optional), evidence"],
        ["Trial / sentence", "Trial, or sentence after a guilty plea"],
        ["Closed", "File closed (appeal considered)"],
      ],
      "Crown Court": [
        ["Instructed", "Instructions taken"],
        ["ID & conflict checks", "Identity and conflict checks"],
        ["Legal aid", "Representation order granted (contribution order?)"],
        ["Sent to the Crown Court", "Sent from the magistrates' court"],
        ["PTPH", "Plea and trial preparation hearing"],
        ["Disclosure & defence statement", "Served case; defence statement within 28 days of initial disclosure"],
        ["Trial preparation", "Witnesses, experts, counsel briefed"],
        ["Trial / sentence", "Trial, or sentence"],
        ["Appeal / outcome", "Advice on appeal (28 days)"],
        ["Closed", "File closed"],
      ],
      Appeal: [
        ["Instructed", "Instructions taken; time limit checked"],
        ["ID & conflict checks", "Identity and conflict checks"],
        ["Advice on merits", "Transcripts / papers reviewed; merits advised on"],
        ["Notice & grounds lodged", "Notice of appeal and grounds lodged"],
        ["Leave / hearing", "Leave (Court of Appeal) and the appeal hearing"],
        ["Outcome", "Decision"],
        ["Closed", "File closed"],
      ],
    },
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
    { title: "Tribunal time limit — act on or after 1 Oct 2026 (6 months less one day; extend for ACAS)", kind: "limitation", critical: true, rule: { from: "Date of the act complained of / dismissal", months: 6, days: -1 } },
    { title: "Tribunal time limit — act before 1 Oct 2026 (3 months less one day; extend for ACAS)", kind: "limitation", critical: true, rule: { from: "Date of the act complained of / dismissal", months: 3, days: -1 } },
    { title: "Settlement payment due", kind: "other", critical: true },
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
