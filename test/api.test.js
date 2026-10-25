// Integration tests: run against a real Postgres. DATABASE_URL must point
// at a throwaway database — the demo firm in it is wiped and re-seeded.
//   DATABASE_URL=postgres://... npm test
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const { pool, normalizeConnectionString } = require("../src/db");
const { runMigrations } = require("../scripts/migrate");
const { runSeed } = require("../scripts/seed");

const PASSWORD = "password123";
const email = (name) => `${name}@vjcrawfordlaw.co.uk`;

async function login(name, password = PASSWORD) {
  return request(app).post("/auth/login").send({ email: email(name), password });
}

async function tokenFor(name) {
  const res = await login(name);
  assert.equal(res.status, 200, `login as ${name} failed`);
  return res.body.token;
}

before(async () => {
  await runMigrations(pool);
  await runSeed(pool);
});

after(() => pool.end());

test("health check", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("login succeeds with the right password and fails with the wrong one", async () => {
  assert.equal((await login("david")).status, 200);
  const bad = await login("david", "wrong-password");
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "Invalid email or password.");
});

test("protected routes need a token", async () => {
  assert.equal((await request(app).get("/matters")).status, 401);
});

test("an account is locked after 5 failed logins, without affecting others", async () => {
  // Uses a non-existent account so the lockout can't leak into other tests.
  const victim = "nobody-locked@vjcrawfordlaw.co.uk";
  for (let i = 0; i < 5; i++) {
    const res = await request(app).post("/auth/login").send({ email: victim, password: "x" });
    assert.equal(res.status, 401);
  }
  const blocked = await request(app).post("/auth/login").send({ email: victim.toUpperCase(), password: "x" });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many attempts/);

  assert.equal((await login("david")).status, 200);
});

test("fee earners only see their own matters; admins see the whole firm", async () => {
  const sarah = await tokenFor("sarah");
  const david = await tokenFor("david");

  const sarahList = await request(app).get("/matters?limit=100").set("Authorization", `Bearer ${sarah}`);
  const davidList = await request(app).get("/matters?limit=100").set("Authorization", `Bearer ${david}`);
  assert.equal(sarahList.status, 200);
  assert.ok(sarahList.body.matters.length > 0);
  assert.ok(davidList.body.matters.length > sarahList.body.matters.length);

  const sarahId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${sarah}`)).body.id;
  assert.ok(sarahList.body.matters.every((m) => m.fee_earner_id === sarahId));

  const notHers = davidList.body.matters.find((m) => m.fee_earner_id !== sarahId);
  const res = await request(app).get(`/matters/${notHers.id}`).set("Authorization", `Bearer ${sarah}`);
  assert.equal(res.status, 404);
});

test("users can change their own password", async () => {
  const token = await tokenFor("marcus");
  const auth = { Authorization: `Bearer ${token}` };

  const wrong = await request(app).post("/auth/change-password").set(auth)
    .send({ currentPassword: "not-it", newPassword: "a-brand-new-pass" });
  assert.equal(wrong.status, 400, "wrong current password must not be a 401 (frontend logs out on 401)");

  const short = await request(app).post("/auth/change-password").set(auth)
    .send({ currentPassword: PASSWORD, newPassword: "short" });
  assert.equal(short.status, 400);

  const ok = await request(app).post("/auth/change-password").set(auth)
    .send({ currentPassword: PASSWORD, newPassword: "a-brand-new-pass" });
  assert.equal(ok.status, 204);

  assert.equal((await login("marcus", "a-brand-new-pass")).status, 200);
  assert.equal((await login("marcus", PASSWORD)).status, 401);
});

test("admins can't create staff with short passwords", async () => {
  const david = await tokenFor("david");
  const res = await request(app).post("/users").set("Authorization", `Bearer ${david}`)
    .send({ name: "Test Person", email: "short-pw@example.com", password: "short" });
  assert.equal(res.status, 400);
});

test("demo data can be re-seeded after staff have added documents and tasks", async () => {
  const david = await tokenFor("david");
  const auth = { Authorization: `Bearer ${david}` };
  const matterId = (await request(app).get("/matters").set(auth)).body.matters[0].id;

  assert.equal((await request(app).post(`/matters/${matterId}/documents`).set(auth)
    .send({ name: "Test doc", category: "Other" })).status, 201);
  assert.equal((await request(app).post(`/matters/${matterId}/tasks`).set(auth)
    .send({ description: "Test task" })).status, 201);

  await runSeed(pool, { password: "a-custom-demo-pass" });
  assert.equal((await login("david", "a-custom-demo-pass")).status, 200);
  assert.equal((await login("david", PASSWORD)).status, 401);

  await runSeed(pool); // back to the default password for the tests below
});

test("sslmode=require is rewritten to verify-full (silences pg warning)", () => {
  assert.equal(normalizeConnectionString("postgres://h/db?sslmode=require"), "postgres://h/db?sslmode=verify-full");
  assert.equal(normalizeConnectionString("postgres://h/db?a=1&sslmode=prefer&b=2"), "postgres://h/db?a=1&sslmode=verify-full&b=2");
  assert.equal(normalizeConnectionString("postgres://h/db?sslmode=disable"), "postgres://h/db?sslmode=disable");
  assert.equal(normalizeConnectionString("postgres://h/db"), "postgres://h/db");
});

test("deactivating a user or changing their role takes effect immediately", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const created = await request(app).post("/users").set(david)
    .send({ name: "Temp Leaver", email: "leaver@vjcrawfordlaw.co.uk", password: "leaver-password", role: "admin" });
  assert.equal(created.status, 201);

  const login = await request(app).post("/auth/login")
    .send({ email: "leaver@vjcrawfordlaw.co.uk", password: "leaver-password" });
  const leaver = { Authorization: `Bearer ${login.body.token}` };
  assert.equal((await request(app).get("/matters").set(leaver)).status, 200);

  // Role change: the token still says admin, but the demotion applies at once.
  assert.ok((await request(app).get("/matters").set(leaver)).body.matters.length > 0);
  await request(app).patch(`/users/${created.body.id}`).set(david).send({ role: "fee_earner", departments: ["conveyancing"] });
  const list = await request(app).get("/matters?limit=100").set(leaver);
  assert.equal(list.body.matters.length, 0, "demoted user still sees the whole firm's matters");

  await request(app).patch(`/users/${created.body.id}`).set(david).send({ active: false });
  const after = await request(app).get("/matters").set(leaver);
  assert.equal(after.status, 401);
  assert.match(after.body.error, /no longer active/);
});

test("public firm registration is off unless ALLOW_REGISTRATION=true", async () => {
  const body = { firmName: "Some Other Firm", name: "Someone", email: "someone@otherfirm.example", password: "long-enough-pass" };
  await pool.query(`DELETE FROM firms WHERE name = 'Some Other Firm'`); // leftovers from an aborted run
  const off = await request(app).post("/auth/register").send(body);
  assert.equal(off.status, 403);

  process.env.ALLOW_REGISTRATION = "true";
  try {
    assert.equal((await request(app).post("/auth/register").send(body)).status, 201);
  } finally {
    delete process.env.ALLOW_REGISTRATION;
    await pool.query(`DELETE FROM firms WHERE name = 'Some Other Firm'`);
  }
});

test("the firm's last active admin can't be demoted or deactivated", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const davidId = (await request(app).get("/auth/me").set(david)).body.id;

  for (const patch of [{ role: "supervisor" }, { active: false }]) {
    const res = await request(app).patch(`/users/${davidId}`).set(david).send(patch);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /only active admin/);
  }

  // With a second admin, demoting one of them is fine.
  const other = await request(app).post("/users").set(david)
    .send({ name: "Second Admin", email: "admin2@vjcrawfordlaw.co.uk", password: "second-admin-pw", role: "admin" });
  assert.equal((await request(app).patch(`/users/${other.body.id}`).set(david).send({ role: "supervisor", departments: ["conveyancing"] })).status, 200);

  assert.equal((await request(app).patch(`/users/${davidId}`).set(david).send({ role: "boss" })).status, 400);
});

test("a malformed id gives a 400, not a server error", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const res = await request(app).get("/matters/not-a-real-id").set(david);
  assert.equal(res.status, 400);
});

test("matters can be moved to every stage, including Closed, and the log names the right stage", async () => {
  const admin = { Authorization: `Bearer ${await tokenFor("david")}` };
  await request(app).patch("/settings").set(admin).send({ requireExchangeChecks: false }); // gate tested separately
  const david = { Authorization: `Bearer ${await tokenFor("sarah")}` }; // the matter's fee earner moves it
  const matterId = (await request(app).get("/matters?showClosed=false").set(david)).body.matters[0].id;

  const pre = await request(app).post(`/matters/${matterId}/stage`).set(david).send({ stageIndex: 7 });
  assert.equal(pre.status, 200);
  const closed = await request(app).post(`/matters/${matterId}/stage`).set(david).send({ stageIndex: 11 });
  assert.equal(closed.status, 200);
  assert.equal((await request(app).post(`/matters/${matterId}/stage`).set(david).send({ stageIndex: 12 })).status, 400);

  const detail = await request(app).get(`/matters/${matterId}`).set(david);
  const log = detail.body.activity.map((a) => a.text);
  assert.ok(log.includes("Moved to Pre-Exchange Review"));
  assert.ok(log.includes("Moved to Closed"));

  const open = await request(app).get("/matters?showClosed=false&limit=100").set(david);
  assert.ok(open.body.matters.every((m) => m.id !== matterId), "closed matter still listed when hiding closed");
  await request(app).patch("/settings").set(admin).send({ requireExchangeChecks: true });
});

test("files can be attached to documents and downloaded again", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const matterId = (await request(app).get("/matters").set(sarah)).body.matters[0].id;
  const doc = (await request(app).post(`/matters/${matterId}/documents`).set(sarah)
    .send({ name: "Signed contract", category: "Contract" })).body;

  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2000, 7)]);
  const up = await request(app).put(`/matters/${matterId}/documents/${doc.id}/file`).set(sarah)
    .attach("file", pdf, "contract (signed).pdf");
  assert.equal(up.status, 200);
  assert.equal(up.body.file_name, "contract (signed).pdf");
  assert.equal(up.body.file_size, pdf.length);

  const down = await request(app).get(`/matters/${matterId}/documents/${doc.id}/file`).set(sarah)
    .buffer(true).parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(down.status, 200);
  assert.equal(down.headers["content-type"], "application/pdf");
  assert.equal(down.headers["x-content-type-options"], "nosniff");
  assert.ok(Buffer.compare(down.body, pdf) === 0, "downloaded bytes differ");

  // Detail view lists the file without sending its bytes.
  const detail = await request(app).get(`/matters/${matterId}`).set(sarah);
  const listed = detail.body.documents.find((d) => d.id === doc.id);
  assert.equal(listed.file_name, "contract (signed).pdf");
  assert.equal(listed.data, undefined);

  // Unsafe types and oversize files are refused.
  const html = await request(app).put(`/matters/${matterId}/documents/${doc.id}/file`).set(sarah)
    .attach("file", Buffer.from("<script>alert(1)</script>"), "evil.html");
  assert.equal(html.status, 400);
  const big = await request(app).put(`/matters/${matterId}/documents/${doc.id}/file`).set(sarah)
    .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), "big.pdf");
  assert.equal(big.status, 413);

  // Another fee earner can't fetch or overwrite it.
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.equal((await request(app).get(`/matters/${matterId}/documents/${doc.id}/file`).set(marcus)).status, 404);
  assert.equal((await request(app).put(`/matters/${matterId}/documents/${doc.id}/file`).set(marcus)
    .attach("file", pdf, "x.pdf")).status, 404);

  // Re-seeding still works with files attached.
  await runSeed(pool);
});

test("import: values in everyday spreadsheet formats are understood", () => {
  const { parseDate, parsePrice, parseStage } = require("../src/utils/matterImport");
  assert.equal(parseDate("08/10/2026"), "2026-10-08");
  assert.equal(parseDate("8-1-26"), "2026-01-08");
  assert.equal(parseDate("2026-10-08"), "2026-10-08");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("next week"), null);
  assert.equal(parsePrice("£465,000"), 465000);
  assert.equal(parsePrice("250000.50"), 250000.5);
  assert.equal(parsePrice("about 200k"), null);
  assert.equal(parseStage("Searches"), 3);
  assert.equal(parseStage("pre-exchange review"), 7);
  assert.equal(parseStage("1"), 0);
  assert.equal(parseStage("12"), 11);
  assert.equal(parseStage("13"), null);
});

test("import: admins can bulk-import matters after checking them", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const before = (await request(app).get("/matters?limit=1").set(david)).body.pagination.total;

  const rows = [
    { "Property Address": "1 Test Street, Bath, BA1 1AA", "Client Name": "A Tester", "Matter Type": "purchase",
      "Price": "£300,000", "Stage": "Searches", "Fee Earner": "Sarah Ncube", "Date Instructed": "01/09/2026",
      "Target Completion": "15/12/2026", "Legacy ID": "X-1" },
    { "Property Address": "2 Test Street, Bath, BA1 1AA", "Client Name": "B Tester", "Matter Type": "Sale",
      "Reference": "OLD-0002", "Fee Earner": "marcus@vjcrawfordlaw.co.uk", "Stage": "12" },
    { "Property Address": "", "Client Name": "", "Matter Type": "" }, // blank line — skipped
  ];

  const check = await request(app).post("/matters/import").set(david).send({ rows, dryRun: true });
  assert.equal(check.status, 200);
  assert.equal(check.body.valid, 2);
  assert.deepEqual(check.body.errors, []);
  assert.deepEqual(check.body.ignoredHeaders, ["Legacy ID"]);

  const ambiguous = await request(app).post("/matters/import").set(david)
    .send({ rows: [{ Address: "x", Client: "y", Type: "Sale", "Completion Date": "01/01/2027" }], dryRun: true });
  assert.deepEqual(ambiguous.body.ignoredHeaders, ["Completion Date"]);
  assert.equal((await request(app).get("/matters?limit=1").set(david)).body.pagination.total, before, "dry run wrote data");

  const done = await request(app).post("/matters/import").set(david).send({ rows, dryRun: false });
  assert.equal(done.status, 201);
  assert.equal(done.body.imported, 2);

  const list = (await request(app).get("/matters?limit=100&search=Test Street").set(david)).body.matters;
  const first = list.find((m) => m.address.startsWith("1 Test"));
  const second = list.find((m) => m.address.startsWith("2 Test"));
  assert.equal(first.type, "Purchase");
  assert.equal(Number(first.price), 300000);
  assert.equal(first.current_stage_index, 3);
  assert.match(first.reference, /^CV-\d{4}-\d{4}$/);
  assert.equal(second.reference, "OLD-0002");
  assert.equal(second.current_stage_index, 11);
  assert.equal(second.fee_earner_name, "Marcus Webb");

  // Re-importing the same reference is caught.
  const again = await request(app).post("/matters/import").set(david).send({ rows: [rows[1]], dryRun: true });
  assert.match(again.body.errors[0].messages[0], /already in the system/);
});

test("import: any bad row means nothing is imported", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const before = (await request(app).get("/matters?limit=1").set(david)).body.pagination.total;
  const rows = [
    { Address: "3 Good Road", Client: "Fine", Type: "Sale" },
    { Address: "4 Bad Road", Client: "Wrong", Type: "Lease", Price: "lots", Stage: "Nearly done",
      "Fee Earner": "Nobody Here", "Target Exchange": "31/02/2026" },
    { Address: "5 Dup Road", Client: "Dup", Type: "Sale", Reference: "DUP-1" },
    { Address: "6 Dup Road", Client: "Dup", Type: "Sale", Reference: "dup-1" },
  ];
  const res = await request(app).post("/matters/import").set(david).send({ rows, dryRun: false });
  assert.equal(res.status, 400);
  assert.equal(res.body.valid, 2);
  assert.deepEqual(res.body.errors.map((e) => e.row), [3, 5]);
  assert.equal(res.body.errors[0].messages.length, 5);
  assert.ok(res.body.errors[0].messages.includes(`Target Exchange "31/02/2026" isn't a valid date (use DD/MM/YYYY).`));
  assert.match(res.body.errors[1].messages[0], /more than once/);
  assert.equal((await request(app).get("/matters?limit=1").set(david)).body.pagination.total, before);
});

