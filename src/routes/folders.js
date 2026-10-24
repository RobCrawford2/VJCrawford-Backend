/**
 * Document folders on a matter.
 *
 *   POST   /matters/:id/folders                       add a folder { name }
 *   PATCH  /matters/:id/folders/:folderId             rename / reorder { name, position }
 *   DELETE /matters/:id/folders/:folderId             delete (its documents become unfiled)
 *   POST   /matters/:id/folders/standard              add any of the standard folders that are missing
 *   PUT    /matters/:id/documents/:documentId/folder  move a document { folderId | null }
 *
 * A matter gets its department's standard folders the first time it's
 * opened (ensureFolders), so older matters pick them up too.
 */
const express = require("express");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { AREA_BY_KEY, FOLDER_FOR_CATEGORY } = require("../config/areas");

const router = express.Router();
router.use(requireAuth);

const MAX_NAME = 80;

/** The standard folder names for a department: the firm's own list if set, else the system default. */
async function standardFolders(db, firmId, department) {
  const own = await db.query(`SELECT folders FROM firm_folder_templates WHERE firm_id = $1 AND department = $2`, [firmId, department]);
  if (own.rows.length) return own.rows[0].folders;
  return AREA_BY_KEY[department]?.folders || [];
}

/** Adds the named folders that the matter doesn't have yet (case-insensitive), after the existing ones. */
async function addFolders(db, matterId, names) {
  const existing = (await db.query(`SELECT lower(name) AS n, position FROM document_folders WHERE matter_id = $1`, [matterId])).rows;
  const have = new Set(existing.map((r) => r.n));
  let position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const added = [];
  for (const name of names) {
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    await db.query(`INSERT INTO document_folders (matter_id, name, position) VALUES ($1, $2, $3)`, [matterId, name, position++]);
    added.push(name);
  }
  return added;
}

/**
 * First time a matter is opened (or when it's created): give it the
 * standard folders, and file any existing documents by their category.
 */
async function ensureFolders(db, matterId) {
  const m = (await db.query(`SELECT firm_id, department, folders_ready FROM matters WHERE id = $1`, [matterId])).rows[0];
  if (!m || m.folders_ready) return;
  // Only one request does the set-up, even if two open the matter at once.
  const claimed = await db.query(`UPDATE matters SET folders_ready = true WHERE id = $1 AND NOT folders_ready RETURNING id`, [matterId]);
  if (!claimed.rows.length) return;
  await addFolders(db, matterId, await standardFolders(db, m.firm_id, m.department));
  for (const [category, folder] of Object.entries(FOLDER_FOR_CATEGORY)) {
    await db.query(
      `UPDATE documents d SET folder_id = f.id FROM document_folders f
       WHERE d.matter_id = $1 AND d.folder_id IS NULL AND d.category = $2 AND f.matter_id = $1 AND lower(f.name) = lower($3)`,
      [matterId, category, folder]
    );
  }
}

async function visibleMatter(req, res) {
  const v = matterVisibilityClause(req.user, 3);
  const r = await query(`SELECT m.id, m.firm_id, m.department FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
    [req.params.id, req.user.firmId, ...v.params]);
  if (!r.rows.length) {
    res.status(404).json({ error: "Matter not found." });
    return null;
  }
  return r.rows[0];
}

const log = (matterId, userId, text) =>
  query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'doc',$3)`, [matterId, userId, text]);

function cleanName(name) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) return { error: "Give the folder a name." };
  if (n.length > MAX_NAME) return { error: `Folder names can be at most ${MAX_NAME} characters.` };
  return { name: n };
}

router.post(
  "/:id/folders/standard",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const added = await addFolders({ query }, m.id, await standardFolders({ query }, m.firm_id, m.department));
    if (added.length) await log(m.id, req.user.id, `Standard folders added: ${added.join(", ")}`);
    res.json({ added });
  })
);

router.post(
  "/:id/folders",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const { name, error } = cleanName(req.body.name);
    if (error) return res.status(400).json({ error });
    const added = await addFolders({ query }, m.id, [name]);
    if (!added.length) return res.status(409).json({ error: `There's already a folder called “${name}”.` });
    const folder = (await query(`SELECT * FROM document_folders WHERE matter_id = $1 AND lower(name) = lower($2)`, [m.id, name])).rows[0];
    await log(m.id, req.user.id, `Folder added: ${name}`);
    res.status(201).json(folder);
  })
);

router.patch(
  "/:id/folders/:folderId",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const folder = (await query(`SELECT * FROM document_folders WHERE id = $1 AND matter_id = $2`, [req.params.folderId, m.id])).rows[0];
    if (!folder) return res.status(404).json({ error: "Folder not found." });
    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      const { name, error } = cleanName(req.body.name);
      if (error) return res.status(400).json({ error });
      params.push(name); sets.push(`name = $${params.length}`);
    }
    if (req.body.position !== undefined) {
      if (!Number.isInteger(req.body.position) || req.body.position < 0) return res.status(400).json({ error: "position must be a whole number." });
      params.push(req.body.position); sets.push(`position = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "No recognised fields to update." });
    params.push(folder.id);
    const updated = (await query(`UPDATE document_folders SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params)).rows[0];
    if (req.body.name !== undefined && updated.name !== folder.name) await log(m.id, req.user.id, `Folder renamed: ${folder.name} → ${updated.name}`);
    res.json(updated);
  })
);

router.delete(
  "/:id/folders/:folderId",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const folder = (await query(`DELETE FROM document_folders WHERE id = $1 AND matter_id = $2 RETURNING name`, [req.params.folderId, m.id])).rows[0];
    if (!folder) return res.status(404).json({ error: "Folder not found." });
    await log(m.id, req.user.id, `Folder deleted: ${folder.name} (its documents are now unfiled)`);
    res.status(204).send();
  })
);

router.put(
  "/:id/documents/:documentId/folder",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const doc = (await query(`SELECT id, name FROM documents WHERE id = $1 AND matter_id = $2`, [req.params.documentId, m.id])).rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    let folder = null;
    if (req.body.folderId) {
      folder = (await query(`SELECT id, name FROM document_folders WHERE id = $1 AND matter_id = $2`, [req.body.folderId, m.id])).rows[0];
      if (!folder) return res.status(400).json({ error: "That folder isn't on this matter." });
    }
    await query(`UPDATE documents SET folder_id = $2 WHERE id = $1`, [doc.id, folder ? folder.id : null]);
    await log(m.id, req.user.id, `Document “${doc.name}” moved to ${folder ? folder.name : "Unfiled"}`);
    res.status(204).send();
  })
);

module.exports = { router, ensureFolders, standardFolders };
