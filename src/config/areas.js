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

const AREA_BY_KEY = Object.fromEntries(AREAS.map((a) => [a.key, a]));
const AREA_KEYS = AREAS.map((a) => a.key);

/** Stage names for a matter's department (and, later, type). */
function stagesFor(department, type) {
  const area = AREA_BY_KEY[department] || AREA_BY_KEY.conveyancing;
  const typeDef = area.typeStages && area.typeStages[type];
  return typeDef || area.stages;
}

const closedIndexFor = (department, type) => stagesFor(department, type).length - 1;

module.exports = { AREAS, AREA_BY_KEY, AREA_KEYS, stagesFor, closedIndexFor, CONVEYANCING_STAGES };
