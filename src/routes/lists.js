/**
 * Registers kept on a matter, defined per department in src/config/practice
 * (Part 36 offers, special damages, charges, transaction checklist…):
 *
 *   POST   /matters/:id/lists/:list               add an item
 *   PATCH  /matters/:id/lists/:list/:itemId       change it (send only what changes; blank clears)
 *   DELETE /matters/:id/lists/:list/:itemId
 *   GET    /matters/:id/lists/:list/document      the list and its summary as a Word table
 *
 * practiceDetail(matter) adds the lists and the calculation cards to the matter detail.
 */
const express = require("express");
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, TextRun } = require("docx");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { practiceFor, listsFor } = require("../config/practice");
const { cleanDetail } = require("./details");
const fmt = require("../utils/format");

const router = express.Router();
router.use(requireAuth);

async function findMatterAndList(req, res) {
  const v = matterVisibilityClause(req.user, 3);
  const m = (await query(`SELECT m.* FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`, [req.params.id, req.user.firmId, ...v.params])).rows[0];
  if (!m) {
    res.status(404).json({ error: "Matter not found." });
    return [];
  }
  const list = listsFor(m.department, m.type).find((l) => l.key === req.params.list);
  if (!list) {
    res.status(404).json({ error: "This matter doesn't keep that list." });
    return [];
  }
  return [m, list];
}

/** Validates item values against the list's fields. Returns { data } or { error }. */
function checkItem(list, body, current = {}) {
  const src = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const data = { ...current };
  let changed = 0;
  for (const field of list.fields) {
    if (!Object.hasOwn(src, field.key)) continue;
    const [value, error] = cleanDetail(field, src[field.key]);
    if (error) return { error };
    if (value === null) delete data[field.key];
    else data[field.key] = value;
    changed++;
  }
  if (!changed) return { error: "Nothing to save." };
  const missing = list.fields.find((f) => f.required && (data[f.key] === undefined || data[f.key] === ""));
  if (missing) return { error: `${missing.label} is required.` };
  return { data };
}

const itemLabel = (list, data) => {
  const first = list.fields.find((f) => f.kind === "text" && data[f.key]) || list.fields[0];
  return data[first.key] !== undefined ? String(data[first.key]).slice(0, 80) : list.singular;
};

