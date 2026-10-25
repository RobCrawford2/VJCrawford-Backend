/**
 * Family (mounted at /matters):
 *   POST   /:id/family-assets                  add to the asset schedule (financial settlements)
 *   PATCH  /:id/family-assets/:itemId
 *   DELETE /:id/family-assets/:itemId
 *   GET    /:id/asset-schedule                 the schedule as a Word document (ES2 style)
 *   POST   /:id/children                       add a child (any family matter)
 *   PATCH  /:id/children/:childId
 *   DELETE /:id/children/:childId
 */
const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { FINANCES, OWNERS, ITEM_KINDS, CATEGORIES, assetSchedule } = require("../config/family");
const { assetScheduleDoc } = require("../reports/family");
const { validDate, isBlank, text } = require("../utils/validate");

const router = express.Router();
router.use(requireAuth);

async function findFamilyMatter(req, res, { finances = false } = {}) {
  const v = matterVisibilityClause(req.user, 3);
  const m = (await query(
    `SELECT m.*, fe.name AS fee_earner_name FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
     WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
    [req.params.id, req.user.firmId, ...v.params]
  )).rows[0];
  if (!m) {
    res.status(404).json({ error: "Matter not found." });
    return null;
  }
  if (m.department !== "family") {
    res.status(400).json({ error: "This is only for family matters." });
    return null;
  }
  if (finances && m.type !== FINANCES) {
    res.status(400).json({ error: "The asset schedule is for financial settlement matters." });
    return null;
  }
  return m;
}

const log = (matterId, userId, msg) =>
  query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'edit',$3)`, [matterId, userId, msg]);

/** What a family matter's screen needs (added to the matter detail). */
async function familyDetail(matter) {
  const [children, assets] = await Promise.all([
    query(`SELECT * FROM family_children WHERE matter_id = $1 ORDER BY date_of_birth NULLS LAST, created_at`, [matter.id]),
    matter.type === FINANCES
      ? query(`SELECT * FROM family_assets WHERE matter_id = $1 ORDER BY kind, created_at`, [matter.id])
      : Promise.resolve({ rows: null }),
  ]);
  const out = { children: children.rows };
  if (assets.rows) {
    out.familyAssets = assets.rows;
    out.assetSchedule = assetSchedule(assets.rows);
  }
  return out;
}

// ---- Asset schedule ----

function checkAsset(body, current) {
  const values = {};
  const has = (k) => Object.hasOwn(body, k);
  const kind = has("kind") ? body.kind : current?.kind;
  if (!ITEM_KINDS.includes(kind)) return { error: "kind must be asset, liability or pension." };
  if (has("kind") || !current) values.kind = kind;
  if (has("owner") || !current) {
    if (!OWNERS.includes(body.owner)) return { error: "Say whose it is: client, other or joint." };
    values.owner = body.owner;
  }
  if (has("category") || !current || values.kind) {
    const category = has("category") ? body.category : current?.category;
    if (!CATEGORIES[kind].includes(category)) return { error: `Choose a category: ${CATEGORIES[kind].join(", ")}.` };
    values.category = category;
  }
  if (has("description") || !current) {
    if (isBlank(body.description) || typeof body.description !== "string") return { error: "Describe it." };
    values.description = body.description.trim();
  }
  if (has("value") || !current) {
    const v = Number(body.value);
    if (isBlank(body.value) || !Number.isFinite(v) || v < 0) return { error: "Give its value (£0 or more; enter debts as positive amounts)." };
    values.value = Math.round(v * 100) / 100;
  }
  if (has("proposedClientPercent")) {
    if (isBlank(body.proposedClientPercent)) values.proposed_client_percent = null;
    else {
      const p = Number(body.proposedClientPercent);
      if (!Number.isFinite(p) || p < 0 || p > 100) return { error: "The client's share must be between 0 and 100%." };
      values.proposed_client_percent = p;
    }
  }
  if (has("source")) values.source = typeof body.source === "string" ? text(body.source) : null;
  if (has("notes")) values.notes = typeof body.notes === "string" ? body.notes.trim() : "";
  return { values };
}

router.post(
  "/:id/family-assets",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res, { finances: true });
    if (!m) return;
    const { values, error } = checkAsset(req.body, null);
    if (error) return res.status(400).json({ error });
    const cols = ["matter_id", "created_by", ...Object.keys(values)];
    const params = [m.id, req.user.id, ...Object.values(values)];
    const r = await query(
      `INSERT INTO family_assets (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      params
    );
    await log(m.id, req.user.id, `Asset schedule: added ${values.description}`);
    res.status(201).json(r.rows[0]);
  })
);

router.patch(
  "/:id/family-assets/:itemId",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res, { finances: true });
    if (!m) return;
    const item = (await query(`SELECT * FROM family_assets WHERE id = $1 AND matter_id = $2`, [req.params.itemId, m.id])).rows[0];
    if (!item) return res.status(404).json({ error: "Not found on this schedule." });
    const { values, error } = checkAsset(req.body, item);
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(values);
    if (!keys.length) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(
      `UPDATE family_assets SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [item.id, ...Object.values(values)]
    );
    res.json(r.rows[0]);
  })
);

