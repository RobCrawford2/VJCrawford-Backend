const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");

const router = express.Router();
router.use(requireAuth);

/**
 * GET /undertakings?status=Outstanding — the firm-wide undertakings
 * register: every undertaking on matters the user can see, outstanding
 * first and oldest first, with the matter's completion date so ones
 * still outstanding after completion stand out.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const params = [req.user.firmId];
    const visibility = matterVisibilityClause(req.user, 2);
    params.push(...visibility.params);
    let statusClause = "";
    if (req.query.status === "Outstanding" || req.query.status === "Discharged") {
      params.push(req.query.status);
      statusClause = `AND u.status = $${params.length}`;
    }
    const result = await query(
      `SELECT u.id, u.direction, u.description, u.party, u.status,
              to_char(u.date_given, 'YYYY-MM-DD') AS date_given,
              to_char(u.date_discharged, 'YYYY-MM-DD') AS date_discharged,
              m.id AS matter_id, m.reference, m.address, fe.name AS fee_earner_name,
              to_char(m.actual_completion, 'YYYY-MM-DD') AS actual_completion
       FROM undertakings u
       JOIN matters m ON m.id = u.matter_id
       LEFT JOIN users fe ON fe.id = m.fee_earner_id
       WHERE m.firm_id = $1 ${visibility.clause} ${statusClause}
       ORDER BY (u.status = 'Outstanding') DESC, u.date_given ASC NULLS LAST
       LIMIT 1000`,
      params
    );
    res.json(result.rows);
  })
);

module.exports = router;
