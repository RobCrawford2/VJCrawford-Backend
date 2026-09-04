const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(`SELECT name, domain, stale_days FROM firms WHERE id = $1`, [req.user.firmId]);
    if (!result.rows.length) return res.status(404).json({ error: "Firm not found." });
    res.json(result.rows[0]);
  })
);

/** Admin only — these affect the whole firm (matter mailbox domain, review-reminder threshold). */
router.patch(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { domain, staleDays } = req.body;
    const setClauses = [];
    const params = [];
    if (domain !== undefined) { params.push(domain); setClauses.push(`domain = $${params.length}`); }
    if (staleDays !== undefined) { params.push(staleDays); setClauses.push(`stale_days = $${params.length}`); }
    if (!setClauses.length) return res.status(400).json({ error: "No recognised fields to update." });

    params.push(req.user.firmId);
    const result = await query(
      `UPDATE firms SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING name, domain, stale_days`,
      params
    );
    res.json(result.rows[0]);
  })
);

module.exports = router;
