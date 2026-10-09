const path = require("path");
const express = require("express");
const multer = require("multer");
const { query, pool } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");

const router = express.Router();
router.use(requireAuth); // every route below requires a valid logged-in user

const { STAGE_NAMES, STAGE_COUNT, CLOSED_INDEX } = require("../utils/stages");
const { ukToday } = require("../utils/dates");
const { validateRows } = require("../utils/matterImport");
const { buildReportOnTitle } = require("../reports/reportOnTitle");

function logActivity(client, matterId, userId, type, text) {
  return client.query(
    `INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1, $2, $3, $4)`,
    [matterId, userId, type, text]
  );
}

/**
 * Loads a matter's full nested detail: the matter row plus every related
 * collection. Run as parallel queries rather than one giant join — simpler
 * to read and reason about, and each of these hits an indexed matter_id
 * column so it's cheap even on a large caseload.
 */
async function loadMatterDetail(matterId) {
  const [matter, documents, emails, enquiries, searches, undertakings, tasks, activity, links, replies, comments] = await Promise.all([
    query(`SELECT * FROM matters WHERE id = $1`, [matterId]),
    query(`SELECT * FROM documents WHERE matter_id = $1 ORDER BY doc_date DESC NULLS LAST, created_at DESC`, [matterId]),
    query(`SELECT * FROM emails WHERE matter_id = $1 ORDER BY email_date DESC, created_at DESC`, [matterId]),
    query(`SELECT * FROM enquiries WHERE matter_id = $1 ORDER BY number ASC`, [matterId]),
    query(`SELECT * FROM searches WHERE matter_id = $1 ORDER BY date_ordered DESC NULLS LAST`, [matterId]),
    query(`SELECT * FROM undertakings WHERE matter_id = $1 ORDER BY date_given DESC NULLS LAST`, [matterId]),
    query(
      `SELECT t.*, u.name AS assigned_to_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.matter_id = $1 ORDER BY (t.status = 'Open') DESC, t.due_date ASC NULLS LAST`,
      [matterId]
    ),
    query(`SELECT * FROM activity_log WHERE matter_id = $1 ORDER BY occurred_at DESC LIMIT 100`, [matterId]),
    query(
      `SELECT linked_matter_id AS id, m.reference, m.address, m.client, m.type, m.current_stage_index, m.target_completion
       FROM matter_links l JOIN matters m ON m.id = l.linked_matter_id
       WHERE l.matter_id = $1`,
      [matterId]
    ),
    query(
      `SELECT r.*, u.name AS created_by_name, em.subject AS source_email_subject
       FROM enquiry_replies r JOIN enquiries e ON e.id = r.enquiry_id
       LEFT JOIN users u ON u.id = r.created_by LEFT JOIN emails em ON em.id = r.source_email_id
       WHERE e.matter_id = $1 ORDER BY r.date_received ASC, r.created_at ASC`,
      [matterId]
    ),
    query(
      `SELECT c.*, u.name AS created_by_name
       FROM enquiry_comments c JOIN enquiries e ON e.id = c.enquiry_id LEFT JOIN users u ON u.id = c.created_by
       WHERE e.matter_id = $1 ORDER BY c.created_at ASC`,
      [matterId]
    ),
  ]);

  if (!matter.rows.length) return null;

  return {
    ...matter.rows[0],
    documents: documents.rows,
    emails: emails.rows,
    enquiries: enquiries.rows.map((q) => ({
      ...q,
      replies: replies.rows.filter((r) => r.enquiry_id === q.id),
      comments: comments.rows.filter((c) => c.enquiry_id === q.id),
    })),
    searches: searches.rows,
    undertakings: undertakings.rows,
    tasks: tasks.rows,
    activity: activity.rows,
    linkedMatters: links.rows,
  };
}

/**
 * Next free number for CV-<year>-NNNN references in this firm. Uses the
 * highest existing number rather than a count, so imported references (which
 * can have gaps or start high) never collide with newly created ones.
 */
async function nextReferenceNumber(db, firmId, year) {
  const result = await db.query(
    `SELECT coalesce(max(substring(reference FROM '^CV-[0-9]{4}-([0-9]+)$')::int), 0) AS max
     FROM matters WHERE firm_id = $1 AND reference LIKE $2`,
    [firmId, `CV-${year}-%`]
  );
  return result.rows[0].max + 1;
}

const formatReference = (year, n) => `CV-${year}-${String(n).padStart(4, "0")}`;

const EXCHANGE_INDEX = STAGE_NAMES.indexOf("Exchange");

/**
 * Checks before a matter may move to Exchange or beyond (from before it),
 * when the firm has them switched on. Returns a list of plain-English
 * reasons it can't yet — empty means OK.
 */
async function exchangeBlockers(db, firmId, matterId, toStage) {
  if (toStage < EXCHANGE_INDEX) return [];
  const firm = (await db.query(`SELECT require_exchange_checks FROM firms WHERE id = $1`, [firmId])).rows[0];
  if (firm && firm.require_exchange_checks === false) return [];
  const m = (await db.query(
    `SELECT current_stage_index, type, lender, pre_exchange_confirmed_by, deposit_received_date,
            to_char(mortgage_offer_expiry, 'YYYY-MM-DD') AS expiry, to_char(target_completion, 'YYYY-MM-DD') AS completion
     FROM matters WHERE id = $1`,
    [matterId]
  )).rows[0];
  if (!m || m.current_stage_index >= EXCHANGE_INDEX) return [];

  const reasons = [];
  if (!m.pre_exchange_confirmed_by) reasons.push("The pre-exchange review hasn't been confirmed.");
  if (m.lender && (m.type === "Purchase" || m.type === "Remortgage")) {
    const needed = m.completion || ukToday();
    if (!m.expiry) reasons.push("The mortgage offer expiry date isn't recorded.");
    else if (m.expiry < needed) {
      reasons.push(m.completion
        ? `The mortgage offer expires (${m.expiry}) before the target completion date (${m.completion}).`
        : `The mortgage offer expired on ${m.expiry}.`);
    }
  }
  if (m.type === "Purchase" && !m.deposit_received_date) reasons.push("The deposit hasn't been marked as received.");
  return reasons;
}

function blockedResponse(res, reasons) {
  return res.status(400).json({
    error: `This matter can't move to Exchange yet:\n• ${reasons.join("\n• ")}`,
    exchangeBlockers: reasons,
  });
}

/** Whether the firm requires sign-off for fee earners' stage moves. */
async function firmRequiresSignoff(firmId) {
  const result = await query(`SELECT require_stage_signoff FROM firms WHERE id = $1`, [firmId]);
  return result.rows[0]?.require_stage_signoff ?? true;
}

/**
 * Who can move a matter's stage directly, and sign off others' requests:
 * the matter's own fee earner, or a supervisor who supervises the matter or
 * its fee earner. Secretaries, assistants and admins can't — admin is a
 * system role, not part of the file's chain of responsibility.
 */
const SIGNOFF_CLAUSE = (userParam) => `(
  m.fee_earner_id = $${userParam + 1}
  OR ($${userParam}::text = 'supervisor' AND (m.supervisor_id = $${userParam + 1} OR fe.supervisor_id = $${userParam + 1}))
)`;

async function canSignOff(user, matterId) {
  const result = await query(
    `SELECT 1 FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
     WHERE m.id = $1 AND m.firm_id = $2 AND ${SIGNOFF_CLAUSE(3)}`,
    [matterId, user.firmId, user.role, user.id]
  );
  return result.rows.length > 0;
}

