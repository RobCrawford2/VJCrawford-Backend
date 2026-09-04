const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

/** GET /users — everyone in the firm can see the staff list (needed for fee-earner/supervisor pickers). */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT id, name, email, role, supervisor_id, active
       FROM users WHERE firm_id = $1 ORDER BY name`,
      [req.user.firmId]
    );
    res.json(result.rows);
  })
);

/** POST /users — add a new staff member. Admin only. */
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, email, password, role = "fee_earner", supervisorId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required." });
    }
    if (!["fee_earner", "supervisor", "admin"].includes(role)) {
      return res.status(400).json({ error: "role must be fee_earner, supervisor or admin." });
    }

    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "A user with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, supervisor_id, active`,
      [req.user.firmId, name, email.toLowerCase(), passwordHash, role, supervisorId || null]
    );
    res.status(201).json(result.rows[0]);
  })
);

/** PATCH /users/:id — update role, supervisor, or deactivate. Admin only. */
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { role, supervisorId, active } = req.body;
    const setClauses = [];
    const params = [];

    if (role !== undefined) { params.push(role); setClauses.push(`role = $${params.length}`); }
    if (supervisorId !== undefined) { params.push(supervisorId); setClauses.push(`supervisor_id = $${params.length}`); }
    if (active !== undefined) { params.push(active); setClauses.push(`active = $${params.length}`); }
    if (!setClauses.length) return res.status(400).json({ error: "No recognised fields to update." });

    params.push(req.params.id, req.user.firmId);
    const result = await query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length - 1} AND firm_id = $${params.length}
       RETURNING id, name, email, role, supervisor_id, active`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found." });
    res.json(result.rows[0]);
  })
);

module.exports = router;
