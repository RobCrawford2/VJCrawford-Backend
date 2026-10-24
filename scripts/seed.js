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
const { hashPassword } = require("../src/utils/passwords");

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

    const passwordHash = await hashPassword(password);

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

    // Support staff: an assistant working for Sarah, a secretary for Marcus.
    for (const [name, email, role, boss] of [
      ["Jess Taylor", "jess@vjcrawfordconveyancing.co.uk", "assistant", sarah.id],
      ["Lucy Brown", "lucy@vjcrawfordconveyancing.co.uk", "secretary", marcus.id],
    ]) {
      await client.query(
        `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [firm.id, name, email, passwordHash, role, boss]
      );
    }

    // Departments: the demo firm runs conveyancing, family and private client.
    // Everyone above works in conveyancing; Priya is the family fee earner.
    const priya = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Priya Shah", "priya@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];
    await client.query(
      `INSERT INTO firm_departments (firm_id, department) VALUES ($1,'conveyancing'), ($1,'family'), ($1,'private_client')`,
      [firm.id]
    );
    await client.query(
      `INSERT INTO user_departments (user_id, department)
       SELECT id, 'conveyancing' FROM users WHERE firm_id = $1 AND id <> $2 AND role <> 'admin'`,
      [firm.id, priya.id]
    );
    await client.query(`INSERT INTO user_departments (user_id, department) VALUES ($1, 'family')`, [priya.id]);
    // Emma runs Wills, Trusts & Probate.
    const emma = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Emma Lowe", "emma@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];
    await client.query(`INSERT INTO user_departments (user_id, department) VALUES ($1, 'private_client')`, [emma.id]);

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

    // A family matter — only Priya (and admins / all-departments staff) can see it.
    const morris = (await client.query(
      `INSERT INTO matters (firm_id, reference, department, address, client, type, current_stage_index, fee_earner_id, supervisor_id,
         other_side_solicitor, date_instructed, notes)
       VALUES ($1,'FAM-2026-0001','family','Divorce and financial settlement','Hannah Morris','Financial settlement',4,$2,$3,
         'Greaves Family Law','2026-07-14','Form E exchange due before the first appointment.') RETURNING id`,
      [firm.id, priya.id, david.id]
    )).rows[0];
    await client.query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'stage','Matter opened at Instructed')`, [morris.id, priya.id]);

    // Wills, Trusts & Probate: an estate in administration, a will and an LPA.
    const pcMatter = async (reference, description, clientName, type, stage, instructed, details, funding, estimate) => {
      const id = (await client.query(
        `INSERT INTO matters (firm_id, reference, department, address, client, type, current_stage_index, fee_earner_id, supervisor_id,
           date_instructed, funding, fee_estimate, pc_details, folders_ready)
         VALUES ($1,$2,'private_client',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,false) RETURNING id`,
        [firm.id, reference, description, clientName, type, stage, emma.id, david.id, instructed, funding, estimate, JSON.stringify(details)]
      )).rows[0].id;
      await client.query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'stage','Matter opened at Instructed')`, [id, emma.id]);
      return id;
    };
    const estateId = await pcMatter("PC-2026-0001", "Estate of Margaret Ellen Hayward", "Executors of Margaret Hayward",
      "Probate / estate administration", 3, "2026-06-08", {
        deceasedName: "Margaret Ellen Hayward", dateOfDeath: "2026-05-21", deceasedAddress: "4 Linden Close, Harrogate, HG2 0PL",
        dateOfBirth: "1937-11-02", maritalStatus: "Widowed / surviving civil partner", dateOfWill: "2019-03-14", grantType: "Probate",
        personalRepresentatives: "Susan Clarke and Peter Hayward", ihtRoute: "IHT400 account", transferredNrbPct: 100,
        transferredRnrbPct: 100, homeToDescendants: true,
      }, "hourly", 6500);
    await client.query(
      `INSERT INTO estate_items (matter_id, kind, category, description, holder, reference, value_at_death, status, notified_on, created_by) VALUES
       ($1,'asset','Property (main residence)','4 Linden Close, Harrogate','—',NULL,425000,'Valued',NULL,$2),
       ($1,'asset','Bank / building society','Current account','Lloyds Bank','30-94-11 / 01234567',8412.55,'Notified','2026-06-12',$2),
       ($1,'asset','Bank / building society','Instant access saver','Nationwide Building Society','0098 112233',64230.10,'Valued','2026-06-12',$2),
       ($1,'asset','Investments / shares','Stocks & shares ISA','Hargreaves Lansdown','HL-778201',112650,'Notified','2026-06-15',$2),
       ($1,'asset','Premium Bonds / NS&I','Premium Bonds','NS&I','HAY 4471 02',50000,'To notify',NULL,$2),
       ($1,'asset','Personal possessions','Household contents and jewellery',NULL,NULL,6500,'Valued',NULL,$2),
       ($1,'liability','Funeral','Funeral account','Wrights Funeral Directors','F-2231',4875,'Agreed','2026-06-10',$2),
       ($1,'liability','Care fees','Care home fees to date of death','Oakfield Care Home','OAK/HAY',3260,'Notified','2026-06-12',$2),
       ($1,'liability','Household bills','Council tax and utilities',NULL,NULL,640,'To notify',NULL,$2)`,
      [estateId, emma.id]
    );
    await client.query(
      `INSERT INTO estate_beneficiaries (matter_id, name, relationship, gift_type, description, amount, share_percent, exemption) VALUES
       ($1,'Yorkshire Air Ambulance','Charity','Pecuniary legacy',NULL,5000,NULL,'charity'),
       ($1,'Emily Clarke','Granddaughter','Specific gift','Diamond engagement ring',NULL,NULL,NULL),
       ($1,'Susan Clarke','Daughter','Share of residue',NULL,NULL,50,NULL),
       ($1,'Peter Hayward','Son','Share of residue',NULL,NULL,50,NULL)`,
      [estateId]
    );
    await client.query(
      `INSERT INTO matter_parties (matter_id, name, role) VALUES ($1,'Margaret Ellen Hayward','Deceased'),
       ($1,'Susan Clarke','Executor'), ($1,'Peter Hayward','Executor')`,
      [estateId]
    );
    const willId = await pcMatter("PC-2026-0002", "Wills for Mr and Mrs Okafor", "Daniel & Grace Okafor", "Will", 6, "2026-07-01", {
      testator: "Daniel Okafor and Grace Okafor", willType: "Mirror wills", executors: "Each other, then Ruth Okafor",
      guardians: "Ruth and Samuel Okafor", dateSigned: "2026-08-04", witnesses: "Emma Lowe and Jess Taylor",
    }, "fixed_fee", 450);
    await pcMatter("PC-2026-0003", "Lasting powers of attorney for Alan Pritchard", "Alan Pritchard", "Lasting power of attorney", 5, "2026-07-15", {
      donor: "Alan Pritchard", lpaTypes: "Both", attorneys: "Claire Pritchard and Owen Pritchard", howAct: "Jointly and severally",
      certificateProvider: "Dr R Mehta", dateSigned: "2026-08-10", sentToOpg: "2026-08-14",
    }, "fixed_fee", 750);
    await client.query(
      `INSERT INTO safe_custody (firm_id, matter_id, doc_type, person, document_date, location, received_on, created_by) VALUES
       ($1,$2,'Will','Daniel Okafor','2026-08-04','Strongroom A — packet 1042','2026-08-04',$3),
       ($1,$2,'Will','Grace Okafor','2026-08-04','Strongroom A — packet 1043','2026-08-04',$3),
       ($1,NULL,'Will','Joan Whitaker','2011-05-19','Strongroom A — packet 0388','2011-05-19',$3)`,
      [firm.id, willId, emma.id]
    );
    await client.query(
      `INSERT INTO deadlines (matter_id, title, kind, due_date, critical, created_by)
       VALUES ($1,'IHT payment due (end of the 6th month after death)','filing','2026-11-30',true,$2),
              ($1,'IHT account (IHT400) due (12 months after the end of the month of death)','filing','2027-05-31',true,$2)`,
      [estateId, emma.id]
    );

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
    // A few documents (filed into the standard folders by category when the matter is first opened).
    await client.query(
      `INSERT INTO documents (matter_id, name, category, doc_date, created_by) VALUES
       ($1, 'Client care letter', 'Correspondence', '2026-07-28', $2),
       ($1, 'Passport — Tom Whitfield', 'ID / AML', '2026-07-28', $2),
       ($1, 'Draft contract', 'Contract', '2026-08-02', $2),
       ($1, 'Official copies of the register', 'Title', '2026-08-02', $2),
       ($1, 'Environmental search result', 'Search', '2026-08-07', $2),
       ($1, 'Mortgage offer — Barclays', 'Mortgage', '2026-08-05', $2),
       ($1, 'Seller''s property information form (TA6)', 'Other', '2026-08-02', $2)`,
      [whitfieldId, marcus.id]
    );

    // Client records (one per client name — in the demo data the same name is
    // the same client, so the Faulkners' purchase and sale share theirs) and
    // the other parties, for the client register and conflict checks.
    await client.query(
      `WITH keyed AS (
         SELECT id, firm_id, client, client_address, client_email, client_phone, client_salutation, created_at,
                lower(client) AS key
         FROM matters WHERE firm_id = $1
       ), made AS (
         INSERT INTO clients (firm_id, name, address, email, phone, salutation, id_verified_on, id_method, risk_level)
         SELECT DISTINCT ON (key) firm_id, client, client_address, client_email, client_phone, client_salutation,
                CASE WHEN client = 'R & J Faulkner' THEN DATE '2026-06-03' END,
                CASE WHEN client = 'R & J Faulkner' THEN 'Passport' END,
                CASE WHEN client = 'R & J Faulkner' THEN 'low' END
         FROM keyed ORDER BY key, client_email NULLS LAST, created_at
         RETURNING id, lower(name) AS name_key
       )
       INSERT INTO matter_clients (matter_id, client_id)
       SELECT k.id, made.id FROM keyed k JOIN made ON made.name_key = k.key`,
      [firm.id]
    );
    await client.query(
      `INSERT INTO matter_parties (matter_id, name, role) VALUES
       ($1, 'Helen Margaret Carver', 'Seller'), ($2, 'Daniel & Sophie Grant', 'Buyer'), ($3, 'Mark Morris', 'Other party (spouse)')`,
      [faulknerPurchaseId, faulknerSaleId, morris.id]
    );

    // Hourly rates, an estimate on the family matter and some time recorded on it.
    await client.query(
      `UPDATE users SET hourly_rate = CASE email
         WHEN 'david@vjcrawfordconveyancing.co.uk' THEN 250 WHEN 'sarah@vjcrawfordconveyancing.co.uk' THEN 200
         WHEN 'marcus@vjcrawfordconveyancing.co.uk' THEN 180 WHEN 'priya@vjcrawfordconveyancing.co.uk' THEN 210
         WHEN 'jess@vjcrawfordconveyancing.co.uk' THEN 120 END
       WHERE firm_id = $1`,
      [firm.id]
    );
    await client.query(`UPDATE matters SET fee_estimate = 3000 WHERE id = $1`, [morris.id]);
    await client.query(`UPDATE matters SET funding = 'fixed_fee' WHERE firm_id = $1 AND department = 'conveyancing'`, [firm.id]);
    await client.query(
      `INSERT INTO time_entries (matter_id, user_id, work_date, units, rate, amount, activity, description) VALUES
       ($1, $2, '2026-07-14', 10, 210, 210, 'Attendance (meeting)', 'Initial meeting — background, finances and options'),
       ($1, $2, '2026-07-21', 4, 210, 84, 'Letter / email out', 'Letter to Greaves Family Law proposing mediation'),
       ($1, $2, '2026-08-11', 15, 210, 315, 'Drafting', 'Form A and covering letter')`,
      [morris.id, priya.id]
    );

    await client.query("COMMIT");
    console.log("[seed] Seed complete.");
    // Only echo the password when it's the well-known local default; a
    // custom DEMO_PASSWORD shouldn't end up in the host's logs.
    const shown = password === "password123" ? password : "<DEMO_PASSWORD>";
    console.log(`[seed] Demo login: sarah@vjcrawfordconveyancing.co.uk / ${shown} (fee earner)`);
    console.log(`[seed]             marcus@vjcrawfordconveyancing.co.uk / ${shown} (fee earner)`);
    console.log(`[seed]             david@vjcrawfordconveyancing.co.uk / ${shown} (admin)`);
    console.log(`[seed]             jess@vjcrawfordconveyancing.co.uk / ${shown} (assistant to Sarah)`);
    console.log(`[seed]             lucy@vjcrawfordconveyancing.co.uk / ${shown} (secretary to Marcus)`);
    console.log(`[seed]             priya@vjcrawfordconveyancing.co.uk / ${shown} (family fee earner)`);
    console.log(`[seed]             emma@vjcrawfordconveyancing.co.uk / ${shown} (wills, trusts & probate fee earner)`);
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
