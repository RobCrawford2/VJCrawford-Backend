const bcrypt = require("bcryptjs");

/**
 * bcrypt work factor. 10 is the widely used standard; 12 made each login
 * take 1–3 seconds on a small hosting plan. Older, stronger hashes still
 * work and are re-hashed at the new cost on the next successful login.
 */
const BCRYPT_COST = 10;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);

/** True if a stored hash used a different cost and should be re-hashed. */
const needsRehash = (hash) => {
  try { return bcrypt.getRounds(hash) !== BCRYPT_COST; } catch { return false; }
};

module.exports = { hashPassword, needsRehash, BCRYPT_COST };
