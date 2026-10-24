/**
 * Builds the SQL WHERE fragment that enforces who can see which matters,
 * based on the authenticated user's role. This is deliberately enforced
 * here — server-side, on every query — rather than trusted to the
 * frontend, which only ever filters what it already received.
 *
 *   - admin:       every matter in their firm
 *   - supervisor:  their own matters, plus matters of anyone who reports to them
 *   - fee_earner:  only their own matters
 *   - secretary / assistant: the matters of the fee earner they work for
 *
 * On top of that, everyone except admins and staff marked "all departments"
 * only sees matters in the departments they've been given access to
 * (user.departments, loaded by loadUserAccess).
 *
 * Returns { clause, params } where `clause` is a SQL fragment starting
 * with "AND ..." ready to append to a query that already filters by
 * firm_id, and `params` are the positional parameters it references
 * (starting from $<startIndex>).
 */
function matterVisibilityClause(user, startIndex) {
  if (user.role === "admin") {
    return { clause: "", params: [] };
  }
  const role = roleClause(user, startIndex);
  if (user.allDepartments) return role;
  return {
    clause: `${role.clause} AND m.department = ANY($${startIndex + role.params.length}::text[])`,
    params: [...role.params, user.departments || []],
  };
}

function roleClause(user, startIndex) {

  if (user.role === "supervisor") {
    return {
      clause: `AND (
        m.fee_earner_id = $${startIndex}
        OR m.supervisor_id = $${startIndex}
        OR m.fee_earner_id IN (SELECT id FROM users WHERE supervisor_id = $${startIndex})
      )`,
      params: [user.id],
    };
  }

  if (user.role === "secretary" || user.role === "assistant") {
    // Support staff see the matters of the fee earner they work for
    // (their users.supervisor_id), plus any assigned to them directly.
    return {
      clause: `AND (
        m.fee_earner_id = $${startIndex}
        OR m.fee_earner_id = (SELECT supervisor_id FROM users WHERE id = $${startIndex})
      )`,
      params: [user.id],
    };
  }

  // Default: fee_earner — only their own matters.
  return {
    clause: `AND m.fee_earner_id = $${startIndex}`,
    params: [user.id],
  };
}

/**
 * Loads a user with what they're allowed to see: role, active flag and
 * departments. Re-read on every request (see requireAuth) so access changes
 * take effect immediately.
 */
async function loadUserAccess(db, userId, firmId = null) {
  const result = await db.query(
    `SELECT u.id, u.firm_id, u.role, u.name, u.active, u.all_departments,
            COALESCE(array_agg(d.department ORDER BY d.department) FILTER (WHERE d.department IS NOT NULL), '{}') AS departments
     FROM users u LEFT JOIN user_departments d ON d.user_id = u.id
     WHERE u.id = $1 ${firmId ? "AND u.firm_id = $2" : ""}
     GROUP BY u.id`,
    firmId ? [userId, firmId] : [userId]
  );
  const u = result.rows[0];
  if (!u) return null;
  return {
    id: u.id, firmId: u.firm_id, role: u.role, name: u.name, active: u.active,
    allDepartments: u.role === "admin" || u.all_departments, departments: u.departments,
  };
}

/** Whether the user may work in (open matters in, see) a department. */
const canUseDepartment = (user, department) => user.allDepartments || (user.departments || []).includes(department);

module.exports = { matterVisibilityClause, loadUserAccess, canUseDepartment };
