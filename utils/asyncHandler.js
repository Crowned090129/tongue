/**
 * utils/asyncHandler.js
 *
 * Express 4 ignores the promise an async route handler returns, so a rejected
 * `await` never reaches the error middleware: it becomes an unhandledRejection
 * and takes the whole process down. Wrap every async handler (and async
 * middleware) so rejections are passed to `next(err)` and answered by the
 * final error middleware in app.js.
 *
 *   router.get("/x", requireAuth, asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return function asyncRoute(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
