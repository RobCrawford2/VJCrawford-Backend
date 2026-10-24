/**
 * Conflict-of-interest search: finds existing clients and other parties
 * whose names look like the names being checked.
 *
 * Matching is deliberately generous (it's a prompt for a human to review,
 * not a verdict): titles, initials and company suffixes are ignored, and a
 * name matches when its last significant word (usually the surname or main
 * company word) appears and at least half the words do.
 *
 * Matters the person checking can't see are reported by department only —
 * "possible match in Family" — so a conveyancer can't read a family file
 * by running a check.
 */
const { AREA_BY_KEY } = require("../config/areas");
const { matterVisibilityClause } = require("./permissions");

const IGNORE = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "sir", "the", "and", "of", "ltd", "limited", "plc", "llp", "lp", "co",
  "company", "inc", "group", "holdings", "uk", "estate", "late", "deceased",
]);

function nameWords(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length >= 2 && !IGNORE.has(w));
}

/** 0–1: how well `candidate` matches `query`; 0 unless the query's last word is present. */
function nameScore(query, candidate) {
  const q = nameWords(query);
  if (!q.length) return 0;
  const c = new Set(nameWords(candidate));
  if (!c.has(q[q.length - 1])) return 0;
  return q.filter((w) => c.has(w)).length / q.length;
}

const MATCH_THRESHOLD = 0.5;

/**
 * Runs the check for a list of names. Returns one entry per name:
 *   { name, matches: [{ kind: 'client'|'party', name, role?, clientId?, matters: [...] }] }
 * where each matter is either { id, reference, address, department, departmentName, type }
 * or, if the user can't see it, { hidden: true, department, departmentName }.
 */
async function conflictCheck(db, user, names, { excludeMatterId = null, excludeClientIds = [] } = {}) {
  const skipClients = new Set(excludeClientIds);
  const wanted = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
  const words = [...new Set(wanted.flatMap(nameWords))];
  if (!words.length) return wanted.map((name) => ({ name, matches: [] }));
  const patterns = words.map((w) => `%${w}%`);

  const [clients, parties] = await Promise.all([
    db.query(
      `SELECT c.id, c.name, m.id AS matter_id, m.reference, m.address, m.department, m.type
       FROM clients c
       LEFT JOIN matter_clients mc ON mc.client_id = c.id
       LEFT JOIN matters m ON m.id = mc.matter_id
       WHERE c.firm_id = $1 AND c.name ILIKE ANY($2::text[])`,
      [user.firmId, patterns]
    ),
    db.query(
      `SELECT p.id, p.name, p.role, m.id AS matter_id, m.reference, m.address, m.department, m.type
       FROM matter_parties p JOIN matters m ON m.id = p.matter_id
       WHERE m.firm_id = $1 AND p.name ILIKE ANY($2::text[])`,
      [user.firmId, patterns]
    ),
  ]);

  // Which of the matched matters can this user see? (Only those, not the whole firm's.)
  const matchedIds = [...new Set([...clients.rows, ...parties.rows].map((r) => r.matter_id).filter(Boolean))];
  const visible = new Set();
  if (matchedIds.length) {
    const v = matterVisibilityClause(user, 3);
    const r = await db.query(`SELECT m.id FROM matters m WHERE m.firm_id = $1 AND m.id = ANY($2::uuid[]) ${v.clause}`, [user.firmId, matchedIds, ...v.params]);
    for (const row of r.rows) visible.add(row.id);
  }

  const describeMatter = (row) => {
    const departmentName = AREA_BY_KEY[row.department]?.name || row.department;
    return visible.has(row.matter_id)
      ? { id: row.matter_id, reference: row.reference, address: row.address, type: row.type, department: row.department, departmentName }
      : { hidden: true, department: row.department, departmentName };
  };

  return wanted.map((name) => {
    const matches = [];
    const byClient = new Map();
    for (const row of clients.rows) {
      if (skipClients.has(row.id) || nameScore(name, row.name) < MATCH_THRESHOLD) continue;
      if (row.matter_id && row.matter_id === excludeMatterId) continue;
      if (!byClient.has(row.id)) byClient.set(row.id, { kind: "client", clientId: row.id, name: row.name, matters: [] });
      if (row.matter_id) byClient.get(row.id).matters.push(describeMatter(row));
    }
    matches.push(...byClient.values());
    for (const row of parties.rows) {
      if (row.matter_id === excludeMatterId || nameScore(name, row.name) < MATCH_THRESHOLD) continue;
      const matter = describeMatter(row);
      // The role ("Child", "Respondent"…) says too much about a file the checker can't see.
      matches.push({ kind: "party", name: row.name, role: matter.hidden ? "Party" : row.role, matters: [matter] });
    }
    return { name, matches };
  });
}

/** Plain-English one-liner for the activity log. */
function summariseCheck(results) {
  const total = results.reduce((n, r) => n + r.matches.length, 0);
  const checked = results.map((r) => r.name).join(", ");
  return total
    ? `Conflict check on ${checked}: ${total} possible match${total === 1 ? "" : "es"}`
    : `Conflict check on ${checked}: no matches`;
}

const countMatches = (results) => results.reduce((n, r) => n + r.matches.length, 0);

module.exports = { conflictCheck, summariseCheck, countMatches, nameScore, nameWords };
