# V J Crawford Conveyancing — Frontend

This is the real, deployable version of the case management app — the same
interface built up in the prototype, now wired to the actual backend API
instead of browser-only artifact storage.

## What changed from the prototype

- Every `window.storage` call is gone, replaced with real API requests
  (`src/api.js`) to the backend.
- There's a real login screen (`src/Login.jsx`) — no more typing your name
  into Settings.
- The matter list is paginated and filtered **server-side** now, not just
  client-side over a locally-held array.
- Fee earner / supervisor are real user accounts (dropdowns), not free text.

## Known limitations of this pass — worth knowing before relying on it

- **The sidebar's "needs attention" icon can under-report.** The matter list
  endpoint returns summary rows for performance (it doesn't fetch every
  matter's documents/emails/enquiries/searches/undertakings/tasks — that
  would be slow at real caseload volume). So the icon can still catch
  date-based and stage-based issues (those live on the matter itself), but
  won't catch e.g. "an enquiry is outstanding" until you actually open that
  matter. A future backend enhancement would have the list endpoint return a
  precomputed attention flag per row to close this gap.
- **Outlook import is still a placeholder.** There's no backend endpoint for
  real Microsoft Graph integration yet (that's Phase 2) — clicking "Import
  from Outlook" shows an honest message rather than pretending to work.
- **The auth token is stored in `sessionStorage`.** This is better than
  `localStorage` (cleared when the tab closes) but still script-accessible.
  The properly secure approach is an httpOnly cookie set by the backend —
  worth doing before this handles real client data, not before.

## Running it locally

```bash
npm install
cp .env.example .env
# Edit .env — point VITE_API_URL at your running backend
# (http://localhost:4000 if you're running the backend locally too)

npm run dev
```

Opens at `http://localhost:5173`. Log in with a seeded demo account (see
the backend's `npm run seed` output) or whatever real account you've
created via `POST /auth/register`.

## Deploying to Netlify

1. Push this folder to a Git repository (or use Netlify's drag-and-drop
   deploy for a quick test — drag the `dist/` folder after running
   `npm run build` locally).
2. In Netlify: **Add new site → Import an existing project**, connect the
   repo.
3. Build settings are already set via `netlify.toml` — Netlify should
   detect `npm run build` and `dist` automatically.
4. **Before the first deploy**, add an environment variable in Netlify's
   site settings: `VITE_API_URL` = your deployed backend's URL (the Railway
   or Render URL from the backend README, including `https://`).
5. Deploy. Netlify gives you a URL immediately; add a custom domain
   afterward if you want `app.vjcrawfordconveyancing.co.uk` or similar.

## Connecting to the backend

The backend must be deployed and reachable first (see the backend
project's own README). Once you have its public URL:

- Set `VITE_API_URL` to that URL, both in your local `.env` and in
  Netlify's environment variables.
- Make sure the backend's `CORS_ORIGIN` environment variable includes this
  frontend's deployed URL, or the browser will block every request. This is
  a common first-deploy snag — if login fails with a network error but the
  backend's `/health` endpoint works fine in a browser tab, check CORS
  first.

## What's still local-only, not backend-persisted

A couple of Settings toggles (`outlookConnected`, `autoFile`) remain
client-side state rather than saved to the firm's account — they reset on
reload. This is intentional: they represent a Phase 2 feature (real Outlook
integration) that doesn't have backend support yet, so persisting a setting
for a feature that doesn't functionally exist would be misleading.
