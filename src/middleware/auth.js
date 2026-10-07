const jwt = require("jsonwebtoken");
const { query } = require("../db");

/**
 * Verifies the Bearer token on every request to a protected route and
 * attaches the authenticated user's id, firm, and role to req.user.
 * This is what makes "fee earner" and "supervisor" real, enforced
 * permissions instead of a display label the frontend trusts blindly.
 *
 * The token alone isn't trusted for who the user is *now*: the user row is
 * re-read on each request, so deactivating someone or changing their role
 * takes effect immediately rather than when their token expires.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
  }

  try {
    const result = await query(
      `SELECT id, firm_id, role, name, active FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: "Your account is no longer active. Please contact your administrator." });
    }
    req.user = { id: user.id, firmId: user.firm_id, role: user.role, name: user.name };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restricts a route to one or more roles, e.g. requireRole('admin') or
 * requireRole('admin', 'supervisor'). Must run after requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
