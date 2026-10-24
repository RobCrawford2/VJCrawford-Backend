/**
 * Departments (areas of law): their matter types and stages. The server's
 * list (GET /settings → areas) is registered at startup; conveyancing is
 * built in so the app works before that arrives, and keeps the stage
 * descriptions shown on the timeline.
 */

export const CONVEYANCING_STAGES = [
  { name: "Instructed",           hint: "File opened, client care letter sent" },
  { name: "ID & AML Checks",      hint: "Verification and source-of-funds" },
  { name: "Contract Pack",        hint: "Draft contract and title issued / reviewed" },
  { name: "Searches",             hint: "Local authority, water & drainage, environmental" },
  { name: "Enquiries",            hint: "Pre-contract enquiries raised and answered" },
  { name: "Mortgage Offer",       hint: "Formal mortgage offer received and reviewed" },
  { name: "Report on Title",      hint: "Report sent to client for approval" },
  { name: "Pre-Exchange Review",  hint: "File checked over and confirmed ready before contracts become binding" },
  { name: "Exchange",             hint: "Contracts signed and exchanged, deposit held" },
  { name: "Completion",           hint: "Funds transferred, keys released" },
  { name: "Post-Completion",      hint: "SDLT return filed, Land Registry application" },
  { name: "Closed",               hint: "File closed and archived" },
];

const registry = {
  conveyancing: { key: "conveyancing", name: "Conveyancing", prefix: "CV", types: ["Purchase", "Sale", "Remortgage"], stages: CONVEYANCING_STAGES },
};
let order = ["conveyancing"];

/** Takes the server's department list (key, name, prefix, types, stage names). */
export function registerAreas(areas) {
  if (!Array.isArray(areas) || !areas.length) return;
  for (const a of areas) {
    registry[a.key] = {
      ...a,
      stages: a.key === "conveyancing" ? CONVEYANCING_STAGES : a.stages.map((name) => ({ name, hint: "" })),
    };
  }
  order = areas.map((a) => a.key);
}

export const areaOf = (key) => registry[key || "conveyancing"] || registry.conveyancing;
export const areaName = (key) => areaOf(key).name;
/** Every department the system supports, in catalogue order. */
export const allAreas = () => order.map((k) => registry[k]);
export const isConveyancing = (m) => (m?.department || "conveyancing") === "conveyancing";
/** A matter's stages: [{ name, hint }], the last being Closed. */
export const stagesOf = (m) => areaOf(m?.department).stages;
export const closedIndexOf = (m) => stagesOf(m).length - 1;
export const isClosed = (m) => m.currentStageIndex >= closedIndexOf(m);

/** Wording for the "address" field, which is the matter's description outside conveyancing. */
export const describeLabel = (department) => ((department || "conveyancing") === "conveyancing" ? "Property address" : "Matter description");

/** Roles for the other people on a matter, by department (for conflict checks). */
const PARTY_ROLES = {
  conveyancing: ["Seller", "Buyer", "Other side", "Lender", "Other"],
  private_client: ["Deceased", "Executor", "Beneficiary", "Attorney", "Trustee", "Other"],
  family: ["Other party (spouse / partner)", "Child", "Other"],
  employment: ["Employer", "Employee", "Respondent", "Claimant", "Other"],
  litigation: ["Opponent / defendant", "Claimant", "Co-defendant", "Witness", "Expert", "Other"],
  personal_injury: ["Defendant / insurer", "Witness", "Other"],
  corporate: ["Buyer", "Seller", "Target company", "Other side", "Other"],
  crime: ["Co-defendant", "Complainant / victim", "Witness", "Other"],
};
export const partyRoles = (department) => PARTY_ROLES[department || "conveyancing"] || ["Other side", "Other"];
