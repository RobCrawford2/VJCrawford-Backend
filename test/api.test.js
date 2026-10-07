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
});

test("sslmode=require is rewritten to verify-full (silences pg warning)", () => {
  assert.equal(normalizeConnectionString("postgres://h/db?sslmode=require"), "postgres://h/db?sslmode=verify-full");
  assert.equal(normalizeConnectionString("postgres://h/db?a=1&sslmode=prefer&b=2"), "postgres://h/db?a=1&sslmode=verify-full&b=2");
  assert.equal(normalizeConnectionString("postgres://h/db?sslmode=disable"), "postgres://h/db?sslmode=disable");
  assert.equal(normalizeConnectionString("postgres://h/db"), "postgres://h/db");
});
