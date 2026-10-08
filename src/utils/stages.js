// Must match STAGES in frontend/src/App.jsx (same order — the index is what's stored).
const STAGE_NAMES = [
  "Instructed", "ID & AML Checks", "Contract Pack", "Searches", "Enquiries",
  "Mortgage Offer", "Report on Title", "Pre-Exchange Review", "Exchange", "Completion",
  "Post-Completion", "Closed",
];

module.exports = { STAGE_NAMES, STAGE_COUNT: STAGE_NAMES.length, CLOSED_INDEX: STAGE_NAMES.length - 1 };
