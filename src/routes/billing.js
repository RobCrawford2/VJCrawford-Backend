/**
 * Time recording and billing.
 *
 *   GET    /matters/:id/billing                 entries, bills and the running totals
 *   POST   /matters/:id/time                    record time (6-minute units)
 *   PATCH  /matters/:id/time/:entryId           edit unbilled time (own, or as supervisor / admin)
 *   DELETE /matters/:id/time/:entryId
 *   POST   /matters/:id/bills                   draft a bill from unbilled time and/or a fixed amount
 *   POST   /matters/:id/bills/:billId/issue     give it the next bill number (fee earner / supervisor / admin)
 *   POST   /matters/:id/bills/:billId/cancel    cancel an issued bill (frees its time to be re-billed)
 *   DELETE /matters/:id/bills/:billId           delete a draft
 *   GET    /matters/:id/bills/:billId/document  the bill as a Word document
 *   GET    /time?from=&to=                      your timesheet
 */
const express = require("express");
const { query, pool } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { matterVisibilityClause } = require("../utils/permissions");
const { ukToday } = require("../utils/dates");
const { buildBill } = require("../reports/bill");

const VAT_RATE = 0.2;
const ACTIVITIES = ["Attendance (meeting)", "Telephone call", "Letter / email out", "Perusal / reading", "Drafting", "Research", "Court / hearing", "Travel / waiting", "Preparation", "Other"];
const round2 = (n) => Math.round(n * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const matterRouter = express.Router();
matterRouter.use(requireAuth);

function log(db, matterId, userId, text) {
  return db.query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'note',$3)`, [matterId, userId, text]);
}

/** The matter row if the user can see it, else null (and a 404 sent). */
async function visibleMatter(req, res) {
  const v = matterVisibilityClause(req.user, 3);
  const result = await query(
    `SELECT m.*, fe.supervisor_id AS fee_earner_supervisor_id FROM matters m LEFT JOIN users fe ON fe.id = m.fee_earner_id
     WHERE m.id = $1 AND m.firm_id = $2 ${v.clause}`,
    [req.params.id, req.user.firmId, ...v.params]
  );
  if (!result.rows.length) {
    res.status(404).json({ error: "Matter not found." });
    return null;
  }
  return result.rows[0];
}

/** Fee earner, their supervisor, or an admin — who can issue bills and edit anyone's time on the matter. */
const canManage = (user, m) =>
  user.role === "admin" || m.fee_earner_id === user.id || (user.role === "supervisor" && (m.supervisor_id === user.id || m.fee_earner_supervisor_id === user.id));

const money = (n) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Running totals for a matter: unbilled time, billed costs and the estimate. */
async function billingSummary(db, matterId) {
  const [time, bills, m] = await Promise.all([
    db.query(
      `SELECT coalesce(sum(units) FILTER (WHERE bill_id IS NULL AND billable), 0)::int AS unbilled_units,
              coalesce(sum(amount) FILTER (WHERE bill_id IS NULL AND billable), 0) AS unbilled_value,
              coalesce(sum(units), 0)::int AS total_units
       FROM time_entries WHERE matter_id = $1`,
      [matterId]
    ),
    db.query(
      `SELECT coalesce(sum(profit_costs) FILTER (WHERE status = 'issued'), 0) AS billed_costs,
              count(*) FILTER (WHERE status = 'draft')::int AS drafts
       FROM bills WHERE matter_id = $1`,
      [matterId]
    ),
    db.query(`SELECT funding, fee_estimate FROM matters WHERE id = $1`, [matterId]),
  ]);
  const unbilled = Number(time.rows[0].unbilled_value);
  const billed = Number(bills.rows[0].billed_costs);
  const estimate = m.rows[0].fee_estimate === null ? null : Number(m.rows[0].fee_estimate);
  return {
    funding: m.rows[0].funding,
    estimate,
    unbilledUnits: time.rows[0].unbilled_units,
    unbilledValue: unbilled,
    billedCosts: billed,
    totalUnits: time.rows[0].total_units,
    costsToDate: round2(unbilled + billed),
    percentOfEstimate: estimate ? Math.round(((unbilled + billed) / estimate) * 100) : null,
    draftBills: bills.rows[0].drafts,
  };
}

function checkEntry(b, partial) {
  if ((!partial || b.workDate !== undefined) && !DATE_RE.test(String(b.workDate || ""))) return "Enter the date the work was done.";
  if (!partial || b.minutes !== undefined || b.units !== undefined) {
    const units = b.units !== undefined ? Number(b.units) : Math.ceil(Number(b.minutes) / 6);
    if (!Number.isInteger(units) || units < 1 || units > 240) return "Time must be between 6 minutes and 24 hours.";
  }
  if ((!partial || b.activity !== undefined) && !ACTIVITIES.includes(b.activity)) return "Choose what the work was.";
  return null;
}
const unitsOf = (b) => (b.units !== undefined ? Number(b.units) : Math.ceil(Number(b.minutes) / 6));

matterRouter.get(
  "/:id/billing",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const [entries, bills, summary] = await Promise.all([
      query(
        `SELECT t.*, to_char(t.work_date, 'YYYY-MM-DD') AS work_date, u.name AS user_name, b.bill_number, b.status AS bill_status
         FROM time_entries t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN bills b ON b.id = t.bill_id
         WHERE t.matter_id = $1 ORDER BY t.work_date DESC, t.created_at DESC`,
        [m.id]
      ),
      query(
        `SELECT b.*, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date, u.name AS issued_by_name
         FROM bills b LEFT JOIN users u ON u.id = b.issued_by WHERE b.matter_id = $1 ORDER BY b.created_at DESC`,
        [m.id]
      ),
      billingSummary({ query }, m.id),
    ]);
    res.json({ entries: entries.rows, bills: bills.rows, summary, activities: ACTIVITIES, canManage: canManage(req.user, m) });
  })
);

matterRouter.post(
  "/:id/time",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const problem = checkEntry(req.body, false);
    if (problem) return res.status(400).json({ error: problem });
    const rate = Number((await query(`SELECT hourly_rate FROM users WHERE id = $1`, [req.user.id])).rows[0]?.hourly_rate || 0);
    const units = unitsOf(req.body);
    const result = await query(
      `INSERT INTO time_entries (matter_id, user_id, work_date, units, rate, amount, activity, description, billable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *, to_char(work_date, 'YYYY-MM-DD') AS work_date`,
      [m.id, req.user.id, req.body.workDate, units, rate, round2((units * rate) / 10), req.body.activity,
       String(req.body.description || "").trim(), req.body.billable !== false]
    );
    res.status(201).json(result.rows[0]);
  })
);

async function editableEntry(req, res) {
  const m = await visibleMatter(req, res);
  if (!m) return null;
  const entry = (await query(`SELECT * FROM time_entries WHERE id = $1 AND matter_id = $2`, [req.params.entryId, m.id])).rows[0];
  if (!entry) { res.status(404).json({ error: "Time entry not found." }); return null; }
  if (entry.user_id !== req.user.id && !canManage(req.user, m)) { res.status(403).json({ error: "You can only change your own time." }); return null; }
  if (entry.bill_id) { res.status(400).json({ error: "This time is on a bill. Delete the draft (or cancel the bill) first." }); return null; }
  return { m, entry };
}

matterRouter.patch(
  "/:id/time/:entryId",
  asyncHandler(async (req, res) => {
    const found = await editableEntry(req, res);
    if (!found) return;
    const problem = checkEntry(req.body, true);
    if (problem) return res.status(400).json({ error: problem });
    const e = found.entry;
    const units = req.body.units !== undefined || req.body.minutes !== undefined ? unitsOf(req.body) : e.units;
    const result = await query(
      `UPDATE time_entries SET work_date = $2, units = $3, amount = $4, activity = $5, description = $6, billable = $7
       WHERE id = $1 RETURNING *, to_char(work_date, 'YYYY-MM-DD') AS work_date`,
      [e.id, req.body.workDate ?? e.work_date, units, round2((units * Number(e.rate)) / 10), req.body.activity ?? e.activity,
       req.body.description !== undefined ? String(req.body.description).trim() : e.description, req.body.billable ?? e.billable]
    );
    res.json(result.rows[0]);
  })
);

matterRouter.delete(
  "/:id/time/:entryId",
  asyncHandler(async (req, res) => {
    const found = await editableEntry(req, res);
    if (!found) return;
    await query(`DELETE FROM time_entries WHERE id = $1`, [found.entry.id]);
    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

function cleanDisbursements(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 50) return null;
  const out = [];
  for (const d of list) {
    if (!d || !String(d.description || "").trim()) return null;
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    out.push({ description: String(d.description).trim(), amount: round2(amount), vat: !!d.vat });
  }
  return out;
}

matterRouter.post(
  "/:id/bills",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const ids = Array.isArray(req.body.timeEntryIds) ? [...new Set(req.body.timeEntryIds)] : [];
    const disbursements = cleanDisbursements(req.body.disbursements);
    if (!disbursements) return res.status(400).json({ error: "Each disbursement needs a description and an amount of £0 or more." });
    const override = req.body.profitCosts;
    if (override !== undefined && override !== null && !(Number.isFinite(Number(override)) && Number(override) >= 0)) {
      return res.status(400).json({ error: "Profit costs must be £0 or more." });
    }
    if (!ids.length && (override === undefined || override === null) && !disbursements.length) {
      return res.status(400).json({ error: "Choose the time to bill, or enter the fee." });
    }

    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      let timeValue = 0;
      if (ids.length) {
        const rows = (await client_.query(
          `SELECT id, amount FROM time_entries WHERE id = ANY($1::uuid[]) AND matter_id = $2 AND bill_id IS NULL AND billable FOR UPDATE`,
          [ids, m.id]
        )).rows;
        if (rows.length !== ids.length) {
          await client_.query("ROLLBACK");
          return res.status(400).json({ error: "Some of that time is already on a bill or isn't billable — refresh and try again." });
        }
        timeValue = rows.reduce((t, r) => t + Number(r.amount), 0);
      }
      const profit = round2(override !== undefined && override !== null ? Number(override) : timeValue);
      const disbTotal = disbursements.reduce((t, d) => t + d.amount, 0);
      const vat = round2((profit + disbursements.filter((d) => d.vat).reduce((t, d) => t + d.amount, 0)) * VAT_RATE);
      const bill = (await client_.query(
        `INSERT INTO bills (firm_id, matter_id, profit_costs, disbursements, vat, total, narrative, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.user.firmId, m.id, profit, JSON.stringify(disbursements), vat, round2(profit + disbTotal + vat), String(req.body.narrative || "").trim(), req.user.id]
      )).rows[0];
      if (ids.length) await client_.query(`UPDATE time_entries SET bill_id = $1 WHERE id = ANY($2::uuid[])`, [bill.id, ids]);
      await log(client_, m.id, req.user.id, `Draft bill prepared: ${money(bill.total)} including VAT${ids.length ? ` (${ids.length} time entr${ids.length === 1 ? "y" : "ies"})` : ""}`);
      await client_.query("COMMIT");
      res.status(201).json(bill);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

