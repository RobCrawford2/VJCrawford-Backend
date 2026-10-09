const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");

const router = express.Router();
router.use(requireAuth);

/**
 * GET /tasks?mine=true — open tasks across every matter the user can see,
 * soonest due first. mine=true limits it to tasks assigned to the user.
 * Powers "My tasks" on the home screen and the Tasks & reminders panel.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const params = [req.user.firmId];
    const visibility = matterVisibilityClause(req.user, 2);
    params.push(...visibility.params);
    let mineClause = "";
    if (req.query.mine === "true") {
      params.push(req.user.id);
      mineClause = `AND t.assigned_to = $${params.length}`;
    }
    const result = await query(
      `SELECT t.id, t.description, t.due_date, t.status, t.assigned_to, u.name AS assigned_to_name,
              m.id AS matter_id, m.reference, m.address
       FROM tasks t
       JOIN matters m ON m.id = t.matter_id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE m.firm_id = $1 ${visibility.clause} AND t.status = 'Open' ${mineClause}
       ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

module.exports = router;