/**
 * Checks a member of staff can be given a task on this matter: active, in
 * the firm, and able to see the matter under their own role's visibility.
 * Returns { user } or { error }.
 */
async function checkAssignee(db, firmId, matterId, assigneeId) {
  const found = await db.query(`SELECT id, firm_id, role, name, active FROM users WHERE id = $1 AND firm_id = $2`, [assigneeId, firmId]);
  const user = found.rows[0];
  if (!user) return { error: "That person isn't a member of staff." };
  if (!user.active) return { error: `${user.name}'s account is deactivated.` };
  const visibility = matterVisibilityClause({ id: user.id, role: user.role }, 3);
  const visible = await db.query(
    `SELECT 1 FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${visibility.clause}`,
    [matterId, firmId, ...visibility.params]
  );
  if (!visible.rows.length) return { error: `${user.name} can't see this matter, so can't be given tasks on it.` };
  return { user };
}

/** Confirms the requesting user is allowed to see this matter before any nested-resource write proceeds. */
async function assertMatterVisible(req, res, matterId) {
  const params = [matterId, req.user.firmId];
  const visibility = matterVisibilityClause(req.user, 3);
  params.push(...visibility.params);

  const result = await query(
    `SELECT id FROM matters m WHERE m.id = $1 AND m.firm_id = $2 ${visibility.clause}`,
    params
  );
  if (!result.rows.length) {
    res.status(404).json({ error: "Matter not found." });
    return false;
  }
  return true;
}

// -----------------------------------------------------------------------
// GET /matters — paginated, filtered list
// -----------------------------------------------------------------------
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const {
      limit = 20,
      offset = 0,
      type,
      showClosed = "true",
      feeEarnerId,
      search,
    } = req.query;

    const pageSize = Math.min(parseInt(limit, 10) || 20, 100); // hard ceiling so a client can't request the whole table at once
    const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const conditions = ["m.firm_id = $1"];
    const params = [req.user.firmId];

    const visibility = matterVisibilityClause(req.user, params.length + 1);
    if (visibility.clause) {
      conditions.push(visibility.clause.replace(/^AND /, ""));
      params.push(...visibility.params);
    }

    if (type && type !== "All") {
      params.push(type);
      conditions.push(`m.type = $${params.length}`);
    }
    if (showClosed === "false") {
      conditions.push(`m.current_stage_index <> ${CLOSED_INDEX}`);
    }
    if (feeEarnerId) {
      params.push(feeEarnerId);
      conditions.push(`m.fee_earner_id = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(search.trim());
      conditions.push(
        `to_tsvector('english', coalesce(m.address,'') || ' ' || coalesce(m.client,'') || ' ' || coalesce(m.reference,'')) @@ plainto_tsquery('english', $${params.length})`
      );
    }

    const whereClause = conditions.join(" AND ");

    const [rows, count] = await Promise.all([
      query(
        `SELECT m.*, fe.name AS fee_earner_name
         FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
         WHERE ${whereClause}
         ORDER BY m.updated_at DESC
         LIMIT ${pageSize} OFFSET ${pageOffset}`,
        params
      ),
      query(`SELECT count(*) FROM matters m WHERE ${whereClause}`, params),
    ]);

    res.json({
      matters: rows.rows,
      pagination: {
        total: parseInt(count.rows[0].count, 10),
        limit: pageSize,
        offset: pageOffset,
      },
    });
  })
);

// -----------------------------------------------------------------------
// POST /matters — create
// -----------------------------------------------------------------------
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { address, client, type, price, feeEarnerId, supervisorId, otherSideSolicitor, otherSideSolicitorEmail, estateAgent, lender, targetExchange, targetCompletion, mortgageOfferExpiry } = req.body;

    if (!address || !client || !type) {
      return res.status(400).json({ error: "address, client and type are required." });
    }
    if (!["Sale", "Purchase", "Remortgage"].includes(type)) {
      return res.status(400).json({ error: "type must be Sale, Purchase or Remortgage." });
    }
    if (req.body.tenure && !TENURES.includes(req.body.tenure)) {
      return res.status(400).json({ error: `tenure must be one of: ${TENURES.join(", ")}.` });
    }

    // Reference generation: CV-<year>-<next number for the firm>. Two staff
    // opening a matter at the same instant could pick the same number; the
    // unique (firm_id, reference) constraint turns that into a 409 retry
    // rather than a duplicate.
    const year = new Date().getFullYear();
    const reference = formatReference(year, await nextReferenceNumber({ query }, req.user.firmId, year));

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const result = await client_.query(
        `INSERT INTO matters (
           firm_id, reference, address, client, type, price, fee_earner_id, supervisor_id,
           other_side_solicitor, other_side_solicitor_email, estate_agent, lender,
           date_instructed, target_exchange, target_completion, mortgage_offer_expiry
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CURRENT_DATE, $13,$14,$15)
         RETURNING *`,
        [req.user.firmId, reference, address, client, type, price || null, feeEarnerId || null, supervisorId || null,
         otherSideSolicitor || null, otherSideSolicitorEmail || null, estateAgent || null, lender || null,
         targetExchange || null, targetCompletion || null, mortgageOfferExpiry || null]
      );
      let matter = result.rows[0];
      const extras = EXTRA_CREATE_FIELDS.filter((k) => req.body[k] !== undefined && req.body[k] !== "");
      if (extras.length) {
        const updated = await client_.query(
          `UPDATE matters SET ${extras.map((k, i) => `${PATCHABLE_FIELDS[k]} = $${i + 1}`).join(", ")}
           WHERE id = $${extras.length + 1} RETURNING *`,
          [...extras.map((k) => req.body[k]), matter.id]
        );
        matter = updated.rows[0];
      }
      await logActivity(client_, matter.id, req.user.id, "stage", "Matter opened at Instructed");
      await client_.query("COMMIT");
      res.status(201).json(matter);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

// -----------------------------------------------------------------------
// POST /matters/import — bulk import from a spreadsheet (admin only)
//
// Body: { rows: [{ <header>: <value> }...], dryRun: boolean }. Every row is
// validated first; with dryRun (or if any row has a problem) nothing is
// written and the per-row problems come back. Otherwise all rows are
// inserted in one transaction — all or nothing.
// -----------------------------------------------------------------------
const MAX_IMPORT_ROWS = 1000;

router.post(
  "/import",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { rows, dryRun = true } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "The file has no rows to import." });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `Import at most ${MAX_IMPORT_ROWS} rows at a time — split the file and import each part.` });
    }
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      return res.status(400).json({ error: "Rows must be objects keyed by column header." });
    }

    const [users, refs] = await Promise.all([
      query(`SELECT id, name, email, active FROM users WHERE firm_id = $1`, [req.user.firmId]),
      query(`SELECT lower(reference) AS reference FROM matters WHERE firm_id = $1`, [req.user.firmId]),
    ]);
    const { matters, errors, ignoredHeaders } = validateRows(rows, {
      users: users.rows,
      existingReferences: new Set(refs.rows.map((r) => r.reference)),
    });

    const summary = { valid: matters.length, errors, ignoredHeaders };
    if (dryRun) return res.json(summary);
    if (errors.length) return res.status(400).json({ error: "Some rows have problems — nothing was imported.", ...summary });
    if (!matters.length) return res.status(400).json({ error: "The file has no rows to import." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      // Serialise imports/new-matter numbering for this firm within the transaction.
      await client_.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`matter-refs:${req.user.firmId}`]);
      const year = new Date().getFullYear();
      let next = await nextReferenceNumber(client_, req.user.firmId, year);

      for (const m of matters) {
        const reference = m.reference || formatReference(year, next++);
        const result = await client_.query(
          `INSERT INTO matters (
             firm_id, reference, address, client, type, price, current_stage_index,
             fee_earner_id, supervisor_id, other_side_solicitor, other_side_solicitor_email,
             estate_agent, lender, date_instructed, target_exchange, target_completion,
             actual_exchange, actual_completion, mortgage_offer_expiry, notes,
             client_address, client_email, client_phone, client_salutation, tenure, title_number,
             registered_proprietor, lease_term, ground_rent, service_charge, deposit, sdlt, mortgage_conditions
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, coalesce($14::date, CURRENT_DATE),$15,$16,$17,$18,$19,$20,
                     $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
           RETURNING id`,
          [req.user.firmId, reference, m.address, m.client, m.type, m.price ?? null, m.stage,
           m.feeEarnerId || null, m.supervisorId || null, m.otherSideSolicitor || null, m.otherSideSolicitorEmail || null,
           m.estateAgent || null, m.lender || null, m.dateInstructed || null, m.targetExchange || null, m.targetCompletion || null,
           m.actualExchange || null, m.actualCompletion || null, m.mortgageOfferExpiry || null, m.notes || "",
           m.clientAddress || null, m.clientEmail || null, m.clientPhone || null, m.clientSalutation || null, m.tenure || null,
           m.titleNumber || null, m.registeredProprietor || null, m.leaseTerm || null, m.groundRent || null,
           m.serviceCharge || null, m.deposit ?? null, m.sdlt ?? null, m.mortgageConditions || null]
        );
        await logActivity(client_, result.rows[0].id, req.user.id, "stage", `Matter imported at ${STAGE_NAMES[m.stage]}`);
      }
      await client_.query("COMMIT");
      res.status(201).json({ imported: matters.length });
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

// -----------------------------------------------------------------------
// GET /matters/upcoming?days=7 — exchanges and completions due soon (or
// overdue), with what's still outstanding on each. Powers "This week".
// -----------------------------------------------------------------------
router.get(
  "/upcoming",
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 60);
    const params = [req.user.firmId, days];
    const visibility = matterVisibilityClause(req.user, 3);
    params.push(...visibility.params);
    const result = await query(
      `SELECT m.id, m.reference, m.address, m.client, m.type, m.current_stage_index, m.lender,
              fe.name AS fee_earner_name,
              to_char(m.target_exchange, 'YYYY-MM-DD') AS target_exchange,
              to_char(m.target_completion, 'YYYY-MM-DD') AS target_completion,
              to_char(m.actual_exchange, 'YYYY-MM-DD') AS actual_exchange,
              to_char(m.mortgage_offer_expiry, 'YYYY-MM-DD') AS mortgage_offer_expiry,
              (m.pre_exchange_confirmed_by IS NOT NULL AND m.pre_exchange_confirmed_by <> '') AS pre_exchange_confirmed,
              (m.deposit_received_date IS NOT NULL) AS deposit_received,
              (SELECT count(*) FROM tasks t WHERE t.matter_id = m.id AND t.status = 'Open')::int AS open_tasks,
              (SELECT count(*) FROM enquiries q WHERE q.matter_id = m.id AND q.status <> 'Answered')::int AS open_enquiries,
              (SELECT count(*) FROM searches x WHERE x.matter_id = m.id AND x.date_received IS NULL)::int AS searches_awaited
       FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
       WHERE m.firm_id = $1 ${visibility.clause}
         AND m.current_stage_index < ${CLOSED_INDEX}
         AND (
           (m.actual_exchange IS NULL AND m.target_exchange <= CURRENT_DATE + $2::int)
           OR (m.actual_completion IS NULL AND m.target_completion <= CURRENT_DATE + $2::int)
         )
       ORDER BY LEAST(
         CASE WHEN m.actual_exchange IS NULL THEN m.target_exchange END,
         CASE WHEN m.actual_completion IS NULL THEN m.target_completion END
       ) ASC
       LIMIT 200`,
      params
    );
    res.json({ today: ukToday(), days, matters: result.rows });
  })
);

// -----------------------------------------------------------------------
// GET /matters/sign-offs/pending — requests waiting for this user's sign-off
// -----------------------------------------------------------------------
router.get(
  "/sign-offs/pending",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT r.id, r.matter_id, r.from_stage, r.to_stage, r.note, r.requested_at,
              rq.name AS requested_by_name, m.reference, m.address, m.client
       FROM stage_requests r
       JOIN matters m ON m.id = r.matter_id
       LEFT JOIN users fe ON fe.id = m.fee_earner_id
       LEFT JOIN users rq ON rq.id = r.requested_by
       WHERE r.status = 'pending' AND m.firm_id = $1 AND r.requested_by IS DISTINCT FROM $3
         AND ${SIGNOFF_CLAUSE(2)}
       ORDER BY r.requested_at ASC`,
      [req.user.firmId, req.user.role, req.user.id]
    );
    res.json(result.rows.map((r) => ({ ...r, to_stage_name: STAGE_NAMES[r.to_stage], from_stage_name: STAGE_NAMES[r.from_stage] })));
  })
);

