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
 * Returns { clause, params } where `clause` is a SQL fragment starting
 * with "AND ..." ready to append to a query that already filters by
 * firm_id, and `params` are the positional parameters it references
 * (starting from $<startIndex>).
 */
function matterVisibilityClause(user, startIndex) {
  if (user.role === "admin") {
    return { clause: "", params: [] };
  }

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

module.exports = { matterVisibilityClause };
