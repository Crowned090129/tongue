# Tonge — Employee Onboarding Guide

Welcome to the team. This document gives you a complete picture of how Tonge works — from the user's first click to the database and back.

---

## 1. What Tonge Is

Tonge is a language learning SaaS. Users choose a language to learn (target) and up to 3 languages they already know (reference). The app then provides:
- AI-generated reference content (grammar, vocabulary, dialogues, etc.)
- A live AI Coach (powered by Claude Sonnet)
- Spaced-repetition flashcards
- Streaks and progress tracking
- Subscription billing via Stripe

**Business model:** Freemium. Free users get 5 AI messages/day. Premium ($9/mo or $79/yr) is unlimited.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (via CDN, no build step) — single `public/index.html` (395KB) |
| Backend | Node.js + Express.js |
| Database | PostgreSQL via Supabase |
| AI | Anthropic Claude (claude-sonnet-4-5) |
| Payments | Stripe (restricted key) |
| Email | Resend |
| Hosting | Fly.io (Docker) |
| Auth | JWT + access code system (no OAuth, no password) |

There is **no build step** for the frontend. `index.html` is served as a static file by Express. React and Babel are loaded from CDN. This keeps deployment simple but means the file is large.

---

## 3. Repository Structure

```
french-app/
├── server.js           # Entry point — validates env, starts HTTP server, runs cron
├── app.js              # Express app — mounts all routes, serves static files
├── db.js               # PostgreSQL pool, schema init, helper functions
├── routes/
│   ├── auth.js         # /api/auth/* — signup, login, validate, onboarding
│   ├── claude.js       # /api/claude — AI Coach endpoint
│   ├── content.js      # /api/content/* — pre-generated language content
│   ├── stripe.js       # /api/stripe/* — checkout, webhook, billing portal
│   ├── streaks.js      # /api/streaks/* — streak tracking (paid only)
│   ├── admin.js        # /admin + /admin/api/* — admin panel (HTML + API)
│   └── push.js         # /api/push/* — web push notifications
├── utils/
│   └── email.js        # Resend email helper
├── scripts/
│   └── prewarm-content.js  # Bulk content generation script
├── public/
│   ├── index.html      # Entire frontend (React, all UI, all language data)
│   ├── admin-content.html  # Content management grid
│   ├── subscribe.html  # Public pricing/signup page
│   └── *.html          # FAQ, privacy, terms, 404
├── tests/
│   └── smoke.test.js   # 24 integration tests
├── Dockerfile
├── fly.toml
└── docs/               # This folder
```

---

## 4. How Authentication Works

Tonge uses a **code-based auth system** — no passwords for end users.

### Free users
1. User enters email → `POST /api/auth/signup`
2. Server upserts a `users` row (plan = "free")
3. Returns a JWT signed with `JWT_SECRET` (expires 90 days)
4. JWT stored in browser localStorage as `tonge_token`

### Paid users
1. Stripe webhook fires after payment → `POST /api/stripe/webhook`
2. Server creates a `users` row + an `access_codes` row (`TG-XXXXXXXX`)
3. Access code emailed to user via Resend
4. User enters code → `POST /api/auth/login`
5. Server validates code, rotates `session_nonce`, returns JWT (expires 30 days)

### JWT validation
Every protected route calls `requireAuth` middleware which:
1. Extracts Bearer token from `Authorization` header
2. Verifies signature with `JWT_SECRET`
3. For paid routes: also calls `requirePaid` which queries DB to confirm the subscription is still active (JWT alone is not enough — prevents access after cancellation)

### Nonce rotation (security)
Access codes have a `session_nonce` field. On every login, a new nonce is generated. The JWT carries the nonce. On validate, the server checks `session_nonce` OR `session_nonce_2` (supports 2 concurrent devices). If neither matches, the session is rejected (means the code was used to log in on another device).

---

## 5. How AI Content Works

There are two types of AI content:

### Pre-generated content (cached)
Grammar, vocabulary, dialogues, structures, and cheatsheets for all 11 languages are generated once and stored in the `content_cache` table.

**Flow:**
1. User requests content → `GET /api/content/:lang/:tab`
2. Server checks `content_cache` for existing row
3. If found: return cached content immediately
4. If not found: call Anthropic API with a structured prompt → validate response (e.g., check for Chinese characters in Chinese content) → store in DB → return to user

**Retry logic:** 3 attempts with increasing temperature. If all fail, returns an error.

**Pre-warming:** Run `node scripts/prewarm-content.js` to generate all 55 content items upfront. Use `--force` to regenerate everything.

### Live AI Coach
Each message → `POST /api/claude`:
1. Auth + rate limit check (5/day free, unlimited paid)
2. Forward prompt + language to Anthropic API (max 2000 tokens)
3. Language-specific system prompt is injected server-side
4. Response returned directly to client

---

## 6. How Payments Work

### Checkout flow
1. User clicks Upgrade → `POST /api/stripe/create-checkout`
2. Server creates a Stripe Checkout Session with the correct Price ID
3. User redirected to Stripe-hosted payment page
4. On success: Stripe fires `checkout.session.completed` webhook
5. Webhook handler (`routes/stripe.js`) creates/updates user + generates access code + sends email

### Webhook events handled
- `checkout.session.completed` — new subscription created
- `invoice.payment_succeeded` — renewal (extends access code expiry)
- `customer.subscription.deleted` — cancellation (deactivates access code)

### Stripe keys
The app uses a **restricted key** (`rk_live_...`) not a full secret key. This is intentional — it limits blast radius if the key is ever exposed.