test("import: only admins can import, and new references continue after imported ones", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const rows = [{ Address: "7 Road", Client: "C", Type: "Sale" }];
  assert.equal((await request(app).post("/matters/import").set(sarah).send({ rows, dryRun: true })).status, 403);

  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const year = new Date().getFullYear();
  await request(app).post("/matters/import").set(david)
    .send({ rows: [{ Address: "8 Road", Client: "C", Type: "Sale", Reference: `CV-${year}-0900` }], dryRun: false });
  const created = await request(app).post("/matters").set(david).send({ address: "9 Road", client: "C", type: "Sale" });
  assert.equal(created.status, 201);
  assert.equal(created.body.reference, `CV-${year}-0901`);
});

test("report on title: a Word draft is built from the matter's searches and enquiries", async () => {
  const JSZip = require("jszip");
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const matters = (await request(app).get("/matters?limit=100").set(sarah)).body.matters;
  const purchase = matters.find((m) => m.type === "Purchase");
  const sale = matters.find((m) => m.type === "Sale");

  await request(app).post(`/matters/${purchase.id}/searches`).set(sarah).send({ type: "Local Authority Search", dateOrdered: "2026-07-01" });
  const search = (await request(app).get(`/matters/${purchase.id}`).set(sarah)).body.searches.find((s) => s.type === "Local Authority Search");
  await request(app).patch(`/matters/${purchase.id}/searches/${search.id}`).set(sarah)
    .send({ dateReceived: "2026-07-20", issue: true, issueNotes: "Unapproved extension noted" });
  const enquiry = (await request(app).post(`/matters/${purchase.id}/enquiries`).set(sarah).send({ question: "Please confirm vacant possession." })).body;
  await request(app).patch(`/matters/${purchase.id}/enquiries/${enquiry.id}/answer`).set(sarah).send({ answer: "Confirmed by the seller." });

  const res = await request(app).get(`/matters/${purchase.id}/report-on-title`).set(sarah)
    .buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /wordprocessingml/);
  assert.match(res.headers["content-disposition"], /Report%20on%20Title/);

  const xml = await (await JSZip.loadAsync(res.body)).file("word/document.xml").async("string");
  const text = xml.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&apos;/g, "'");
  for (const expected of [purchase.client, purchase.address, purchase.reference, "Unapproved extension noted",
    "Please confirm vacant possession.", "Confirmed by the seller.", "Sarah Ncube", "[title number]"]) {
    assert.ok(text.includes(expected), `report is missing: ${expected}`);
  }

  const log = (await request(app).get(`/matters/${purchase.id}`).set(sarah)).body.activity.map((a) => a.text);
  assert.ok(log.includes("Report on Title draft generated"));

  assert.equal((await request(app).get(`/matters/${sale.id}/report-on-title`).set(sarah)).status, 400);
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.equal((await request(app).get(`/matters/${purchase.id}/report-on-title`).set(marcus)).status, 404);
});

test("client, title and money details are stored, cleared, and used in the report", async () => {
  const JSZip = require("jszip");
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const purchase = (await request(app).get("/matters?limit=100").set(sarah)).body.matters.find((m) => m.type === "Purchase");

  const patch = {
    clientAddress: "1 Old Road, Bath, BA1 1AA", clientEmail: "client@example.com", clientPhone: "07700 900000",
    clientSalutation: "Ms Tester", tenure: "Leasehold", titleNumber: "AV999", registeredProprietor: "Seller Person",
    leaseTerm: "125 years from 2005", groundRent: "£100 a year", serviceCharge: "£900 a year",
    deposit: 30000, sdlt: 0, mortgageConditions: "None",
  };
  const saved = await request(app).patch(`/matters/${purchase.id}`).set(sarah).send(patch);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.title_number, "AV999");
  assert.equal(Number(saved.body.deposit), 30000);

  const res = await request(app).get(`/matters/${purchase.id}/report-on-title`).set(sarah)
    .buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  const text = (await (await JSZip.loadAsync(res.body)).file("word/document.xml").async("string"))
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  for (const expected of ["1 Old Road", "Dear Ms Tester", "Leasehold", "AV999", "Seller Person", "125 years from 2005",
    "£100 a year", "£900 a year", "£30,000", "none is payable"]) {
    assert.ok(text.includes(expected), `report is missing: ${expected}`);
  }
  assert.ok(!text.includes("[title number]"));

  assert.equal((await request(app).patch(`/matters/${purchase.id}`).set(sarah).send({ tenure: "Rented" })).status, 400);

  // Clearing optional fields (as the Edit form does with blank inputs) must work — dates included.
  const cleared = await request(app).patch(`/matters/${purchase.id}`).set(sarah)
    .send({ deposit: "", titleNumber: "", targetExchange: "", actualExchange: "", notes: "" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.deposit, null);
  assert.equal(cleared.body.target_exchange, null);
  assert.equal(cleared.body.notes, "");

  const created = await request(app).post("/matters").set(sarah)
    .send({ address: "10 New Road", client: "New Client", type: "Purchase", clientEmail: "new@example.com", tenure: "Freehold" });
  assert.equal(created.status, 201);
  assert.equal(created.body.client_email, "new@example.com");
  assert.equal(created.body.tenure, "Freehold");
});

test("import: client and title columns are brought across", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const rows = [{ Address: "11 Import Lane", Client: "Imp Client", Type: "Purchase", "Client Email": "imp@example.com",
    Tenure: "leasehold", "Title Number": "XY1", Deposit: "£25,000", SDLT: "0", Salutation: "Mr Imp" }];
  const done = await request(app).post("/matters/import").set(david).send({ rows, dryRun: false });
  assert.equal(done.status, 201);
  const m = (await request(app).get("/matters?search=Import Lane").set(david)).body.matters[0];
  assert.equal(m.client_email, "imp@example.com");
  assert.equal(m.tenure, "Leasehold");
  assert.equal(m.title_number, "XY1");
  assert.equal(Number(m.deposit), 25000);
  assert.equal(Number(m.sdlt), 0);
  assert.equal(m.client_salutation, "Mr Imp");

  const bad = await request(app).post("/matters/import").set(david)
    .send({ rows: [{ Address: "x", Client: "y", Type: "Sale", Tenure: "Rented", Deposit: "lots" }], dryRun: true });
  assert.equal(bad.body.errors[0].messages.length, 2);
});

test("staff management: admins add, edit, reset and deactivate staff, and it's all audited", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarahId = (await request(app).get("/auth/me").set({ Authorization: `Bearer ${await tokenFor("sarah")}` })).body.id;

  const added = await request(app).post("/users").set(david)
    .send({ name: "New Starter", email: "Starter@VJCrawfordLaw.co.uk", password: "temporary-pass-1", supervisorId: sarahId, departments: ["conveyancing"] });
  assert.equal(added.status, 201);
  assert.equal(added.body.email, "starter@vjcrawfordlaw.co.uk");
  const id = added.body.id;
  const login = (pw) => request(app).post("/auth/login").send({ email: "starter@vjcrawfordlaw.co.uk", password: pw });
  assert.equal((await login("temporary-pass-1")).status, 200);

  const edited = await request(app).patch(`/users/${id}`).set(david).send({ name: "New Starter-Smith", role: "supervisor" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, "New Starter-Smith");
  assert.equal(edited.body.role, "supervisor");

  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ email: "david@vjcrawfordlaw.co.uk" })).status, 409);
  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ email: "not-an-email" })).status, 400);
  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ supervisorId: id })).status, 400);
  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ supervisorId: "00000000-0000-0000-0000-000000000000" })).status, 400);

  assert.equal((await request(app).post(`/users/${id}/reset-password`).set(david).send({ password: "short" })).status, 400);
  assert.equal((await request(app).post(`/users/${id}/reset-password`).set(david).send({ password: "reset-by-admin-1" })).status, 204);
  assert.equal((await login("temporary-pass-1")).status, 401);
  assert.equal((await login("reset-by-admin-1")).status, 200);

  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ active: false })).status, 200);
  assert.equal((await login("reset-by-admin-1")).status, 401);
  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ active: true })).status, 200);

  // Non-admins can't manage staff or read the audit.
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  assert.equal((await request(app).post(`/users/${id}/reset-password`).set(sarah).send({ password: "sarah-did-this" })).status, 403);
  assert.equal((await request(app).get("/users/audit").set(sarah)).status, 403);

  const audit = (await request(app).get("/users/audit").set(david)).body.filter((a) => a.target_name === "New Starter-Smith");
  assert.deepEqual(audit.map((a) => a.action).reverse(), ["added", "updated", "password reset", "deactivated", "reactivated"]);
  assert.match(audit.find((a) => a.action === "updated").details, /role changed from Fee earner to Supervisor/);
  assert.ok(audit.every((a) => a.actor_name === "David Okonkwo"));

  await runSeed(pool); // re-seeding still works with audit entries present
});

test("linked matters come back with enough detail to show and open them", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const [a, b] = (await request(app).get("/matters?limit=100").set(david)).body.matters;
  assert.equal((await request(app).put(`/matters/${a.id}/links/${b.id}`).set(david)).status, 204);
  const detail = (await request(app).get(`/matters/${a.id}`).set(david)).body;
  const link = detail.linkedMatters.find((l) => l.id === b.id);
  assert.ok(link, "link missing");
  for (const key of ["reference", "address", "client", "type", "current_stage_index"]) assert.ok(key in link, `missing ${key}`);
  // Reciprocal
  assert.ok((await request(app).get(`/matters/${b.id}`).set(david)).body.linkedMatters.some((l) => l.id === a.id));
});

test("enquiries: replies and comments are logged, status can be set by hand, emails can be linked", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const matterId = (await request(app).get("/matters").set(sarah)).body.matters[0].id;
  const q = (await request(app).post(`/matters/${matterId}/enquiries`).set(sarah).send({ question: "Please confirm the boiler was last serviced." })).body;
  const base = `/matters/${matterId}/enquiries/${q.id}`;

  // Typed reply → Response received
  const r1 = await request(app).post(`${base}/replies`).set(sarah).send({ reply: "Seller is checking.", dateReceived: "2026-09-01" });
  assert.equal(r1.status, 201);
  // Comment
  assert.equal((await request(app).post(`${base}/comments`).set(sarah).send({ comment: "Not good enough — chase for the certificate." })).status, 201);
  assert.equal((await request(app).post(`${base}/comments`).set(sarah).send({ comment: "  " })).status, 400);
  // Back to Raised by hand
  assert.equal((await request(app).patch(`${base}/status`).set(sarah).send({ status: "Outstanding" })).status, 200);
  assert.equal((await request(app).patch(`${base}/status`).set(sarah).send({ status: "Done" })).status, 400);

  // A reply email arrives; link it to the enquiry (text taken from the email)
  const email = (await request(app).post(`/matters/${matterId}/emails`).set(sarah)
    .send({ direction: "in", subject: "Boiler", body: "Serviced in March 2026, certificate attached.", date: "2026-09-10" })).body.email;
  const r2 = await request(app).post(`${base}/replies`).set(sarah).send({ emailId: email.id });
  assert.equal(r2.status, 201);
  assert.equal(r2.body.reply, "Serviced in March 2026, certificate attached.");
  assert.equal(r2.body.date_received.slice(0, 10), "2026-09-10");

  // Satisfactory
  assert.equal((await request(app).patch(`${base}/status`).set(sarah).send({ status: "Answered" })).status, 200);

  const detail = (await request(app).get(`/matters/${matterId}`).set(sarah)).body;
  const e = detail.enquiries.find((x) => x.id === q.id);
  assert.equal(e.status, "Answered");
  assert.equal(e.answer, "Serviced in March 2026, certificate attached.");
  assert.deepEqual(e.replies.map((r) => r.reply), ["Seller is checking.", "Serviced in March 2026, certificate attached."]);
  assert.equal(e.replies[1].source_email_subject, "Boiler");
  assert.equal(e.replies[0].created_by_name, "Sarah Ncube");
  assert.deepEqual(e.comments.map((c) => c.comment), ["Not good enough — chase for the certificate."]);
  const log = detail.activity.map((a) => a.text);
  assert.ok(log.includes(`Enquiry ${q.number} marked Satisfactory`));
  assert.ok(log.includes(`Enquiry ${q.number} marked Raised`));

  // Auto-matching a numbered reply email logs a reply too — once, even if re-run
  const q2 = (await request(app).post(`/matters/${matterId}/enquiries`).set(sarah).send({ question: "Any disputes?" })).body;
  const auto = (await request(app).post(`/matters/${matterId}/emails`).set(sarah)
    .send({ direction: "in", subject: "Replies", body: `${q2.number}. None that the seller is aware of.`, date: "2026-09-12" })).body;
  assert.equal(auto.enquiriesMatched, 1);
  await request(app).patch(`/matters/${matterId}/enquiries/${q2.id}/status`).set(sarah).send({ status: "Outstanding" });
  await request(app).post(`/matters/${matterId}/emails/${auto.email.id}/match`).set(sarah);
  const e2 = (await request(app).get(`/matters/${matterId}`).set(sarah)).body.enquiries.find((x) => x.id === q2.id);
  assert.equal(e2.replies.length, 1);

  // Linking an email from another matter is refused
  const other = (await request(app).get("/matters?limit=100").set(sarah)).body.matters.find((m) => m.id !== matterId);
  const otherEmail = (await request(app).post(`/matters/${other.id}/emails`).set(sarah)
    .send({ direction: "in", subject: "x", body: "y", date: "2026-09-12" })).body.email;
  assert.equal((await request(app).post(`${base}/replies`).set(sarah).send({ emailId: otherEmail.id })).status, 404);
});

