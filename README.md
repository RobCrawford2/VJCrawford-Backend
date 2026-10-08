# V J Crawford Conveyancing — Case Management API

This is **Phase 1** of moving the case management system off browser-only
storage and onto a real backend: a Postgres database, a REST API, and real
authentication with role-based permissions (fee earner / supervisor / admin).

It's designed to serve the same data shape the React prototype already
uses, so the frontend can be pointed at this instead of `window.storage`
with the interface itself barely changing.

## What's in Phase 1

- A properly normalized Postgres schema (`migrations/001_init.sql`) —
  matters, documents, emails, enquiries, searches, undertakings, tasks and
  an activity log as real linked tables, not one JSON blob per matter.
- A REST API (Express) covering matter CRUD and every sub-resource used in
  the prototype, including the enquiry auto-match-from-email logic and the
  mortgage-expiry / stage-tracking fields.
- Real login (JWT-based) and password hashing (bcrypt).
- **Server-enforced** role-based visibility: fee earners see their own
  matters, supervisors see their team's, admins see everything in the
  firm — enforced in every query, not just filtered in the UI.
- Server-side pagination and search on the matter list.
- A seed script that loads the same demo data (Faulkner purchase + linked
  sale, the Whitfield "problem file", etc.) used in the frontend prototype.

## What's deliberately **not** in Phase 1

This is the honest part. Phase 1 is the foundation, not the finished
system:

- **Document files are stored in Postgres** (`document_files`, up to 10 MB
  each). That's simple and needs no extra accounts, but database storage is
  limited and comparatively expensive — once the firm has a lot of files,
  move them to object storage (e.g. S3 London); `documents.storage_key` is
  already there for that.
- **No real Outlook integration.** The email auto-matching logic is real
  and running server-side now, but emails still have to be logged manually
  — Microsoft Graph integration is Phase 2.
- **No client accounting / ledger.** Deliberately out of scope — this
  should integrate with your firm's existing SRA Accounts Rules-compliant
  accounting software rather than be rebuilt from scratch.
- **No production security hardening yet.** Refresh tokens,
  audit-log immutability, and a few other things below are needed before
  this goes anywhere near real client data. See "Before this goes live"
  at the bottom.

## Getting started locally

You'll need [Docker](https://docs.docker.com/get-docker/) installed. This
runs Postgres and the API together with one command:

```bash
cp .env.example .env
# Edit .env — at minimum, change JWT_SECRET to a real random value:
# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up --build
```

Once it's running, apply the schema and load demo data:

```bash
docker compose exec api npm run migrate
docker compose exec api npm run seed
```

The API is now running at `http://localhost:4000`. Check it's alive:

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

Log in with one of the seeded demo accounts (see the output of `npm run
seed`, or use `sarah@vjcrawfordconveyancing.co.uk` / `password123`):

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sarah@vjcrawfordconveyancing.co.uk","password":"password123"}'
```

That returns a `token` — pass it as `Authorization: Bearer <token>` on
every other request.

### Without Docker

If you'd rather run Postgres yourself:

```bash
npm install
cp .env.example .env   # point DATABASE_URL at your own Postgres
npm run migrate
npm run seed
npm run dev
```

## Running the tests

The tests run against a real Postgres database and **wipe and re-seed the
demo firm** in it, so point them at a throwaway database, never the live
one:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vjcrawford_test npm test
```

GitHub runs the same tests (plus a frontend build) automatically on every
pull request — see `.github/workflows/ci.yml`.

## API overview