router.delete(
  "/:id/family-assets/:itemId",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res, { finances: true });
    if (!m) return;
    const r = await query(`DELETE FROM family_assets WHERE id = $1 AND matter_id = $2 RETURNING description`, [req.params.itemId, m.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found on this schedule." });
    await log(m.id, req.user.id, `Asset schedule: removed ${r.rows[0].description}`);
    res.status(204).send();
  })
);

router.get(
  "/:id/asset-schedule",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res, { finances: true });
    if (!m) return;
    const [firm, items] = await Promise.all([
      query(`SELECT name FROM firms WHERE id = $1`, [req.user.firmId]),
      query(`SELECT * FROM family_assets WHERE matter_id = $1 ORDER BY kind, created_at`, [m.id]),
    ]);
    const buffer = await assetScheduleDoc({ matter: m, firm: firm.rows[0], feeEarner: m.fee_earner_name, details: m.details || {}, items: items.rows, schedule: assetSchedule(items.rows) });
    await log(m.id, req.user.id, "Asset schedule (ES2) draft generated");
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`Asset schedule - ${m.reference}.docx`)}`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  })
);

// ---- Children ----

const LIVES_WITH = ["Client", "Other party", "Shared", "Someone else"];

function checkChild(body, partial) {
  const values = {};
  const has = (k) => Object.hasOwn(body, k);
  if (!partial || has("name")) {
    if (isBlank(body.name) || typeof body.name !== "string") return { error: "Give the child's name." };
    values.name = body.name.trim();
  }
  if (has("dateOfBirth")) {
    if (!isBlank(body.dateOfBirth) && !validDate(body.dateOfBirth)) return { error: "Date of birth must be a date." };
    values.date_of_birth = text(body.dateOfBirth);
  }
  if (has("livesWith")) {
    if (!isBlank(body.livesWith) && !LIVES_WITH.includes(body.livesWith)) return { error: `livesWith must be one of: ${LIVES_WITH.join(", ")}.` };
    values.lives_with = text(body.livesWith);
  }
  if (has("school")) values.school = typeof body.school === "string" ? text(body.school) : null;
  if (has("notes")) values.notes = typeof body.notes === "string" ? body.notes.trim() : "";
  return { values };
}

router.post(
  "/:id/children",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res);
    if (!m) return;
    const { values, error } = checkChild(req.body, false);
    if (error) return res.status(400).json({ error });
    const cols = ["matter_id", ...Object.keys(values)];
    const params = [m.id, ...Object.values(values)];
    const r = await query(
      `INSERT INTO family_children (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      params
    );
    await log(m.id, req.user.id, `Child added: ${values.name}`);
    res.status(201).json(r.rows[0]);
  })
);

router.patch(
  "/:id/children/:childId",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res);
    if (!m) return;
    const { values, error } = checkChild(req.body, true);
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(values);
    if (!keys.length) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(
      `UPDATE family_children SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(", ")} WHERE id = $1 AND matter_id = $2 RETURNING *`,
      [req.params.childId, m.id, ...Object.values(values)]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Child not found on this matter." });
    res.json(r.rows[0]);
  })
);

router.delete(
  "/:id/children/:childId",
  asyncHandler(async (req, res) => {
    const m = await findFamilyMatter(req, res);
    if (!m) return;
    const r = await query(`DELETE FROM family_children WHERE id = $1 AND matter_id = $2 RETURNING name`, [req.params.childId, m.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Child not found on this matter." });
    await log(m.id, req.user.id, `Child removed: ${r.rows[0].name}`);
    res.status(204).send();
  })
);

module.exports = { router, familyDetail, LIVES_WITH };
