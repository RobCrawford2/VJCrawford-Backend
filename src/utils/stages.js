// Conveyancing stages (the original workflow). Other departments' stages
// are in src/config/areas.js — use stagesFor(department, type) there.
const { CONVEYANCING_STAGES } = require("../config/areas");

const STAGE_NAMES = CONVEYANCING_STAGES;

module.exports = { STAGE_NAMES, STAGE_COUNT: STAGE_NAMES.length, CLOSED_INDEX: STAGE_NAMES.length - 1 };
