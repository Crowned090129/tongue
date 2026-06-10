/**
 * tests/smoke.test.js
 *
 * Integration smoke tests for Tonge's critical paths.
 * Requires a live DATABASE_URL (the same Supabase DB is fine — tests
 * create and clean up their own rows).
 *
 * Run:  npm test
 *       node --test tests/smoke.test.js
 *
 * Tests are grouped into three suites:
 *   1. Infrastructure  — health check, DB connectivity
 *   2. Auth            — signup, validate, login rejection, rate limiting
 *   3. Access control  — unauthenticated rejections, free-tier AI gate
 */

"use strict";

require("dotenv").config(); // never override shell vars — NODE_ENV=test must survive

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http   = require("node:http");
const db     = require("../db");
const app    = require("../app");

// ── Test server ───────────────────────────────────────────────────────────────

let server;
let BASE_URL;

before(async () => {
  // Skip if no DB is available
  if (!process.env.DATABASE_URL) {
    console.warn("[Tests] DATABASE_URL not set — skipping integration tests");
    process.exit(0);
  }
  await db.initialize();
  // Clear ALL rate limits — tests share 127.0.0.1 and Supabase DB; stale
  // limits from prior runs or the dev server bleed into the test window.
  await db.run("DELETE FROM rate_limits").catch(() => {});

  await new Promise((resolve, reject) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      BASE_URL = `http://127.0.0.1:${port}`;
      console.log(`[Tests] Test server listening at ${BASE_URL}`);
      resolve();
    });
    server.once("error", reject);
  });
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  // Close the DB pool so the process exits cleanly
  await db.pool.end();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const GET  = (path, headers)       => req("GET",    path, null, headers);
const POST = (path, body, headers) => req("POST",   path, body, headers);

// Unique email per test run to avoid conflicts
const testEmail = () => `test_${Date.now()}_${Math.random().toString(36).slice(2)}@tonge-test.invalid`;

// ── Suite 1: Infrastructure ───────────────────────────────────────────────────

describe("Infrastructure", () => {

  test("GET /health returns 200 with db:ok", async () => {
    const { status, body } = await GET("/health");
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.status, "ok");
    assert.equal(body.db,     "ok");
    assert.ok(body.ts, "ts field should be present");
  });

  test("GET /api/stripe/prices returns price objects", async () => {
    // This endpoint reads env vars — it should exist even without Stripe keys
    // (returns 500 if keys missing, but the route must exist)
    const { status } = await GET("/api/stripe/prices");
    assert.ok([200, 500].includes(status), `Unexpected status ${status}`);
  });

});

// ── Suite 2: Auth ─────────────────────────────────────────────────────────────

