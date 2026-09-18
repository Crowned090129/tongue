/**
 * tests/support/assertTestDatabase.js — hard guard for every database-using test.
 *
 * db.js calls this whenever NODE_ENV=test, so in test mode the only database the
 * app can ever open is TEST_DATABASE_URL, and only if it is a local database whose
 * name ends in "_test". DATABASE_URL (production, in .env) is never read by tests.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];

function assertTestDatabase(url = process.env.TEST_DATABASE_URL) {
  if (process.env.NODE_ENV !== "test") throw new Error("Refusing: NODE_ENV must be 'test'");
  if (!url) throw new Error("Refusing: TEST_DATABASE_URL is required (DATABASE_URL is ignored in tests)");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing: TEST_DATABASE_URL is not a valid URL");
  }
  const localHost = LOCAL_HOSTS.includes(parsed.hostname);
  const testName = parsed.pathname.slice(1).endsWith("_test");
  if (!localHost || !testName) {
    throw new Error(`Refusing to run tests against ${parsed.hostname}${parsed.pathname}`);
  }
  return url;
}

module.exports = { assertTestDatabase };
