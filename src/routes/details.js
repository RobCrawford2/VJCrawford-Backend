/**
 * PATCH /matters/:id/details — the details recorded for the matter's
 * department and type (see src/config/matterDetails.js). Send any of the
 * fields; a blank value clears it.
 */
const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { detailFieldsFor } = require("../config/matterDetails");
const { validDate, isBlank } = require("../utils/validate");

const router = express.Router();
router.use(requireAuth);

/** Checks one value against its field definition; returns [value, error]. A null value clears the field. */
function cleanDetail(field, raw) {
  if (field.kind === "bool") return [raw === true, null];
  if (isBlank(raw)) return [null, null];
  switch (field.kind) {
    case "date":
      return validDate(String(raw)) ? [String(raw), null] : [null, `${field.label} must be a date.`];
    case "datetime": {
      const v = String(raw).slice(0, 16);
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && validDate(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60
        ? [v, null] : [null, `${field.label} must be a date and time.`];
    }
    case "number": {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? [v, null] : [null, `${field.label} must be a number (0 or more).`];
    }
    case "money": {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? [Math.round(v * 100) / 100, null] : [null, `${field.label} must be £0 or more.`];
    }
    case "percent": {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? [v, null] : [null, `${field.label} must be between 0 and 100.`];
    }
    case "select":
      return field.options.includes(raw) ? [raw, null] : [null, `${field.label} must be one of: ${field.options.join(", ")}.`];
    default:
      if (typeof raw !== "string") return [null, `${field.label} must be text.`];
      return raw.length > 2000 ? [null, `${field.label} is too long.`] : [raw.trim(), null];
  }
}

router.patch(
  "/:id/details",
  asyncHandler(async (req, res) => {
    const v = matterVisibilityClause(req.user, 3);
    const m = (await query(`SELECT m.id, m.department, m.type, m.details FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
      [req.params.id, req.user.firmId, ...v.params])).rows[0];
    if (!m) return res.status(404).json({ error: "Matter not found." });
    const fields = detailFieldsFor(m.department, m.type);
    if (!fields.length) return res.status(400).json({ error: "There are no extra details for this kind of matter." });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const next = { ...(m.details || {}) };
    let changed = 0;
    for (const field of fields) {
      if (!Object.hasOwn(body, field.key)) continue;
      const [value, error] = cleanDetail(field, body[field.key]);
      if (error) return res.status(400).json({ error });
      if (value === null) delete next[field.key];
      else next[field.key] = value;
      changed++;
    }
    if (!changed) return res.status(400).json({ error: "No recognised fields to update." });
    const r = await query(`UPDATE matters SET details = $2::jsonb WHERE id = $1 RETURNING details`, [m.id, JSON.stringify(next)]);
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'edit',$3)`, [m.id, req.user.id, `${m.type} details updated`]);
    res.json(r.rows[0].details);
  })
);

module.exports = { router, cleanDetail };