test("stage sign-off follows the chain: assistants request, the matter's fee earner signs off, admin can't", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  const sarahId = (await request(app).get("/auth/me").set(sarah)).body.id;

  // An assistant who works for Sarah
  const created = await request(app).post("/users").set(david)
    .send({ name: "Amy Assistant", email: "amy@vjcrawfordlaw.co.uk", password: "assistant-pass-1", role: "assistant", supervisorId: sarahId, departments: ["conveyancing"] });
  assert.equal(created.status, 201);
  const amy = { Authorization: `Bearer ${(await request(app).post("/auth/login").send({ email: "amy@vjcrawfordlaw.co.uk", password: "assistant-pass-1" })).body.token}` };

  await request(app).patch("/settings").set(david).send({ requireExchangeChecks: false }); // gate tested separately
  // Amy sees exactly Sarah's matters
  const amyList = (await request(app).get("/matters?limit=100").set(amy)).body.matters;
  const sarahList = (await request(app).get("/matters?limit=100").set(sarah)).body.matters;
  assert.deepEqual(amyList.map((m) => m.id).sort(), sarahList.map((m) => m.id).sort());

  const matter = sarahList.find((m) => m.current_stage_index < 11);
  const from = matter.current_stage_index;
  const to = from + 1;

  // Assistant can't move directly; neither can admin
  const direct = await request(app).post(`/matters/${matter.id}/stage`).set(amy).send({ stageIndex: to });
  assert.equal(direct.status, 403);
  assert.equal(direct.body.needsSignoff, true);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage`).set(david).send({ stageIndex: to })).status, 403);

  // Assistant requests
  const reqRes = await request(app).post(`/matters/${matter.id}/stage-requests`).set(amy).send({ stageIndex: to, note: "Searches all back" });
  assert.equal(reqRes.status, 201);
  let detail = (await request(app).get(`/matters/${matter.id}`).set(amy)).body;
  assert.equal(detail.pendingStageRequest.to_stage, to);
  assert.equal(detail.canSignOffStages, false);
  assert.equal(detail.stageMovesNeedSignoff, true);

  // Admin and other fee earners can't sign off; it waits for Sarah
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(david).send({ approve: true })).status, 403);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(marcus).send({ approve: true })).status, 404);
  assert.equal((await request(app).get("/matters/sign-offs/pending").set(david)).body.length, 0);
  const pending = (await request(app).get("/matters/sign-offs/pending").set(sarah)).body;
  assert.ok(pending.some((p) => p.id === reqRes.body.id && p.requested_by_name === "Amy Assistant"));

  // Sarah declines (needs a reason), Amy asks again, Sarah approves
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(sarah).send({ approve: false })).status, 400);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(sarah).send({ approve: false, note: "Mortgage offer not in yet" })).status, 200);
  assert.equal((await request(app).get(`/matters/${matter.id}`).set(amy)).body.current_stage_index, from);
  const again = (await request(app).post(`/matters/${matter.id}/stage-requests`).set(amy).send({ stageIndex: to })).body;
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${again.id}/decision`).set(sarah).send({ approve: true, note: "OK" })).status, 200);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${again.id}/decision`).set(sarah).send({ approve: true })).status, 409);
  detail = (await request(app).get(`/matters/${matter.id}`).set(sarah)).body;
  assert.equal(detail.current_stage_index, to);
  assert.equal(detail.canSignOffStages, true);
  assert.equal(detail.stageMovesNeedSignoff, false);
  const log = detail.activity.map((a) => a.text);
  assert.ok(log.some((t) => t.includes("declined by Sarah Ncube — Mortgage offer not in yet")));
  assert.ok(log.some((t) => t.includes("signed off by Sarah Ncube")));

  // Withdraw your own request; the fee earner moves directly
  const w = (await request(app).post(`/matters/${matter.id}/stage-requests`).set(amy).send({ stageIndex: from })).body;
  assert.equal((await request(app).delete(`/matters/${matter.id}/stage-requests/${w.id}`).set(sarah)).status, 404);
  assert.equal((await request(app).delete(`/matters/${matter.id}/stage-requests/${w.id}`).set(amy)).status, 204);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage`).set(sarah).send({ stageIndex: from })).status, 200);

  // Firm switches sign-off off — the assistant moves directly
  assert.equal((await request(app).patch("/settings").set(david).send({ requireStageSignoff: false })).status, 200);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage`).set(amy).send({ stageIndex: to })).status, 200);
  await request(app).patch("/settings").set(david).send({ requireStageSignoff: true });
  await request(app).post(`/matters/${matter.id}/stage`).set(sarah).send({ stageIndex: from });
  await request(app).patch("/settings").set(david).send({ requireExchangeChecks: true });
});

test("standard tasks can be added in bulk", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const matterId = (await request(app).get("/matters").set(sarah)).body.matters[0].id;
  const res = await request(app).post(`/matters/${matterId}/tasks/bulk`).set(sarah)
    .send({ tasks: [{ description: "Send client care letter", dueDate: "2026-10-10" }, { description: "Verify client ID" }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.length, 2);
  assert.equal((await request(app).post(`/matters/${matterId}/tasks/bulk`).set(sarah).send({ tasks: [{ description: " " }] })).status, 400);
});

test("tasks can be assigned to staff who can see the matter, edited, and listed as 'my tasks'", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const users = (await request(app).get("/users").set(david)).body;
  const id = (name) => users.find((u) => u.name === name).id;
  const matter = (await request(app).get("/matters").set(sarah)).body.matters[0];

  // Jess (Sarah's assistant) can be assigned; Marcus (other fee earner) can't see it; Lucy (Marcus's secretary) can't either
  const t = await request(app).post(`/matters/${matter.id}/tasks`).set(sarah)
    .send({ description: "Send client care letter", dueDate: "2026-10-12", assignedTo: id("Jess Taylor") });
  assert.equal(t.status, 201);
  assert.equal(t.body.assigned_to, id("Jess Taylor"));
  const bad = await request(app).post(`/matters/${matter.id}/tasks`).set(sarah).send({ description: "x", assignedTo: id("Marcus Webb") });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /can't see this matter/);
  assert.equal((await request(app).post(`/matters/${matter.id}/tasks`).set(sarah).send({ description: "x", assignedTo: id("Lucy Brown") })).status, 400);

  // Bulk with per-task assignees
  const bulk = await request(app).post(`/matters/${matter.id}/tasks/bulk`).set(sarah).send({ tasks: [
    { description: "Review title", assignedTo: id("Sarah Ncube") }, { description: "Order searches", assignedTo: id("Jess Taylor") }, { description: "Unassigned one" },
  ] });
  assert.equal(bulk.status, 201);
  assert.equal((await request(app).post(`/matters/${matter.id}/tasks/bulk`).set(sarah).send({ tasks: [{ description: "x", assignedTo: id("Marcus Webb") }] })).status, 400);

  // Edit: reassign, change date, unassign
  const edited = await request(app).patch(`/matters/${matter.id}/tasks/${t.body.id}`).set(sarah).send({ assignedTo: id("Sarah Ncube"), dueDate: "2026-10-15" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.assigned_to, id("Sarah Ncube"));
  assert.equal((await request(app).patch(`/matters/${matter.id}/tasks/${t.body.id}`).set(sarah).send({ description: " " })).status, 400);
  const detail = (await request(app).get(`/matters/${matter.id}`).set(sarah)).body;
  const row = detail.tasks.find((x) => x.id === t.body.id);
  assert.equal(row.assigned_to_name, "Sarah Ncube");
  assert.ok(detail.activity.some((a) => a.text.includes("assigned to Sarah Ncube") && a.text.includes("due 2026-10-15")));

  // My tasks for Jess = just "Order searches"; Sarah's include the two of hers; admin's "all" includes everything
  const jess = { Authorization: `Bearer ${(await request(app).post("/auth/login").send({ email: "jess@vjcrawfordlaw.co.uk", password: "password123" })).body.token}` };
  const jessMine = (await request(app).get("/tasks?mine=true").set(jess)).body;
  assert.deepEqual(jessMine.map((x) => x.description), ["Order searches"]);
  assert.equal(jessMine[0].reference, matter.reference);
  const sarahMine = (await request(app).get("/tasks?mine=true").set(sarah)).body.map((x) => x.description);
  assert.ok(sarahMine.includes("Send client care letter") && sarahMine.includes("Review title"));
  const all = (await request(app).get("/tasks").set(david)).body.map((x) => x.description);
  assert.ok(all.includes("Unassigned one"));
  // Marcus can't see Sarah's matter's tasks at all
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.ok(!(await request(app).get("/tasks").set(marcus)).body.some((x) => x.matter_id === matter.id));

  await request(app).patch(`/matters/${matter.id}/tasks/${t.body.id}`).set(sarah).send({ assignedTo: null });
  assert.equal((await request(app).get(`/matters/${matter.id}`).set(sarah)).body.tasks.find((x) => x.id === t.body.id).assigned_to, null);
});

test("admins can switch dictation off for the firm", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  assert.equal((await request(app).get("/settings").set(sarah)).body.dictation_enabled, true);
  assert.equal((await request(app).patch("/settings").set(sarah).send({ dictationEnabled: false })).status, 403);
  assert.equal((await request(app).patch("/settings").set(david).send({ dictationEnabled: "no" })).status, 400);
  assert.equal((await request(app).patch("/settings").set(david).send({ dictationEnabled: false })).body.dictation_enabled, false);
  await request(app).patch("/settings").set(david).send({ dictationEnabled: true });
});

test("checks before exchange: review, mortgage offer and deposit must be in place", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const created = (await request(app).post("/matters").set(sarah).send({
    address: "1 Gate Lane", client: "G Client", type: "Purchase", feeEarnerId: (await request(app).get("/auth/me").set(sarah)).body.id,
    lender: "Halifax", targetCompletion: "2026-12-20", mortgageOfferExpiry: "2026-12-01",
  })).body;
  await request(app).post(`/matters/${created.id}/stage`).set(sarah).send({ stageIndex: 7 });

  const blocked = await request(app).post(`/matters/${created.id}/stage`).set(sarah).send({ stageIndex: 8 });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.exchangeBlockers.length, 3);
  assert.match(blocked.body.exchangeBlockers.join(" "), /pre-exchange review/);
  assert.match(blocked.body.exchangeBlockers.join(" "), /expires \(2026-12-01\) before the target completion date \(2026-12-20\)/);
  assert.match(blocked.body.exchangeBlockers.join(" "), /deposit/);
  // Requests are refused for the same reasons
  assert.equal((await request(app).post(`/matters/${created.id}/stage-requests`).set(sarah).send({ stageIndex: 8 })).status, 400);

  await request(app).patch(`/matters/${created.id}`).set(sarah).send({
    preExchangeConfirmedBy: "Sarah Ncube", preExchangeConfirmedDate: "2026-10-09", mortgageOfferExpiry: "2027-01-31", depositReceivedDate: "2026-10-09",
  });
  assert.equal((await request(app).post(`/matters/${created.id}/stage`).set(sarah).send({ stageIndex: 8 })).status, 200);
  // Moving back and forth after exchange isn't re-checked
  assert.equal((await request(app).post(`/matters/${created.id}/stage`).set(sarah).send({ stageIndex: 9 })).status, 200);
});

test("upcoming exchanges/completions, undertakings register, SDLT fields", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const me = (await request(app).get("/auth/me").set(sarah)).body.id;
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const a = (await request(app).post("/matters").set(sarah).send({ address: "2 Soon St", client: "S", type: "Purchase", feeEarnerId: me, targetCompletion: soon })).body;
  const b = (await request(app).post("/matters").set(sarah).send({ address: "3 Later St", client: "L", type: "Sale", feeEarnerId: me, targetCompletion: later })).body;
  const up = (await request(app).get("/matters/upcoming?days=7").set(sarah)).body;
  assert.ok(up.matters.some((m) => m.id === a.id && m.deposit_received === false && m.pre_exchange_confirmed === false));
  assert.ok(!up.matters.some((m) => m.id === b.id));
  assert.match(up.today, /^\d{4}-\d{2}-\d{2}$/);

  await request(app).post(`/matters/${a.id}/undertakings`).set(sarah).send({ direction: "given", description: "Redeem mortgage", party: "Seller's solicitor", dateGiven: "2026-09-01" });
  const reg = (await request(app).get("/undertakings?status=Outstanding").set(sarah)).body;
  assert.ok(reg.some((u) => u.matter_id === a.id && u.reference === a.reference && u.description === "Redeem mortgage"));
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.ok(!(await request(app).get("/undertakings").set(marcus)).body.some((u) => u.matter_id === a.id));

  const p = await request(app).patch(`/matters/${a.id}`).set(sarah).send({ sdltBuyerType: "first_time", sdltNonResident: false, leaseYearsRemaining: 80, os1PriorityExpiry: soon });
  assert.equal(p.status, 200);
  assert.equal(p.body.sdlt_buyer_type, "first_time");
  assert.equal(p.body.lease_years_remaining, 80);
  assert.equal((await request(app).patch(`/matters/${a.id}`).set(sarah).send({ sdltBuyerType: "investor" })).status, 400);
});

test("corrections: items added by mistake can be edited or deleted, and it's logged", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const matterId = (await request(app).get("/matters").set(sarah)).body.matters[0].id;
  const base = `/matters/${matterId}`;
  const doc = (await request(app).post(`${base}/documents`).set(sarah).send({ name: "Wrong name", category: "Other" })).body;
  assert.equal((await request(app).patch(`${base}/documents/${doc.id}`).set(sarah).send({ name: "Signed TR1", category: "Contract" })).body.name, "Signed TR1");
  assert.equal((await request(app).patch(`${base}/documents/${doc.id}`).set(sarah).send({ name: " " })).status, 400);
  assert.equal((await request(app).delete(`${base}/documents/${doc.id}`).set(sarah)).status, 204);
  assert.equal((await request(app).delete(`${base}/documents/${doc.id}`).set(sarah)).status, 404);

  const q = (await request(app).post(`${base}/enquiries`).set(sarah).send({ question: "Typo questoin" })).body;
  assert.equal((await request(app).patch(`${base}/enquiries/${q.id}`).set(sarah).send({ question: "Fixed question" })).body.question, "Fixed question");
  const email = (await request(app).post(`${base}/emails`).set(sarah).send({ direction: "in", subject: "Reply", body: "x", date: "2026-10-01" })).body.email;
  await request(app).post(`${base}/enquiries/${q.id}/replies`).set(sarah).send({ emailId: email.id });
  assert.equal((await request(app).delete(`${base}/emails/${email.id}`).set(sarah)).status, 204); // reply stays, link cleared
  const after = (await request(app).get(base).set(sarah)).body;
  assert.equal(after.enquiries.find((x) => x.id === q.id).replies.length, 1);
  assert.equal((await request(app).delete(`${base}/enquiries/${q.id}`).set(sarah)).status, 204);

  const u = (await request(app).post(`${base}/undertakings`).set(sarah).send({ direction: "given", description: "Old" })).body;
  assert.equal((await request(app).patch(`${base}/undertakings/${u.id}`).set(sarah).send({ direction: "sideways" })).status, 400);
  assert.equal((await request(app).patch(`${base}/undertakings/${u.id}`).set(sarah).send({ description: "New wording" })).status, 200);
  assert.equal((await request(app).delete(`${base}/undertakings/${u.id}`).set(sarah)).status, 204);
  const t = (await request(app).post(`${base}/tasks`).set(sarah).send({ description: "Oops" })).body;
  assert.equal((await request(app).delete(`${base}/tasks/${t.id}`).set(sarah)).status, 204);
  const s2 = (await request(app).post(`${base}/searches`).set(sarah).send({ type: "Wrong search" })).body;
  assert.equal((await request(app).delete(`${base}/searches/${s2.id}`).set(sarah)).status, 204);

  const log = (await request(app).get(base).set(sarah)).body.activity.map((a) => a.text);
  for (const t of ['Deleted document "Signed TR1"', "Edited enquiry", 'Deleted email log "Reply"', 'Deleted task "Oops"', 'Deleted search "Wrong search"', 'Edited undertaking "New wording"']) {
    assert.ok(log.some((x) => x.startsWith(t)), `missing log: ${t}`);
  }
  // Another fee earner can't delete on this matter
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  const t2 = (await request(app).post(`${base}/tasks`).set(sarah).send({ description: "Keep" })).body;
  assert.equal((await request(app).delete(`${base}/tasks/${t2.id}`).set(marcus)).status, 404);
});

function docxBody(r, cb) { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); }
async function docxText(res) {
  const JSZip = require("jszip");
  const xml = await (await JSZip.loadAsync(res.body)).file("word/document.xml").async("string");
  return xml.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&apos;/g, "'");
}

test("completion statement: costs are validated and the figures add up", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const me = (await request(app).get("/auth/me").set(sarah)).body.id;
  const m = (await request(app).post("/matters").set(sarah).send({ address: "9 Figures Way", client: "Pat Buyer", type: "Purchase", feeEarnerId: me, price: 300000 })).body;

  assert.equal((await request(app).patch(`/matters/${m.id}`).set(sarah).send({ costs: [{ description: "", amount: 10 }] })).status, 400);
  assert.equal((await request(app).patch(`/matters/${m.id}`).set(sarah).send({ costs: [{ description: "Fee", amount: -1 }] })).status, 400);
  const ok = await request(app).patch(`/matters/${m.id}`).set(sarah).send({
    sdlt: 5000, mortgageAdvance: 200000, fundsReceived: 30000,
    costs: [{ description: "Legal fee", amount: 1000, vat: true }, { description: "Land Registry fee", amount: 150, vat: false }],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.costs[0], { description: "Legal fee", amount: 1000, vat: true });

  const templates = (await request(app).get("/matters/document-templates").set(sarah)).body;
  assert.ok(templates.some((t) => t.key === "completion-statement"));

  const res = await request(app).get(`/matters/${m.id}/generate/completion-statement`).set(sarah).buffer(true).parse(docxBody);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-disposition"], /Completion%20statement/);
  const text = await docxText(res);
  // 300,000 + 5,000 + 1,150 + 200 VAT = 306,350; less 200,000 and 30,000 = 76,350
  for (const expected of ["£306,350.00", "VAT at 20%", "£200.00", "£76,350.00", "Balance required from you before completion", "Pat Buyer"]) {
    assert.ok(text.includes(expected), `statement is missing: ${expected}`);
  }
  for (const t of templates) {
    const r = await request(app).get(`/matters/${m.id}/generate/${t.key}`).set(sarah).buffer(true).parse(docxBody);
    assert.equal(r.status, 200, t.key);
    assert.ok((await docxText(r)).includes(m.reference), `${t.key} is missing the reference`);
  }
  assert.equal((await request(app).get(`/matters/${m.id}/generate/nonsense`).set(sarah)).status, 404);
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.equal((await request(app).get(`/matters/${m.id}/generate/client-care`).set(marcus)).status, 404);
  const log = (await request(app).get(`/matters/${m.id}`).set(sarah)).body.activity.map((a) => a.text);
  assert.ok(log.includes("Completion statement draft generated"));
});

test("bank details: new details start unverified, replace the old ones, and only the fee earner can verify", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const jess = { Authorization: `Bearer ${await tokenFor("jess")}` };
  const me = (await request(app).get("/auth/me").set(sarah)).body.id;
  const m = (await request(app).post("/matters").set(sarah).send({ address: "4 Proceeds Rd", client: "Sam Seller", type: "Sale", feeEarnerId: me })).body;
  const base = `/matters/${m.id}/bank-details`;

  assert.equal((await request(app).post(base).set(sarah).send({ accountName: "Sam", sortCode: "12345", accountNumber: "12345678" })).status, 400);
  assert.equal((await request(app).post(base).set(sarah).send({ accountName: "Sam", sortCode: "12-34-56", accountNumber: "1234" })).status, 400);
  const first = await request(app).post(base).set(jess).send({ accountName: "Sam Seller", sortCode: "12-34-56", accountNumber: "1234 5678", bankName: "Barclays" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.sort_code, "123456");
  assert.equal(first.body.status, "unverified");

  assert.equal((await request(app).post(`${base}/${first.body.id}/verify`).set(jess).send({ method: "Phone call to number on file" })).status, 403);
  assert.equal((await request(app).post(`${base}/${first.body.id}/verify`).set(sarah).send({ method: "Other" })).status, 400);
  const v = await request(app).post(`${base}/${first.body.id}/verify`).set(sarah).send({ method: "Phone call to number on file", note: "Spoke to Sam on 07700 900000" });
  assert.equal(v.status, 200);
  assert.equal(v.body.status, "verified");

  const second = (await request(app).post(base).set(jess).send({ accountName: "Sam Seller", sortCode: "654321", accountNumber: "87654321" })).body;
  const detail = (await request(app).get(`/matters/${m.id}`).set(sarah)).body;
  assert.deepEqual(detail.bankDetails.map((b) => b.status), ["unverified", "superseded"]);
  assert.equal(detail.bankDetails[0].id, second.id);
  assert.equal((await request(app).post(`${base}/${first.body.id}/verify`).set(sarah).send({ method: "Video call" })).status, 404);
  assert.ok(detail.activity.some((a) => a.text.startsWith("Client bank details CHANGED (account ending 4321)")));

  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.equal((await request(app).post(base).set(marcus).send({ accountName: "X", sortCode: "111111", accountNumber: "11111111" })).status, 404);
});

test("departments: staff only see and open matters in their own departments", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };

  const priyaList = (await request(app).get("/matters?limit=100").set(priya)).body.matters;
  assert.ok(priyaList.length > 0 && priyaList.every((m) => m.department === "family"));
  const family = priyaList[0];
  assert.match(family.reference, /^FAM-/);
  assert.ok(!(await request(app).get("/matters?limit=100").set(sarah)).body.matters.some((m) => m.department === "family"));
  assert.equal((await request(app).get(`/matters/${family.id}`).set(sarah)).status, 404);
  assert.equal((await request(app).post(`/matters/${family.id}/notes`).set(sarah).send({ text: "x" })).status, 404);
  const all = (await request(app).get("/matters?limit=100").set(david)).body.matters;
  assert.ok(all.some((m) => m.department === "family") && all.some((m) => m.department === "conveyancing"));
  assert.ok((await request(app).get("/matters?department=family&limit=100").set(david)).body.matters.every((m) => m.department === "family"));

  // Opening matters: only in your departments, with that department's types.
  assert.equal((await request(app).post("/matters").set(sarah).send({ department: "family", address: "Divorce", client: "X", type: "Divorce" })).status, 403);
  assert.equal((await request(app).post("/matters").set(priya).send({ department: "family", address: "Divorce", client: "X", type: "Purchase" })).status, 400);
  assert.equal((await request(app).post("/matters").set(priya).send({ department: "crime", address: "R v X", client: "X", type: "Crown Court" })).status, 403); // not her department
  const priyaId = (await request(app).get("/auth/me").set(priya)).body.id;
  const created = await request(app).post("/matters").set(priya).send({ department: "family", address: "Child arrangements", client: "Y", type: "Children", feeEarnerId: priyaId });
  assert.equal(created.status, 201);
  assert.match(created.body.reference, /^FAM-\d{4}-\d{4}$/);

  // Each kind of family matter has its own stages (children: 9, ending in Closed) and no exchange checks.
  const stages = (await request(app).get("/settings").set(priya)).body.areas.find((a) => a.key === "family").typeStages.Children;
  assert.equal(stages.length, 9);
  assert.equal(stages.at(-1), "Closed");
  assert.equal((await request(app).post(`/matters/${created.body.id}/stage`).set(priya).send({ stageIndex: stages.length })).status, 400);
  assert.equal((await request(app).post(`/matters/${created.body.id}/stage`).set(priya).send({ stageIndex: 7 })).status, 200);
  const log = (await request(app).get(`/matters/${created.body.id}`).set(priya)).body.activity.map((a) => a.text);
  assert.ok(log.includes(`Moved to ${stages[7]}`));
  assert.equal((await request(app).patch(`/matters/${created.body.id}`).set(priya).send({ type: "Remortgage" })).status, 400);

  // Can't give tasks to someone outside the department.
  const sarahId = (await request(app).get("/auth/me").set(sarah)).body.id;
  assert.equal((await request(app).post(`/matters/${created.body.id}/tasks`).set(priya).send({ description: "x", assignedTo: sarahId })).status, 400);

  // The upcoming-exchanges dashboard is conveyancing only.
  assert.ok(!(await request(app).get("/matters/upcoming?days=60").set(david)).body.matters.some((m) => m.id === created.body.id));
});

test("departments: admins switch departments on for the firm and grant staff access, and it's audited", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const sarahId = (await request(app).get("/auth/me").set(sarah)).body.id;

  const settings = (await request(app).get("/settings").set(david)).body;
  assert.deepEqual(settings.departments, ["conveyancing", "private_client", "family", "employment", "litigation", "personal_injury", "corporate", "crime"]);
  assert.equal(settings.areas.length, 8);
  assert.equal((await request(app).patch("/settings").set(sarah).send({ departments: ["conveyancing"] })).status, 403);
  const off = await request(app).patch("/settings").set(david).send({ departments: ["conveyancing", "private_client"] });
  assert.equal(off.status, 400); // family has matters
  assert.match(off.body.error, /can't be switched off while it has matters/);
  const on = await request(app).patch("/settings").set(david).send({ departments: [...new Set([...settings.departments, "corporate"])] });
  assert.equal(on.status, 200);
  assert.ok(on.body.departments.includes("corporate"));

  // Grant Sarah family: she can now open a family matter; take it away and she can't see it.
  assert.equal((await request(app).patch(`/users/${sarahId}`).set(david).send({ departments: ["conveyancing", "nonsense"] })).status, 400);
  assert.equal((await request(app).patch(`/users/${sarahId}`).set(david).send({ departments: [] })).status, 400);
  const granted = await request(app).patch(`/users/${sarahId}`).set(david).send({ departments: ["conveyancing", "family"] });
  assert.deepEqual(granted.body.departments, ["conveyancing", "family"]);
  const fam = await request(app).post("/matters").set(sarah).send({ department: "family", address: "Divorce", client: "Z", type: "Divorce", feeEarnerId: sarahId });
  assert.equal(fam.status, 201);
  assert.equal((await request(app).get(`/auth/me`).set(sarah)).body.departments.join(), "conveyancing,family");
  await request(app).patch(`/users/${sarahId}`).set(david).send({ departments: ["conveyancing"] });
  assert.equal((await request(app).get(`/matters/${fam.body.id}`).set(sarah)).status, 404);

  // "All departments" (e.g. a partner) sees across departments without being admin.
  const partner = await request(app).post("/users").set(david)
    .send({ name: "Pat Partner", email: "pat@vjcrawfordlaw.co.uk", password: "partner-pass-1", role: "supervisor", allDepartments: true });
  assert.equal(partner.status, 201);
  assert.equal((await request(app).post("/users").set(david)
    .send({ name: "No Dept", email: "nodept@vjcrawfordlaw.co.uk", password: "nodept-pass-1", role: "fee_earner" })).status, 400);
  await request(app).patch(`/users/${sarahId}`).set(david).send({ supervisorId: partner.body.id });
  const pat = { Authorization: `Bearer ${(await request(app).post("/auth/login").send({ email: "pat@vjcrawfordlaw.co.uk", password: "partner-pass-1" })).body.token}` };
  assert.equal((await request(app).get(`/matters/${fam.body.id}`).set(pat)).status, 200);

  const audit = (await request(app).get("/users/audit").set(david)).body.map((a) => a.details);
  assert.ok(audit.some((d) => d.includes("departments changed from Conveyancing to Conveyancing, Family")));
  assert.ok(audit.some((d) => d.includes("all departments")));
});

test("conflict check: finds clients and other parties firm-wide, but only reveals the department of files you can't see", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const check = async (who, names, extra = {}) => (await request(app).post("/clients/conflict-check").set(who).send({ names, ...extra })).body.results;

  // Mark Morris is the other party on a family matter Sarah can't see.
  // Same surname as our family client Hannah Morris too — flagged, as relatives can be a conflict.
  const [mark] = await check(sarah, ["Mr Mark Morris"]);
  const asParty = mark.matches.find((m) => m.kind === "party");
  assert.equal(asParty.name, "Mark Morris");
  assert.deepEqual(asParty.matters[0], { hidden: true, department: "family", departmentName: "Family" });
  assert.ok(mark.matches.some((m) => m.kind === "client" && m.name === "Hannah Morris"));
  const [markForDavid] = await check(david, ["Mark Morris"]);
  assert.match(markForDavid.matches.find((m) => m.kind === "party").matters[0].reference, /^FAM-/);

  // Hannah Morris is a family client: flagged by department only, and not in Sarah's client list.
  const [hannah] = await check(sarah, ["Hannah Morris"]);
  assert.equal(hannah.matches[0].kind, "client");
  assert.equal(hannah.matches[0].matters[0].hidden, true);
  const sarahClients = (await request(app).get("/clients?search=Morris").set(sarah)).body;
  assert.ok(!sarahClients.some((c) => c.name === "Hannah Morris"));
  assert.equal((await request(app).get(`/clients/${hannah.matches[0].clientId}`).set(sarah)).status, 404);
  assert.equal((await request(app).get(`/clients/${hannah.matches[0].clientId}`).set(david)).status, 200);

  // Unrelated names don't match; titles and initials are ignored.
  assert.equal((await check(sarah, ["Jane Doe"]))[0].matches.length, 0);
  assert.ok((await check(sarah, ["Mr R Faulkner"]))[0].matches.some((m) => m.kind === "client" && m.name === "R & J Faulkner"));
  assert.equal((await request(app).post("/clients/conflict-check").set(sarah).send({ names: [] })).status, 400);
});

test("opening a matter: clients linked or created, parties recorded, conflicts must be reviewed and are logged", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const sarahId = (await request(app).get("/auth/me").set(sarah)).body.id;
  const faulkner = (await request(app).get("/clients?search=Faulkner").set(sarah)).body.find((c) => c.matter_count === 2);
  assert.ok(faulkner, "the Faulkners' shared client record");

  const base = { department: "conveyancing", address: "1 Conflict Close", client: "R & J Faulkner", type: "Purchase", feeEarnerId: sarahId };
  // The other side is our family client → must be reviewed before opening.
  const blocked = await request(app).post("/matters").set(sarah)
    .send({ ...base, clientIds: [faulkner.id], parties: [{ name: "Hannah Morris", role: "Seller" }], conflictReview: {} });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.conflicts[0].matches.length, 0); // choosing Faulkner doesn't flag Faulkner
  assert.equal(blocked.body.conflicts[1].matches[0].matters[0].departmentName, "Family");
  const opened = await request(app).post("/matters").set(sarah)
    .send({ ...base, clientIds: [faulkner.id], parties: [{ name: "Hannah Morris", role: "Seller" }], conflictReview: { note: "Checked with Family — different Hannah Morris (different address)" } });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const detail = (await request(app).get(`/matters/${opened.body.id}`).set(sarah)).body;
  assert.deepEqual(detail.clients.map((c) => c.name), ["R & J Faulkner"]);
  assert.deepEqual(detail.parties.map((p) => [p.name, p.role]), [["Hannah Morris", "Seller"]]);
  assert.ok(detail.conflict_checked_at && detail.conflict_check_note.startsWith("Checked with Family"));
  assert.ok(detail.activity.some((a) => /Conflict check on R & J Faulkner, Hannah Morris: 2 possible matches — reviewed: Checked with Family/.test(a.text)));

  // A new client is created; older callers get a client record made for them.
  const fresh = await request(app).post("/matters").set(sarah)
    .send({ ...base, address: "2 Fresh Way", client: "Olu Adeyemi", newClients: [{ name: "Olu Adeyemi", email: "olu@example.com" }], conflictReview: {} });
  assert.equal(fresh.status, 201);
  const legacy = await request(app).post("/matters").set(sarah).send({ ...base, address: "3 Old Road", client: "Legacy Client", clientEmail: "legacy@example.com" });
  const legacyDetail = (await request(app).get(`/matters/${legacy.body.id}`).set(sarah)).body;
  assert.equal(legacyDetail.clients[0].email, "legacy@example.com");
  assert.equal((await request(app).post("/matters").set(sarah).send({ ...base, parties: [{ name: "No Role" }] })).status, 400);

  // Parties and clients can be added later — each is conflict-checked — and removed.
  const added = await request(app).post(`/matters/${fresh.body.id}/parties`).set(sarah).send({ name: "Mark Morris", role: "Seller" });
  assert.equal(added.status, 201);
  assert.equal(added.body.conflicts[0].matches[0].matters[0].hidden, true);
  assert.equal((await request(app).delete(`/matters/${fresh.body.id}/parties/${added.body.party.id}`).set(sarah)).status, 204);
  const freshClient = (await request(app).get(`/matters/${fresh.body.id}`).set(sarah)).body.clients[0];
  assert.equal((await request(app).delete(`/matters/${fresh.body.id}/clients/${freshClient.id}`).set(sarah)).status, 400); // last client
  const joint = await request(app).post(`/matters/${fresh.body.id}/clients`).set(sarah).send({ newClient: { name: "Tolu Adeyemi" } });
  assert.equal(joint.status, 201);
  assert.equal((await request(app).delete(`/matters/${fresh.body.id}/clients/${freshClient.id}`).set(sarah)).status, 204);
});

test("client records: ID / AML checks are validated and noted on the client's matters", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const whitfield = (await request(app).get("/clients?search=Whitfield").set({ Authorization: `Bearer ${await tokenFor("david")}` })).body[0];
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  assert.equal((await request(app).get(`/clients/${whitfield.id}`).set(sarah)).status, 404); // Marcus's client
  const bad = await request(app).post(`/clients/${whitfield.id}/id-check`).set(marcus).send({ verifiedOn: "2026-10-01", method: "Library card", riskLevel: "low" });
  assert.equal(bad.status, 400);
  const ok = await request(app).post(`/clients/${whitfield.id}/id-check`).set(marcus).send({ verifiedOn: "2026-10-01", method: "Passport", riskLevel: "medium" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.risk_level, "medium");
  const record = (await request(app).get(`/clients/${whitfield.id}`).set(marcus)).body;
  assert.equal(record.id_verified_by_name, "Marcus Webb");
  const matterId = record.matters[0].id;
  const log = (await request(app).get(`/matters/${matterId}`).set(marcus)).body.activity.map((a) => a.text);
  assert.ok(log.includes("ID checked for Tom Whitfield (Passport) — medium risk"));
  const edited = await request(app).patch(`/clients/${whitfield.id}`).set(marcus).send({ phone: "07700 900111", name: " " });
  assert.equal(edited.status, 400);
  assert.equal((await request(app).patch(`/clients/${whitfield.id}`).set(marcus).send({ phone: "07700 900111" })).body.phone, "07700 900111");
});

test("diary: deadlines are added, moved, completed and logged; the diary shows the team's, by visibility", async () => {
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const family = (await request(app).get("/matters?limit=100").set(priya)).body.matters.find((m) => m.reference === "FAM-2026-0001");
  const base = `/matters/${family.id}/deadlines`;
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);

  assert.equal((await request(app).post(base).set(priya).send({ title: "", dueDate: soon })).status, 400);
  assert.equal((await request(app).post(base).set(priya).send({ title: "FDR", dueDate: soon, dueTime: "25:00" })).status, 400);
  assert.equal((await request(app).post(base).set(priya).send({ title: "FDR", dueDate: soon, kind: "party" })).status, 400);
  const fdr = await request(app).post(base).set(priya).send({ title: "FDR appointment", kind: "hearing", dueDate: soon, dueTime: "10:00", location: "Bristol Civil & Family Justice Centre", critical: true });
  assert.equal(fdr.status, 201);
  assert.equal(fdr.body.due_date, soon);
  assert.equal(fdr.body.due_time, "10:00");
  await request(app).post(base).set(priya).send({ title: "Form E exchange", kind: "court_deadline", dueDate: later, critical: true });

  // The diary: due within the window (and overdue); Sarah can't see family deadlines; the supervisor (admin) can.
  const diary = (await request(app).get("/deadlines?days=14").set(priya)).body;
  assert.ok(diary.deadlines.some((d) => d.id === fdr.body.id && d.reference === "FAM-2026-0001"));
  assert.ok(!diary.deadlines.some((d) => d.title === "Form E exchange"));
  assert.ok((await request(app).get("/deadlines?days=60").set(priya)).body.deadlines.some((d) => d.title === "Form E exchange"));
  assert.ok(!(await request(app).get("/deadlines?days=60").set(sarah)).body.deadlines.some((d) => d.matter_id === family.id));
  assert.ok((await request(app).get("/deadlines?days=60").set(david)).body.deadlines.some((d) => d.id === fdr.body.id));
  assert.ok(!(await request(app).get("/deadlines?days=60&mine=true").set(david)).body.deadlines.some((d) => d.id === fdr.body.id));
  assert.equal((await request(app).post(base).set(sarah).send({ title: "x", dueDate: soon })).status, 404);

  // Move it, mark it done (drops off the diary), reopen; all logged.
  const moved = await request(app).patch(`${base}/${fdr.body.id}`).set(priya).send({ dueDate: later });
  assert.equal(moved.body.due_date, later);
  const done = await request(app).patch(`${base}/${fdr.body.id}`).set(priya).send({ status: "done" });
  assert.equal(done.body.status, "done");
  assert.ok(!(await request(app).get("/deadlines?days=60").set(priya)).body.deadlines.some((d) => d.id === fdr.body.id));
  const detail = (await request(app).get(`/matters/${family.id}`).set(priya)).body;
  assert.equal(detail.deadlines.find((d) => d.id === fdr.body.id).done_by_name, "Priya Shah");
  const log = detail.activity.map((a) => a.text);
  assert.ok(log.includes(`Diary: FDR appointment — ${soon} (critical)`));
  assert.ok(log.includes(`Diary: FDR appointment — moved from ${soon} to ${later}`));
  assert.ok(log.includes("Diary: FDR appointment — done"));
  assert.equal((await request(app).delete(`${base}/${fdr.body.id}`).set(priya)).status, 204);

  // Common deadlines per department come with the settings.
  const areas = (await request(app).get("/settings").set(priya)).body.areas;
  const pi = areas.find((a) => a.key === "personal_injury").deadlines;
  assert.deepEqual(pi[0].rule, { from: "Date of accident or date of knowledge", years: 3 });
});

test("time recording: 6-minute units at the fee earner's rate; only your own (unbilled) time can be changed", async () => {
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const me = (await request(app).get("/auth/me").set(priya)).body;
  assert.equal(me.hourlyRate, 210);
  const priyaId = me.id;
  const m = (await request(app).post("/matters").set(priya).send({ department: "family", address: "Billing test", client: "Bill Payer", type: "Divorce", feeEarnerId: priyaId })).body;
  assert.equal(m.funding, "hourly");
  const base = `/matters/${m.id}/time`;

  assert.equal((await request(app).post(base).set(priya).send({ workDate: "2026-10-01", minutes: 0, activity: "Drafting" })).status, 400);
  assert.equal((await request(app).post(base).set(priya).send({ workDate: "2026-10-01", minutes: 30, activity: "Juggling" })).status, 400);
  const e1 = await request(app).post(base).set(priya).send({ workDate: "2026-10-01", minutes: 20, activity: "Telephone call", description: "Call with client" });
  assert.equal(e1.status, 201);
  assert.equal(e1.body.units, 4); // 20 minutes rounds up to 4 × 6 minutes
  assert.equal(Number(e1.body.amount), 84); // 0.4 h × £210
  const e2 = (await request(app).post(base).set(priya).send({ workDate: "2026-10-02", units: 10, activity: "Drafting", description: "Petition" })).body;
  await request(app).post(base).set(priya).send({ workDate: "2026-10-02", units: 2, activity: "Other", description: "Admin", billable: false });

  const billing = (await request(app).get(`/matters/${m.id}/billing`).set(priya)).body;
  assert.equal(billing.entries.length, 3);
  assert.equal(billing.summary.unbilledUnits, 14);
  assert.equal(billing.summary.unbilledValue, 294);
  assert.equal(billing.summary.percentOfEstimate, null);

  // Estimate, and the matter detail carries the running totals.
  assert.equal((await request(app).patch(`/matters/${m.id}`).set(priya).send({ funding: "barter" })).status, 400);
  await request(app).patch(`/matters/${m.id}`).set(priya).send({ feeEstimate: 400 });
  assert.equal((await request(app).get(`/matters/${m.id}`).set(priya)).body.billing.percentOfEstimate, 74);

  // Editing: your own entry, recalculated; not someone else's unless you supervise the matter.
  const edited = await request(app).patch(`${base}/${e2.id}`).set(priya).send({ units: 5 });
  assert.equal(Number(edited.body.amount), 105);
  assert.equal((await request(app).patch(`${base}/${e2.id}`).set(sarah).send({ units: 1 })).status, 404); // can't see the matter
  assert.equal((await request(app).patch(`${base}/${e2.id}`).set(david).send({ description: "Petition (revised)" })).status, 200); // admin

  // Rates are only listed for admins; timesheet shows your own.
  assert.ok((await request(app).get("/users").set(david)).body.some((u) => u.hourly_rate !== undefined));
  assert.ok((await request(app).get("/users").set(priya)).body.every((u) => u.hourly_rate === undefined));
  const sheet = (await request(app).get("/time?from=2026-10-01&to=2026-10-02").set(priya)).body;
  assert.ok(sheet.entries.length >= 3);
  assert.ok(sheet.totals.units >= 11);
});

test("billing: draft from unbilled time and disbursements, issue with the next number, cancel, Word bill", async () => {
  const JSZip = require("jszip");
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  const priyaId = (await request(app).get("/auth/me").set(priya)).body.id;
  const m = (await request(app).post("/matters").set(priya).send({ department: "family", address: "Bill me", client: "Pay Ing", type: "Children", feeEarnerId: priyaId })).body;
  const entry = (await request(app).post(`/matters/${m.id}/time`).set(priya).send({ workDate: "2026-10-05", units: 10, activity: "Drafting" })).body;
  const nonBillable = (await request(app).post(`/matters/${m.id}/time`).set(priya).send({ workDate: "2026-10-05", units: 1, activity: "Other", billable: false })).body;

  const bills = `/matters/${m.id}/bills`;
  assert.equal((await request(app).post(bills).set(priya).send({})).status, 400);
  assert.equal((await request(app).post(bills).set(priya).send({ timeEntryIds: [nonBillable.id] })).status, 400);
  const draft = await request(app).post(bills).set(priya).send({
    timeEntryIds: [entry.id],
    disbursements: [{ description: "Court fee", amount: 232, vat: false }, { description: "Courier", amount: 10, vat: true }],
    narrative: "Child arrangements application",
  });
  assert.equal(draft.status, 201);
  assert.equal(Number(draft.body.profit_costs), 210);
  assert.equal(Number(draft.body.vat), 44); // 20% of (210 + 10)
  assert.equal(Number(draft.body.total), 496); // 210 + 242 + 44
  // Time on a draft is locked and can't go on a second bill.
  assert.equal((await request(app).patch(`/matters/${m.id}/time/${entry.id}`).set(priya).send({ units: 1 })).status, 400);
  assert.equal((await request(app).post(bills).set(priya).send({ timeEntryIds: [entry.id] })).status, 400);

  // Word draft, then issue (fee earner) with the next firm-wide number.
  const doc = await request(app).get(`${bills}/${draft.body.id}/document`).set(priya)
    .buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  const text = (await (await JSZip.loadAsync(doc.body)).file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
  for (const t of ["DRAFT", "Pay Ing", "Child arrangements application", "Court fee", "£496.00", "Schedule of time"]) assert.ok(text.includes(t), `bill missing ${t}`);
  const issued = await request(app).post(`${bills}/${draft.body.id}/issue`).set(priya);
  assert.equal(issued.status, 200);
  assert.ok(issued.body.bill_number >= 1);
  assert.equal((await request(app).delete(`${bills}/${draft.body.id}`).set(priya)).status, 400);
  const billing = (await request(app).get(`/matters/${m.id}/billing`).set(priya)).body;
  assert.equal(billing.summary.billedCosts, 210);
  assert.equal(billing.summary.unbilledValue, 0);

  // A fixed fee bill gets the next number; cancelling frees the time.
  const fixed = (await request(app).post(bills).set(priya).send({ profitCosts: 500 })).body;
  const second = await request(app).post(`${bills}/${fixed.id}/issue`).set(david);
  assert.equal(second.body.bill_number, issued.body.bill_number + 1);
  assert.equal((await request(app).post(`${bills}/${draft.body.id}/cancel`).set(priya).send({})).status, 400);
  assert.equal((await request(app).post(`${bills}/${draft.body.id}/cancel`).set(priya).send({ reason: "Wrong client" })).status, 204);
  const after = (await request(app).get(`/matters/${m.id}/billing`).set(priya)).body;
  assert.equal(after.summary.unbilledValue, 210);
  assert.equal(after.summary.billedCosts, 500);
  const log = (await request(app).get(`/matters/${m.id}`).set(priya)).body.activity.map((a) => a.text);
  assert.ok(log.includes(`Bill ${issued.body.bill_number} issued: £496.00 including VAT`));
  assert.ok(log.includes(`Bill ${issued.body.bill_number} cancelled — Wrong client`));
  // Someone who can't see the matter can't bill it.
  assert.equal((await request(app).post(bills).set(marcus).send({ profitCosts: 1 })).status, 404);

  // Rates: admin sets them, audited.
  const r = await request(app).patch(`/users/${priyaId}`).set(david).send({ hourlyRate: 225 });
  assert.equal(Number(r.body.hourly_rate), 225);
  assert.equal((await request(app).patch(`/users/${priyaId}`).set(david).send({ hourlyRate: -5 })).status, 400);
  assert.ok((await request(app).get("/users/audit").set(david)).body.some((a) => a.details.includes("hourly rate changed from £210 to £225")));
});

test("review fixes: nothing from another department leaks through sign-offs, links, the timesheet or conflict roles", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const sarahId = (await request(app).get("/auth/me").set(sarah)).body.id;
  const priyaId = (await request(app).get("/auth/me").set(priya)).body.id;
  const family = (await request(app).get("/matters?department=family&limit=100").set(david)).body.matters.find((m) => m.reference === "FAM-2026-0001");
  const conv = (await request(app).get("/matters?limit=100").set(sarah)).body.matters[0];

  // Sarah supervises Priya but works only in conveyancing: Priya's family sign-off request isn't listed for her.
  await request(app).patch(`/users/${sarahId}`).set(david).send({ role: "supervisor" });
  await request(app).patch(`/users/${priyaId}`).set(david).send({ supervisorId: sarahId });
  await request(app).patch("/settings").set(david).send({ requireStageSignoff: true });
  // Priya is the fee earner so she moves directly; have the admin request instead to create a pending request.
  await request(app).post(`/matters/${family.id}/stage-requests`).set(david).send({ stageIndex: 5, note: "x" });
  const pending = (await request(app).get("/matters/sign-offs/pending").set(sarah)).body;
  assert.ok(!pending.some((r) => r.matter_id === family.id), "family request leaked into Sarah's sign-offs");

  // A link to a family matter isn't shown on Sarah's conveyancing matter.
  assert.ok([200, 201, 204].includes((await request(app).put(`/matters/${conv.id}/links/${family.id}`).set(david)).status));
  const convDetail = (await request(app).get(`/matters/${conv.id}`).set(sarah)).body;
  assert.ok(!convDetail.linkedMatters.some((l) => l.id === family.id));
  assert.ok((await request(app).get(`/matters/${conv.id}`).set(david)).body.linkedMatters.some((l) => l.id === family.id));

  // A hidden party's role isn't revealed by the conflict check.
  const [mark] = (await request(app).post("/clients/conflict-check").set(sarah).send({ names: ["Mark Morris"] })).body.results;
  const hiddenParties = mark.matches.filter((m) => m.kind === "party" && m.matters[0].hidden);
  assert.ok(hiddenParties.length >= 1);
  assert.ok(hiddenParties.every((m) => m.role === "Party"));

  // Priya loses family access: her timesheet keeps her time but not the matter's details.
  await request(app).post(`/matters/${family.id}/time`).set(priya).send({ workDate: "2026-10-20", units: 1, activity: "Other" });
  await request(app).patch(`/users/${priyaId}`).set(david).send({ departments: ["conveyancing"] });
  const sheet = (await request(app).get("/time?from=2026-10-20&to=2026-10-20").set(priya)).body;
  assert.ok(sheet.entries.length >= 1);
  assert.ok(sheet.entries.every((e) => e.reference !== "FAM-2026-0001" && !e.address.includes("Divorce")));
  await request(app).patch(`/users/${priyaId}`).set(david).send({ departments: ["family"] });
});

test("review fixes: billing can't double-issue, hides rates from non-managers, and locks billed time", async () => {
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const priyaId = (await request(app).get("/auth/me").set(priya)).body.id;
  const m = (await request(app).post("/matters").set(priya).send({ department: "family", address: "Double issue", client: "D I", type: "Divorce", feeEarnerId: priyaId })).body;
  const e = (await request(app).post(`/matters/${m.id}/time`).set(priya).send({ workDate: "2026-10-05", units: 3, activity: "Drafting" })).body;
  const draft = (await request(app).post(`/matters/${m.id}/bills`).set(priya).send({ timeEntryIds: [e.id] })).body;
  const [a, b] = await Promise.all([
    request(app).post(`/matters/${m.id}/bills/${draft.id}/issue`).set(priya),
    request(app).post(`/matters/${m.id}/bills/${draft.id}/issue`).set(priya),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const issuedNumber = (a.status === 200 ? a : b).body.bill_number;
  const bills = (await request(app).get(`/matters/${m.id}/billing`).set(priya)).body.bills;
  assert.equal(bills.find((x) => x.id === draft.id).bill_number, issuedNumber);
  assert.equal((await request(app).delete(`/matters/${m.id}/time/${e.id}`).set(priya)).status, 400);

  // Rates: shown to the matter's fee earner, not to an assistant.
  assert.ok((await request(app).get(`/matters/${m.id}/billing`).set(priya)).body.entries.every((x) => x.rate !== undefined));
  const jess = { Authorization: `Bearer ${await tokenFor("jess")}` };
  const sarahMatter = (await request(app).get("/matters?limit=100").set(jess)).body.matters[0];
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  await request(app).post(`/matters/${sarahMatter.id}/time`).set(sarah).send({ workDate: "2026-10-05", units: 1, activity: "Other" });
  const asJess = (await request(app).get(`/matters/${sarahMatter.id}/billing`).set(jess)).body;
  assert.ok(asJess.entries.length && asJess.entries.every((x) => x.rate === undefined));
  assert.ok((await request(app).get(`/matters/${sarahMatter.id}/billing`).set(david)).body.entries.every((x) => x.rate !== undefined));
});

test("review fixes: staff and matter assignments are validated; odd input gets a 400, not a crash", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const priyaId = (await request(app).get("/auth/me").set({ Authorization: `Bearer ${await tokenFor("priya")}` })).body.id;

  // A repeated department is fine (not a half-created account).
  const dup = await request(app).post("/users").set(david)
    .send({ name: "Dup Dept", email: "dupdept@vjcrawfordlaw.co.uk", password: "dup-dept-pass-1", departments: ["family", "family"] });
  assert.equal(dup.status, 201);
  assert.deepEqual(dup.body.departments, ["family"]);

  // A conveyancing matter can't be given a family-only fee earner.
  const conv = (await request(app).get("/matters?limit=100").set(sarah)).body.matters[0];
  const bad = await request(app).patch(`/matters/${conv.id}`).set(sarah).send({ feeEarnerId: priyaId });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /doesn't work in Conveyancing/);
  assert.equal((await request(app).post("/matters").set(sarah).send({ address: "x", client: "y", type: "Purchase", supervisorId: priyaId })).status, 400);

  // Odd input: impossible dates, built-in names, repeated query parameters.
  assert.equal((await request(app).post(`/matters/${conv.id}/tasks`).set(sarah).send({ description: "x", dueDate: "2026-02-30" })).status, 400);
  assert.equal((await request(app).post("/matters").set(david).send({ department: "__proto__", address: "x", client: "y", type: "z" })).status, 400);
  assert.equal((await request(app).post("/matters").set(david).send({ department: "constructor", address: "x", client: "y", type: "z" })).status, 400);
  assert.equal((await request(app).patch("/settings").set(david).send({ departments: ["conveyancing", "constructor"] })).status, 400);
  assert.equal((await request(app).get("/matters?search=Mill&search=Lane").set(sarah)).status, 200);
  assert.equal((await request(app).post(`/matters/${conv.id}/notes`).set(sarah).send({ text: 5 })).status, 400);
  assert.equal((await request(app).post("/auth/login").send({ email: ["a"], password: "x" })).status, 400);

  // Dates come back as plain dates.
  const detail = (await request(app).get(`/matters/${conv.id}`).set(sarah)).body;
  assert.match(String(detail.date_instructed), /^\d{4}-\d{2}-\d{2}$/);
});

test("document folders: standard set on first open, filed by category, moved, renamed, deleted, by visibility", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };

  // A conveyancing matter with documents opens with the standard folders, documents filed by category.
  const created = await request(app).post("/matters").set(sarah)
    .send({ address: "1 Folder Row", client: "Fiona Folder", type: "Purchase", conflictNote: "Checked", feeEarnerId: (await request(app).get("/auth/me").set(sarah)).body.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Documents added before the matter is first opened (like those on older matters).
  await request(app).post(`/matters/${created.body.id}/documents`).set(sarah).send({ name: "Draft contract", category: "Contract" });
  await request(app).post(`/matters/${created.body.id}/documents`).set(sarah).send({ name: "Misc", category: "Other" });
  const opened = await request(app).get(`/matters/${created.body.id}`).set(sarah);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const conv = opened.body;
  assert.equal(conv.documents.find((d) => d.category === "Other").folder_id, null);
  const list = (await request(app).get("/matters?limit=100").set(sarah)).body.matters;
  const names = conv.folders.map((f) => f.name);
  assert.equal(names[0], "Client care & ID");
  assert.ok(names.includes("Contract pack") && names.includes("Searches"));
  const contractFolder = conv.folders.find((f) => f.name === "Contract pack");
  const contractDoc = conv.documents.find((doc) => doc.category === "Contract");
  assert.equal(contractDoc.folder_id, contractFolder.id);
  // Opening again doesn't duplicate them.
  assert.equal((await request(app).get(`/matters/${conv.id}`).set(sarah)).body.folders.length, conv.folders.length);

  // Add (duplicate names refused), rename, move a document, add a document straight into a folder.
  const added = await request(app).post(`/matters/${conv.id}/folders`).set(sarah).send({ name: "  Planning  " });
  assert.equal(added.status, 201);
  assert.equal(added.body.name, "Planning");
  assert.equal((await request(app).post(`/matters/${conv.id}/folders`).set(sarah).send({ name: "planning" })).status, 409);
  assert.equal((await request(app).post(`/matters/${conv.id}/folders`).set(sarah).send({ name: " " })).status, 400);
  const renamed = await request(app).patch(`/matters/${conv.id}/folders/${added.body.id}`).set(sarah).send({ name: "Planning & building regs" });
  assert.equal(renamed.body.name, "Planning & building regs");
  assert.equal((await request(app).put(`/matters/${conv.id}/documents/${contractDoc.id}/folder`).set(sarah).send({ folderId: added.body.id })).status, 204);
  const doc = await request(app).post(`/matters/${conv.id}/documents`).set(sarah)
    .send({ name: "Planning permission", category: "Other", folderId: added.body.id });
  assert.equal(doc.body.folder_id, added.body.id);

  // A folder from another matter can't be used.
  const other = list.find((m) => m.id !== conv.id);
  const otherFolders = (await request(app).get(`/matters/${other.id}`).set(sarah)).body.folders;
  assert.equal((await request(app).put(`/matters/${conv.id}/documents/${contractDoc.id}/folder`).set(sarah).send({ folderId: otherFolders[0].id })).status, 400);

  // Deleting a folder leaves its documents unfiled; the standard set can be put back.
  assert.equal((await request(app).delete(`/matters/${conv.id}/folders/${added.body.id}`).set(sarah)).status, 204);
  assert.equal((await request(app).delete(`/matters/${conv.id}/folders/${contractFolder.id}`).set(sarah)).status, 204);
  let detail = (await request(app).get(`/matters/${conv.id}`).set(sarah)).body;
  assert.equal(detail.documents.find((d) => d.id === contractDoc.id).folder_id, null);
  assert.equal(detail.documents.find((d) => d.id === doc.body.id).folder_id, null);
  const restored = await request(app).post(`/matters/${conv.id}/folders/standard`).set(sarah);
  assert.deepEqual(restored.body.added, ["Contract pack"]);
  detail = (await request(app).get(`/matters/${conv.id}`).set(sarah)).body;
  assert.ok(detail.activity.some((a) => /Folder deleted: Contract pack/.test(a.text)));

  // Someone outside conveyancing can't touch them.
  assert.equal((await request(app).post(`/matters/${conv.id}/folders`).set(priya).send({ name: "x" })).status, 404);
  assert.equal((await request(app).put(`/matters/${conv.id}/documents/${contractDoc.id}/folder`).set(priya).send({ folderId: null })).status, 404);

  // An admin can change a department's standard folders; new matters use them; null goes back to the default.
  assert.equal((await request(app).patch("/settings").set(sarah).send({ folderTemplate: { department: "family", folders: ["A"] } })).status, 403);
  assert.equal((await request(app).patch("/settings").set(david).send({ folderTemplate: { department: "family", folders: [" "] } })).status, 400);
  const set = await request(app).patch("/settings").set(david)
    .send({ folderTemplate: { department: "family", folders: ["Court papers", "Correspondence", "court papers", ""] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.folderTemplates.find((t) => t.department === "family").folders, ["Court papers", "Correspondence"]);
  const fam = await request(app).post("/matters").set(priya).send({ department: "family", type: "Divorce", client: "Folder Test", address: "Folder Test - divorce", conflictNote: "Checked", feeEarnerId: (await request(app).get("/auth/me").set(priya)).body.id });
  assert.equal(fam.status, 201, JSON.stringify(fam.body));
  const famDetail = (await request(app).get(`/matters/${fam.body.id}`).set(priya)).body;
  assert.deepEqual(famDetail.folders.map((f) => f.name), ["Court papers", "Correspondence"]);
  const reset = await request(app).patch("/settings").set(david).send({ folderTemplate: { department: "family", folders: null } });
  assert.equal(reset.body.folderTemplates.find((t) => t.department === "family").customised, false);
});

test("wills, trusts & probate: own stages per type, estate register, IHT estimate, documents, safe custody", async () => {
  const emma = { Authorization: `Bearer ${await tokenFor("emma")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const list = (await request(app).get("/matters?limit=100").set(emma)).body.matters;
  assert.ok(list.every((m) => m.department === "private_client"));
  const estateRow = list.find((m) => m.reference === "PC-2026-0001");
  const willRow = list.find((m) => m.reference === "PC-2026-0002");

  // Probate has 9 stages, a will 8; both can be closed at their own last stage.
  assert.equal((await request(app).post(`/matters/${estateRow.id}/stage`).set(emma).send({ stageIndex: 9 })).status, 400);
  assert.equal((await request(app).post(`/matters/${willRow.id}/stage`).set(emma).send({ stageIndex: 8 })).status, 400);

  // The estate: details, register and summary come with the matter.
  let estate = (await request(app).get(`/matters/${estateRow.id}`).set(emma)).body;
  assert.equal(estate.details.deceasedName, "Margaret Ellen Hayward");
  assert.equal(estate.estateItems.length, 9);
  assert.equal(estate.beneficiaries.length, 4);
  assert.ok(estate.detailFields.some((f) => f.key === "dateOfDeath"));
  // £666,792.65 gross; £8,775 debts; full transferred NRB and RNRB (£650k + £350k) → no IHT.
  assert.equal(estate.estateSummary.grossEstate, 666792.65);
  assert.equal(estate.estateSummary.netEstate, 658017.65);
  assert.equal(estate.estateSummary.iht.due, 0);

  // Without the transferred bands, tax is due: (658,017.65 − 5,000 charity − 325,000 − 175,000) × 40%.
  const det = await request(app).patch(`/matters/${estateRow.id}/details`).set(emma).send({ transferredNrbPct: 0, transferredRnrbPct: "", dateOfDeath: "2026-05-21" });
  assert.equal(det.status, 200);
  assert.equal(det.body.transferredNrbPct, 0);
  assert.equal(det.body.transferredRnrbPct, undefined);
  estate = (await request(app).get(`/matters/${estateRow.id}`).set(emma)).body;
  assert.equal(estate.estateSummary.iht.due, Math.round((658017.65 - 5000 - 325000 - 175000) * 0.4 * 100) / 100);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/details`).set(emma).send({ dateOfDeath: "2026-02-30" })).status, 400);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/details`).set(emma).send({ grantType: "Sort of probate" })).status, 400);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/details`).set(emma).send({ nonsense: 1 })).status, 400);

  // Add, update and remove assets; beneficiaries need a share or amount.
  const car = await request(app).post(`/matters/${estateRow.id}/estate-items`).set(emma)
    .send({ kind: "asset", category: "Vehicle", description: "Honda Jazz", valueAtDeath: "4200" });
  assert.equal(car.status, 201);
  assert.equal((await request(app).post(`/matters/${estateRow.id}/estate-items`).set(emma).send({ kind: "asset", category: "Spaceship", description: "x" })).status, 400);
  const sold = await request(app).patch(`/matters/${estateRow.id}/estate-items/${car.body.id}`).set(emma).send({ status: "Notified" });
  assert.match(String(sold.body.notified_on), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/estate-items/${car.body.id}`).set(emma).send({ valueRealised: 3900, status: "Collected / transferred" })).status, 200);
  assert.equal((await request(app).post(`/matters/${estateRow.id}/beneficiaries`).set(emma).send({ name: "X", giftType: "Share of residue" })).status, 400);
  const ben = await request(app).post(`/matters/${estateRow.id}/beneficiaries`).set(emma).send({ name: "Local church", giftType: "Pecuniary legacy", amount: 1000, exemption: "charity" });
  assert.equal(ben.status, 201);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/beneficiaries/${ben.body.id}`).set(emma).send({ paidAmount: 1000, paidOn: "2026-10-01" })).status, 200);
  estate = (await request(app).get(`/matters/${estateRow.id}`).set(emma)).body;
  assert.equal(estate.estateSummary.distribution.beneficiaries.find((b) => b.id === ben.body.id).balance, 0);
  assert.ok(estate.activity.some((a) => /Paid £1,000.00 to Local church/.test(a.text)));
  assert.equal((await request(app).delete(`/matters/${estateRow.id}/estate-items/${car.body.id}`).set(emma)).status, 204);

  // Word drafts.
  for (const url of [
    `/matters/${estateRow.id}/estate-account`,
    `/matters/${estateRow.id}/estate-items/${estate.estateItems[1].id}/letter`,
    `/matters/${estateRow.id}/beneficiaries/${ben.body.id}/letter`,
  ]) {
    const doc = await request(app).get(url).set(emma).buffer(true).parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    assert.equal(doc.status, 200, url);
    assert.equal(doc.body.slice(0, 2).toString(), "PK");
  }

  // The estate register only exists on probate matters, and other departments can't see any of it.
  assert.equal((await request(app).post(`/matters/${willRow.id}/estate-items`).set(emma).send({ kind: "asset", category: "Vehicle", description: "x" })).status, 400);
  assert.equal((await request(app).get(`/matters/${estateRow.id}/estate-account`).set(sarah)).status, 404);
  assert.equal((await request(app).patch(`/matters/${estateRow.id}/details`).set(sarah).send({ deceasedName: "x" })).status, 404);

  // Changing a will into probate keeps it in range; a closed matter stays closed.
  const lpa = list.find((m) => m.reference === "PC-2026-0003");
  assert.equal((await request(app).post(`/matters/${lpa.id}/stage`).set(emma).send({ stageIndex: 7 })).status, 200);
  const changed = await request(app).patch(`/matters/${lpa.id}`).set(emma).send({ type: "Probate / estate administration" });
  assert.equal(changed.body.current_stage_index, 8);

  // Safe custody register: Emma sees all three; Sarah (conveyancing) none; release is recorded once.
  const reg = (await request(app).get("/safe-custody").set(emma)).body;
  assert.equal(reg.entries.length, 3);
  assert.equal((await request(app).get("/safe-custody").set(sarah)).body.entries.length, 0);
  assert.equal((await request(app).get("/safe-custody?search=okafor").set(emma)).body.entries.length, 2);
  assert.equal((await request(app).post("/safe-custody").set(sarah).send({ docType: "Will", person: "A", location: "B", receivedOn: "2026-01-01" })).status, 403);
  const added = await request(app).post("/safe-custody").set(emma).send({ docType: "Lasting power of attorney", person: "Alan Pritchard", location: "Packet 1050", receivedOn: "2026-10-01", matterId: lpa.id });
  assert.equal(added.status, 201);
  assert.equal((await request(app).post(`/safe-custody/${added.body.id}/withdraw`).set(emma).send({ withdrawnOn: "2026-10-02" })).status, 400);
  assert.equal((await request(app).post(`/safe-custody/${added.body.id}/withdraw`).set(emma).send({ withdrawnOn: "2026-10-02", withdrawnTo: "Claire Pritchard (attorney)" })).status, 200);
  assert.equal((await request(app).post(`/safe-custody/${added.body.id}/withdraw`).set(emma).send({ withdrawnOn: "2026-10-02", withdrawnTo: "x" })).status, 409);
  assert.equal((await request(app).get("/safe-custody").set(emma)).body.entries.length, 3);
  assert.equal((await request(app).get("/safe-custody?withdrawn=true").set(emma)).body.entries.length, 4);

  // The settings carry each type's stages for the screens.
  const settings = (await request(app).get("/settings").set(emma)).body;
  const pc = settings.areas.find((a) => a.key === "private_client");
  assert.equal(pc.typeStages["Probate / estate administration"].length, 9);
  assert.equal(pc.typeStageHints.Will.length, 8);
});

test("family: own stages per type, details, asset schedule with proposed split, children, Word schedule", async () => {
  const priya = { Authorization: `Bearer ${await tokenFor("priya")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const list = (await request(app).get("/matters?limit=100").set(priya)).body.matters;
  const fin = list.find((m) => m.reference === "FAM-2026-0001");
  const divorce = list.find((m) => m.reference === "FAM-2026-0002");
  const injunction = list.find((m) => m.reference === "FAM-2026-0004");

  // Financial settlement: 10 stages; injunction 8.
  assert.equal((await request(app).post(`/matters/${fin.id}/stage`).set(priya).send({ stageIndex: 10 })).status, 400);
  assert.equal((await request(app).post(`/matters/${injunction.id}/stage`).set(priya).send({ stageIndex: 8 })).status, 400);

  // The schedule: capital and pensions kept apart, now and as proposed.
  let m = (await request(app).get(`/matters/${fin.id}`).set(priya)).body;
  assert.ok(m.detailFields.some((f) => f.key === "formEExchanged"));
  assert.equal(m.details.otherParty, "Mark Morris");
  assert.equal(m.children.length, 2);
  const s = m.assetSchedule;
  // Capital: 485,000 − 162,000 + 18,400 + 41,200 + 14,500 − 6,300 = 390,800.
  assert.equal(s.capital.total, 390800);
  // Client now: half the equity (161,500) + 18,400 = 179,900; proposed: 60% of equity (193,800) + 18,400 = 212,200.
  assert.equal(s.capital.clientNow, 179900);
  assert.equal(s.capital.clientProposed, 212200);
  assert.equal(s.capitalTransferToClient, 32300);
  // Pensions: 96,000 + 212,000; client proposed 96,000 + 40% of 212,000 = 180,800.
  assert.equal(s.pensions.total, 308000);
  assert.equal(s.pensions.clientProposed, 180800);

  const car = await request(app).post(`/matters/${fin.id}/family-assets`).set(priya)
    .send({ kind: "asset", owner: "client", category: "Vehicle", description: "Ford Fiesta", value: "3500" });
  assert.equal(car.status, 201);
  assert.equal((await request(app).post(`/matters/${fin.id}/family-assets`).set(priya).send({ kind: "asset", owner: "neighbour", category: "Vehicle", description: "x", value: 1 })).status, 400);
  assert.equal((await request(app).post(`/matters/${fin.id}/family-assets`).set(priya).send({ kind: "pension", owner: "client", category: "Vehicle", description: "x", value: 1 })).status, 400);
  assert.equal((await request(app).patch(`/matters/${fin.id}/family-assets/${car.body.id}`).set(priya).send({ proposedClientPercent: 101 })).status, 400);
  assert.equal((await request(app).patch(`/matters/${fin.id}/family-assets/${car.body.id}`).set(priya).send({ proposedClientPercent: 0 })).status, 200);
  m = (await request(app).get(`/matters/${fin.id}`).set(priya)).body;
  assert.equal(m.assetSchedule.capital.clientNow, 179900 + 3500);
  assert.equal(m.assetSchedule.capital.clientProposed, 212200);
  assert.equal((await request(app).delete(`/matters/${fin.id}/family-assets/${car.body.id}`).set(priya)).status, 204);

  const doc = await request(app).get(`/matters/${fin.id}/asset-schedule`).set(priya).buffer(true)
    .parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(doc.status, 200);
  assert.equal(doc.body.slice(0, 2).toString(), "PK");

  // The schedule is only for financial settlements; children for any family matter; nothing for other departments.
  assert.equal((await request(app).post(`/matters/${divorce.id}/family-assets`).set(priya).send({ kind: "asset", owner: "client", category: "Vehicle", description: "x", value: 1 })).status, 400);
  const child = await request(app).post(`/matters/${divorce.id}/children`).set(priya).send({ name: "Ella Morris", dateOfBirth: "2014-03-09", livesWith: "Client" });
  assert.equal(child.status, 201);
  assert.equal((await request(app).patch(`/matters/${divorce.id}/children/${child.body.id}`).set(priya).send({ livesWith: "Grandma" })).status, 400);
  assert.equal((await request(app).patch(`/matters/${divorce.id}/children/${child.body.id}`).set(priya).send({ dateOfBirth: "2014-02-30" })).status, 400);
  assert.equal((await request(app).delete(`/matters/${divorce.id}/children/${child.body.id}`).set(priya)).status, 204);
  assert.equal((await request(app).get(`/matters/${fin.id}/asset-schedule`).set(sarah)).status, 404);
  assert.equal((await request(app).post(`/matters/${fin.id}/children`).set(sarah).send({ name: "x" })).status, 404);

  // Details: validated by the type's fields.
  assert.equal((await request(app).patch(`/matters/${divorce.id}/details`).set(priya).send({ weAct: "Both of them" })).status, 400);
  assert.equal((await request(app).patch(`/matters/${divorce.id}/details`).set(priya).send({ financialOrderInPlace: true, placeOfMarriage: "" })).status, 200);
  m = (await request(app).get(`/matters/${divorce.id}`).set(priya)).body;
  assert.equal(m.details.financialOrderInPlace, true);
  assert.equal(m.details.placeOfMarriage, undefined);
  assert.ok((await request(app).get(`/matters/${injunction.id}`).set(priya)).body.details.confidentialAddress);
});

