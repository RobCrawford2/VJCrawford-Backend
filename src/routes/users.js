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
const USER_COLUMNS = "id, name, email, role, supervisor_id, active, created_at, all_departments, hourly_rate";
const { AREA_BY_KEY } = require("../config/areas");
// Departments each person can work in, alongside their row.
const SELECT_USERS = `SELECT ${USER_COLUMNS},
  (SELECT COALESCE(array_agg(d.department ORDER BY d.department), '{}') FROM user_departments d WHERE d.user_id = users.id) AS departments
  FROM users`;

async function getUser(id) {
  return (await query(`${SELECT_USERS} WHERE id = $1`, [id])).rows[0];
}

/** Departments must be ones the firm runs. Returns an error message or null. */
async function checkDepartments(firmId, departments) {
  if (!Array.isArray(departments)) return "departments must be a list.";
  const firm = (await query(`SELECT department FROM firm_departments WHERE firm_id = $1`, [firmId])).rows.map((r) => r.department);
  const bad = departments.find((d) => !firm.includes(d));
  return bad ? `${AREA_BY_KEY[bad]?.name || bad} isn't one of the firm's departments.` : null;
}

async function setDepartments(userId, departments) {
  await query(`DELETE FROM user_departments WHERE user_id = $1`, [userId]);
  if (departments.length) {
    await query(`INSERT INTO user_departments (user_id, department) SELECT $1, unnest($2::text[])`, [userId, departments]);
  }
}

const departmentNames = (list) => (list.length ? list.map((d) => AREA_BY_KEY[d]?.name || d).join(", ") : "none");

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
      `${SELECT_USERS} WHERE firm_id = $1 ORDER BY active DESC, name`,
      [req.user.firmId]
    );
    // Hourly rates are for admins (and each person's own, via /auth/me).
    res.json(req.user.role === "admin" ? result.rows : result.rows.map(({ hourly_rate, ...u }) => u));
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
    const { name, email, password, role = "fee_earner", supervisorId, departments = [], allDepartments = false, hourlyRate = null } = req.body;
    if (hourlyRate !== null && hourlyRate !== "" && !(Number(hourlyRate) >= 0)) return res.status(400).json({ error: "The hourly rate must be £0 or more." });
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
    const departmentProblem = await checkDepartments(req.user.firmId, departments);
    if (departmentProblem) return res.status(400).json({ error: departmentProblem });
    if (typeof allDepartments !== "boolean") return res.status(400).json({ error: "allDepartments must be true or false." });
    if (role !== "admin" && !allDepartments && !departments.length) {
      return res.status(400).json({ error: "Choose which department(s) they work in, or tick All departments." });
    }

    const existing = await query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "A user with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id, all_departments, hourly_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.firmId, name.trim(), email.trim().toLowerCase(), passwordHash, role, supervisorId || null, allDepartments,
       hourlyRate === "" || hourlyRate === null ? null : Number(hourlyRate)]
    );
    const id = result.rows[0].id;
    await setDepartments(id, departments);
    await audit(req.user.firmId, req.user.id, id, "added",
      `Added as ${ROLE_LABELS[role]} — ${allDepartments ? "all departments" : `departments: ${departmentNames(departments)}`}`);
    res.status(201).json(await getUser(id));
  })
);

/** PATCH /users/:id — update name, email, role, supervisor, or (de)activate. Admin only. */
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, email, role, supervisorId, active, departments, allDepartments, hourlyRate } = req.body;
    if (hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "" && !(Number(hourlyRate) >= 0)) {
      return res.status(400).json({ error: "The hourly rate must be £0 or more." });
    }
    if (departments !== undefined) {
      const departmentProblem = await checkDepartments(req.user.firmId, departments);
      if (departmentProblem) return res.status(400).json({ error: departmentProblem });
    }
    if (allDepartments !== undefined && typeof allDepartments !== "boolean") return res.status(400).json({ error: "allDepartments must be true or false." });
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be secretary, assistant, fee_earner, supervisor or admin." });
    }
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: "Name can't be blank." });
    if (email !== undefined && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: "That email address doesn't look right." });
    }
    if (active !== undefined && typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false." });

    const current = await query(`${SELECT_USERS} WHERE id = $1 AND firm_id = $2`, [req.params.id, req.user.firmId]);
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
    const newRate = hourlyRate === undefined ? undefined : hourlyRate === "" || hourlyRate === null ? null : Number(hourlyRate);
    if (newRate !== undefined && newRate !== (before.hourly_rate === null ? null : Number(before.hourly_rate))) {
      set("hourly_rate", newRate);
      changes.push(`hourly rate changed from ${before.hourly_rate === null ? "none" : `£${Number(before.hourly_rate)}`} to ${newRate === null ? "none" : `£${newRate}`}`);
    }
    if (allDepartments !== undefined && allDepartments !== before.all_departments) {
      set("all_departments", allDepartments); changes.push(allDepartments ? "given access to all departments" : "no longer has access to all departments");
    }
    const sameDepartments = departments === undefined || [...departments].sort().join() === [...before.departments].sort().join();
    if (!sameDepartments) changes.push(`departments changed from ${departmentNames(before.departments)} to ${departmentNames(departments)}`);

    const finalRole = role ?? before.role;
    const finalAll = allDepartments ?? before.all_departments;
    const finalDepartments = departments ?? before.departments;
    if (finalRole !== "admin" && !finalAll && !finalDepartments.length) {
      return res.status(400).json({ error: "They need at least one department, or All departments." });
    }

    if (!changes.length) return res.json(before);

    if (!sameDepartments) await setDepartments(req.params.id, departments);
    if (setClauses.length) {
      params.push(req.params.id, req.user.firmId);
      await query(`UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length - 1} AND firm_id = $${params.length}`, params);
    }
    const action = active === false && changes.includes("deactivated") ? "deactivated" : active === true && changes.includes("reactivated") ? "reactivated" : "updated";
    await audit(req.user.firmId, req.user.id, req.params.id, action, changes.join("; "));
    res.json(await getUser(req.params.id));
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
