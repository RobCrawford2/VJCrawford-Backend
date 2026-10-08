const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const ROLES = ["secretary", "assistant", "fee_earner", "supervisor", "admin"];
const ROLE_LABELS = { secretary: "Secretary", assistant: "Assistant", fee_earner: "Fee earner", supervisor: "Supervisor", admin: "Admin" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_COLUMNS = "id, name, email, role, supervisor_id, active, created_at";

function audit(firmId, actorId, targetId, action, details = "") {
  return query(
    `INSERT INTO staff_audit (firm_id, actor_id, target_id, action, details) VALUES ($1,$2,$3,$4,$5)`,
    [firmId, actorId, targetId, action, details]
  );
}

/** A supervisor must be an active member of the same firm (and not the person themselves). */
async function checkSupervisor(firmId, supervisorId, selfId) {
  if (!supervisorId) return null;
  if (supervisorId === selfId) return "Someone can't be their own supervisor.";
  const result = await query(`SELECT active FROM users WHERE id = $1 AND firm_id = $2`, [supervisorId, firmId]);
  if (!result.rows.length) return "That supervisor isn't a member of staff.";
  if (!result.rows[0].active) return "That supervisor's account is deactivated.";
  return null;
}

/** GET /users — everyone in the firm can see the staff list (needed for fee-earner/supervisor pickers). */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT ${USER_COLUMNS} FROM users WHERE firm_id = $1 ORDER BY active DESC, name`,
      [req.user.firmId]
    );
    res.json(result.rows);
  })
);

/** GET /users/audit — recent staff account changes. Admin only. */
router.get(
  "/audit",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT a.id, a.action, a.details, a.occurred_at, actor.name AS actor_name, target.name AS target_name
       FROM staff_audit a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users target ON target.id = a.target_id
       WHERE a.firm_id = $1 ORDER BY a.occurred_at DESC LIMIT 100`,
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
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: "Name, email and a temporary password are required." });
    }
    if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "That email address doesn't look right." });
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be secretary, assistant, fee_earner, supervisor or admin." });
    }
    if (password.length < 10) {
      return res.status(400).json({ error: "Password must be at least 10 characters." });
    }
    const supervisorProblem = await checkSupervisor(req.user.firmId, supervisorId);
    if (supervisorProblem) return res.status(400).json({ error: supervisorProblem });

    const existing = await query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "A user with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${USER_COLUMNS}`,
      [req.user.firmId, name.trim(), email.trim().toLowerCase(), passwordHash, role, supervisorId || null]
    );
    await audit(req.user.firmId, req.user.id, result.rows[0].id, "added", `Added as ${ROLE_LABELS[role]}`);
    res.status(201).json(result.rows[0]);
  })
);

/** PATCH /users/:id — update name, email, role, supervisor, or (de)activate. Admin only. */
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, email, role, supervisorId, active } = req.body;
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be secretary, assistant, fee_earner, supervisor or admin." });
    }
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: "Name can't be blank." });
    if (email !== undefined && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: "That email address doesn't look right." });
    }
    if (active !== undefined && typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false." });

    const current = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND firm_id = $2`, [req.params.id, req.user.firmId]);
    const before = current.rows[0];
    if (!before) return res.status(404).json({ error: "User not found." });

    // Never leave the firm without an active admin — nobody could then add
    // staff, reactivate accounts or change firm settings.
    const losesAdmin = (role !== undefined && role !== "admin") || active === false;
    if (losesAdmin && before.role === "admin" && before.active) {
      const others = await query(
        `SELECT count(*) FROM users WHERE firm_id = $1 AND role = 'admin' AND active AND id <> $2`,
        [req.user.firmId, req.params.id]
      );
      if (parseInt(others.rows[0].count, 10) === 0) {
        return res.status(400).json({ error: "This is the firm's only active admin. Make someone else an admin first." });
      }
    }

    if (supervisorId !== undefined) {
      const supervisorProblem = await checkSupervisor(req.user.firmId, supervisorId, req.params.id);
      if (supervisorProblem) return res.status(400).json({ error: supervisorProblem });
    }
    if (email !== undefined && email.trim().toLowerCase() !== before.email) {
      const taken = await query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
      if (taken.rows.length) return res.status(409).json({ error: "A user with that email already exists." });
    }

    const changes = [];
    const setClauses = [];
    const params = [];
    const set = (column, value) => { params.push(value); setClauses.push(`${column} = $${params.length}`); };

    if (name !== undefined && name.trim() !== before.name) { set("name", name.trim()); changes.push(`name changed from "${before.name}" to "${name.trim()}"`); }
    if (email !== undefined && email.trim().toLowerCase() !== before.email) { set("email", email.trim().toLowerCase()); changes.push(`email changed from ${before.email} to ${email.trim().toLowerCase()}`); }
    if (role !== undefined && role !== before.role) { set("role", role); changes.push(`role changed from ${ROLE_LABELS[before.role]} to ${ROLE_LABELS[role]}`); }
    if (supervisorId !== undefined && (supervisorId || null) !== before.supervisor_id) { set("supervisor_id", supervisorId || null); changes.push("supervisor changed"); }
    if (active !== undefined && active !== before.active) { set("active", active); changes.push(active ? "reactivated" : "deactivated"); }

    if (!setClauses.length) return res.json(before);

    params.push(req.params.id, req.user.firmId);
    const result = await query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length - 1} AND firm_id = $${params.length}
       RETURNING ${USER_COLUMNS}`,
      params
    );
    const action = active === false && changes.includes("deactivated") ? "deactivated" : active === true && changes.includes("reactivated") ? "reactivated" : "updated";
    await audit(req.user.firmId, req.user.id, req.params.id, action, changes.join("; "));
    res.json(result.rows[0]);
  })
);

/**
 * POST /users/:id/reset-password — admin sets a temporary password for a
 * member of staff (e.g. they've forgotten theirs). They should change it
 * from "Change password" once logged in.
 */
router.post(
  "/:id/reset-password",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 10) {
      return res.status(400).json({ error: "The temporary password must be at least 10 characters." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 AND firm_id = $3 RETURNING id`,
      [passwordHash, req.params.id, req.user.firmId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found." });
    await audit(req.user.firmId, req.user.id, req.params.id, "password reset", "Temporary password set by an admin");
    res.status(204).send();
  })
);

module.exports = router;
