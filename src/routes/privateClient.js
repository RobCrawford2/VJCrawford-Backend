/**
 * Wills, Trusts & Probate.
 *
 * On a matter (mounted at /matters):
 *   POST   /:id/estate-items                     add an asset or liability
 *   PATCH  /:id/estate-items/:itemId             update one
 *   DELETE /:id/estate-items/:itemId
 *   POST   /:id/beneficiaries                    add a beneficiary / gift
 *   PATCH  /:id/beneficiaries/:beneficiaryId
 *   DELETE /:id/beneficiaries/:beneficiaryId
 *   GET    /:id/estate-account                   estate account (.docx)
 *   GET    /:id/estate-items/:itemId/letter      letter notifying the holder of the death (.docx)
 *   GET    /:id/beneficiaries/:beneficiaryId/letter   letter sending a payment, with receipt (.docx)
 *
 * Firm-wide (mounted at /safe-custody): the register of original wills,
 * LPAs and deeds held in the strongroom.
 *   GET  /?search=&withdrawn=true    POST /    PATCH /:id    POST /:id/withdraw
 */
const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause, canUseDepartment } = require("../utils/permissions");
const {
  ASSET_CATEGORIES, LIABILITY_CATEGORIES, ITEM_STATUSES, GIFT_TYPES, PROBATE, estateSummary,
} = require("../config/privateClient");
const { estateAccount, deathNotificationLetter, paymentLetter } = require("../reports/estate");
const { validDate, isBlank, text } = require("../utils/validate");


async function findMatter(req, res) {
  const v = matterVisibilityClause(req.user, 3);
  const r = await query(
    `SELECT m.*, fe.name AS fee_earner_name FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
     WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
    [req.params.id, req.user.firmId, ...v.params]
  );
  if (!r.rows.length) {
    res.status(404).json({ error: "Matter not found." });
    return null;
  }
  const m = r.rows[0];
  if (m.department !== "private_client") {
    res.status(400).json({ error: "This is only for Wills, Trusts & Probate matters." });
    return null;
  }
  return m;
}

async function findProbate(req, res) {
  const m = await findMatter(req, res);
  if (!m) return null;
  if (m.type !== PROBATE) {
    res.status(400).json({ error: "The estate register is only for probate / estate administration matters." });
    return null;
  }
  return m;
}

const log = (matterId, userId, type, msg) =>
  query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,$3,$4)`, [matterId, userId, type, msg]);

const money = (v) => `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Loads what a private client matter's screen needs (added to the matter detail). */
async function privateClientDetail(matter) {
  const [items, beneficiaries, custody] = await Promise.all([
    query(`SELECT * FROM estate_items WHERE matter_id = $1 ORDER BY kind, created_at`, [matter.id]),
    query(`SELECT * FROM estate_beneficiaries WHERE matter_id = $1 ORDER BY created_at`, [matter.id]),
    query(`SELECT * FROM safe_custody WHERE matter_id = $1 ORDER BY received_on DESC, created_at DESC`, [matter.id]),
  ]);
  const out = { safeCustody: custody.rows };
  if (matter.type === PROBATE) {
    out.estateItems = items.rows;
    out.beneficiaries = beneficiaries.rows;
    out.estateSummary = estateSummary(items.rows, beneficiaries.rows, matter.details || {});
  }
  return out;
}

// -----------------------------------------------------------------------
// Matter routes
// -----------------------------------------------------------------------
const matterRouter = express.Router();
matterRouter.use(requireAuth);

// ---- Estate register (assets and liabilities) ----

/** Validates an asset / liability body. Returns { values } (column → value) or { error }. */
function checkItem(body, kind, partial) {
  const values = {};
  const categories = kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
  const has = (k) => Object.hasOwn(body, k);
  if (!partial || has("category")) {
    if (!categories.includes(body.category)) return { error: `Choose a category: ${categories.join(", ")}.` };
    values.category = body.category;
  }
  if (!partial || has("description")) {
    if (isBlank(body.description) || typeof body.description !== "string") return { error: `Describe the ${kind}.` };
    values.description = body.description.trim();
  }
  for (const [k, col] of [["holder", "holder"], ["holderAddress", "holder_address"], ["reference", "reference"]]) {
    if (has(k)) {
      if (!isBlank(body[k]) && typeof body[k] !== "string") return { error: `${k} must be text.` };
      values[col] = text(body[k]);
    }
  }
  for (const [k, col] of [["valueAtDeath", "value_at_death"], ["valueRealised", "value_realised"]]) {
    if (!has(k)) continue;
    if (isBlank(body[k])) { values[col] = null; continue; }
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < 0) return { error: "Amounts must be £0 or more." };
    values[col] = Math.round(v * 100) / 100;
  }
  if (has("status")) {
    if (!ITEM_STATUSES[kind].includes(body.status)) return { error: `status must be one of: ${ITEM_STATUSES[kind].join(", ")}.` };
    values.status = body.status;
  }
  if (has("notifiedOn")) {
    if (!isBlank(body.notifiedOn) && !validDate(body.notifiedOn)) return { error: "notifiedOn must be a date." };
    values.notified_on = text(body.notifiedOn);
  }
  if (has("passesOutsideWill")) values.passes_outside_will = body.passesOutsideWill === true;
  if (has("notes")) values.notes = typeof body.notes === "string" ? body.notes.trim() : "";
  return { values };
}

matterRouter.post(
  "/:id/estate-items",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const kind = req.body.kind;
    if (!["asset", "liability"].includes(kind)) return res.status(400).json({ error: "kind must be asset or liability." });
    const { values, error } = checkItem(req.body, kind, false);
    if (error) return res.status(400).json({ error });
    const cols = ["matter_id", "kind", "created_by", ...Object.keys(values)];
    const params = [m.id, kind, req.user.id, ...Object.values(values)];
    const r = await query(
      `INSERT INTO estate_items (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      params
    );
    await log(m.id, req.user.id, "edit", `${kind === "asset" ? "Asset" : "Liability"} added: ${values.description}`);
    res.status(201).json(r.rows[0]);
  })
);