const log = (matterId, userId, text) =>
  query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'edit',$3)`, [matterId, userId, text]);

router.post(
  "/:id/lists/:list",
  asyncHandler(async (req, res) => {
    const [m, list] = await findMatterAndList(req, res);
    if (!m) return;
    const { data, error } = checkItem(list, req.body);
    if (error) return res.status(400).json({ error });
    const r = await query(
      `INSERT INTO matter_list_items (matter_id, list, data, created_by, position)
       VALUES ($1,$2,$3::jsonb,$4, (SELECT COALESCE(MAX(position) + 1, 0) FROM matter_list_items WHERE matter_id = $1 AND list = $2)) RETURNING *`,
      [m.id, list.key, JSON.stringify(data), req.user.id]
    );
    await log(m.id, req.user.id, `${list.title}: added ${itemLabel(list, data)}`);
    res.status(201).json(r.rows[0]);
  })
);

router.patch(
  "/:id/lists/:list/:itemId",
  asyncHandler(async (req, res) => {
    const [m, list] = await findMatterAndList(req, res);
    if (!m) return;
    const item = (await query(`SELECT * FROM matter_list_items WHERE id = $1 AND matter_id = $2 AND list = $3`, [req.params.itemId, m.id, list.key])).rows[0];
    if (!item) return res.status(404).json({ error: "Not found on this list." });
    const { data, error } = checkItem(list, req.body, item.data);
    if (error) return res.status(400).json({ error });
    const r = await query(`UPDATE matter_list_items SET data = $2::jsonb WHERE id = $1 RETURNING *`, [item.id, JSON.stringify(data)]);
    // Log status changes (the usual reason to edit), not every keystroke-level edit.
    const statusField = list.fields.find((f) => f.key === "status");
    if (statusField && data.status !== item.data.status) await log(m.id, req.user.id, `${list.title}: ${itemLabel(list, data)} — ${data.status || "status cleared"}`);
    res.json(r.rows[0]);
  })
);

router.delete(
  "/:id/lists/:list/:itemId",
  asyncHandler(async (req, res) => {
    const [m, list] = await findMatterAndList(req, res);
    if (!m) return;
    const r = await query(`DELETE FROM matter_list_items WHERE id = $1 AND matter_id = $2 AND list = $3 RETURNING data`, [req.params.itemId, m.id, list.key]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found on this list." });
    await log(m.id, req.user.id, `${list.title}: removed ${itemLabel(list, r.rows[0].data)}`);
    res.status(204).send();
  })
);

/** Shows a stored value the way the screen does. */
function showValue(field, v) {
  if (v === undefined || v === null || v === "") return "";
  switch (field.kind) {
    case "money": return fmt.money(v);
    case "date": return fmt.date(v);
    case "datetime": return fmt.dateTime(v);
    case "percent": return `${v}%`;
    case "bool": return v ? "Yes" : "No";
    default: return String(v);
  }
}

router.get(
  "/:id/lists/:list/document",
  asyncHandler(async (req, res) => {
    const [m, list] = await findMatterAndList(req, res);
    if (!m) return;
    const [rows, firm] = await Promise.all([
      query(`SELECT * FROM matter_list_items WHERE matter_id = $1 AND list = $2 ORDER BY position, created_at`, [m.id, list.key]),
      query(`SELECT name FROM firms WHERE id = $1`, [req.user.firmId]),
    ]);
    const items = rows.rows.map((r) => ({ id: r.id, ...r.data }));
    const columns = list.fields.filter((f) => f.table !== false);
    const summary = list.summary ? list.summary(items, m) : null;
    const border = { style: BorderStyle.SINGLE, size: 4, color: "B8B2A3" };
    const cell = (text, head) => new TableCell({
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "E8E4DA" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: !!head, size: 18, font: "Calibri" })] })],
    });
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: [
        new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.label, true)) }),
        ...items.map((it) => new TableRow({ children: columns.map((c) => cell(showValue(c, it[c.key]))) })),
      ],
    });
    const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, font: "Calibri", size: opts.size || 21, bold: opts.bold })], spacing: { after: 120 } });
    const doc = new Document({
      creator: firm.rows[0].name,
      title: `${list.title} — ${m.reference}`,
      sections: [{
        properties: { page: { size: { orientation: columns.length > 5 ? "landscape" : "portrait" }, margin: { top: 800, bottom: 800, left: 800, right: 800 } } },
        children: [
          p(`${list.title}`, { bold: true, size: 30 }),
          p(`${m.reference} — ${m.client} — ${m.address}`),
          p(`Prepared by ${firm.rows[0].name} on ${fmt.date(new Date().toISOString())}`),
          items.length ? table : p("Nothing recorded."),
          ...(summary ? [p(""), p("Summary", { bold: true, size: 24 }), ...summary.rows.map((r) => p(`${r.label}: ${r.value}`, { bold: r.strong })), ...(summary.note ? [p(summary.note, { size: 18 })] : [])] : []),
        ],
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    await log(m.id, req.user.id, `${list.title} exported to Word`);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${list.title} - ${m.reference}.docx`)}`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  })
);

/** The lists (with their items and summaries) and calculation cards for a matter. */
async function practiceDetail(matter) {
  const practice = practiceFor(matter.department);
  if (!practice) return {};
  const defs = listsFor(matter.department, matter.type);
  const rows = defs.length
    ? (await query(`SELECT * FROM matter_list_items WHERE matter_id = $1 ORDER BY position, created_at`, [matter.id])).rows
    : [];
  const byList = Object.fromEntries(defs.map((l) => [l.key, rows.filter((r) => r.list === l.key).map((r) => ({ id: r.id, ...r.data }))]));
  const lists = defs.map((l) => {
    const items = byList[l.key];
    return {
      key: l.key, title: l.title, singular: l.singular, icon: l.icon, intro: l.intro || null,
      fields: l.fields, items, summary: l.summary ? l.summary(items, matter) : null,
    };
  });
  const insights = practice.insights ? practice.insights(matter, byList) : { cards: [], attention: [] };
  const attention = [...(insights.attention || []), ...lists.flatMap((l) => l.summary?.attention || [])];
  return { lists, insights: insights.cards || [], serverAttention: attention };
}

module.exports = { router, practiceDetail, checkItem };
