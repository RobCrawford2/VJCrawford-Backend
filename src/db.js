const { Pool, types } = require("pg");

// Return DATE columns as plain 'YYYY-MM-DD' text. By default pg turns them
// into JavaScript dates at the server's local midnight, which can shift them
// by a day when the server isn't on UTC and breaks <input type="date">.
types.setTypeParser(1082, (value) => value);

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
  // Work in UK time, so CURRENT_DATE and timestamps follow the firm's day
  // rather than UTC (the host's timezone).
  // JIT compilation is off: it only helps big analytical queries, and on
  // ours it added half a second or more to each request for no gain.
  options: "-c TimeZone=Europe/London -c jit=off",
  max: Number(process.env.PG_POOL_MAX) || 15,
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
