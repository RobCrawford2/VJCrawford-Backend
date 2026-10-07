/**
 * A deliberately simple migration runner: applies every .sql file in
 * /migrations, in filename order, that hasn't been applied yet. Tracks
 * what's been applied in a schema_migrations table.
 *
 * This is fine for a small team. If the project grows a lot of migrations
 * or multiple developers writing them concurrently, swap this for
 * node-pg-migrate or Prisma Migrate — the SQL files themselves would carry
 * over largely unchanged.
 *
 * Exported as `runMigrations(pool)` so server.js can run this automatically
 * on boot (useful on hosts like Render's free tier that don't offer a
 * shell to run `npm run migrate` by hand) as well as being runnable
 * directly via `npm run migrate`.
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query(`SELECT filename FROM schema_migrations`);
  const appliedSet = new Set(applied.rows.map((r) => r.filename));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  let appliedCount = 0;

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[migrate] skip  ${file} (already applied)`);
      continue;
    }
    console.log(`[migrate] apply ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Failed applying ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] Migrations up to date (${appliedCount} newly applied).`);
  return appliedCount;
}

// CLI usage: `npm run migrate` — uses the shared pool, runs, then exits.
if (require.main === module) {
  require("dotenv").config();
  const { pool } = require("../src/db");
  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