### Billing portal
`GET /api/stripe/portal` — redirects the user to Stripe's hosted billing portal where they can cancel, update payment method, or download invoices.

---

## 7. Database Schema

Key tables:

**`users`** — one row per user. Fields: `email`, `plan` (free/monthly/yearly), `status` (active/cancelled/deleted), `stripe_customer_id`, `onboarding_completed`, `user_level`, `user_goal`, `daily_commitment`.

**`access_codes`** — one row per paid subscription period. Fields: `code` (TG-XXXXXXXX), `user_id`, `plan`, `is_active`, `expires_at`, `session_nonce`, `session_nonce_2`.

**`content_cache`** — stores pre-generated AI content. Fields: `lang`, `tab`, `content` (JSON), `generated_at`.

**`rate_limits`** — IP-based and user-based rate limit counters. Shared across all servers via DB (survives restarts).

**`ai_usage_logs`** — every AI call logged with `user_id`, `feature_type`, `tokens_used`, `cost_usd`, `lang`.

**`streaks`** — one row per user. `current_streak`, `longest_streak`, `last_activity_date`.

**`analytics_events`** — generic event log. `user_id`, `event_name`, `properties` (JSON).

---

## 8. Running Locally

```bash
cd french-app
npm install
# Copy .env and fill in values (DATABASE_URL, JWT_SECRET, etc.)
node server.js
# App runs at http://localhost:3001
```

**Run tests:**
```bash
npm test
# 24 smoke tests — requires live DATABASE_URL
```

**Pre-warm content:**
```bash
npm run prewarm        # generate missing items only
npm run prewarm:force  # regenerate everything
```

---

## 9. Deployment

The app runs on Fly.io using Docker.

```bash
# Deploy
flyctl deploy --app tonge-app

# View logs
flyctl logs --app tonge-app

# Set/update environment variable
flyctl secrets set KEY=value --app tonge-app

# SSH into running machine
flyctl ssh console --app tonge-app

# Scale machines
fly scale count 2 --app tonge-app
```

**fly.toml** controls: Dockerfile build, internal port (3001), health check path (`/health`), auto-stop/start behaviour.

**Health check:** `GET /health` returns `{"status":"ok","db":"ok","ts":"..."}`. If `db` is not "ok", the database connection is broken.

---

## 10. Key External Services

| Service | Purpose | Dashboard |
|---|---|---|
| Supabase | PostgreSQL database | supabase.com |
| Anthropic | Claude AI API | console.anthropic.com |
| Stripe | Payments + billing | dashboard.stripe.com |
| Resend | Transactional email | resend.com |
| Fly.io | App hosting | fly.io/apps/tonge-app |

---

## 11. Security Notes

- **Never commit `.env`** — it contains live production keys
- **JWT_SECRET** — if this leaks, all user sessions can be forged. Rotate immediately if compromised: `flyctl secrets set JWT_SECRET=<new-value>` (all users will be logged out)
- **Admin password** — stored in `ADMIN_PASSWORD` env var. The admin panel is the most powerful surface — keep the password strong and private
- **Stripe restricted key** — if compromised, revoke in Stripe dashboard and generate a new one. The restricted key can only create checkout sessions and read prices — it cannot issue refunds or access customer data
- **Rate limiting** — all auth endpoints are rate limited at the DB level. Login: 10 attempts/15min/IP. Signup: 5/hour/IP. AI: 5/day (free), unlimited (paid)
- **Input validation** — all user input is validated and sanitised before reaching the DB. Prompts sent to Anthropic are capped at 6000 characters

---

## 12. Operational Runbook

### App is down / not responding
1. Check `https://tonge-app.fly.dev/health`
2. If no response: `flyctl status --app tonge-app`
3. If machines stopped: `flyctl deploy --app tonge-app`
4. Check Fly.io billing — machines stop if account balance runs out

### Database connection errors
1. Check Supabase dashboard — is the project paused? (Free tier pauses after 1 week of inactivity)
2. If paused: click Resume in Supabase dashboard
3. Check `DATABASE_URL` is set correctly in Fly secrets

### Anthropic API errors / content not loading
1. Check credits at console.anthropic.com — add credits if balance is zero
2. Check API key is valid: `flyctl secrets list --app tonge-app`
3. AI content will fail silently and return an error to the user — the app does not crash

### Stripe webhook not firing
1. Check Stripe dashboard → Developers → Webhooks → check for failed deliveries
2. Confirm webhook URL is `https://tonge-app.fly.dev/api/stripe/webhook`
3. Confirm `STRIPE_WEBHOOK_SECRET` in Fly secrets matches the webhook signing secret in Stripe

### A user paid but didn't get their access code
1. Check Stripe — did payment succeed?
2. Check admin panel Users tab — was a code generated?
3. If not: generate one manually in the Generate tab
4. If code exists: use the Email button to resend it

---

## 13. Codebase Conventions

- **No TypeScript** — plain JavaScript throughout
- **No ORM** — raw SQL via `db.get()`, `db.all()`, `db.run()` helpers in `db.js`
- **No frontend build** — React via CDN, JSX transpiled in-browser by Babel
- **Error handling** — async errors are caught at route level, logged, and return a JSON error to the client. The server never crashes on a user request
- **Environment** — `NODE_ENV=production` in prod, `NODE_ENV=test` for tests. Never use `dotenv({ override: true })` — it breaks test isolation
- **Tests** — `node --test tests/smoke.test.js`. Tests hit the live Supabase DB. They clean up after themselves. Always run tests before deploying a significant change
