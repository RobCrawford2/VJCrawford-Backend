const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { AREA_BY_KEY } = require("../config/areas");
const { conflictCheck } = require("../utils/conflicts");

const router = express.Router();
router.use(requireAuth);

const ID_METHODS = ["Passport", "Driving licence", "Electronic ID check", "Certified copies", "In person — other ID", "Company search (Companies House)"];
const RISK_LEVELS = ["low", "medium", "high"];

/**
 * Which client records someone can see: those on a matter they can see,
 * ones not yet on any matter, and ones they added. Clients known only
 * from other departments stay hidden (the conflict check still flags them,
 * by department only).
 */
function clientVisibilityClause(user, startIndex) {
  const v = matterVisibilityClause(user, startIndex + 1);
  return {
    clause: `AND (
      EXISTS (SELECT 1 FROM matter_clients mc JOIN matters m ON m.id = mc.matter_id WHERE mc.client_id = c.id ${v.clause})
      OR NOT EXISTS (SELECT 1 FROM matter_clients mc2 WHERE mc2.client_id = c.id)
      OR c.created_by = $${startIndex}
    )`,
    params: [user.id, ...v.params],
  };
}

async function findVisibleClient(user, clientId) {
  const v = clientVisibilityClause(user, 3);
  const result = await query(`SELECT c.* FROM clients c WHERE c.id = $1 AND c.firm_id = $2 ${v.clause}`, [clientId, user.firmId, ...v.params]);
  return result.rows[0] || null;
}

const FIELDS = {
  clientType: "client_type", name: "name", dateOfBirth: "date_of_birth", companyNumber: "company_number",
  address: "address", email: "email", phone: "phone", salutation: "salutation", notes: "notes",
};

/** Validates a client body; returns an error message or null. */
function checkClient(body, { partial = false } = {}) {
  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) return "The client's name is required.";
  }
  if (body.clientType !== undefined && !["individual", "organisation"].includes(body.clientType)) return "clientType must be individual or organisation.";
  if (body.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth)) return "dateOfBirth must be a date (YYYY-MM-DD).";
  return null;
}

/** Creates a client record (also used when opening a matter for a new client). */
async function createClient(db, user, body) {
  const result = await db.query(
    `INSERT INTO clients (firm_id, client_type, name, date_of_birth, company_number, address, email, phone, salutation, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [user.firmId, body.clientType || "individual", String(body.name).trim(), body.dateOfBirth || null, body.companyNumber || null,
     body.address || null, body.email || null, body.phone || null, body.salutation || null, body.notes || "", user.id]
  );
  return result.rows[0];
}

/** The client's matters: full details where the user can see them, department only otherwise. */
async function clientMatters(user, clientId) {
  const v = matterVisibilityClause(user, 2);
  const [all, visible] = await Promise.all([
    query(
      `SELECT m.id, m.reference, m.address, m.type, m.department, m.current_stage_index, m.date_instructed
       FROM matter_clients mc JOIN matters m ON m.id = mc.matter_id WHERE mc.client_id = $1 ORDER BY m.date_instructed DESC NULLS LAST`,
      [clientId]
    ),
    query(
      `SELECT m.id FROM matter_clients mc JOIN matters m ON m.id = mc.matter_id WHERE mc.client_id = $1 ${v.clause}`,
      [clientId, ...v.params]
    ),
  ]);
  const seen = new Set(visible.rows.map((r) => r.id));
  return all.rows.map((m) => (seen.has(m.id)
    ? { ...m, departmentName: AREA_BY_KEY[m.department]?.name }
    : { hidden: true, department: m.department, departmentName: AREA_BY_KEY[m.department]?.name }));
}

// -----------------------------------------------------------------------
// POST /clients/conflict-check — { names: [...] }
// -----------------------------------------------------------------------
router.post(
  "/conflict-check",
  asyncHandler(async (req, res) => {
    const names = Array.isArray(req.body.names) ? req.body.names : [];
    if (!names.some((n) => String(n || "").trim())) return res.status(400).json({ error: "Enter at least one name to check." });
    if (names.length > 30) return res.status(400).json({ error: "Check at most 30 names at a time." });
    const excludeClientIds = Array.isArray(req.body.excludeClientIds) ? req.body.excludeClientIds : [];
    res.json({ results: await conflictCheck({ query }, req.user, names, { excludeClientIds, excludeMatterId: req.body.matterId || null }) });
  })
);

// -----------------------------------------------------------------------
// GET /clients?search=&limit= — the client register
// -----------------------------------------------------------------------
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const params = [req.user.firmId];
    const conditions = ["c.firm_id = $1"];
    const v = clientVisibilityClause(req.user, 2);
    params.push(...v.params);
    conditions.push(v.clause.replace(/^AND /, ""));
    const search = String(req.query.search || "").trim();
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.company_number ILIKE $${params.length})`);
    }
    const result = await query(
      `SELECT c.*, (SELECT count(*)::int FROM matter_clients mc WHERE mc.client_id = c.id) AS matter_count
       FROM clients c WHERE ${conditions.join(" AND ")}
       ORDER BY c.name LIMIT ${limit}`,
      params
    );
    res.json(result.rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const problem = checkClient(req.body);
    if (problem) return res.status(400).json({ error: problem });
    res.status(201).json(await createClient({ query }, req.user, req.body));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const client = await findVisibleClient(req.user, req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found." });
    const verifier = client.id_verified_by
      ? (await query(`SELECT name FROM users WHERE id = $1`, [client.id_verified_by])).rows[0]?.name
      : null;
    res.json({ ...client, id_verified_by_name: verifier, matters: await clientMatters(req.user, client.id) });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const client = await findVisibleClient(req.user, req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found." });
    const problem = checkClient(req.body, { partial: true });
    if (problem) return res.status(400).json({ error: problem });
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(FIELDS)) {
      if (req.body[key] === undefined) continue;
      const value = typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key];
      params.push(column === "notes" ? value || "" : value === "" ? null : value);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "No recognised fields to update." });
    params.push(client.id);
    const result = await query(`UPDATE clients SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    res.json(result.rows[0]);
  })
);

/** Record the client's ID / AML check. */
router.post(
  "/:id/id-check",
  asyncHandler(async (req, res) => {
    const client = await findVisibleClient(req.user, req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found." });
    const { verifiedOn, method, riskLevel } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(verifiedOn || ""))) return res.status(400).json({ error: "Enter the date ID was checked." });
    if (!ID_METHODS.includes(method)) return res.status(400).json({ error: "Choose how ID was checked." });
    if (!RISK_LEVELS.includes(riskLevel)) return res.status(400).json({ error: "Choose the AML risk level." });
    const result = await query(
      `UPDATE clients SET id_verified_on = $2, id_method = $3, risk_level = $4, id_verified_by = $5 WHERE id = $1 RETURNING *`,
      [client.id, verifiedOn, method, riskLevel, req.user.id]
    );
    // Note it on each of the client's matters the checker can see.
    const v = matterVisibilityClause(req.user, 4);
    await query(
      `INSERT INTO activity_log (matter_id, user_id, type, text)
       SELECT m.id, $2, 'note', $3 FROM matter_clients mc JOIN matters m ON m.id = mc.matter_id
       WHERE mc.client_id = $1 ${v.clause}`,
      [client.id, req.user.id, `ID checked for ${client.name} (${method}) — ${riskLevel} risk`, ...v.params]
    );
    res.json(result.rows[0]);
  })
);

module.exports = router;
module.exports.createClient = createClient;
module.exports.checkClient = checkClient;
module.exports.findVisibleClient = findVisibleClient;
module.exports.ID_METHODS = ID_METHODS;
