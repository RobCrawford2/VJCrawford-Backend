const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in your Postgres connection string."
  );
}

/**
 * pg currently treats sslmode=prefer/require/verify-ca in the URL as
 * verify-full, and logs a security warning on every boot saying that will
 * change. Spelling out verify-full keeps today's (stricter) behaviour and
 * silences the warning.
 */
function normalizeConnectionString(url) {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/, "$1verify-full");
}

const pool = new Pool({
  connectionString: normalizeConnectionString(process.env.DATABASE_URL),
  // Most managed Postgres providers (Render, Railway, RDS, etc.) require SSL
  // in production but not for a local Docker instance. Adjust as needed once
  // you know your hosting provider's requirements.
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  // A background client emitted an error (e.g. connection dropped). Log it
  // rather than crashing the whole server on a transient network blip.
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = {
  pool,
  normalizeConnectionString,
  /** Run a single query. Use pool.connect() directly instead for multi-statement transactions. */
  query: (text, params) => pool.query(text, params),
};
