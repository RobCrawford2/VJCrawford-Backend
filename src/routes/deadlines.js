const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { ukToday } = require("../utils/dates");

const router = express.Router();
router.use(requireAuth);

/**
 * GET /deadlines?days=14&mine=true — the diary: open deadlines due within
 * the next `days` days, plus anything overdue, on matters the user can see.
 * Supervisors therefore see their team's deadlines as well as their own.
 * `mine` limits it to matters where the user is the fee earner.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 366);
    const params = [req.user.firmId, days];
    const v = matterVisibilityClause(req.user, 3);
    params.push(...v.params);
    let mine = "";
    if (req.query.mine === "true") {
      params.push(req.user.id);
      mine = `AND m.fee_earner_id = $${params.length}`;
    }
    const result = await query(
      `SELECT d.id, d.matter_id, d.kind, d.title, to_char(d.due_date, 'YYYY-MM-DD') AS due_date, to_char(d.due_time, 'HH24:MI') AS due_time,
              d.location, d.critical, m.reference, m.address, m.client, m.department, fe.name AS fee_earner_name
       FROM deadlines d JOIN matters m ON m.id = d.matter_id LEFT JOIN users fe ON fe.id = m.fee_earner_id
       WHERE m.firm_id = $1 AND d.status = 'open' AND d.due_date <= CURRENT_DATE + $2::int ${v.clause} ${mine}
       ORDER BY d.due_date, d.due_time NULLS FIRST
       LIMIT 500`,
      params
    );
    res.json({ today: ukToday(), deadlines: result.rows });
  })
);

module.exports = router;
