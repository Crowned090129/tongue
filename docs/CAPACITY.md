# Capacity and unit economics — 2026-09-19

The owner's stated target is millions of **registered accounts, monthly actives
and simultaneous users**. This document measures what exists against that, so
the target can be costed instead of asserted. Every throughput number below was
measured; every cost number is an estimate with its assumptions stated.

## What was measured

Local preview (`127.0.0.1:3003`, production-built client, local PostgreSQL 14,
Apple Silicon). **Never run against production.**

| Endpoint | Concurrency | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| `/health` | 50 | 10,622 req/s | 4.4 ms | 6.7 ms | 10.0 ms | 0 |
| `/api/auth/validate` | 50 | 2,533 req/s | 18.5 ms | 25.2 ms | 39.2 ms | 0 |
| `/api/auth/validate` | 200 | 2,756 req/s | 72.7 ms | 79.8 ms | 86.4 ms | **214** |
| `/app` (built HTML) | 50 | 7,964 req/s | 5.7 ms | 8.8 ms | 15.0 ms | 0 |

**The authenticated path saturates at roughly 2,500 req/s per process and starts
failing at 200 concurrent requests.** Throughput does not improve from 50 → 200
concurrency; only latency and errors do. The limit is the connection pool
(`db.js`: `max: 20`, `connectionTimeoutMillis: 5000`), not CPU.

This is a fast laptop with a local database. A Fly `shared-cpu-1x` machine with a
network round trip to Postgres will be materially slower. Treat 2,500 req/s as an
optimistic per-process ceiling, not a production figure.

Note that session revocation (added this release) costs one indexed `users`
lookup per authenticated request, plus one `access_codes` lookup for code
sessions. That is the correct trade for closing the revocation hole, but it does
mean authenticated traffic is now database-bound rather than free.

## What "millions" costs

### AI is the binding constraint, and it binds long before infrastructure does

`routes/claude.js` uses `claude-sonnet-4-5` with `max_tokens` capped at 2000
(default 1000). Quotas: **free 5 messages/day, paid 300 messages/day.**

**Corrected 2026-09-19 after measuring the actual requests.** An earlier draft
of this document claimed the AI path resends whole conversations uncached and
logs no token usage. Both were wrong, and the caching recommendation that
followed from them was wrong too. What is actually true:

- `POST /api/claude` (one-shot generation) sends **one** user message, capped at
  6,000 characters, plus a system prompt. No history is resent.
- `POST /api/claude/chat` (the conversational Coach) **does** resend history —
  up to 20 turns of up to 2,000 characters each, so roughly 10,000 tokens at the
  cap — with `max_tokens: 400`.
- Token usage **is already recorded.** `logUsage()` writes real
  `usage.input_tokens` / `usage.output_tokens` per call into `ai_usage_logs`.
  Its `estimated_cost` column, however, is hardcoded at $3/$15 per MTok, which
  is not necessarily the deployed model's rate — treat the token columns as
  measured and the cost column as an assumption.
- Measured system prompt sizes: **236 tokens** (one-shot) and **335 tokens**
  (chat). Both are **below the minimum cacheable prefix** (512–4096 tokens,
  model-dependent), so caching the system prompt **cannot engage at all**.
  Caching could only help the chat path once a conversation's history is long
  enough to clear that floor, and only within the cache TTL. That is a real but
  much narrower win than first claimed, and it is unverifiable here without
  spending live provider budget.

Estimating with current-generation Claude Sonnet 5 rates ($2/M input, $10/M
output) — the deployed model is a previous generation and its rate should be
confirmed before these numbers are used for planning:

| Per message | Input | Output | Cost |
|---|---|---|---|
| Light (800 in / 300 out) | $0.0016 | $0.0030 | **$0.0046** |
| Typical (1,500 in / 500 out) | $0.0030 | $0.0050 | **$0.0080** |
| Heavy (3,000 in / 1,000 out) | $0.0060 | $0.0100 | **$0.0160** |

