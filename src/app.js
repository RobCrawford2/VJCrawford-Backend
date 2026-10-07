const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const matterRoutes = require("./routes/matters");
const userRoutes = require("./routes/users");
const settingsRoutes = require("./routes/settings");

const app = express();

// Render (and most hosts) put the app behind one proxy. Trusting that hop
// lets req.ip be the real client address, which the login rate limits
// depend on — otherwise every request looks like it came from the proxy.
app.set("trust proxy", 1);

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
  if (err.code === "22P02") {
    // Postgres invalid_text_representation — e.g. a malformed id in the URL
    return res.status(400).json({ error: "That doesn't look like a valid id or value." });
  }
  if (err.code === "23503") {
    // Postgres foreign_key_violation
    return res.status(400).json({ error: "That references something that doesn't exist." });
  }

  res.status(500).json({ error: "Something went wrong on our end." });
});

module.exports = app;