matterRouter.patch(
  "/:id/estate-items/:itemId",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const item = (await query(`SELECT * FROM estate_items WHERE id = $1 AND matter_id = $2`, [req.params.itemId, m.id])).rows[0];
    if (!item) return res.status(404).json({ error: "Not found on this estate." });
    const { values, error } = checkItem(req.body, item.kind, true);
    if (error) return res.status(400).json({ error });
    // Marking it notified records today's date, if no date was given.
    if (values.status === "Notified" && !item.notified_on && values.notified_on === undefined) values.notified_on = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(values);
    if (!keys.length) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(
      `UPDATE estate_items SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [item.id, ...Object.values(values)]
    );
    if (values.status && values.status !== item.status) await log(m.id, req.user.id, "edit", `${item.description}: ${values.status}`);
    res.json(r.rows[0]);
  })
);

matterRouter.delete(
  "/:id/estate-items/:itemId",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const r = await query(`DELETE FROM estate_items WHERE id = $1 AND matter_id = $2 RETURNING kind, description`, [req.params.itemId, m.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found on this estate." });
    await log(m.id, req.user.id, "edit", `${r.rows[0].kind === "asset" ? "Asset" : "Liability"} removed: ${r.rows[0].description}`);
    res.status(204).send();
  })
);

// ---- Beneficiaries ----

function checkBeneficiary(body, partial) {
  const values = {};
  const has = (k) => Object.hasOwn(body, k);
  if (!partial || has("name")) {
    if (isBlank(body.name) || typeof body.name !== "string") return { error: "Give the beneficiary's name." };
    values.name = body.name.trim();
  }
  if (!partial || has("giftType")) {
    if (!GIFT_TYPES.includes(body.giftType)) return { error: `giftType must be one of: ${GIFT_TYPES.join(", ")}.` };
    values.gift_type = body.giftType;
  }
  for (const [k, col] of [["relationship", "relationship"], ["description", "description"]]) {
    if (has(k)) values[col] = typeof body[k] === "string" ? text(body[k]) : null;
  }
  for (const [k, col, max] of [["amount", "amount"], ["paidAmount", "paid_amount"], ["sharePercent", "share_percent", 100]]) {
    if (!has(k)) continue;
    if (isBlank(body[k])) { values[col] = null; continue; }
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < 0 || (max && v > max)) return { error: max ? "A share must be between 0 and 100%." : "Amounts must be £0 or more." };
    values[col] = v;
  }
  if (has("exemption")) {
    if (!isBlank(body.exemption) && !["spouse", "charity"].includes(body.exemption)) return { error: "exemption must be spouse, charity or blank." };
    values.exemption = text(body.exemption);
  }
  for (const [k, col] of [["paidOn", "paid_on"], ["receiptOn", "receipt_on"]]) {
    if (!has(k)) continue;
    if (!isBlank(body[k]) && !validDate(body[k])) return { error: `${k} must be a date.` };
    values[col] = text(body[k]);
  }
  if (has("notes")) values.notes = typeof body.notes === "string" ? body.notes.trim() : "";
  return { values };
}

function giftProblem(row) {
  if (row.gift_type === "Share of residue" && !(Number(row.share_percent) > 0)) return "Give the share of the residue (%).";
  if (row.gift_type === "Pecuniary legacy" && !(Number(row.amount) > 0)) return "Give the amount of the legacy.";
  return null;
}

matterRouter.post(
  "/:id/beneficiaries",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const { values, error } = checkBeneficiary(req.body, false);
    if (error) return res.status(400).json({ error });
    const problem = giftProblem(values);
    if (problem) return res.status(400).json({ error: problem });
    const cols = ["matter_id", ...Object.keys(values)];
    const params = [m.id, ...Object.values(values)];
    const r = await query(
      `INSERT INTO estate_beneficiaries (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      params
    );
    await log(m.id, req.user.id, "edit", `Beneficiary added: ${values.name} (${values.gift_type.toLowerCase()})`);
    res.status(201).json(r.rows[0]);
  })
);

