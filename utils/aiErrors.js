/**
 * utils/aiErrors.js — one error contract for every AI-backed route.
 *
 * Failures are answered with a real HTTP status and the body
 *   { code, error, message, retryable }
 * (`error` repeats `message` for clients that predate `code`). Clients show one
 * honest message per code. "Check your connection" is only ever true when the
 * browser's own fetch fails, never for a provider-side problem.
 */

const UNAVAILABLE = "The AI tutor is unavailable right now. Lessons, review and the library still work.";

const AI_ERRORS = {
  ai_unconfigured:        { status: 503, retryable: false, message: UNAVAILABLE },
  ai_unavailable_credits: { status: 503, retryable: false, message: UNAVAILABLE },
  ai_overloaded:          { status: 503, retryable: true,  message: "The AI tutor is busy right now. Try again in a minute." },
  ai_timeout:             { status: 503, retryable: true,  message: "The AI tutor took too long to answer. Try again." },
  ai_unreachable:         { status: 503, retryable: true,  message: "Tongue couldn't reach the AI tutor. Try again in a minute." },
  ai_bad_output:          { status: 502, retryable: true,  message: "The AI tutor sent an answer Tongue couldn't read. Try again." },
  ai_upstream_error:      { status: 502, retryable: false, message: "The AI tutor couldn't handle that request." },
};

class AiError extends Error {
  constructor(code, detail) {
    const known = Object.prototype.hasOwnProperty.call(AI_ERRORS, code) ? code : "ai_upstream_error";
    super(detail ? `${known}: ${detail}` : known);
    this.name = "AiError";
    this.code = known;
  }
}

// Map a non-OK provider response (status + raw body text) to a code.
function classifyUpstream(status, bodyText = "") {
  const body = String(bodyText);
  if (/credit balance|purchase credits|billing|insufficient[^"]{0,20}credit/i.test(body)) return "ai_unavailable_credits";
  if (status === 402) return "ai_unavailable_credits";
  if (status === 401 || status === 403) return "ai_unconfigured";
  if (status === 408) return "ai_timeout";
  if (status === 429 || status === 529 || status >= 500) return "ai_overloaded";
  return "ai_upstream_error";
}

// Map an error thrown by fetch itself (DNS, reset, abort, timeout) to a code.
function classifyFetchFailure(err) {
  const name = err && err.name;
  if (name === "TimeoutError" || name === "AbortError") return "ai_timeout";
  return "ai_unreachable";
}

function aiErrorBody(code) {
  const known = Object.prototype.hasOwnProperty.call(AI_ERRORS, code) ? code : "ai_upstream_error";
  const def = AI_ERRORS[known];
  return { code: known, error: def.message, message: def.message, retryable: def.retryable };
}

function sendAiError(res, code) {
  const body = aiErrorBody(code);
  const def = AI_ERRORS[body.code];
  if (def.status === 503) res.setHeader("Retry-After", def.retryable ? "60" : "3600");
  return res.status(def.status).json(body);
}

module.exports = { AI_ERRORS, AiError, classifyUpstream, classifyFetchFailure, aiErrorBody, sendAiError };
