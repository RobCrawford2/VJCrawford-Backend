require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { pool } = require("./db");
const { runMigrations } = require("../scripts/migrate");
const { runSeed } = require("../scripts/seed");

const authRoutes = require("./routes/auth");
const matterRoutes = require("./routes/matters");
const userRoutes = require("./routes/users");
const settingsRoutes = require("./routes/settings");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean),
    credentials: true,
  })
);

// Basic request logging — swap for a real logger (pino/winston) before production.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/matters", matterRoutes);
app.use("/users", userRoutes);
app.use("/settings", settingsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Centralised error handler — every asyncHandler-wrapped route funnels here
// on failure, so error responses are consistent and stack traces never leak
// to the client.
app.use((err, req, res, next) => {
  console.error(err);

  if (err.code === "23505") {
    // Postgres unique_violation
    return res.status(409).json({ error: "That record already exists." });
  }
  if (err.code === "23503") {
    // Postgres foreign_key_violation
    return res.status(400).json({ error: "That references something that doesn't exist." });
  }

  res.status(500).json({ error: "Something went wrong on our end." });
});

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
// that don't offer a shell to run `npm run seed` by hand. Unset it again
// after the first successful run.
app.listen(PORT, () => {
  console.log(`V J Crawford Conveyancing API listening on port ${PORT}`);

  (async () => {
    try {
      await runMigrations(pool);
      if (process.env.SEED_ON_BOOT === "true") {
        console.log("[boot] SEED_ON_BOOT is true — seeding demo data...");
        await runSeed(pool);
      }
    } catch (err) {
      console.error("[boot] Setup on boot failed:", err.message);
    }
  })();
});
