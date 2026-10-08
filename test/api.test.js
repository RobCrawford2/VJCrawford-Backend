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
const email = (name) => `${name}@vjcrawfordconveyancing.co.uk`;

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
  assert.deepEqual(res.body, { status: "ok" });
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
  const victim = "nobody-locked@vjcrawfordconveyancing.co.uk";
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
    .send({ name: "Temp Leaver", email: "leaver@vjcrawfordconveyancing.co.uk", password: "leaver-password", role: "admin" });
  assert.equal(created.status, 201);

  const login = await request(app).post("/auth/login")
    .send({ email: "leaver@vjcrawfordconveyancing.co.uk", password: "leaver-password" });
  const leaver = { Authorization: `Bearer ${login.body.token}` };
  assert.equal((await request(app).get("/matters").set(leaver)).status, 200);

  // Role change: the token still says admin, but the demotion applies at once.
  assert.ok((await request(app).get("/matters").set(leaver)).body.matters.length > 0);
  await request(app).patch(`/users/${created.body.id}`).set(david).send({ role: "fee_earner" });
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
    .send({ name: "Second Admin", email: "admin2@vjcrawfordconveyancing.co.uk", password: "second-admin-pw", role: "admin" });
  assert.equal((await request(app).patch(`/users/${other.body.id}`).set(david).send({ role: "supervisor" })).status, 200);

  assert.equal((await request(app).patch(`/users/${davidId}`).set(david).send({ role: "boss" })).status, 400);
});

test("a malformed id gives a 400, not a server error", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const res = await request(app).get("/matters/not-a-real-id").set(david);
  assert.equal(res.status, 400);
});

test("matters can be moved to every stage, including Closed, and the log names the right stage", async () => {
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
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
      "Reference": "OLD-0002", "Fee Earner": "marcus@vjcrawfordconveyancing.co.uk", "Stage": "12" },
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
    .send({ name: "New Starter", email: "Starter@VJCrawfordConveyancing.co.uk", password: "temporary-pass-1", supervisorId: sarahId });
  assert.equal(added.status, 201);
  assert.equal(added.body.email, "starter@vjcrawfordconveyancing.co.uk");
  const id = added.body.id;
  const login = (pw) => request(app).post("/auth/login").send({ email: "starter@vjcrawfordconveyancing.co.uk", password: pw });
  assert.equal((await login("temporary-pass-1")).status, 200);

  const edited = await request(app).patch(`/users/${id}`).set(david).send({ name: "New Starter-Smith", role: "supervisor" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, "New Starter-Smith");
  assert.equal(edited.body.role, "supervisor");

  assert.equal((await request(app).patch(`/users/${id}`).set(david).send({ email: "david@vjcrawfordconveyancing.co.uk" })).status, 409);
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

test("stage sign-off: fee earners request, the supervisor or an admin approves or declines", async () => {
  const sarah = { Authorization: `Bearer ${await tokenFor("sarah")}` };
  const david = { Authorization: `Bearer ${await tokenFor("david")}` };
  const marcus = { Authorization: `Bearer ${await tokenFor("marcus")}` };
  const matter = (await request(app).get("/matters?showClosed=false").set(sarah)).body.matters[0];
  const from = matter.current_stage_index;
  const to = from === 11 ? 10 : from + 1;

  // Fee earner can't move directly while sign-off is required
  const direct = await request(app).post(`/matters/${matter.id}/stage`).set(sarah).send({ stageIndex: to });
  assert.equal(direct.status, 403);
  assert.equal(direct.body.needsSignoff, true);

  // Request it
  const reqRes = await request(app).post(`/matters/${matter.id}/stage-requests`).set(sarah).send({ stageIndex: to, note: "Searches all back" });
  assert.equal(reqRes.status, 201);
  let detail = (await request(app).get(`/matters/${matter.id}`).set(sarah)).body;
  assert.equal(detail.pendingStageRequest.to_stage, to);
  assert.equal(detail.canSignOffStages, false);
  assert.equal(detail.stageMovesNeedSignoff, true);

  // Requester and other fee earners can't approve; Sarah's pending list is empty
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(sarah).send({ approve: true })).status, 403);
  assert.equal((await request(app).get("/matters/sign-offs/pending").set(sarah)).body.length, 0);

  // Admin sees it waiting; declining needs a reason
  const pending = (await request(app).get("/matters/sign-offs/pending").set(david)).body;
  assert.ok(pending.some((p) => p.id === reqRes.body.id && p.requested_by_name === "Sarah Ncube"));
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(david).send({ approve: false })).status, 400);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${reqRes.body.id}/decision`).set(david).send({ approve: false, note: "Mortgage offer not in yet" })).status, 200);
  detail = (await request(app).get(`/matters/${matter.id}`).set(sarah)).body;
  assert.equal(detail.current_stage_index, from);
  assert.equal(detail.pendingStageRequest, null);

  // Ask again; approve — stage moves; can't decide twice
  const again = (await request(app).post(`/matters/${matter.id}/stage-requests`).set(sarah).send({ stageIndex: to })).body;
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${again.id}/decision`).set(david).send({ approve: true, note: "OK" })).status, 200);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage-requests/${again.id}/decision`).set(david).send({ approve: true })).status, 409);
  detail = (await request(app).get(`/matters/${matter.id}`).set(sarah)).body;
  assert.equal(detail.current_stage_index, to);
  const log = detail.activity.map((a) => a.text);
  assert.ok(log.some((t) => t.startsWith("Sign-off requested to move to")));
  assert.ok(log.some((t) => t.includes("declined by David Okonkwo — Mortgage offer not in yet")));
  assert.ok(log.some((t) => t.includes("signed off by David Okonkwo")));

  // Withdraw your own request
  const w = (await request(app).post(`/matters/${matter.id}/stage-requests`).set(sarah).send({ stageIndex: from })).body;
  assert.equal((await request(app).delete(`/matters/${matter.id}/stage-requests/${w.id}`).set(marcus)).status, 404);
  assert.equal((await request(app).delete(`/matters/${matter.id}/stage-requests/${w.id}`).set(sarah)).status, 204);

  // Firm switches sign-off off — fee earners move directly
  assert.equal((await request(app).patch("/settings").set(david).send({ requireStageSignoff: false })).status, 200);
  assert.equal((await request(app).post(`/matters/${matter.id}/stage`).set(sarah).send({ stageIndex: from })).status, 200);
  await request(app).patch("/settings").set(david).send({ requireStageSignoff: true });
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