async function findBill(req, res, m) {
  const bill = (await query(`SELECT * FROM bills WHERE id = $1 AND matter_id = $2`, [req.params.billId, m.id])).rows[0];
  if (!bill) res.status(404).json({ error: "Bill not found." });
  return bill;
}

matterRouter.post(
  "/:id/bills/:billId/issue",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    if (!canManage(req.user, m)) return res.status(403).json({ error: "Only the matter's fee earner, their supervisor or an admin can issue bills." });
    const bill = await findBill(req, res, m);
    if (!bill) return;
    if (bill.status !== "draft") return res.status(400).json({ error: "Only a draft bill can be issued." });
    const client_ = await pool.connect();
    try {
      await client_.query("BEGIN");
      await client_.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bill-numbers:${req.user.firmId}`]);
      const next = (await client_.query(`SELECT coalesce(max(bill_number), 0) + 1 AS n FROM bills WHERE firm_id = $1`, [req.user.firmId])).rows[0].n;
      const issued = (await client_.query(
        `UPDATE bills SET status = 'issued', bill_number = $2, bill_date = $3, issued_by = $4, issued_at = now() WHERE id = $1 RETURNING *, to_char(bill_date, 'YYYY-MM-DD') AS bill_date`,
        [bill.id, next, ukToday(), req.user.id]
      )).rows[0];
      await log(client_, m.id, req.user.id, `Bill ${next} issued: ${money(issued.total)} including VAT`);
      await client_.query("COMMIT");
      res.json(issued);
    } catch (err) {
      await client_.query("ROLLBACK");
      throw err;
    } finally {
      client_.release();
    }
  })
);

matterRouter.post(
  "/:id/bills/:billId/cancel",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    if (!canManage(req.user, m)) return res.status(403).json({ error: "Only the matter's fee earner, their supervisor or an admin can cancel bills." });
    const bill = await findBill(req, res, m);
    if (!bill) return;
    if (bill.status !== "issued") return res.status(400).json({ error: "Only an issued bill can be cancelled (delete a draft instead)." });
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Give a reason for cancelling the bill." });
    await query(`UPDATE bills SET status = 'cancelled', cancelled_reason = $2 WHERE id = $1`, [bill.id, reason]);
    await query(`UPDATE time_entries SET bill_id = NULL WHERE bill_id = $1`, [bill.id]);
    await log({ query }, m.id, req.user.id, `Bill ${bill.bill_number} cancelled — ${reason}`);
    res.status(204).send();
  })
);

matterRouter.delete(
  "/:id/bills/:billId",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const bill = await findBill(req, res, m);
    if (!bill) return;
    if (bill.status !== "draft") return res.status(400).json({ error: "Issued bills can't be deleted — cancel them instead." });
    await query(`UPDATE time_entries SET bill_id = NULL WHERE bill_id = $1`, [bill.id]);
    await query(`DELETE FROM bills WHERE id = $1`, [bill.id]);
    await log({ query }, m.id, req.user.id, `Draft bill (${money(bill.total)}) deleted`);
    res.status(204).send();
  })
);

matterRouter.get(
  "/:id/bills/:billId/document",
  asyncHandler(async (req, res) => {
    const m = await visibleMatter(req, res);
    if (!m) return;
    const bill = (await query(`SELECT *, to_char(bill_date, 'YYYY-MM-DD') AS bill_date FROM bills WHERE id = $1 AND matter_id = $2`, [req.params.billId, m.id])).rows[0];
    if (!bill) return res.status(404).json({ error: "Bill not found." });
    const [firm, entries, feeEarner] = await Promise.all([
      query(`SELECT name FROM firms WHERE id = $1`, [req.user.firmId]),
      query(
        `SELECT to_char(t.work_date, 'YYYY-MM-DD') AS work_date, t.units, t.amount, t.activity, t.description, u.name AS user_name
         FROM time_entries t LEFT JOIN users u ON u.id = t.user_id WHERE t.bill_id = $1 ORDER BY t.work_date, t.created_at`,
        [bill.id]
      ),
      query(`SELECT name FROM users WHERE id = $1`, [m.fee_earner_id]),
    ]);
    const buffer = await buildBill({ bill, matter: m, firm: firm.rows[0], entries: entries.rows, feeEarner: feeEarner.rows[0]?.name || null });
    const fileName = `${bill.bill_number ? `Bill ${bill.bill_number}` : "Draft bill"} - ${m.reference}.docx`;
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  })
);

// ---------------------------------------------------------------------------
// Timesheet
// ---------------------------------------------------------------------------
const timeRouter = express.Router();
timeRouter.use(requireAuth);

timeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const to = DATE_RE.test(req.query.to || "") ? req.query.to : ukToday();
    const from = DATE_RE.test(req.query.from || "") ? req.query.from : to;
    const result = await query(
      `SELECT t.id, t.matter_id, to_char(t.work_date, 'YYYY-MM-DD') AS work_date, t.units, t.amount, t.activity, t.description, t.billable,
              t.bill_id, m.reference, m.address, m.client
       FROM time_entries t JOIN matters m ON m.id = t.matter_id
       WHERE t.user_id = $1 AND t.work_date BETWEEN $2 AND $3
       ORDER BY t.work_date DESC, t.created_at DESC`,
      [req.user.id, from, to]
    );
    const units = result.rows.reduce((n, r) => n + r.units, 0);
    const billable = result.rows.filter((r) => r.billable).reduce((n, r) => n + r.units, 0);
    res.json({ from, to, entries: result.rows, totals: { units, billableUnits: billable, value: round2(result.rows.reduce((n, r) => n + Number(r.amount), 0)) } });
  })
);

module.exports = { matterRouter, timeRouter, billingSummary, ACTIVITIES };
