/**
 * Loads the same demo firm, staff, and matters used in the React prototype
 * (Faulkner purchase + linked sale, Shah closed sale, Whitfield "problem
 * file") so the backend can be tested end-to-end with realistic, familiar
 * data. Safe to re-run — it wipes and recreates the demo firm each time.
 *
 * Exported as `runSeed(pool)` so it can be triggered on server boot (see
 * server.js — gated behind SEED_ON_BOOT=true) as well as run directly via
 * `npm run seed`.
 */
const bcrypt = require("bcryptjs");

async function runSeed(pool, { password = "password123" } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Wipe any previous demo firm. Matters go first: their documents, tasks
    // etc. reference the firm's users via created_by (no cascade), so
    // deleting the firm in one step fails once any such rows exist.
    await client.query(
      `DELETE FROM matters WHERE firm_id IN (SELECT id FROM firms WHERE name = 'V J Crawford Conveyancing (Demo)')`
    );
    await client.query(
      `DELETE FROM staff_audit WHERE firm_id IN (SELECT id FROM firms WHERE name = 'V J Crawford Conveyancing (Demo)')`
    );
    await client.query(`DELETE FROM firms WHERE name = 'V J Crawford Conveyancing (Demo)'`);

    const firm = (
      await client.query(
        `INSERT INTO firms (name, domain, stale_days) VALUES ($1, $2, 14) RETURNING id`,
        ["V J Crawford Conveyancing (Demo)", "vjcrawfordconveyancing.co.uk"]
      )
    ).rows[0];

    const passwordHash = await bcrypt.hash(password, 12);

    const david = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'admin') RETURNING id`,
      [firm.id, "David Okonkwo", "david@vjcrawfordconveyancing.co.uk", passwordHash]
    )).rows[0];

    const sarah = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Sarah Ncube", "sarah@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];

    const marcus = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Marcus Webb", "marcus@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];

    async function insertMatter(m) {
      const row = (await client.query(
        `INSERT INTO matters (
           firm_id, reference, address, client, type, price, current_stage_index,
           fee_earner_id, supervisor_id, other_side_solicitor, other_side_solicitor_email,
           estate_agent, lender, date_instructed, target_exchange, target_completion,
           actual_exchange, actual_completion, mortgage_offer_expiry, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          firm.id, m.reference, m.address, m.client, m.type, m.price, m.stage,
          m.feeEarner, david.id, m.otherSideSolicitor || null, m.otherSideSolicitorEmail || null,
          m.estateAgent || null, m.lender || null, m.instructed, m.targetExchange || null,
          m.targetCompletion || null, m.actualExchange || null, m.actualCompletion || null,
          m.mortgageOfferExpiry || null, m.notes || "",
        ]
      )).rows[0];
      return row.id;
    }

    const faulknerPurchaseId = await insertMatter({
      reference: "CV-2026-0041", address: "14 Mill Race Lane, Winchcombe, GL54 5LX", client: "R & J Faulkner",
      type: "Purchase", price: 465000, stage: 7, feeEarner: sarah.id,
      otherSideSolicitor: "Hedley & Bourne LLP", otherSideSolicitorEmail: "conveyancing@hedleybourne.co.uk",
      estateAgent: "Chapman Moore Estate Agents", lender: "Nationwide Building Society",
      instructed: "2026-06-02", targetExchange: "2026-08-22", targetCompletion: "2026-08-29",
      mortgageOfferExpiry: "2026-11-30",
      notes: "Chain of two — linked to the Faulkners' own sale. Buyer's mortgage offer in place.",
    });

    const faulknerSaleId = await insertMatter({
      reference: "CV-2026-0040", address: "6 Orchard Terrace, Cheltenham, GL50 2QF", client: "R & J Faulkner",
      type: "Sale", price: 398000, stage: 7, feeEarner: sarah.id,
      otherSideSolicitor: "Milbourne Grant Solicitors", otherSideSolicitorEmail: "conveyancing@milbournegrant.co.uk",
      estateAgent: "Chapman Moore Estate Agents",
      instructed: "2026-06-02", targetExchange: "2026-08-22", targetCompletion: "2026-09-03",
      notes: "Same clients' onward purchase is CV-2026-0041 — this sale is funding it.",
    });
    await client.query(`INSERT INTO matter_links (matter_id, linked_matter_id) VALUES ($1,$2), ($2,$1)`, [faulknerPurchaseId, faulknerSaleId]);

    await client.query(
      `UPDATE matters SET client_address = $1, client_email = $2, client_phone = $3, client_salutation = $4,
         tenure = 'Freehold', title_number = 'GR412873', registered_proprietor = 'Helen Margaret Carver',
         deposit = 46500, sdlt = 10750, mortgage_conditions = 'Retention of £2,500 pending replacement of the rear roof covering.'
       WHERE id = $5`,
      ["6 Orchard Terrace, Cheltenham, GL50 2QF", "faulkners@example.com", "07700 900456", "Mr and Mrs Faulkner", faulknerPurchaseId]
    );

    await insertMatter({
      reference: "CV-2026-0038", address: "Flat 3, Ashworth Court, 22 Grove Road, Bristol, BS6 6UN", client: "Priya Shah",
      type: "Sale", price: 245000, stage: 11, feeEarner: marcus.id,
      otherSideSolicitor: "Redgrave Legal", otherSideSolicitorEmail: "property@redgravelegal.co.uk", estateAgent: "Northside Homes",
      instructed: "2026-04-14", targetExchange: "2026-06-10", targetCompletion: "2026-06-24",
      actualExchange: "2026-06-10", actualCompletion: "2026-06-24",
      notes: "Straightforward sale, no chain. File ready to archive.",
    });

    const whitfieldId = await insertMatter({
      reference: "CV-2026-0045", address: "9 Foundry Court, Kelham Island, Sheffield, S3 8SB", client: "Tom Whitfield",
      type: "Purchase", price: 189950, stage: 3, feeEarner: marcus.id,
      otherSideSolicitor: "Marchetti & Co", otherSideSolicitorEmail: "res@marchettico.com",
      estateAgent: "Kelham Property Partners", lender: "Barclays Mortgages",
      instructed: "2026-07-28", targetCompletion: "2026-09-20", mortgageOfferExpiry: "2026-09-10",
      notes: "First-time buyer. Awaiting search results before enquiries can be raised.",
    });

    // A deliberately overdue + issue-flagged search, matching the frontend demo.
    await client.query(
      `INSERT INTO searches (matter_id, type, date_ordered, expected_return, date_received, issue, issue_notes) VALUES
       ($1, 'Local Authority Search', '2026-08-01', '2026-08-15', NULL, false, NULL),
       ($1, 'Water & Drainage Search', '2026-08-01', '2026-08-10', '2026-08-09', false, NULL),
       ($1, 'Environmental Search', '2026-08-01', '2026-08-08', '2026-08-07', true, 'Low risk of historic contamination flagged within 250m — referred to client, awaiting instructions on indemnity insurance.')`,
      [whitfieldId]
    );
    await client.query(
      `INSERT INTO tasks (matter_id, description, due_date, status, created_by) VALUES ($1,$2,'2026-08-18','Open',$3)`,
      [whitfieldId, "Follow up with client for instructions on indemnity insurance re: environmental search", marcus.id]
    );

    await client.query("COMMIT");
    console.log("[seed] Seed complete.");
    // Only echo the password when it's the well-known local default; a
    // custom DEMO_PASSWORD shouldn't end up in the host's logs.
    const shown = password === "password123" ? password : "<DEMO_PASSWORD>";
    console.log(`[seed] Demo login: sarah@vjcrawfordconveyancing.co.uk / ${shown} (fee earner)`);
    console.log(`[seed]             marcus@vjcrawfordconveyancing.co.uk / ${shown} (fee earner)`);
    console.log(`[seed]             david@vjcrawfordconveyancing.co.uk / ${shown} (admin)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// CLI usage: `npm run seed` — uses the shared pool, runs, then exits.
if (require.main === module) {
  require("dotenv").config();
  const { pool } = require("../src/db");
  runSeed(pool, { password: process.env.DEMO_PASSWORD || "password123" })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runSeed };