At the typical figure and ~$9/month revenue:

- **Break-even is about 37 messages/day.** The paid cap is **300/day — roughly
  8× break-even.** One power user on the advertised allowance costs ~$72/month
  against $9 of revenue, before Fly, Postgres or Stripe fees.
- **A free user costs about $1.20/month** (5/day × 30) and returns nothing.

Applied to the stated targets:

| Target | AI cost/month | Revenue | Gap |
|---|---|---|---|
| 1M registered, 10% using the free allowance | ~$120k | $0 | −$120k |
| 1M monthly active, all free | ~$1.2M | $0 | −$1.2M |
| 1M monthly active, 3% converting at $9 | ~$1.2M | ~$270k | **−$930k** |

**No infrastructure decision changes this.** The product loses money per active
user at the current allowances, and scale multiplies the loss rather than
amortising it. This is true at 100 users as much as at a million — it is simply
survivable at 100.

### Infrastructure, if the economics were fixed

1M simultaneous users at one request per 10 seconds is ~100,000 req/s. Against a
measured 2,500 req/s per process (optimistic), that is 40+ app processes at best
and several hundred realistically, each holding up to 20 database connections —
800 to 6,600 connections against a single Postgres that comfortably serves a few
hundred. Today there are 2 machines and one database.

Reaching that needs, in order: a connection pooler (PgBouncer) so app count and
connection count stop being the same number; read replicas for content; a CDN
for the hashed assets (already immutable-cached, so this is cheap); and moving
rate limiting off the database, since `checkIpRateLimit` currently performs a
write per limited request. None of this is exotic. None of it is built.

## Recommended order — cheapest and most certain first

1. **Read `ai_usage_logs`.** The real per-message token counts are already
   sitting in production. Querying that table replaces every estimate below with
   a measurement, and costs nothing. Do this before changing any allowance.
   (Correct the hardcoded $3/$15 rate in `logUsage()` to the deployed model's
   actual rate at the same time, or recompute cost from the token columns.)
2. **Set the paid allowance near break-even** (order of 50/day, not 300), or
   raise the price. 300/day is not a limit; it is an invitation to lose $72.
3. **Reconsider the free allowance.** 5 messages/day × zero revenue is the entire
   cost of the "millions registered" scenario.
4. **Model choice is a real lever but it is the owner's call** — Sonnet 5 is
   $2/$10 and Haiku 4.5 is $1/$5 against the older Sonnet currently deployed.
   Changing it trades quality for cost and should be measured on real prompts,
   not assumed.
5. **Only then** PgBouncer, replicas and horizontal scale — and only against a
   measured workload, not a target number.

Prompt caching is **not** on this list. Measurement showed the system prompts
are too small to cache, and the only candidate — a long Coach conversation — is
both narrow and untestable without live provider spend.

## The honest summary

The current build cannot serve millions of anything, and the reason is not the
code — it is that each active learner costs more than they pay. Fixing throughput
before fixing unit economics would buy the ability to lose money faster.

There is also no evidence yet that anyone wants this product: production logs
show no authentication activity at all since the last deploy. Spending on
capacity before demand exists would be the expensive version of this mistake.

Numbers that remain unknown because they need the owner or production access:
registered vs active user counts (the production database read was blocked),
the real subscription price, and any infrastructure budget. Per-message token
usage is **not** unknown — it is in `ai_usage_logs` and only needs to be read.

**Next measurement worth making:** run `scripts/ai-usage.js`, which reads the
token counts already recorded in `ai_usage_logs` and reports cost per message,
cost per learner, and — the figure that should set the daily cap — how many
messages the heaviest learners actually send in a day:

```sh
fly ssh console -a tongue-app -C "node /app/scripts/ai-usage.js"
```

It recomputes cost from the token columns at a rate you pass in, and prints the
rate used. It deliberately ignores the stored `estimated_cost` column, which was
written with a hardcoded $3/$15 that may not be the deployed model's price.
