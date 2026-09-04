const jwt = require("jsonwebtoken");

/**
 * Verifies the Bearer token on every request to a protected route and
 * attaches the authenticated user's id, firm, and role to req.user.
 * This is what makes "fee earner" and "supervisor" real, enforced
 * permissions instead of a display label the frontend trusts blindly.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      firmId: payload.firmId,
      role: payload.role,
      name: payload.name,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
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