matterRouter.patch(
  "/:id/beneficiaries/:beneficiaryId",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const b = (await query(`SELECT * FROM estate_beneficiaries WHERE id = $1 AND matter_id = $2`, [req.params.beneficiaryId, m.id])).rows[0];
    if (!b) return res.status(404).json({ error: "Beneficiary not found." });
    const { values, error } = checkBeneficiary(req.body, true);
    if (error) return res.status(400).json({ error });
    const problem = giftProblem({ ...b, ...values });
    if (problem) return res.status(400).json({ error: problem });
    const keys = Object.keys(values);
    if (!keys.length) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(
      `UPDATE estate_beneficiaries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [b.id, ...Object.values(values)]
    );
    if (values.paid_amount !== undefined && Number(values.paid_amount) !== Number(b.paid_amount) && values.paid_amount !== null) {
      await log(m.id, req.user.id, "edit", `Paid ${money(values.paid_amount)} to ${r.rows[0].name}`);
    }
    res.json(r.rows[0]);
  })
);

matterRouter.delete(
  "/:id/beneficiaries/:beneficiaryId",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const r = await query(`DELETE FROM estate_beneficiaries WHERE id = $1 AND matter_id = $2 RETURNING name`, [req.params.beneficiaryId, m.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Beneficiary not found." });
    await log(m.id, req.user.id, "edit", `Beneficiary removed: ${r.rows[0].name}`);
    res.status(204).send();
  })
);

// ---- Word drafts ----

function sendDocx(res, title, reference, buffer) {
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title} - ${reference}.docx`)}`,
    "Cache-Control": "private, no-store",
  });
  res.send(buffer);
}

async function docContext(m, firmId) {
  const [firm, items, beneficiaries] = await Promise.all([
    query(`SELECT name FROM firms WHERE id = $1`, [firmId]),
    query(`SELECT * FROM estate_items WHERE matter_id = $1 ORDER BY kind, created_at`, [m.id]),
    query(`SELECT * FROM estate_beneficiaries WHERE matter_id = $1 ORDER BY created_at`, [m.id]),
  ]);
  return {
    matter: m, firm: firm.rows[0], feeEarner: m.fee_earner_name || null, details: m.details || {},
    items: items.rows, beneficiaries: beneficiaries.rows,
    summary: estateSummary(items.rows, beneficiaries.rows, m.details || {}),
  };
}

matterRouter.get(
  "/:id/estate-account",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const ctx = await docContext(m, req.user.firmId);
    const buffer = await estateAccount(ctx);
    await log(m.id, req.user.id, "doc", "Estate account draft generated");
    sendDocx(res, "Estate account", m.reference, buffer);
  })
);

matterRouter.get(
  "/:id/estate-items/:itemId/letter",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const ctx = await docContext(m, req.user.firmId);
    const item = ctx.items.find((i) => i.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: "Not found on this estate." });
    const buffer = await deathNotificationLetter(ctx, item);
    await log(m.id, req.user.id, "doc", `Letter to ${item.holder || item.description} drafted`);
    sendDocx(res, `Notification of death - ${item.holder || item.description}`, m.reference, buffer);
  })
);

matterRouter.get(
  "/:id/beneficiaries/:beneficiaryId/letter",
  asyncHandler(async (req, res) => {
    const m = await findProbate(req, res);
    if (!m) return;
    const ctx = await docContext(m, req.user.firmId);
    const b = ctx.beneficiaries.find((x) => x.id === req.params.beneficiaryId);
    if (!b) return res.status(404).json({ error: "Beneficiary not found." });
    const buffer = await paymentLetter(ctx, b);
    await log(m.id, req.user.id, "doc", `Payment letter to ${b.name} drafted`);
    sendDocx(res, `Payment to ${b.name}`, m.reference, buffer);
  })
);

// -----------------------------------------------------------------------
// Safe custody register (firm-wide)
// -----------------------------------------------------------------------
const custodyRouter = express.Router();
custodyRouter.use(requireAuth);

const DOC_TYPES = ["Will", "Codicil", "Lasting power of attorney", "Enduring power of attorney", "Trust deed", "Title deeds", "Other deed"];

/**
 * Entries on a matter follow that matter's visibility; entries not on a
 * matter are for Wills, Trusts & Probate staff (and admins).
 */
function custodyVisibility(user, startIndex) {
  const v = matterVisibilityClause(user, startIndex);
  const loose = canUseDepartment(user, "private_client") ? "s.matter_id IS NULL" : "false";
  return {
    clause: `AND (${loose} OR EXISTS (SELECT 1 FROM matters m WHERE m.id = s.matter_id ${v.clause}))`,
    params: v.params,
  };
}

async function findCustody(req, res) {
  const v = custodyVisibility(req.user, 3);
  const r = await query(`SELECT s.* FROM safe_custody s WHERE s.id = $1 AND s.firm_id = $2 ${v.clause}`, [req.params.id, req.user.firmId, ...v.params]);
  if (!r.rows.length) {
    res.status(404).json({ error: "Not found in the register." });
    return null;
  }
  return r.rows[0];
}

function checkCustody(body, partial) {
  const values = {};
  const has = (k) => Object.hasOwn(body, k);
  if (!partial || has("docType")) {
    if (!DOC_TYPES.includes(body.docType)) return { error: `docType must be one of: ${DOC_TYPES.join(", ")}.` };
    values.doc_type = body.docType;
  }
  for (const [k, col, label] of [["person", "person", "whose document it is"], ["location", "location", "where it's kept (e.g. strongroom packet number)"]]) {
    if (!partial || has(k)) {
      if (isBlank(body[k]) || typeof body[k] !== "string") return { error: `Give ${label}.` };
      values[col] = body[k].trim();
    }
  }
  for (const [k, col, required] of [["documentDate", "document_date", false], ["receivedOn", "received_on", true]]) {
    if (!(has(k) || (!partial && required))) continue;
    if (isBlank(body[k])) {
      if (required) return { error: "Give the date it was received." };
      values[col] = null;
      continue;
    }
    if (!validDate(body[k])) return { error: `${k} must be a date.` };
    values[col] = body[k];
  }
  if (has("notes")) values.notes = typeof body.notes === "string" ? body.notes.trim() : "";
  return { values };
}

custodyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const params = [req.user.firmId];
    const v = custodyVisibility(req.user, 2);
    params.push(...v.params);
    const conditions = [`s.firm_id = $1 ${v.clause}`];
    const search = String(req.query.search || "").trim();
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(s.person ILIKE $${params.length} OR s.location ILIKE $${params.length} OR mm.reference ILIKE $${params.length})`);
    }
    if (req.query.withdrawn !== "true") conditions.push("s.withdrawn_on IS NULL");
    const r = await query(
      `SELECT s.*, mm.reference AS matter_reference, mm.address AS matter_description, wu.name AS withdrawn_by_name
       FROM safe_custody s LEFT JOIN matters mm ON mm.id = s.matter_id LEFT JOIN users wu ON wu.id = s.withdrawn_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY lower(s.person), s.received_on DESC LIMIT 500`,
      params
    );
    res.json({ docTypes: DOC_TYPES, entries: r.rows });
  })
);

custodyRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { values, error } = checkCustody(req.body, false);
    if (error) return res.status(400).json({ error });
    let matter = null;
    if (req.body.matterId) {
      const v = matterVisibilityClause(req.user, 3);
      matter = (await query(`SELECT m.id, m.department, m.reference FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
        [req.body.matterId, req.user.firmId, ...v.params])).rows[0];
      if (!matter) return res.status(400).json({ error: "That matter wasn't found." });
    } else if (!canUseDepartment(req.user, "private_client")) {
      return res.status(403).json({ error: "Only Wills, Trusts & Probate staff can add entries not on a matter." });
    }
    const cols = ["firm_id", "matter_id", "department", "created_by", ...Object.keys(values)];
    const params = [req.user.firmId, matter ? matter.id : null, matter ? matter.department : "private_client", req.user.id, ...Object.values(values)];
    const r = await query(
      `INSERT INTO safe_custody (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      params
    );
    if (matter) await log(matter.id, req.user.id, "edit", `${values.doc_type} of ${values.person} placed in safe custody (${values.location})`);
    res.status(201).json(r.rows[0]);
  })
);

custodyRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const entry = await findCustody(req, res);
    if (!entry) return;
    const { values, error } = checkCustody(req.body, true);
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(values);
    if (!keys.length) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(
      `UPDATE safe_custody SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [entry.id, ...Object.values(values)]
    );
    res.json(r.rows[0]);
  })
);

custodyRouter.post(
  "/:id/withdraw",
  asyncHandler(async (req, res) => {
    const entry = await findCustody(req, res);
    if (!entry) return;
    if (entry.withdrawn_on) return res.status(409).json({ error: "This has already been taken out of safe custody." });
    const { withdrawnOn, withdrawnTo } = req.body;
    if (!(validDate(String(withdrawnOn || "")))) return res.status(400).json({ error: "Give the date it was taken out." });
    if (isBlank(withdrawnTo) || typeof withdrawnTo !== "string") return res.status(400).json({ error: "Say who it was released to (and their authority)." });
    const r = await query(
      `UPDATE safe_custody SET withdrawn_on = $2, withdrawn_to = $3, withdrawn_by = $4 WHERE id = $1 AND withdrawn_on IS NULL RETURNING *`,
      [entry.id, withdrawnOn, withdrawnTo.trim(), req.user.id]
    );
    if (!r.rows.length) return res.status(409).json({ error: "This has already been taken out of safe custody." });
    if (entry.matter_id) await log(entry.matter_id, req.user.id, "edit", `${entry.doc_type} of ${entry.person} released from safe custody to ${withdrawnTo.trim()}`);
    res.json(r.rows[0]);
  })
);

module.exports = { matterRouter, custodyRouter, privateClientDetail };
