/**
 * Wraps an async route handler so any thrown error / rejected promise is
 * passed to Express's error handler instead of crashing the process or
 * leaving the request hanging.
 *
 * Usage: router.get('/', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
