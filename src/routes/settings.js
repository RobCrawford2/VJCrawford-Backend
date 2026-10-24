const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AREAS, AREA_BY_KEY } = require("../config/areas");

/** The firm's switched-on departments, in catalogue order. */
async function firmDepartments(firmId) {
  const rows = (await query(`SELECT department FROM firm_departments WHERE firm_id = $1`, [firmId])).rows.map((r) => r.department);
  return AREAS.map((a) => a.key).filter((k) => rows.includes(k));
}

const router = express.Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(`SELECT name, domain, stale_days, require_stage_signoff, dictation_enabled, require_exchange_checks FROM firms WHERE id = $1`, [req.user.firmId]);
    if (!result.rows.length) return res.status(404).json({ error: "Firm not found." });
    res.json({
      ...result.rows[0],
      departments: await firmDepartments(req.user.firmId),
      // Every department the system supports, with its matter types and stages.
      areas: AREAS.map(({ key, name, prefix, types, stages, deadlines }) => ({ key, name, prefix, types, stages, deadlines })),
    });
  })
);

/** Admin only — these affect the whole firm (matter mailbox domain, review-reminder threshold). */
router.patch(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { domain, staleDays, requireStageSignoff, dictationEnabled, requireExchangeChecks, departments } = req.body;
    if (departments !== undefined) {
      if (!Array.isArray(departments) || !departments.length || !departments.every((d) => AREA_BY_KEY[d])) {
        return res.status(400).json({ error: "Choose at least one department." });
      }
      const current = await firmDepartments(req.user.firmId);
      const removed = current.filter((d) => !departments.includes(d));
      if (removed.length) {
        const open = await query(
          `SELECT department, count(*)::int AS n FROM matters WHERE firm_id = $1 AND department = ANY($2::text[]) GROUP BY department`,
          [req.user.firmId, removed]
        );
        if (open.rows.length) {
          const r = open.rows[0];
          return res.status(400).json({ error: `${AREA_BY_KEY[r.department].name} can't be switched off while it has matters (${r.n}).` });
        }
      }
      await query(`DELETE FROM firm_departments WHERE firm_id = $1 AND NOT (department = ANY($2::text[]))`, [req.user.firmId, departments]);
      await query(
        `INSERT INTO firm_departments (firm_id, department) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [req.user.firmId, departments]
      );
    }
    const setClauses = [];
    const params = [];
    if (domain !== undefined) { params.push(domain); setClauses.push(`domain = $${params.length}`); }
    if (staleDays !== undefined) { params.push(staleDays); setClauses.push(`stale_days = $${params.length}`); }
    if (requireStageSignoff !== undefined) {
      if (typeof requireStageSignoff !== "boolean") return res.status(400).json({ error: "requireStageSignoff must be true or false." });
      params.push(requireStageSignoff); setClauses.push(`require_stage_signoff = $${params.length}`);
    }
    if (dictationEnabled !== undefined) {
      if (typeof dictationEnabled !== "boolean") return res.status(400).json({ error: "dictationEnabled must be true or false." });
      params.push(dictationEnabled); setClauses.push(`dictation_enabled = $${params.length}`);
    }
    if (requireExchangeChecks !== undefined) {
      if (typeof requireExchangeChecks !== "boolean") return res.status(400).json({ error: "requireExchangeChecks must be true or false." });
      params.push(requireExchangeChecks); setClauses.push(`require_exchange_checks = $${params.length}`);
    }
    if (!setClauses.length && departments === undefined) return res.status(400).json({ error: "No recognised fields to update." });

    params.push(req.user.firmId);
    const result = await query(
      setClauses.length
        ? `UPDATE firms SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING name, domain, stale_days, require_stage_signoff, dictation_enabled, require_exchange_checks`
        : `SELECT name, domain, stale_days, require_stage_signoff, dictation_enabled, require_exchange_checks FROM firms WHERE id = $1`,
      params
    );
    res.json({ ...result.rows[0], departments: await firmDepartments(req.user.firmId) });
  })
);

module.exports = router;
