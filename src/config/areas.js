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
  ],
  family: [
    { title: "Earliest conditional order application (20 weeks after issue)", kind: "court_deadline", rule: { from: "Date divorce issued", weeks: 20 } },
    { title: "Earliest final order application (6 weeks and 1 day after conditional order)", kind: "court_deadline", rule: { from: "Date of conditional order", weeks: 6, days: 1 } },
    { title: "Form E exchange", kind: "court_deadline", critical: true },
    { title: "First appointment", kind: "hearing", critical: true },
    { title: "FDR appointment", kind: "hearing", critical: true },
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

/** How new matters in each department are usually funded (can be changed per matter). */
const DEFAULT_FUNDING = { conveyancing: "fixed_fee", personal_injury: "cfa", crime: "legal_aid" };
for (const area of AREAS) area.defaultFunding = DEFAULT_FUNDING[area.key] || "hourly";
const FUNDING_TYPES = ["hourly", "fixed_fee", "cfa", "legal_aid"];

const AREA_BY_KEY = Object.fromEntries(AREAS.map((a) => [a.key, a]));
const AREA_KEYS = AREAS.map((a) => a.key);

/** Stage names for a matter's department (and, later, type). */
function stagesFor(department, type) {
  const area = AREA_BY_KEY[department] || AREA_BY_KEY.conveyancing;
  const typeDef = area.typeStages && area.typeStages[type];
  return typeDef || area.stages;
}

const closedIndexFor = (department, type) => stagesFor(department, type).length - 1;

module.exports = { AREAS, AREA_BY_KEY, AREA_KEYS, stagesFor, closedIndexFor, CONVEYANCING_STAGES, FUNDING_TYPES };