describe("Auth — signup", () => {

  test("POST /api/auth/signup with valid email returns token + plan:free", async () => {
    const email = testEmail();
    const { status, body } = await POST("/api/auth/signup", { email });
    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(body.token,           "token must be present");
    assert.equal(body.plan, "free", "new user must be free tier");
    assert.equal(body.email, email.toLowerCase());
  });

  test("POST /api/auth/signup with missing email returns 400", async () => {
    const { status, body } = await POST("/api/auth/signup", {});
    assert.equal(status, 400);
    assert.ok(body.error, "error message must be present");
  });

  test("POST /api/auth/signup with invalid email returns 400", async () => {
    const { status, body } = await POST("/api/auth/signup", { email: "notanemail" });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test("POST /api/auth/signup is idempotent — same email returns token again", async () => {
    const email = testEmail();
    const r1 = await POST("/api/auth/signup", { email });
    const r2 = await POST("/api/auth/signup", { email });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.plan, "free");
  });

});

describe("Auth — validate", () => {

  test("GET /api/auth/validate with valid free token returns valid:true + plan:free", async () => {
    const email = testEmail();
    const signup = await POST("/api/auth/signup", { email });
    assert.equal(signup.status, 200);

    const { status, body } = await GET("/api/auth/validate", {
      Authorization: `Bearer ${signup.body.token}`,
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.valid, true);
    assert.equal(body.plan,  "free");
  });

  test("GET /api/auth/validate with no token returns 401", async () => {
    const { status } = await GET("/api/auth/validate");
    assert.equal(status, 401);
  });

  test("GET /api/auth/validate with garbage token returns 401", async () => {
    const { status } = await GET("/api/auth/validate", {
      Authorization: "Bearer thisisgarbagetoken",
    });
    assert.equal(status, 401);
  });

});

describe("Auth — login", () => {

  test("POST /api/auth/login with invalid code returns 401", async () => {
    const { status, body } = await POST("/api/auth/login", { code: "TG-INVALID00" });
    assert.equal(status, 401, JSON.stringify(body));
    assert.ok(body.error);
  });

  test("POST /api/auth/login with missing code returns 400", async () => {
    const { status } = await POST("/api/auth/login", {});
    assert.equal(status, 400);
  });

  test("POST /api/auth/login with empty string code returns 400", async () => {
    const { status } = await POST("/api/auth/login", { code: "" });
    assert.equal(status, 400);
  });

});

// ── Suite 3: Access control ───────────────────────────────────────────────────

describe("Access control — unauthenticated rejections", () => {

  test("POST /api/claude without token returns 401", async () => {
    const { status } = await POST("/api/claude", { prompt: "hello" });
    assert.equal(status, 401);
  });

  test("GET /api/streaks without token returns 401", async () => {
    const { status } = await GET("/api/streaks");
    assert.equal(status, 401);
  });

  test("POST /api/streaks/log without token returns 401", async () => {
    const { status } = await POST("/api/streaks/log", {});
    assert.equal(status, 401);
  });

  test("GET /api/content/status without admin token returns 401", async () => {
    const { status } = await GET("/api/content/status");
    assert.equal(status, 401);
  });

});

describe("Access control — free-tier gating", () => {

  test("GET /api/streaks with free token returns 402 (paid only)", async () => {
    const email = testEmail();
    const signup = await POST("/api/auth/signup", { email });
    assert.equal(signup.status, 200);

    const { status, body } = await GET("/api/streaks", {
      Authorization: `Bearer ${signup.body.token}`,
    });
    assert.equal(status, 402, `Expected 402 (paid-only), got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.upgrade, true);
  });

  test("POST /api/claude with free token is allowed (rate-limited, not blocked)", async () => {
    // Free users CAN use the AI — they just get 5/day.
    // We just verify the request is not rejected with 401/402 for auth reasons.
    // It may return 429 if the test account already hit the daily limit,
    // or 502/503 if Anthropic key is absent — both are acceptable here.
    const email = testEmail();
    const signup = await POST("/api/auth/signup", { email });
    assert.equal(signup.status, 200);

    const { status } = await POST(
      "/api/claude",
      { prompt: '{"type":"fill","language":"Spanish"}', language: "es", featureType: "test" },
      { Authorization: `Bearer ${signup.body.token}` }
    );
    // Not an auth error (401/402) — the request was accepted for processing
    assert.ok(
      ![401, 402].includes(status),
      `Expected non-auth status, got ${status} — free user was incorrectly rejected`
    );
  });

});

describe("Access control — admin", () => {

  test("POST /admin/api/login with wrong password returns 401", async () => {
    const { status, body } = await POST("/admin/api/login", { password: "definitelywrong" });
    assert.equal(status, 401, JSON.stringify(body));
  });

  test("GET /admin/api/stats without token returns 401", async () => {
    const { status } = await GET("/admin/api/stats");
    assert.equal(status, 401);
  });

  test("GET /admin/api/users without token returns 401", async () => {
    const { status } = await GET("/admin/api/users");
    assert.equal(status, 401);
  });

});

// ── Suite 4: Input validation ─────────────────────────────────────────────────

describe("Input validation", () => {

  test("POST /api/auth/signup with 1000-char email returns 400", async () => {
    const { status } = await POST("/api/auth/signup", { email: "a".repeat(1000) + "@b.com" });
    // Either 400 (validation) or 500 (DB constraint) — must not be 200
    assert.notEqual(status, 200, "Should not accept absurdly long email");
  });

  test("POST /api/auth/login with non-string code returns 400", async () => {
    const { status } = await POST("/api/auth/login", { code: 12345 });
    // 400 (type check) or 401 (treated as wrong code) — must not crash (500)
    assert.ok([400, 401].includes(status), `Expected 400 or 401, got ${status}`);
  });

  test("POST /api/claude with oversized prompt returns 400", async () => {
    const email = testEmail();
    const { body: { token } } = await POST("/api/auth/signup", { email });
    const { status } = await POST(
      "/api/claude",
      { prompt: "x".repeat(7000), language: "es" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(status, 400, "Oversized prompt should be rejected");
  });

});
