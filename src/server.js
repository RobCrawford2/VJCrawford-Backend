require("dotenv").config();

const app = require("./app");
const { pool } = require("./db");
const { runMigrations } = require("../scripts/migrate");
const { runSeed } = require("../scripts/seed");

const PORT = process.env.PORT || 4000;

// Start listening FIRST, then run setup in the background. This matters on
// hosts that kill the process if it doesn't bind a port quickly (Render's
// free tier does this) — running migrations before listen() risks a
// SIGTERM if they take more than a few seconds. Migrations are safe to run
// on every boot (each one only applies once, tracked in schema_migrations).
//
// Seeding is NOT safe to run on every boot — it wipes and recreates the
// demo firm each time, which would destroy real changes. It only runs if
// SEED_ON_BOOT=true is explicitly set, for hosts (like Render's free tier)
// that don't offer a shell to run `npm run seed` by hand, and also needs
// DEMO_PASSWORD set (10+ characters) so the internet-facing demo accounts
// don't use the well-known local default. Unset SEED_ON_BOOT again after the
// first successful run.
app.listen(PORT, () => {
  console.log(`V J Crawford Conveyancing API listening on port ${PORT}`);

  (async () => {
    try {
      await runMigrations(pool);
      app.locals.setup = { migrations: "ok" };
      if (process.env.SEED_ON_BOOT === "true") {
        // Boot seeding only happens on a deployed host, where the demo
        // accounts are reachable from the internet — so refuse the
        // well-known local default and require a real password.
        const password = process.env.DEMO_PASSWORD || "";
        if (password.length < 10) {
          console.error(
            "[boot] SEED_ON_BOOT is true but DEMO_PASSWORD is missing or under 10 characters — skipping seed."
          );
        } else {
          console.log("[boot] SEED_ON_BOOT is true — seeding demo data...");
          await runSeed(pool, { password });
        }
      }
    } catch (err) {
      console.error("[boot] Setup on boot failed:", err.message);
      if (app.locals.setup.migrations !== "ok") app.locals.setup = { migrations: "failed", error: err.message };
    }
  })();
});