const isoIn = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const binary = (res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); };

test("employment: own stages, time limit with ACAS, awards, schedule of loss and offers lists, Word export", async () => {
  const aisha = { Authorization: `Bearer ${await tokenFor("aisha")}` };
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const list = (await request(app).get("/matters?limit=100").set(aisha)).body.matters;
  const claim = list.find((m) => m.reference === "EMP-2026-0001");
  const employer = list.find((m) => m.reference === "EMP-2026-0003");
  const settlement = list.find((m) => m.reference === "EMP-2026-0002");
  assert.equal((await request(app).post(`/matters/${claim.id}/stage`).set(aisha).send({ stageIndex: 11 })).status, 400);
  assert.equal((await request(app).post(`/matters/${settlement.id}/stage`).set(aisha).send({ stageIndex: 8 })).status, 400);

  // Set ACAS dates and a known dismissal date: 6-month limit (act after 1 Oct 2026) extended by the ACAS period.
  const det = await request(app).patch(`/matters/${claim.id}/details`).set(aisha)
    .send({ edt: "2026-10-15", acasDayA: "2026-11-01", acasDayB: "2026-12-01", startDate: "2014-03-01", dateOfBirth: "1980-05-10", grossWeeklyPay: 900 });
  assert.equal(det.status, 200);
  let m = (await request(app).get(`/matters/${claim.id}`).set(aisha)).body;
  const limit = m.insights.find((c) => c.title === "Tribunal time limit");
  assert.ok(limit.rows.some((r) => r.label.startsWith("Primary limit (6 months") && r.value === "14 Apr 2027"));
  // 30 days of conciliation added to 14 Apr 2027.
  assert.ok(limit.rows.some((r) => r.label === "Last day to present the ET1" && r.value.startsWith("14 May 2027")));
  const awards = m.insights.find((c) => c.title === "Awards");
  // 12 years: 5 at 1.5 (the years starting after the 41st birthday) and 7 at 1 = 14.5 weeks × £751 cap.
  assert.ok(awards.rows.some((r) => r.label === "Basic award (unfair dismissal)" && r.value === "£10,889.50"));

  // Lists: schedule of loss and offers come with the matter, with summaries.
  const schedule = m.lists.find((l) => l.key === "schedule");
  assert.equal(schedule.items.length, 4);
  assert.ok(schedule.summary.rows.some((r) => r.label === "Net claim" && r.value === "£23,524.50"));
  const added = await request(app).post(`/matters/${claim.id}/lists/schedule`).set(aisha).send({ head: "Other", description: "New job earnings", amount: "1000", deduction: true });
  assert.equal(added.status, 201);
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/schedule`).set(aisha).send({ head: "Other" })).status, 400);
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/schedule`).set(aisha).send({ head: "Nonsense", amount: 1 })).status, 400);
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/charges`).set(aisha).send({ x: 1 })).status, 404);
  m = (await request(app).get(`/matters/${claim.id}`).set(aisha)).body;
  assert.ok(m.lists.find((l) => l.key === "schedule").summary.rows.some((r) => r.label === "Net claim" && r.value === "£22,524.50"));
  const offer = m.lists.find((l) => l.key === "offers").items[0];
  assert.equal((await request(app).patch(`/matters/${claim.id}/lists/offers/${offer.id}`).set(aisha).send({ status: "Rejected" })).status, 200);
  m = (await request(app).get(`/matters/${claim.id}`).set(aisha)).body;
  assert.ok(m.activity.some((a) => /Offers: .* — Rejected/.test(a.text)));
  assert.equal((await request(app).delete(`/matters/${claim.id}/lists/schedule/${added.body.id}`).set(aisha)).status, 204);
  const doc = await request(app).get(`/matters/${claim.id}/lists/schedule/document`).set(aisha).buffer(true).parse(binary);
  assert.equal(doc.status, 200);
  assert.equal(doc.body.slice(0, 2).toString(), "PK");

  // Employer side: ET3 due 28 days after the claim was sent → flagged.
  const emp = (await request(app).get(`/matters/${employer.id}`).set(aisha)).body;
  assert.ok(emp.serverAttention.some((t) => t.startsWith("ET3 response due")));
  // Settlement agreement: £30,000 tax-free, the rest taxable.
  const set = (await request(app).get(`/matters/${settlement.id}`).set(aisha)).body;
  assert.ok(set.insights[0].rows.some((r) => r.label === "— taxable above £30,000" && r.value === "£12,000.00"));
  assert.equal(set.lists.length, 0);

  // Other departments can't see any of it; datetimes and numbers validate.
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/schedule`).set(sarah).send({ head: "Other", amount: 1 })).status, 404);
  assert.equal((await request(app).patch(`/matters/${claim.id}/details`).set(aisha).send({ hearingDays: -2 })).status, 400);
});