// -----------------------------------------------------------------------
// GET /matters/:id — full detail
// -----------------------------------------------------------------------
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const detail = await loadMatterDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Matter not found." });
    const [pending, canSign, requireSignoff] = await Promise.all([
      query(
        `SELECT r.*, u.name AS requested_by_name FROM stage_requests r LEFT JOIN users u ON u.id = r.requested_by
         WHERE r.matter_id = $1 AND r.status = 'pending'`,
        [req.params.id]
      ),
      canSignOff(req.user, req.params.id),
      firmRequiresSignoff(req.user.firmId),
    ]);
    res.json({
      ...detail,
      pendingStageRequest: pending.rows[0] || null,
      canSignOffStages: canSign,
      stageMovesNeedSignoff: requireSignoff && !canSign,
    });
  })
);

// -----------------------------------------------------------------------
// GET /matters/:id/report-on-title — draft Report on Title (.docx)
// -----------------------------------------------------------------------
router.get(
  "/:id/report-on-title",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const [matter, searches, enquiries, firm] = await Promise.all([
      query(`SELECT m.*, fe.name AS fee_earner_name FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id WHERE m.id = $1`, [req.params.id]),
      query(`SELECT * FROM searches WHERE matter_id = $1 ORDER BY date_ordered ASC NULLS LAST, created_at ASC`, [req.params.id]),
      query(`SELECT * FROM enquiries WHERE matter_id = $1 ORDER BY number ASC`, [req.params.id]),
      query(`SELECT name FROM firms WHERE id = $1`, [req.user.firmId]),
    ]);
    const m = matter.rows[0];
    if (!["Purchase", "Remortgage"].includes(m.type)) {
      return res.status(400).json({ error: "A Report on Title is only produced for purchases and remortgages." });
    }

    const buffer = await buildReportOnTitle({
      matter: m,
      searches: searches.rows,
      enquiries: enquiries.rows,
      firm: firm.rows[0],
      feeEarner: m.fee_earner_name ? { name: m.fee_earner_name } : null,
    });
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'doc','Report on Title draft generated')`,
      [req.params.id, req.user.id]);

    const fileName = `Report on Title - ${m.reference}.docx`;
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  })
);

// -----------------------------------------------------------------------
// PATCH /matters/:id — update core fields (address, parties, dates, notes, team, stage)
// -----------------------------------------------------------------------
const PATCHABLE_FIELDS = {
  address: "address", client: "client", type: "type", price: "price",
  feeEarnerId: "fee_earner_id", supervisorId: "supervisor_id",
  otherSideSolicitor: "other_side_solicitor", otherSideSolicitorEmail: "other_side_solicitor_email",
  estateAgent: "estate_agent", lender: "lender",
  targetExchange: "target_exchange", targetCompletion: "target_completion",
  actualExchange: "actual_exchange", actualCompletion: "actual_completion",
  mortgageOfferExpiry: "mortgage_offer_expiry", notes: "notes",
  preExchangeChecklist: "pre_exchange_checklist",
  preExchangeConfirmedBy: "pre_exchange_confirmed_by",
  preExchangeConfirmedDate: "pre_exchange_confirmed_date",
  clientAddress: "client_address", clientEmail: "client_email", clientPhone: "client_phone",
  clientSalutation: "client_salutation",
  tenure: "tenure", titleNumber: "title_number", registeredProprietor: "registered_proprietor",
  leaseTerm: "lease_term", groundRent: "ground_rent", serviceCharge: "service_charge",
  deposit: "deposit", sdlt: "sdlt", mortgageConditions: "mortgage_conditions",
  sdltBuyerType: "sdlt_buyer_type", sdltNonResident: "sdlt_non_resident",
  depositReceivedDate: "deposit_received_date", os1PriorityExpiry: "os1_priority_expiry",
  leaseYearsRemaining: "lease_years_remaining",
};

// Fields that can also be supplied when a matter is first opened (POST /matters).
const EXTRA_CREATE_FIELDS = [
  "clientAddress", "clientEmail", "clientPhone", "clientSalutation",
  "tenure", "titleNumber", "registeredProprietor", "leaseTerm", "groundRent", "serviceCharge",
  "deposit", "sdlt", "mortgageConditions",
];
const TENURES = ["Freehold", "Leasehold", "Share of freehold", "Commonhold"];
// Empty strings from cleared optional form fields are stored as NULL (date and
// numeric columns reject ""). address/client/type/notes are NOT NULL text.
const KEEP_BLANK = new Set(["address", "client", "type", "notes"]);
const blankToNull = (key, v) => (v === "" && !KEEP_BLANK.has(key) ? null : v);

// JSONB columns need their JS value serialized before going to Postgres —
// everything else in PATCHABLE_FIELDS is a plain scalar and passes through as-is.
const JSON_FIELDS = new Set(["preExchangeChecklist"]);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;

    const setClauses = [];
    const params = [];
    if (req.body.tenure && !TENURES.includes(req.body.tenure)) {
      return res.status(400).json({ error: `tenure must be one of: ${TENURES.join(", ")}.` });
    }
    if (req.body.sdltBuyerType && !["standard", "first_time", "additional"].includes(req.body.sdltBuyerType)) {
      return res.status(400).json({ error: "sdltBuyerType must be standard, first_time or additional." });
    }
    for (const [bodyKey, column] of Object.entries(PATCHABLE_FIELDS)) {
      if (bodyKey in req.body) {
        params.push(JSON_FIELDS.has(bodyKey) ? JSON.stringify(req.body[bodyKey]) : blankToNull(bodyKey, req.body[bodyKey]));
        setClauses.push(`${column} = $${params.length}`);
      }
    }
    if (!setClauses.length) return res.status(400).json({ error: "No recognised fields to update." });

    params.push(req.params.id);
    const result = await query(
      `UPDATE matters SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: "Matter not found." });

    await query(
      `INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'edit','Matter details updated')`,
      [req.params.id, req.user.id]
    );
    res.json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// POST /matters/:id/stage — move the stage tracker
