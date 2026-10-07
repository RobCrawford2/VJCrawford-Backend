const rateLimit = require("express-rate-limit");

// Counts are held in memory, so they reset when the server restarts. That's
// fine for a single instance; move to a shared store (e.g. Redis) if the API
// is ever run as several instances behind a load balancer.

const WINDOW_MS = 15 * 60 * 1000;
const message = { error: "Too many attempts. Please wait 15 minutes and try again." };

/**
 * Per-account lockout: 5 failed logins for one email address within 15
 * minutes blocks further attempts on that account, from anywhere. Successful
 * logins don't count, so a user who gets it right isn't penalised.
 */
const loginAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${String(req.body?.email || "").trim().toLowerCase()}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message,
});

/**
 * Per-IP limit on failed attempts at the unauthenticated auth endpoints, so
 * one source can't spray guesses across many accounts. Only failures count,
 * so a whole office logging in from one shared address isn't locked out.
 */
const authIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message,
});

module.exports = { loginAccountLimiter, authIpLimiter };
