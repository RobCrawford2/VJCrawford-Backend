const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { loginAccountLimiter, authIpLimiter } = require("../middleware/rateLimit");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, firmId: user.firm_id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

/**
 * POST /auth/register
 * Creates a new firm and its first user (an admin). This is the "sign up
 * the firm" endpoint — subsequent staff are added via POST /users by an
 * existing admin, not through this route.
 *
 * Off unless ALLOW_REGISTRATION=true: this is a single-firm deployment, so
 * there's no reason to let anyone on the internet create firms on it. Turn
 * it on briefly if a fresh database ever needs its first firm.
 */
router.post(
  "/register",
  authIpLimiter,
  asyncHandler(async (req, res) => {
    if (process.env.ALLOW_REGISTRATION !== "true") {
      return res.status(403).json({ error: "New firm registration is disabled." });
    }
    const { firmName, name, email, password } = req.body;

    if (!firmName || !name || !email || !password) {
      return res.status(400).json({ error: "firmName, name, email and password are all required." });
    }
    if (password.length < 10) {
      return res.status(400).json({ error: "Password must be at least 10 characters." });
    }

    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const client = await require("../db").pool.connect();
    try {
      await client.query("BEGIN");

      const firmResult = await client.query(
        "INSERT INTO firms (name) VALUES ($1) RETURNING id, name",
        [firmName]
      );
      const firm = firmResult.rows[0];

      const passwordHash = await bcrypt.hash(password, 12);
      const userResult = await client.query(
        `INSERT INTO users (firm_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin')
         RETURNING id, firm_id, name, email, role`,
        [firm.id, name, email.toLowerCase(), passwordHash]
      );
      const user = userResult.rows[0];

      await client.query("COMMIT");

      const token = signToken(user);
      res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, firmId: firm.id, firmName: firm.name } });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

/**
 * POST /auth/login
 */
router.post(
  "/login",
  authIpLimiter,
  loginAccountLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await query(
      `SELECT u.id, u.firm_id, u.name, u.email, u.password_hash, u.role, u.active, f.name AS firm_name
       FROM users u JOIN firms f ON f.id = u.firm_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    // Deliberately vague error message on both "no such user" and "wrong
    // password" — distinguishing them lets an attacker enumerate valid emails.
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, firmId: user.firm_id, firmName: user.firm_name },
    });
  })
);

/**
 * GET /auth/me — lets the frontend verify a stored token is still valid
 * and re-fetch the current user's details on app load.
 */
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.firm_id, f.name AS firm_name, f.domain, f.stale_days
       FROM users u JOIN firms f ON f.id = u.firm_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found." });
    const u = result.rows[0];
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role, firmId: u.firm_id, firmName: u.firm_name, domain: u.domain, staleDays: u.stale_days });
  })
);

/**
 * POST /auth/change-password — lets the logged-in user change their own
 * password. A wrong current password returns 400, not 401: the frontend
 * treats any 401 as "session expired" and logs the user out.
 */
router.post(
  "/change-password",
  authIpLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are both required." });
    }
    if (newPassword.length < 10) {
      return res.status(400).json({ error: "New password must be at least 10 characters." });
    }

    const result = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found." });

    const ok = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: "Current password is incorrect." });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, req.user.id]);
    res.status(204).send();
  })
);

module.exports = router;