// -----------------------------------------------------------------------

router.post(
  "/:id/stage",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { stageIndex } = req.body;
    if (typeof stageIndex !== "number" || stageIndex < 0 || stageIndex >= STAGE_COUNT) {
      return res.status(400).json({ error: `stageIndex must be between 0 and ${STAGE_COUNT - 1}.` });
    }

    const blockers = await exchangeBlockers({ query }, req.user.firmId, req.params.id, stageIndex);
    if (blockers.length) return blockedResponse(res, blockers);

    if ((await firmRequiresSignoff(req.user.firmId)) && !(await canSignOff(req.user, req.params.id))) {
      return res.status(403).json({
        error: "Moving this matter to another stage needs the fee earner's sign-off. Send a sign-off request instead.",
        needsSignoff: true,
      });
    }

    const result = await query(
      `UPDATE matters SET current_stage_index = $1 WHERE id = $2 RETURNING *`,
      [stageIndex, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Matter not found." });

    // A direct move by the fee earner / supervisor supersedes any waiting request.
    await query(
      `UPDATE stage_requests SET status = 'withdrawn', decided_by = $2, decided_at = now(),
         decision_note = 'Superseded by a direct stage change'
       WHERE matter_id = $1 AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    await query(
      `INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'stage',$3)`,
      [req.params.id, req.user.id, `Moved to ${STAGE_NAMES[stageIndex]}`]
    );
    res.json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Stage sign-off requests
// -----------------------------------------------------------------------

/** Ask for sign-off to move the matter to another stage. Replaces any request already waiting. */
router.post(
  "/:id/stage-requests",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { stageIndex, note = "" } = req.body;
    if (typeof stageIndex !== "number" || stageIndex < 0 || stageIndex >= STAGE_COUNT) {
      return res.status(400).json({ error: `stageIndex must be between 0 and ${STAGE_COUNT - 1}.` });
    }
    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const matter = (await client_.query(`SELECT current_stage_index FROM matters WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
      if (matter.current_stage_index === stageIndex) {
        await client_.query("ROLLBACK");
        return res.status(400).json({ error: "The matter is already at that stage." });
      }
      const blockers = await exchangeBlockers(client_, req.user.firmId, req.params.id, stageIndex);
      if (blockers.length) {
        await client_.query("ROLLBACK");
        return blockedResponse(res, blockers);
      }
      await client_.query(
        `UPDATE stage_requests SET status = 'withdrawn', decided_by = $2, decided_at = now(), decision_note = 'Replaced by a new request'
         WHERE matter_id = $1 AND status = 'pending'`,
        [req.params.id, req.user.id]
      );
      const created = await client_.query(
        `INSERT INTO stage_requests (matter_id, from_stage, to_stage, note, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.params.id, matter.current_stage_index, stageIndex, String(note).trim(), req.user.id]
      );
      await logActivity(client_, req.params.id, req.user.id, "signoff",
        `Sign-off requested to move to ${STAGE_NAMES[stageIndex]}${String(note).trim() ? ` — ${String(note).trim()}` : ""}`);
      await client_.query("COMMIT");
      res.status(201).json(created.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Approve (moves the stage) or decline a waiting request. The matter's fee earner or their supervisor only. */
router.post(
  "/:id/stage-requests/:requestId/decision",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { approve, note = "" } = req.body;
    if (typeof approve !== "boolean") return res.status(400).json({ error: "approve must be true or false." });
    if (!approve && !String(note).trim()) return res.status(400).json({ error: "Please give a reason for declining." });
    if (!(await canSignOff(req.user, req.params.id))) {
      return res.status(403).json({ error: "Only the matter's fee earner (or their supervisor) can sign off stage moves." });
    }

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const request = (await client_.query(
        `SELECT * FROM stage_requests WHERE id = $1 AND matter_id = $2 FOR UPDATE`,
        [req.params.requestId, req.params.id]
      )).rows[0];
      if (!request) {
        await client_.query("ROLLBACK");
        return res.status(404).json({ error: "Sign-off request not found." });
      }
      if (request.status !== "pending") {
        await client_.query("ROLLBACK");
        return res.status(409).json({ error: "That request has already been dealt with." });
      }
      if (request.requested_by === req.user.id) {
        await client_.query("ROLLBACK");
        return res.status(403).json({ error: "You can't sign off your own request." });
      }

      await client_.query(
        `UPDATE stage_requests SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $4`,
        [approve ? "approved" : "declined", req.user.id, String(note).trim(), request.id]
      );
      const stageName = STAGE_NAMES[request.to_stage];
      if (approve) {
        const blockers = await exchangeBlockers(client_, req.user.firmId, req.params.id, request.to_stage);
        if (blockers.length) {
          await client_.query("ROLLBACK");
          return blockedResponse(res, blockers);
        }
        await client_.query(`UPDATE matters SET current_stage_index = $1 WHERE id = $2`, [request.to_stage, req.params.id]);
        await logActivity(client_, req.params.id, req.user.id, "stage", `Moved to ${stageName}`);
        await logActivity(client_, req.params.id, req.user.id, "signoff",
          `Move to ${stageName} signed off by ${req.user.name}${String(note).trim() ? ` — ${String(note).trim()}` : ""}`);
      } else {
        await logActivity(client_, req.params.id, req.user.id, "signoff",
          `Move to ${stageName} declined by ${req.user.name} — ${String(note).trim()}`);
      }
      await client_.query("COMMIT");
      res.json({ status: approve ? "approved" : "declined" });
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** The requester withdraws their own waiting request. */
router.delete(
  "/:id/stage-requests/:requestId",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const result = await query(
      `UPDATE stage_requests SET status = 'withdrawn', decided_by = $3, decided_at = now(), decision_note = 'Withdrawn by requester'
       WHERE id = $1 AND matter_id = $2 AND status = 'pending' AND requested_by = $3 RETURNING to_stage`,
      [req.params.requestId, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "No waiting request of yours to withdraw." });
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'signoff',$3)`,
      [req.params.id, req.user.id, `Sign-off request to move to ${STAGE_NAMES[result.rows[0].to_stage]} withdrawn`]);
    res.status(204).send();
  })
);

