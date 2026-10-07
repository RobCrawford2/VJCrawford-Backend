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
