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
    // Aisha does employment (and corporate); departments are switched on below as each is set up.
    const aisha = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Aisha Khan", "aisha@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];
    await client.query(`INSERT INTO firm_departments (firm_id, department) VALUES ($1, 'employment')`, [firm.id]);
    await client.query(`INSERT INTO user_departments (user_id, department) VALUES ($1, 'employment')`, [aisha.id]);
    // Tom does litigation (and personal injury).
    const tom = (await client.query(
      `INSERT INTO users (firm_id, name, email, password_hash, role, supervisor_id) VALUES ($1,$2,$3,$4,'fee_earner',$5) RETURNING id`,
      [firm.id, "Tom Reid", "tom@vjcrawfordconveyancing.co.uk", passwordHash, david.id]
    )).rows[0];
    await client.query(`INSERT INTO firm_departments (firm_id, department) VALUES ($1, 'litigation')`, [firm.id]);
    await client.query(`INSERT INTO user_departments (user_id, department) VALUES ($1, 'litigation')`, [tom.id]);

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
    await client.query(
      `UPDATE matters SET details = $2::jsonb WHERE id = $1`,
      [morris.id, JSON.stringify({ otherParty: "Mark Morris", court: "Bristol Family Court", caseNumber: "BS26F00412", miam: "MIAM attended", formAIssued: "2026-07-30", firstAppointment: "2026-11-19" })]
    );
    await client.query(
      `INSERT INTO family_assets (matter_id, kind, owner, category, description, value, proposed_client_percent, source, created_by) VALUES
       ($1,'asset','joint','Family home','14 Cotham Vale, Bristol (net of 3% sale costs)',485000,60,'Agreed valuation',$2),
       ($1,'liability','joint','Mortgage','Nationwide mortgage',162000,60,'Redemption statement',$2),
       ($1,'asset','client','Bank / savings','Santander current and ISA',18400,NULL,'Form E 2.3',$2),
       ($1,'asset','other','Bank / savings','Barclays savings',41200,NULL,'Form E 2.3',$2),
       ($1,'asset','other','Vehicle','Audi A4',14500,NULL,'Form E 2.7',$2),
       ($1,'liability','other','Loan / credit card','Barclaycard',6300,NULL,'Form E 2.14',$2),
       ($1,'pension','client','Defined benefit (final salary)','NHS Pension Scheme',96000,NULL,'CETV Aug 2026',$2),
       ($1,'pension','other','Defined contribution','Aviva workplace pension',212000,40,'CETV Jul 2026',$2)`,
      [morris.id, priya.id]
    );
    await client.query(
      `INSERT INTO family_children (matter_id, name, date_of_birth, lives_with, school) VALUES
       ($1,'Ella Morris','2014-03-09','Client','Cotham School'), ($1,'Jacob Morris','2018-11-22','Client','Westbury Park Primary')`,
      [morris.id]
    );

    // More family: the divorce, a children case and an urgent injunction (dates relative to today, so the warnings show).
    const isoIn = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const famMatter = async (reference, description, clientName, type, stage, details, funding, estimate) => {
      const id = (await client.query(
        `INSERT INTO matters (firm_id, reference, department, address, client, type, current_stage_index, fee_earner_id, supervisor_id,
           date_instructed, funding, fee_estimate, details)
         VALUES ($1,$2,'family',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
        [firm.id, reference, description, clientName, type, stage, priya.id, david.id, isoIn(-200), funding, estimate, JSON.stringify(details)]
      )).rows[0].id;
      await client.query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'stage','Matter opened at Instructed')`, [id, priya.id]);
      return id;
    };
    await famMatter("FAM-2026-0002", "Divorce — Morris", "Hannah Morris", "Divorce", 6, {
      weAct: "Applicant", applicationType: "Divorce", dateOfMarriage: "2011-06-18", placeOfMarriage: "Bristol Register Office",
      dateOfSeparation: "2025-11-01", applicationIssued: isoIn(-190), acknowledgmentFiled: isoIn(-175),
      conditionalOrderApplied: isoIn(-48), conditionalOrderPronounced: isoIn(-50), otherParty: "Mark Morris", caseNumber: "1726-4410-9921-0042",
    }, "fixed_fee", 650);
    const childrenId = await famMatter("FAM-2026-0003", "Child arrangements — Patel", "Ravi Patel", "Children", 4, {
      otherParty: "Anjali Patel", court: "Birmingham Family Court", caseNumber: "BM26P00877", miam: "MIAM attended",
      c100Issued: isoIn(-70), cafcassLetter: isoIn(-40), fhdraDate: isoIn(-10), section7Due: isoIn(35),
    }, "hourly", 3500);
    await client.query(
      `INSERT INTO family_children (matter_id, name, date_of_birth, lives_with) VALUES ($1,'Arjun Patel','2019-04-15','Other party')`,
      [childrenId]
    );
    await famMatter("FAM-2026-0004", "Non-molestation order — K. Doyle", "Kerry Doyle", "Injunction / domestic abuse", 6, {
      orderType: "Non-molestation order", withoutNotice: true, applicationIssued: isoIn(-170), orderMade: isoIn(-168),
      orderExpires: isoIn(12), servedOnRespondent: isoIn(-166), policeNotified: true, otherParty: "Sean Doyle",
      court: "Manchester Family Court", caseNumber: "MA26F00133", confidentialAddress: true,
    }, "legal_aid", null);

    // Wills, Trusts & Probate: an estate in administration, a will and an LPA.
    const pcMatter = async (reference, description, clientName, type, stage, instructed, details, funding, estimate) => {
      const id = (await client.query(
        `INSERT INTO matters (firm_id, reference, department, address, client, type, current_stage_index, fee_earner_id, supervisor_id,
           date_instructed, funding, fee_estimate, details, folders_ready)
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

    // Matters for the departments set up from configuration (src/config/practice), with list items.
    const practiceMatter = async ({ reference, department, description, clientName, type, stage, feeEarner, details, funding, estimate, lists = {} }) => {
      const id = (await client.query(
        `INSERT INTO matters (firm_id, reference, department, address, client, type, current_stage_index, fee_earner_id, supervisor_id,
           date_instructed, funding, fee_estimate, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id`,
        [firm.id, reference, department, description, clientName, type, stage, feeEarner, david.id, isoIn(-60), funding, estimate, JSON.stringify(details)]
      )).rows[0].id;
      await client.query(`INSERT INTO activity_log (matter_id, user_id, type, text) VALUES ($1,$2,'stage','Matter opened at Instructed')`, [id, feeEarner]);
      for (const [list, items] of Object.entries(lists)) {
        for (const [i, data] of items.entries()) {
          await client.query(`INSERT INTO matter_list_items (matter_id, list, data, position, created_by) VALUES ($1,$2,$3::jsonb,$4,$5)`, [id, list, JSON.stringify(data), i, feeEarner]);
        }
      }
      return id;
    };

    // Employment
    await practiceMatter({
      reference: "EMP-2026-0001", department: "employment", description: "Unfair dismissal — Lewis v Brightwell Logistics", clientName: "Jordan Lewis",
      type: "Tribunal claim — for employee", stage: 3, feeEarner: aisha.id, funding: "hourly", estimate: 7500,
      details: {
        otherParty: "Brightwell Logistics Ltd", jobTitle: "Warehouse supervisor", claims: "Unfair dismissal; failure to make reasonable adjustments",
        dateOfBirth: "1979-02-14", startDate: "2015-01-05", edt: isoIn(-40), grossWeeklyPay: 820, netWeeklyPay: 610, acasDayA: isoIn(-20),
      },
      lists: {
        schedule: [
          { head: "Basic award", description: "11 years × 1.5 / 1 weeks at £751", amount: 11264.5 },
          { head: "Loss of earnings to date", description: "6 weeks × £610 net", amount: 3660 },
          { head: "Loss of statutory rights", amount: 600 },
          { head: "Injury to feelings", description: "Lower Vento band", amount: 8000 },
        ],
        offers: [{ date: isoIn(-5), madeBy: "Other side", offerType: "COT3 / ACAS", amount: 6000, terms: "Through ACAS; agreed reference", status: "Open" }],
      },
    });
    await practiceMatter({
      reference: "EMP-2026-0002", department: "employment", description: "Settlement agreement — Nina Clarke", clientName: "Nina Clarke",
      type: "Settlement agreement", stage: 3, feeEarner: aisha.id, funding: "fixed_fee", estimate: 500,
      details: {
        otherParty: "Northgate Insurance plc", dateOfBirth: "1984-09-30", startDate: "2012-04-02", terminationDate: isoIn(14), grossWeeklyPay: 1150,
        noticePay: 13800, holidayPay: 2100, settlementPayment: 42000, legalFeesContribution: 500, receivedOn: isoIn(-3), paymentDue: isoIn(42),
      },
    });
    await practiceMatter({
      reference: "EMP-2026-0003", department: "employment", description: "Ahmed v Harbour Cafés Ltd", clientName: "Harbour Cafés Ltd",
      type: "Tribunal claim — for employer", stage: 4, feeEarner: aisha.id, funding: "hourly", estimate: 9000,
      details: {
        otherParty: "Samir Ahmed", claims: "Unfair dismissal; unpaid holiday pay", startDate: "2021-06-01", edt: isoIn(-75), dateOfBirth: "1996-12-03",
        grossWeeklyPay: 520, claimSentToRespondent: isoIn(-20), tribunal: "Bristol", caseNumber: "1401234/2026",
      },
      lists: { offers: [{ date: isoIn(-2), madeBy: "Us", offerType: "Without prejudice save as to costs", amount: 2500, status: "Open" }] },
    });

    // Litigation
    await practiceMatter({
      reference: "LIT-2026-0001", department: "litigation", description: "Wexford Joinery v Castlegate Developments — unpaid invoices", clientName: "Wexford Joinery Ltd",
      type: "Contract / debt dispute", stage: 4, feeEarner: tom.id, funding: "hourly", estimate: 18000,
      details: {
        weAct: "Claimant", otherParty: "Castlegate Developments Ltd", claimValue: 48500, causeOfAction: "2025-09-30", letterBeforeClaim: isoIn(-120),
        claimIssued: isoIn(-30), claimNumber: "K00BS412", court: "County Court at Bristol", claimFormServed: isoIn(-27), particularsServed: isoIn(-25),
        aosFiled: isoIn(-15), interestRate: 8, interestFrom: "2025-10-30",
      },
      lists: {
        offers: [
          { date: isoIn(-40), madeBy: "Us", offerType: "Part 36", amount: 44000, status: "Rejected", respondedOn: isoIn(-25) },
          { date: isoIn(-16), madeBy: "Other side", offerType: "Part 36", amount: 30000, terms: "Inclusive of interest", status: "Open" },
        ],
        chronology: [
          { date: "2025-03-14", event: "Subcontract signed for joinery at Castlegate's Harbourside scheme", source: "Subcontract, cl. 4 (payment)" },
          { date: "2025-08-29", event: "Works completed; final account invoice issued (£48,500)", source: "Invoice WJ-2291" },
          { date: "2025-09-30", event: "Payment due date passes; no pay less notice served", source: "Subcontract cl. 4.3", disputed: true },
          { date: "2026-02-11", event: "Castlegate alleges defective doors; withholds payment", source: "Email from site manager", disputed: true },
        ],
        witnesses: [
          { name: "Gareth Wexford", role: "Witness of fact", evidence: "Contract, works and invoices", status: "Proof taken" },
          { name: "Independent joinery expert (TBC)", role: "Expert (single joint)", evidence: "Alleged defects", status: "To approach", due: isoIn(30) },
        ],
      },
    });
    await practiceMatter({
      reference: "LIT-2026-0002", department: "litigation", description: "Hale v Barrow Surveyors — negligent survey", clientName: "Michael & Ruth Hale",
      type: "Professional negligence", stage: 2, feeEarner: tom.id, funding: "hourly", estimate: 25000,
      details: { weAct: "Claimant", otherParty: "Barrow Surveyors LLP", claimValue: 62000, causeOfAction: "2020-11-12", dateOfKnowledge: "2025-04-03", letterBeforeClaim: isoIn(-30) },
      lists: { chronology: [
        { date: "2020-11-12", event: "Level 2 survey report: no significant defects", source: "Survey report" },
        { date: "2025-04-03", event: "Subsidence discovered during extension works", source: "Structural engineer's report" },
      ] },
    });
    await practiceMatter({
      reference: "LIT-2026-0003", department: "litigation", description: "Arden Print v Lumen Events — debt", clientName: "Arden Print Ltd",
      type: "Debt recovery", stage: 6, feeEarner: tom.id, funding: "fixed_fee", estimate: 900,
      details: {
        weAct: "Claimant", otherParty: "Lumen Events Ltd", debtorType: "Business", invoiceDue: "2026-03-31", claimValue: 6240, causeOfAction: "2026-03-31",
        letterBeforeClaim: "2026-05-02", claimIssued: "2026-06-10", judgmentDate: isoIn(-20), judgmentAmount: 6802.4, amountRecovered: 1500,
      },
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
    console.log(`[seed]             aisha@vjcrawfordconveyancing.co.uk / ${shown} (employment fee earner)`);
    console.log(`[seed]             tom@vjcrawfordconveyancing.co.uk / ${shown} (litigation & personal injury fee earner)`);
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