// -----------------------------------------------------------------------
// Activity / "log update" notes
// -----------------------------------------------------------------------
router.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });

    const result = await query(
      `INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'note',$3) RETURNING *`,
      [req.params.id, req.user.id, text.trim()]
    );
    res.status(201).json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------
router.post(
  "/:id/documents",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { name, category, date, notes } = req.body;
    if (!name || !category) return res.status(400).json({ error: "name and category are required." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const result = await client_.query(
        `INSERT INTO documents (matter_id, name, category, doc_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, name, category, date || null, notes || null, req.user.id]
      );
      await logActivity(client_, req.params.id, req.user.id, "doc", `Document added: ${name}`);
      await client_.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

// -----------------------------------------------------------------------
// Document files — the actual file behind a document record, stored in
// Postgres (document_files). One file per document; uploading again
// replaces it.
// -----------------------------------------------------------------------
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Extension → MIME type we serve it back as. Anything not listed is
// refused, which also keeps out HTML/SVG/scripts that a browser might run.
const ALLOWED_FILE_TYPES = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".msg": "application/vnd.ms-outlook",
  ".eml": "message/rfc822",
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

function receiveFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `Files must be ${MAX_FILE_BYTES / 1024 / 1024} MB or smaller.` });
    }
    if (err) return res.status(400).json({ error: "Couldn't read the uploaded file." });
    next();
  });
}

router.put(
  "/:id/documents/:documentId/file",
  // Check access before reading the upload into memory.
  asyncHandler(async (req, res, next) => {
    if (await assertMatterVisible(req, res, req.params.id)) next();
  }),
  receiveFile,
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file was attached." });
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const mime = ALLOWED_FILE_TYPES[ext];
    if (!mime) {
      return res.status(400).json({ error: "That type of file isn't allowed. Use PDF, Word, Excel, images, text, or Outlook emails." });
    }

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const doc = await client_.query(
        `UPDATE documents SET file_name = $1, file_mime = $2, file_size = $3
         WHERE id = $4 AND matter_id = $5 RETURNING *`,
        [req.file.originalname, mime, req.file.size, req.params.documentId, req.params.id]
      );
      if (!doc.rows.length) {
        await client_.query("ROLLBACK");
        return res.status(404).json({ error: "Document not found." });
      }
      await client_.query(
        `INSERT INTO document_files (document_id, data, uploaded_by) VALUES ($1, $2, $3)
         ON CONFLICT (document_id) DO UPDATE SET data = EXCLUDED.data, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
        [req.params.documentId, req.file.buffer, req.user.id]
      );
      await logActivity(client_, req.params.id, req.user.id, "doc", `File attached to ${doc.rows[0].name}: ${req.file.originalname}`);
      await client_.query("COMMIT");
      res.json(doc.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

router.get(
  "/:id/documents/:documentId/file",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const result = await query(
      `SELECT d.file_name, d.file_mime, f.data
       FROM documents d JOIN document_files f ON f.document_id = d.id
       WHERE d.id = $1 AND d.matter_id = $2`,
      [req.params.documentId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "No file attached to this document." });

    const { file_name, file_mime, data } = result.rows[0];
    res.set({
      "Content-Type": file_mime || "application/octet-stream",
      "Content-Length": data.length,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file_name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    res.send(data);
  })
);

// -----------------------------------------------------------------------
// Emails — includes the same auto-match-to-enquiries logic as the frontend
// prototype, now running once, server-side, instead of per-browser.
// -----------------------------------------------------------------------

/** Mirrors the frontend's parseEnquiryReplies heuristic: pulls numbered replies out of an email body. */
function parseEnquiryReplies(body) {
  if (!body) return {};
  const lines = body.split(/\n+/);
  const found = {};
  let currentNum = null;
  let buffer = [];
  const flush = () => {
    if (currentNum !== null && buffer.length) found[currentNum] = buffer.join(" ").trim();
  };
  for (const line of lines) {
    const m = line.match(/^\s*(\d{1,2})[.)\:]\s+(.*)$/);
    if (m) {
      flush();
      currentNum = parseInt(m[1], 10);
      buffer = [m[2]];
    } else if (currentNum !== null && line.trim()) {
      buffer.push(line.trim());
    }
  }
  flush();
  return found;
}

async function matchEmailToEnquiries(client_, matterId, email, userId) {
  const replies = parseEnquiryReplies(email.body);
  if (!Object.keys(replies).length) return 0;

  // Outstanding enquiries that don't already have a reply logged from this email
  // (so re-running the match on the same email doesn't log it twice).
  const outstanding = await client_.query(
    `SELECT e.id, e.number FROM enquiries e
     WHERE e.matter_id = $1 AND e.status = 'Outstanding'
       AND NOT EXISTS (SELECT 1 FROM enquiry_replies r WHERE r.enquiry_id = e.id AND r.source_email_id = $2)`,
    [matterId, email.id]
  );

  let matched = 0;
  for (const enquiry of outstanding.rows) {
    if (replies[enquiry.number]) {
      await client_.query(
        `UPDATE enquiries SET status = 'Pending Review', answer = $1, date_answered = $2,
           auto_filled = true, source_email_id = $3, follow_up_notes = ''
         WHERE id = $4`,
        [replies[enquiry.number], email.email_date, email.id, enquiry.id]
      );
      await client_.query(
        `INSERT INTO enquiry_replies (enquiry_id, reply, date_received, source_email_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [enquiry.id, replies[enquiry.number], email.email_date, email.id, userId]
      );
      matched++;
    }
  }
  return matched;
}

router.post(
  "/:id/emails",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { direction, from, to, subject, body, date } = req.body;
    if (!direction || !subject || !date) return res.status(400).json({ error: "direction, subject and date are required." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const emailResult = await client_.query(
        `INSERT INTO emails (matter_id, direction, from_address, to_address, subject, body, email_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.id, direction, from || null, to || null, subject, body || null, date]
      );
      const email = emailResult.rows[0];
      await logActivity(client_, req.params.id, req.user.id, "email", `Email logged: ${subject}`);

      let matched = 0;
      if (direction === "in") {
        matched = await matchEmailToEnquiries(client_, req.params.id, email, req.user.id);
        if (matched > 0) {
          await logActivity(client_, req.params.id, req.user.id, "enquiry", `${matched} enquiry repl${matched === 1 ? "y" : "ies"} auto-filled from this email — pending review`);
        }
      }

      await client_.query("COMMIT");
      res.status(201).json({ email, enquiriesMatched: matched });
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Manual re-check — lets a user re-run matching against a specific email on demand. */
router.post(
  "/:id/emails/:emailId/match",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const emailResult = await client_.query(`SELECT * FROM emails WHERE id = $1 AND matter_id = $2`, [req.params.emailId, req.params.id]);
      if (!emailResult.rows.length) {
        await client_.query("ROLLBACK");
        return res.status(404).json({ error: "Email not found." });
      }
      const matched = await matchEmailToEnquiries(client_, req.params.id, emailResult.rows[0], req.user.id);
      if (matched > 0) {
        await logActivity(client_, req.params.id, req.user.id, "enquiry", `${matched} enquiry repl${matched === 1 ? "y" : "ies"} matched from "${emailResult.rows[0].subject}" — pending review`);
      }
      await client_.query("COMMIT");
      res.json({ enquiriesMatched: matched });
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

// -----------------------------------------------------------------------
// Enquiries
// -----------------------------------------------------------------------
router.post(
  "/:id/enquiries",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { question } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: "question is required." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const maxResult = await client_.query(`SELECT coalesce(max(number), 0) AS max FROM enquiries WHERE matter_id = $1`, [req.params.id]);
      const nextNumber = maxResult.rows[0].max + 1;
      const result = await client_.query(
        `INSERT INTO enquiries (matter_id, number, question, date_raised, status)
         VALUES ($1,$2,$3, CURRENT_DATE, 'Outstanding') RETURNING *`,
        [req.params.id, nextNumber, question.trim()]
      );
      await logActivity(client_, req.params.id, req.user.id, "enquiry", `Enquiry ${nextNumber} added`);
      await client_.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Bulk-add from the standard enquiries template. */
router.post(
  "/:id/enquiries/bulk",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { questions } = req.body;
    if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ error: "questions must be a non-empty array." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const maxResult = await client_.query(`SELECT coalesce(max(number), 0) AS max FROM enquiries WHERE matter_id = $1`, [req.params.id]);
      let next = maxResult.rows[0].max;
      const inserted = [];
      for (const q of questions) {
        next++;
        const result = await client_.query(
          `INSERT INTO enquiries (matter_id, number, question, date_raised, status)
           VALUES ($1,$2,$3, CURRENT_DATE, 'Outstanding') RETURNING *`,
          [req.params.id, next, q]
        );
        inserted.push(result.rows[0]);
      }
      await logActivity(client_, req.params.id, req.user.id, "enquiry", `${inserted.length} standard enquiries added from template`);
      await client_.query("COMMIT");
      res.status(201).json(inserted);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Manually answer an Outstanding enquiry (not via the auto-match path). */
router.patch(
  "/:id/enquiries/:enquiryId/answer",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { answer, dateAnswered } = req.body;
    if (!answer || !answer.trim()) return res.status(400).json({ error: "answer is required." });

    const result = await query(
      `UPDATE enquiries SET status = 'Answered', answer = $1, date_answered = $2
       WHERE id = $3 AND matter_id = $4 RETURNING *`,
      [answer.trim(), dateAnswered || ukToday(), req.params.enquiryId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Enquiry not found." });

    await query(
      `INSERT INTO enquiry_replies (enquiry_id, reply, date_received, created_by) VALUES ($1,$2,$3,$4)`,
      [req.params.enquiryId, answer.trim(), result.rows[0].date_answered, req.user.id]
    );
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'enquiry',$3)`,
      [req.params.id, req.user.id, `Enquiry ${result.rows[0].number} answered`]);
    res.json(result.rows[0]);
  })
);

/** Review a Pending Review (auto-filled) enquiry: confirm it, or flag a follow-up. */
router.patch(
  "/:id/enquiries/:enquiryId/review",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { outcome, finalAnswer, followUpNote } = req.body; // outcome: 'confirm' | 'follow_up'

    if (outcome === "confirm") {
      if (!finalAnswer || !finalAnswer.trim()) return res.status(400).json({ error: "finalAnswer is required to confirm." });
      const result = await query(
        `UPDATE enquiries SET status = 'Answered', answer = $1 WHERE id = $2 AND matter_id = $3 RETURNING *`,
        [finalAnswer.trim(), req.params.enquiryId, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Enquiry not found." });
      await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'enquiry',$3)`,
        [req.params.id, req.user.id, `Enquiry ${result.rows[0].number} reply confirmed`]);
      return res.json(result.rows[0]);
    }

    if (outcome === "follow_up") {
      if (!followUpNote || !followUpNote.trim()) return res.status(400).json({ error: "followUpNote is required to flag a follow-up." });
      const result = await query(
        `UPDATE enquiries SET status = 'Outstanding', follow_up_notes = $1, auto_filled = false
         WHERE id = $2 AND matter_id = $3 RETURNING *`,
        [followUpNote.trim(), req.params.enquiryId, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Enquiry not found." });
      await query(`INSERT INTO enquiry_comments (enquiry_id, comment, created_by) VALUES ($1,$2,$3)`,
        [req.params.enquiryId, `Follow-up needed: ${followUpNote.trim()}`, req.user.id]);
      await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'enquiry',$3)`,
        [req.params.id, req.user.id, `Follow-up needed on enquiry ${result.rows[0].number}: ${followUpNote.trim()}`]);
      return res.json(result.rows[0]);
    }

    res.status(400).json({ error: "outcome must be 'confirm' or 'follow_up'." });
  })
);

// Status labels as staff see them (the stored values predate the wording).
const ENQUIRY_STATUS_LABELS = { Outstanding: "Raised", "Pending Review": "Response received", Answered: "Satisfactory" };

/** Loads an enquiry, checking it belongs to the matter. */
async function findEnquiry(db, matterId, enquiryId) {
  const result = await db.query(`SELECT * FROM enquiries WHERE id = $1 AND matter_id = $2`, [enquiryId, matterId]);
  return result.rows[0] || null;
}

/** Set an enquiry's status by hand: Raised / Response received / Satisfactory. */
router.patch(
  "/:id/enquiries/:enquiryId/status",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { status } = req.body;
    if (!ENQUIRY_STATUS_LABELS[status]) {
      return res.status(400).json({ error: "status must be Outstanding, Pending Review or Answered." });
    }
    const enquiry = await findEnquiry({ query }, req.params.id, req.params.enquiryId);
    if (!enquiry) return res.status(404).json({ error: "Enquiry not found." });
    if (enquiry.status === status) return res.json(enquiry);

    const result = await query(`UPDATE enquiries SET status = $1 WHERE id = $2 RETURNING *`, [status, enquiry.id]);
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'enquiry',$3)`,
      [req.params.id, req.user.id, `Enquiry ${enquiry.number} marked ${ENQUIRY_STATUS_LABELS[status]}`]);
    res.json(result.rows[0]);
  })
);

/**
 * Log a reply against an enquiry — typed/pasted, or linked to an email
 * already on the matter (emailId). Becomes the enquiry's latest answer and
 * moves it to "Response received" unless a status is given.
 */
router.post(
  "/:id/enquiries/:enquiryId/replies",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { reply, dateReceived, emailId, status = "Pending Review" } = req.body;
    if (!ENQUIRY_STATUS_LABELS[status]) return res.status(400).json({ error: "Unknown status." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const enquiry = await findEnquiry(client_, req.params.id, req.params.enquiryId);
      if (!enquiry) {
        await client_.query("ROLLBACK");
        return res.status(404).json({ error: "Enquiry not found." });
      }
      let email = null;
      if (emailId) {
        email = (await client_.query(`SELECT * FROM emails WHERE id = $1 AND matter_id = $2`, [emailId, req.params.id])).rows[0];
        if (!email) {
          await client_.query("ROLLBACK");
          return res.status(404).json({ error: "That email isn't on this matter." });
        }
      }
      const text = (reply && reply.trim()) || (email && (email.body || "").trim());
      if (!text) {
        await client_.query("ROLLBACK");
        return res.status(400).json({ error: "The reply is empty." });
      }
      const date = dateReceived || (email && email.email_date) || ukToday();

      const inserted = await client_.query(
        `INSERT INTO enquiry_replies (enquiry_id, reply, date_received, source_email_id, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [enquiry.id, text, date, email ? email.id : null, req.user.id]
      );
      await client_.query(
        `UPDATE enquiries SET answer = $1, date_answered = $2, status = $3, source_email_id = coalesce($4, source_email_id)
         WHERE id = $5`,
        [text, date, status, email ? email.id : null, enquiry.id]
      );
      await logActivity(client_, req.params.id, req.user.id, "enquiry",
        `Reply logged on enquiry ${enquiry.number}${email ? ` from email "${email.subject}"` : ""}`);
      await client_.query("COMMIT");
      res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Add an internal comment to an enquiry. */
router.post(
  "/:id/enquiries/:enquiryId/comments",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { comment } = req.body;
    if (!comment || !comment.trim()) return res.status(400).json({ error: "The comment is empty." });
    const enquiry = await findEnquiry({ query }, req.params.id, req.params.enquiryId);
    if (!enquiry) return res.status(404).json({ error: "Enquiry not found." });
    const result = await query(
      `INSERT INTO enquiry_comments (enquiry_id, comment, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [enquiry.id, comment.trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Searches
// -----------------------------------------------------------------------
router.post(
  "/:id/searches",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { type, dateOrdered, expectedReturn } = req.body;
    if (!type) return res.status(400).json({ error: "type is required." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const result = await client_.query(
        `INSERT INTO searches (matter_id, type, date_ordered, expected_return) VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, type, dateOrdered || null, expectedReturn || null]
      );
      await logActivity(client_, req.params.id, req.user.id, "search", `${type} ordered`);
      await client_.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

router.patch(
  "/:id/searches/:searchId",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { expectedReturn, dateReceived, issue, issueNotes } = req.body;

    const result = await query(
      `UPDATE searches SET
         expected_return = coalesce($1, expected_return),
         date_received = $2,
         issue = coalesce($3, issue),
         issue_notes = $4
       WHERE id = $5 AND matter_id = $6 RETURNING *`,
      [expectedReturn || null, dateReceived || null, issue, issueNotes || null, req.params.searchId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Search not found." });

    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'search',$3)`,
      [req.params.id, req.user.id, issue ? `Issue flagged on ${result.rows[0].type}` : `${result.rows[0].type} updated`]);
    res.json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Undertakings
// -----------------------------------------------------------------------
router.post(
  "/:id/undertakings",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { direction, description, party, dateGiven } = req.body;
    if (!direction || !description || !description.trim()) return res.status(400).json({ error: "direction and description are required." });

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const result = await client_.query(
        `INSERT INTO undertakings (matter_id, direction, description, party, date_given, status)
         VALUES ($1,$2,$3,$4,$5,'Outstanding') RETURNING *`,
        [req.params.id, direction, description.trim(), party || null, dateGiven || null]
      );
      await logActivity(client_, req.params.id, req.user.id, "undertaking", `Undertaking ${direction === "given" ? "given to" : "received from"} ${party || "the other side"}`);
      await client_.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

router.patch(
  "/:id/undertakings/:undertakingId/discharge",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { dateDischarged } = req.body;

    const result = await query(
      `UPDATE undertakings SET status = 'Discharged', date_discharged = $1 WHERE id = $2 AND matter_id = $3 RETURNING *`,
      [dateDischarged || ukToday(), req.params.undertakingId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Undertaking not found." });

    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'undertaking','Undertaking marked as discharged')`,
      [req.params.id, req.user.id]);
    res.json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Tasks / reminders
// -----------------------------------------------------------------------
router.post(
  "/:id/tasks",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { description, dueDate, assignedTo } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: "description is required." });
    let assignee = null;
    if (assignedTo) {
      const check = await checkAssignee({ query }, req.user.firmId, req.params.id, assignedTo);
      if (check.error) return res.status(400).json({ error: check.error });
      assignee = check.user;
    }

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const result = await client_.query(
        `INSERT INTO tasks (matter_id, description, due_date, status, created_by, assigned_to)
         VALUES ($1,$2,$3,'Open',$4,$5) RETURNING *`,
        [req.params.id, description.trim(), dueDate || null, req.user.id, assignee ? assignee.id : null]
      );
      await logActivity(client_, req.params.id, req.user.id, "task",
        `Task added: ${description.trim()}${assignee ? ` — assigned to ${assignee.name}` : ""}`);
      await client_.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Bulk-add tasks (e.g. from the standard task list). All or nothing. */
router.post(
  "/:id/tasks/bulk",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 200) {
      return res.status(400).json({ error: "tasks must be a list of 1–200 tasks." });
    }
    if (!tasks.every((t) => t && typeof t.description === "string" && t.description.trim())) {
      return res.status(400).json({ error: "Every task needs a description." });
    }
    const assigneeIds = [...new Set(tasks.map((t) => t.assignedTo).filter(Boolean))];
    for (const id of assigneeIds) {
      const check = await checkAssignee({ query }, req.user.firmId, req.params.id, id);
      if (check.error) return res.status(400).json({ error: check.error });
    }
    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      const inserted = [];
      for (const t of tasks) {
        const result = await client_.query(
          `INSERT INTO tasks (matter_id, description, due_date, status, created_by, assigned_to) VALUES ($1,$2,$3,'Open',$4,$5) RETURNING *`,
          [req.params.id, t.description.trim(), t.dueDate || null, req.user.id, t.assignedTo || null]
        );
        inserted.push(result.rows[0]);
      }
      await logActivity(client_, req.params.id, req.user.id, "task", `${inserted.length} standard task${inserted.length === 1 ? "" : "s"} added`);
      await client_.query("COMMIT");
      res.status(201).json(inserted);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

/** Edit a task: description, due date, and/or who it's assigned to (null to unassign). */
router.patch(
  "/:id/tasks/:taskId",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const { description, dueDate, assignedTo } = req.body;
    const current = (await query(
      `SELECT t.*, to_char(t.due_date, 'YYYY-MM-DD') AS due_str, u.name AS assigned_to_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1 AND t.matter_id = $2`,
      [req.params.taskId, req.params.id]
    )).rows[0];
    if (!current) return res.status(404).json({ error: "Task not found." });

    const setClauses = [];
    const params = [];
    const set = (col, val) => { params.push(val); setClauses.push(`${col} = $${params.length}`); };
    const changes = [];

    if (description !== undefined) {
      if (!String(description).trim()) return res.status(400).json({ error: "The task needs a description." });
      if (description.trim() !== current.description) { set("description", description.trim()); changes.push("description changed"); }
    }
    if (dueDate !== undefined && (dueDate || null) !== current.due_str) {
      set("due_date", dueDate || null);
      changes.push(dueDate ? `due ${dueDate}` : "due date removed");
    }
    let assigneeName = null;
    if (assignedTo !== undefined && (assignedTo || null) !== current.assigned_to) {
      if (assignedTo) {
        const check = await checkAssignee({ query }, req.user.firmId, req.params.id, assignedTo);
        if (check.error) return res.status(400).json({ error: check.error });
        assigneeName = check.user.name;
      }
      set("assigned_to", assignedTo || null);
      changes.push(assignedTo ? `assigned to ${assigneeName}` : "unassigned");
    }
    delete current.due_str;
    if (!setClauses.length) return res.json(current);

    params.push(current.id);
    const result = await query(`UPDATE tasks SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'task',$3)`,
      [req.params.id, req.user.id, `Task "${current.description}" ${changes.join(", ")}`]);
    res.json(result.rows[0]);
  })
);

router.patch(
  "/:id/tasks/:taskId/complete",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const result = await query(
      `UPDATE tasks SET status = 'Done', date_completed = CURRENT_DATE WHERE id = $1 AND matter_id = $2 RETURNING *`,
      [req.params.taskId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Task not found." });

    await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'task',$3)`,
      [req.params.id, req.user.id, `Task completed: ${result.rows[0].description}`]);
    res.json(result.rows[0]);
  })
);

router.patch(
  "/:id/tasks/:taskId/reopen",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    const result = await query(
      `UPDATE tasks SET status = 'Open', date_completed = NULL WHERE id = $1 AND matter_id = $2 RETURNING *`,
      [req.params.taskId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Task not found." });
    res.json(result.rows[0]);
  })
);

// -----------------------------------------------------------------------
// Chain / linked matters (reciprocal)
// -----------------------------------------------------------------------
router.put(
  "/:id/links/:linkedId",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    if (!(await assertMatterVisible(req, res, req.params.linkedId))) return;

    await query(
      `INSERT INTO matter_links (matter_id, linked_matter_id) VALUES ($1,$2), ($2,$1)
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.params.linkedId]
    );
    res.status(204).send();
  })
);

router.delete(
  "/:id/links/:linkedId",
  asyncHandler(async (req, res) => {
    if (!(await assertMatterVisible(req, res, req.params.id))) return;
    await query(
      `DELETE FROM matter_links WHERE (matter_id = $1 AND linked_matter_id = $2) OR (matter_id = $2 AND linked_matter_id = $1)`,
      [req.params.id, req.params.linkedId]
    );
    res.status(204).send();
  })
);

// -----------------------------------------------------------------------
// Corrections: edit / delete items added by mistake. Every change is
// written to the matter's activity log, so the history shows what was
// removed or changed, when and by whom.
// -----------------------------------------------------------------------

/** Deletes one row belonging to the matter and logs it. `describe` builds the log text from the row. */
function deleteRoute(path, table, idParam, label, describe, before) {
  router.delete(
    path,
    asyncHandler(async (req, res) => {
      if (!(await assertMatterVisible(req, res, req.params.id))) return;
      const client_ = await pool.connect();
      try {
        await client_.query("BEGIN");
        const row = (await client_.query(`SELECT * FROM ${table} WHERE id = $1 AND matter_id = $2`, [req.params[idParam], req.params.id])).rows[0];
        if (!row) {
          await client_.query("ROLLBACK");
          return res.status(404).json({ error: `${label} not found.` });
        }
        if (before) await before(client_, row);
        await client_.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);
        await logActivity(client_, req.params.id, req.user.id, "edit", `Deleted ${describe(row)}`);
        await client_.query("COMMIT");
        res.status(204).send();
      } catch (err) {
        await client_.query("ROLLBACK");
        throw err;
      } finally {
        client_.release();
      }
    })
  );
}

deleteRoute("/:id/documents/:documentId", "documents", "documentId", "Document", (d) => `document "${d.name}"${d.file_name ? " and its file" : ""}`);
deleteRoute("/:id/emails/:emailId", "emails", "emailId", "Email", (e) => `email log "${e.subject}"`,
  (db, e) => db.query(`UPDATE enquiries SET source_email_id = NULL WHERE source_email_id = $1`, [e.id]));
deleteRoute("/:id/enquiries/:enquiryId", "enquiries", "enquiryId", "Enquiry", (q) => `enquiry ${q.number}: "${q.question}"`);
deleteRoute("/:id/searches/:searchId", "searches", "searchId", "Search", (x) => `search "${x.type}"`);
deleteRoute("/:id/undertakings/:undertakingId", "undertakings", "undertakingId", "Undertaking", (u) => `undertaking "${u.description}"`);
deleteRoute("/:id/tasks/:taskId", "tasks", "taskId", "Task", (t) => `task "${t.description}"`);

/** Generic field edit for one row on the matter; `fields` maps body keys to columns (+ optional validator). */
function editRoute(path, table, idParam, label, fields, describe) {
  router.patch(
    path,
    asyncHandler(async (req, res) => {
      if (!(await assertMatterVisible(req, res, req.params.id))) return;
      const row = (await query(`SELECT * FROM ${table} WHERE id = $1 AND matter_id = $2`, [req.params[idParam], req.params.id])).rows[0];
      if (!row) return res.status(404).json({ error: `${label} not found.` });
      const setClauses = [];
      const params = [];
      for (const [key, { column, required, oneOf }] of Object.entries(fields)) {
        if (!(key in req.body)) continue;
        let value = req.body[key];
        if (typeof value === "string") value = value.trim();
        if (value === "") value = null;
        if (required && value === null) return res.status(400).json({ error: `${key} can't be blank.` });
        if (oneOf && value !== null && !oneOf.includes(value)) return res.status(400).json({ error: `${key} must be one of: ${oneOf.join(", ")}.` });
        params.push(value);
        setClauses.push(`${column} = $${params.length}`);
      }
      if (!setClauses.length) return res.status(400).json({ error: "No recognised fields to update." });
      params.push(row.id);
      const result = await query(`UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
      await query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'edit',$3)`,
        [req.params.id, req.user.id, `Edited ${describe(result.rows[0])}`]);
      res.json(result.rows[0]);
    })
  );
}

editRoute("/:id/documents/:documentId", "documents", "documentId", "Document", {
  name: { column: "name", required: true }, category: { column: "category", required: true },
  date: { column: "doc_date" }, notes: { column: "notes" },
}, (d) => `document "${d.name}"`);
editRoute("/:id/enquiries/:enquiryId", "enquiries", "enquiryId", "Enquiry", {
  question: { column: "question", required: true },
}, (q) => `enquiry ${q.number}`);
editRoute("/:id/undertakings/:undertakingId", "undertakings", "undertakingId", "Undertaking", {
  direction: { column: "direction", required: true, oneOf: ["given", "received"] },
  description: { column: "description", required: true }, party: { column: "party" }, dateGiven: { column: "date_given" },
}, (u) => `undertaking "${u.description}"`);
editRoute("/:id/emails/:emailId", "emails", "emailId", "Email", {
  subject: { column: "subject", required: true }, body: { column: "body" },
}, (e) => `email log "${e.subject}"`);

module.exports = router;