test("litigation: limitation, CPR deadlines on business days, fee and track, Part 36 relevant period, chronology", async () => {
  const tom = { Authorization: `Bearer ${await tokenFor("tom")}` };
  const list = (await request(app).get("/matters?limit=100").set(tom)).body.matters;
  const claim = list.find((m) => m.reference === "LIT-2026-0001");
  const pn = list.find((m) => m.reference === "LIT-2026-0002");
  const debt = list.find((m) => m.reference === "LIT-2026-0003");

  let m = (await request(app).get(`/matters/${claim.id}`).set(tom)).body;
  const value = m.insights.find((c) => c.title === "Value");
  assert.ok(value.rows.some((r) => r.label === "Court issue fee (EX50)" && r.value === "£2,425.00"));
  assert.ok(value.rows.some((r) => r.value.startsWith("Intermediate track")));
  // The other side's Part 36 offer was made 16 days ago: relevant period ends in 5 days → flagged.
  assert.ok(m.serverAttention.some((t) => t.startsWith("Part 36 offer of £30,000.00 from the other side")));
  assert.equal(m.lists.find((l) => l.key === "chronology").items.length, 4);

  // Known dates: particulars deemed served 1 Dec 2026 with an acknowledgment → defence 29 Dec; claim form posted on Christmas Eve → deemed served 30 Dec.
  await request(app).patch(`/matters/${claim.id}/details`).set(tom).send({ claimIssued: "2026-11-20", claimFormServed: "2026-12-24", particularsServed: "2026-12-01", aosFiled: "2026-12-10" });
  m = (await request(app).get(`/matters/${claim.id}`).set(tom)).body;
  const proc = m.insights.find((c) => c.title === "Proceedings");
  assert.ok(proc.rows.some((r) => r.label.startsWith("Claim form deemed served") && r.value === "30 Dec 2026"));
  assert.ok(proc.rows.some((r) => r.label === "Defence due (28 days)" && r.value.startsWith("29 Dec 2026")));

  // Professional negligence: latent damage gives 3 years from knowledge.
  const p = (await request(app).get(`/matters/${pn.id}`).set(tom)).body;
  assert.ok(p.insights.find((c) => c.title === "Limitation").rows.some((r) => r.value.startsWith("3 Apr 2028")));
  assert.ok(p.insights.find((c) => c.title === "Pre-action").rows.some((r) => r.label === "Letter of response due (3 months)"));

  // Debt recovery: its own 8 stages; judgment outstanding.
  assert.equal((await request(app).post(`/matters/${debt.id}/stage`).set(tom).send({ stageIndex: 8 })).status, 400);
  const dm = (await request(app).get(`/matters/${debt.id}`).set(tom)).body;
  assert.ok(dm.insights.find((c) => c.title === "Judgment & enforcement").rows.some((r) => r.label === "Outstanding" && r.value === "£5,302.40"));

  // Chronology entries need a date and an event.
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/chronology`).set(tom).send({ event: "x" })).status, 400);
  assert.equal((await request(app).post(`/matters/${claim.id}/lists/chronology`).set(tom).send({ date: "2026-01-05", event: "Chaser sent" })).status, 201);
});

test("personal injury: limitation (incl. children), portal deadlines in business days, valuation, CFA cap, specials", async () => {
  const tom = { Authorization: `Bearer ${await tokenFor("tom")}` };
  const list = (await request(app).get("/matters?limit=100").set(tom)).body.matters;
  const work = list.find((m) => m.reference === "PI-2026-0002");
  const child = list.find((m) => m.reference === "PI-2026-0003");
  const rta = list.find((m) => m.reference === "PI-2026-0001");

  // Employer's liability: £28,000 general + £10,080 past + £6,500 future = £44,580; 20% contributory → £35,664.
  const w = (await request(app).get(`/matters/${work.id}`).set(tom)).body;
  const val = w.insights.find((c) => c.title === "Valuation");
  assert.ok(val.rows.some((r) => r.label === "Full value" && r.value === "£44,580.00"));
  assert.ok(val.rows.some((r) => r.label === "Value after contributory negligence" && r.value === "£35,664.00"));
  assert.ok(val.rows.some((r) => r.label === "Likely track" && r.value.startsWith("Intermediate")));
  // CFA cap: 25% of ((28,000 + 10,080) × 80% − 2,300 CRU) = £7,041.00; client keeps at least 35,664 − 7,041 − 1,500 ATE.
  const cfa = w.insights.find((c) => c.title === "Client's deductions (CFA)");
  assert.ok(cfa.rows.some((r) => r.label.startsWith("Most the success fee") && r.value === "£7,041.00"));
  assert.ok(cfa.rows.some((r) => r.label === "Client receives at least" && r.value === "£27,123.00"));

  // A child: limitation runs to the 21st birthday, and settlement needs approval.
  const c = (await request(app).get(`/matters/${child.id}`).set(tom)).body;
  const lim = c.insights.find((x) => x.title === "Limitation");
  assert.ok(lim.rows.some((r) => r.value.startsWith("1 May 2037")));
  assert.ok(lim.rows.some((r) => r.label === "Child claimant"));

  // RTA portal: 15 business days from Fri 18 Dec 2026, skipping 25 and 28 Dec and 1 Jan → Wed 13 Jan 2027.
  await request(app).patch(`/matters/${rta.id}/details`).set(tom).send({ claimNotified: "2026-12-18" });
  const r = (await request(app).get(`/matters/${rta.id}`).set(tom)).body;
  assert.ok(r.insights.find((x) => x.title === "Protocol").rows.some((x) => x.label.startsWith("Liability decision due (RTA Portal") && x.value.startsWith("13 Jan 2027")));

  // Specials need a head, a period and an amount.
  assert.equal((await request(app).post(`/matters/${rta.id}/lists/specials`).set(tom).send({ head: "Travel", amount: 10 })).status, 400);
  assert.equal((await request(app).post(`/matters/${rta.id}/lists/specials`).set(tom).send({ head: "Travel", period: "Past", amount: 10 })).status, 201);
});

test("corporate: own stages, stamp duty, deal timetable, checklist and due diligence lists, company and renewal dates", async () => {
  const aisha = { Authorization: `Bearer ${await tokenFor("aisha")}` };
  const list = (await request(app).get("/matters?limit=100").set(aisha)).body.matters;
  const deal = list.find((m) => m.reference === "CC-2026-0001");
  const formation = list.find((m) => m.reference === "CC-2026-0002");
  const contract = list.find((m) => m.reference === "CC-2026-0003");
  assert.equal((await request(app).post(`/matters/${deal.id}/stage`).set(aisha).send({ stageIndex: 9 })).status, 400);
  assert.equal((await request(app).post(`/matters/${formation.id}/stage`).set(aisha).send({ stageIndex: 7 })).status, 400);

  let m = (await request(app).get(`/matters/${deal.id}`).set(aisha)).body;
  // £1,850,000 + £250,000 deferred = £2.1m × 0.5% = £10,500.
  assert.ok(m.insights.find((c) => c.title === "Stamp duty").rows.some((r) => r.value === "£10,500.00"));
  assert.ok(m.serverAttention.some((t) => t.startsWith("Longstop date")));
  assert.ok(m.serverAttention.some((t) => t.startsWith("1 red due diligence issue")));
  assert.ok(m.serverAttention.some((t) => t.includes("Buyer board minutes")));
  assert.ok(!m.serverAttention.some((t) => t.includes("Bank consent"))); // the other side's job
  const checklist = m.lists.find((l) => l.key === "checklist");
  assert.ok(checklist.summary.rows.some((r) => r.label === "Complete" && r.value === "0 of 8"));

  // Complete the deal: warranty, tax and filing dates appear.
  await request(app).patch(`/matters/${deal.id}/details`).set(aisha).send({ completionDate: "2026-11-30" });
  m = (await request(app).get(`/matters/${deal.id}`).set(aisha)).body;
  const t = m.insights.find((c) => c.title === "Deal timetable");
  assert.ok(t.rows.some((r) => r.label.startsWith("Warranty claims") && r.value === "30 Nov 2028"));
  assert.ok(t.rows.some((r) => r.label.startsWith("Tax covenant") && r.value === "30 Nov 2033"));
  assert.ok(m.insights.find((c) => c.title === "Stamp duty").rows.some((r) => r.label === "Stamp the transfer within 30 days" && r.value.startsWith("30 Dec 2026")));

  const f = (await request(app).get(`/matters/${formation.id}`).set(aisha)).body;
  assert.ok(f.insights.find((c) => c.title === "Company deadlines"));
  assert.equal(f.lists.find((l) => l.key === "dd"), undefined);
  const c = (await request(app).get(`/matters/${contract.id}`).set(aisha)).body;
  assert.ok(c.serverAttention.some((x) => x.startsWith("Notice to end or renegotiate")));
});

test("crime: own stages, PACE clock, custody time limit, defence statement, plea credit, appeal deadline, charges", async () => {
  const dan = { Authorization: `Bearer ${await tokenFor("dan")}` };
  const aisha = { Authorization: `Bearer ${await tokenFor("aisha")}` };
  const list = (await request(app).get("/matters?limit=100").set(dan)).body.matters;
  assert.ok(list.length === 3 && list.every((m) => m.department === "crime"));
  const station = list.find((m) => m.reference === "CRI-2026-0001");
  const mags = list.find((m) => m.reference === "CRI-2026-0002");
  const crown = list.find((m) => m.reference === "CRI-2026-0003");
  assert.equal((await request(app).post(`/matters/${station.id}/stage`).set(dan).send({ stageIndex: 6 })).status, 400);
  assert.equal((await request(app).post(`/matters/${crown.id}/stage`).set(dan).send({ stageIndex: 9 })).status, 200);
  await request(app).post(`/matters/${crown.id}/stage`).set(dan).send({ stageIndex: 5 });

  // PACE clock from a known relevant time.
  assert.equal((await request(app).patch(`/matters/${station.id}/details`).set(dan).send({ relevantTime: "2026-10-25T25:00" })).status, 400);
  await request(app).patch(`/matters/${station.id}/details`).set(dan).send({ relevantTime: "2026-10-25T21:30" });
  const s = (await request(app).get(`/matters/${station.id}`).set(dan)).body;
  const pace = s.insights.find((c) => c.title === "PACE clock");
  assert.ok(pace.rows.some((r) => r.label === "24-hour limit" && r.value.startsWith("26 Oct 2026 21:30")));

  // Crown Court, remanded: CTL 182 days from sending (12 days left) and defence statement due in 4 days → flagged.
  const c = (await request(app).get(`/matters/${crown.id}`).set(dan)).body;
  assert.ok(c.serverAttention.some((t) => t.startsWith("Custody time limit expires")));
  assert.ok(c.serverAttention.some((t) => t.startsWith("Defence statement due")));
  const charges = c.lists.find((l) => l.key === "charges");
  assert.ok(charges.summary.rows.some((r) => r.label === "Venue" && r.value.startsWith("Crown Court")));

  // Magistrates': guilty-plea credit after the first hearing is a quarter at most; sentence → 15 business days to appeal.
  let m = (await request(app).get(`/matters/${mags.id}`).set(dan)).body;
  assert.ok(m.insights.find((x) => x.title === "Case timetable").rows.some((r) => r.label === "Credit for a guilty plea now" && r.value.startsWith("one quarter")));
  await request(app).patch(`/matters/${mags.id}/details`).set(dan).send({ verdictDate: "2026-12-18", sentenceDate: "2026-12-18" });
  m = (await request(app).get(`/matters/${mags.id}`).set(dan)).body;
  assert.ok(m.insights.find((x) => x.title === "Appeal deadline").rows[0].value.startsWith("13 Jan 2027"));

  // Charges need an offence and a classification; other departments can't see crime files.
  assert.equal((await request(app).post(`/matters/${mags.id}/lists/charges`).set(dan).send({ offence: "Assault" })).status, 400);
  assert.equal((await request(app).post(`/matters/${mags.id}/lists/charges`).set(dan).send({ offence: "Common assault", classification: "Summary only" })).status, 201);
  assert.equal((await request(app).get(`/matters/${mags.id}`).set(aisha)).status, 404);
});

test("conveyancing sales: own stage names lined up with purchases; exchange needs the review but not a deposit; import accepts sale stage names", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const conv = (await request(app).get("/settings").set(sarah)).body.areas.find((a) => a.key === "conveyancing");
  const sale = conv.typeStages.Sale;
  assert.equal(sale.length, conv.stages.length);
  for (const name of ["Pre-Exchange Review", "Exchange", "Completion", "Closed"]) assert.equal(sale.indexOf(name), conv.stages.indexOf(name));
  assert.ok(!sale.includes("Searches") && !sale.includes("Mortgage Offer") && !sale.includes("Report on Title"));
  assert.equal(conv.typeStageHints.Sale.length, sale.length);

  const me = (await request(app).get("/auth/me").set(sarah)).body.id;
  const m = (await request(app).post("/matters").set(sarah).send({ address: "7 Seller Street", client: "Sam Seller", type: "Sale", feeEarnerId: me, conflictNote: "Checked" })).body;
  assert.equal((await request(app).post(`/matters/${m.id}/stage`).set(sarah).send({ stageIndex: 3 })).status, 200);
  const log = (await request(app).get(`/matters/${m.id}`).set(sarah)).body.activity.map((a) => a.text);
  assert.ok(log.includes("Moved to Contract pack issued"));
  // Exchange: blocked only by the pre-exchange review (a seller has no deposit or mortgage offer to show).
  const blocked = await request(app).post(`/matters/${m.id}/stage`).set(sarah).send({ stageIndex: 8 });
  assert.equal(blocked.status, 400);
  assert.deepEqual(blocked.body.exchangeBlockers, ["The pre-exchange review hasn't been confirmed."]);

  // Spreadsheet import understands sale stage names (and the old purchase names still work).
  const res = await request(app).post("/matters/import").set(david)
    .send({ rows: [{ Address: "1 Import Row", Client: "Ima Seller", Type: "Sale", Stage: "Buyer's enquiries" }, { Address: "2 Import Row", Client: "Ivor Buyer", Type: "Purchase", Stage: "Searches" }], dryRun: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.valid, 2);
  assert.deepEqual(res.body.errors, []);
});