All routes except `/auth/register` and `/auth/login` require
`Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create a new firm + first admin user (disabled unless `ALLOW_REGISTRATION=true`) |
| POST | `/auth/login` | Log in, get a token |
| GET | `/auth/me` | Current user + firm details |
| POST | `/auth/change-password` | Change your own password (`currentPassword`, `newPassword`) |
| GET | `/matters?limit=&offset=&type=&showClosed=&feeEarnerId=&search=` | Paginated, filtered matter list |
| POST | `/matters` | Create a matter |
| POST | `/matters/import` | Bulk import (admin only) — `{ rows, dryRun }`, rows keyed by spreadsheet header; validates every row, all-or-nothing, max 1000 rows |
| GET | `/matters/:id` | Full matter detail, all sub-resources included |
| PATCH | `/matters/:id` | Update matter fields |
| POST | `/matters/:id/stage` | Move the stage tracker |
| POST | `/matters/:id/notes` | Log a free-text update |
| POST | `/matters/:id/documents` | Add a document record |
| PUT | `/matters/:id/documents/:docId/file` | Upload (or replace) the file for a document — multipart field `file`, max 10 MB, PDF/Office/images/text/Outlook only |
| GET | `/matters/:id/documents/:docId/file` | Download a document's file |
| POST | `/matters/:id/emails` | Log an email (auto-matches enquiry replies) |
| POST | `/matters/:id/emails/:emailId/match` | Manually re-run enquiry matching |
| POST | `/matters/:id/enquiries` | Add an enquiry |
| POST | `/matters/:id/enquiries/bulk` | Add several from the standard template |
| PATCH | `/matters/:id/enquiries/:eid/answer` | Manually answer an enquiry |
| PATCH | `/matters/:id/enquiries/:eid/review` | Confirm or flag-follow-up a Pending Review reply |
| POST | `/matters/:id/searches` | Order a search |
| PATCH | `/matters/:id/searches/:sid` | Update / flag an issue |
| POST | `/matters/:id/undertakings` | Add an undertaking |
| PATCH | `/matters/:id/undertakings/:uid/discharge` | Discharge it |
| POST | `/matters/:id/tasks` | Add a task |
| PATCH | `/matters/:id/tasks/:tid/complete` \| `/reopen` | Complete / reopen |
| PUT/DELETE | `/matters/:id/links/:linkedId` | Link / unlink a matter chain |
| GET | `/users` | List staff (for fee-earner pickers) |
| POST/PATCH | `/users` | Add / update staff (admin only) |
| GET/PATCH | `/settings` | Firm-level settings (domain, review threshold) |

## Connecting the React frontend to this API

The prototype currently persists via `window.storage.get/set`, which only
exists inside Claude's artifact environment. To run the real frontend
against this API instead:

1. Replace the `window.storage` calls in the load effect and `persist()`
   function with `fetch()` calls to `GET /matters` and the relevant
   `POST`/`PATCH` endpoints above.
2. Add a login screen that calls `POST /auth/login` and stores the
   returned token (e.g. in memory / a secure cookie — **not**
   `localStorage`, which isn't accessible to script-injection-resistant
   storage the way an httpOnly cookie is).
3. Send `Authorization: Bearer <token>` on every request.
4. The nested detail (documents, emails, enquiries, etc.) now comes back
   already joined from `GET /matters/:id` — no more client-side
   `normalizeMatter()` backfilling, since the database enforces the shape.

The data model matches closely enough that most of this is swapping one
persistence layer for another, not rewriting the UI.

## Deploying this for real

A few realistic options, roughly cheapest/simplest to most involved:

- **Railway / Render** — both offer a managed Postgres and a place to run
  the Node app with minimal setup; good starting point for a small firm.
- **AWS (RDS + ECS/Elastic Beanstalk)** or **Azure equivalents** — more
  control, more setup, usually the right call once you're past a handful
  of staff or have specific data-residency requirements.

### Demo data on a deployed host

Hosts without a shell (like Render's free tier) can load the demo firm on
boot by setting `SEED_ON_BOOT=true`. Because those demo accounts are then
reachable from the internet, boot seeding also requires `DEMO_PASSWORD`
(10+ characters) — it won't use the local `password123` default, and skips
seeding with a log message if `DEMO_PASSWORD` is missing. Seeding wipes and
recreates the demo firm, so set `SEED_ON_BOOT` back to `false` once it has
run.

Whichever you choose, set real environment variables (never commit `.env`),
put the API behind HTTPS, and set `CORS_ORIGIN` to your actual deployed
frontend URL.

## Before this goes anywhere near real client data

This is a repeat of the compliance conversation we've already had, made
concrete against this codebase specifically:

- [x] **Rate limiting** on `/auth/login` — 5 failed attempts on one
      account, or 30 failed attempts from one address, blocks further tries
      for 15 minutes (`src/middleware/rateLimit.js`)
- [ ] **Refresh tokens / shorter-lived access tokens** — right now a
      token is valid for its full 12-hour lifetime with no revocation
      mechanism if a device is lost
- [ ] **HTTPS everywhere** — never run this over plain HTTP once real data
      is involved
- [ ] **Database backups** — automatic, tested, with a real restore
      process, not just "the managed provider probably does this"
- [ ] **Encryption at rest** confirmed with your hosting provider
- [ ] **Cyber Essentials certification**
- [ ] **A penetration test** before real client matters go anywhere near it
- [ ] **A documented data retention / deletion policy**, and the deletion
      logic actually built (right now `ON DELETE CASCADE` deletes
      permanently — real retention rules may require soft-deletion /
      archiving instead)
- [ ] Sign-off from your COLP / a compliance advisor, same as flagged for
      the Report on Title template

None of this is unusual or specific to this codebase — it's the standard
list for any system handling client data and money in a regulated
profession. Phase 1 gets the foundations right; this list is what turns
"the foundations are right" into "this is safe to actually use."
