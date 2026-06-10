# Tonge — Deployment Checklist

Use this checklist every time you deploy to production (new machines, env changes, code updates).

---

## 1. Environment Variables

Set all of the following in Fly.io (`fly secrets set KEY=value`) or your hosting provider's dashboard.

### Required (app will refuse to start without these in production)
- [ ] `DATABASE_URL` — PostgreSQL connection string from Supabase
- [ ] `JWT_SECRET` — Min 64-char random string (generate: `openssl rand -hex 32`)
- [ ] `ANTHROPIC_API_KEY` — From console.anthropic.com
- [ ] `STRIPE_SECRET_KEY` — From Stripe Dashboard → Developers → API keys (use `sk_live_` in production)
- [ ] `STRIPE_WEBHOOK_SECRET` — From Stripe Dashboard → Webhooks → signing secret
- [ ] `ADMIN_PASSWORD` — Strong password for /admin

### Required for email delivery
- [ ] `RESEND_API_KEY` — From resend.com dashboard
- [ ] `EMAIL_FROM` — Verified sender email (e.g. noreply@tonge.app)
- [ ] `EMAIL_FROM_NAME` — Display name (e.g. Tonge)

### Required for correct URLs
- [ ] `APP_URL` — Full URL of production app (e.g. https://tonge-app.fly.dev)

### Recommended
- [ ] `FRONTEND_URL` — If frontend has a separate domain, add here for CORS
- [ ] `SUPPORT_EMAIL` — Shown on FAQ / error pages
- [ ] `STRIPE_PRICE_MONTHLY` — Stripe price ID for $9/month plan (price_...)
- [ ] `STRIPE_PRICE_YEARLY` — Stripe price ID for $79/year plan (price_...)

---

## 2. Stripe Setup

- [ ] Create product "Tonge Premium" in Stripe Dashboard → Products
- [ ] Create two prices: $9/month (recurring) and $79/year (recurring)
- [ ] Copy the price IDs to `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`
- [ ] Create a webhook endpoint in Stripe → Webhooks pointing to `https://your-domain/api/stripe/webhook`
- [ ] Subscribe to these events:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Copy the signing secret to `STRIPE_WEBHOOK_SECRET`
- [ ] Test the webhook with Stripe CLI: `stripe trigger checkout.session.completed`

---

## 3. Database (Supabase)

- [ ] Create a new Supabase project (or use existing)
- [ ] Copy the connection string (Settings → Database → URI)
- [ ] Set `DATABASE_URL` in production secrets
- [ ] On first deploy, the app will auto-initialize the schema (idempotent)
- [ ] Verify schema was created: check Supabase Table Editor for `users`, `access_codes`, `subscriptions`, `rate_limits`, `ai_usage_logs`, `analytics_events`, `stripe_events`
- [ ] Optionally enable Supabase row-level security for extra isolation

---

## 4. Domain & DNS

- [ ] Point your custom domain to Fly.io (add `CNAME` or `A` record)
- [ ] Run: `fly certs create yourdomain.com` to provision SSL
- [ ] Update `APP_URL` in secrets to use your custom domain
- [ ] Verify HTTPS works: `curl -I https://yourdomain.com/health`

---

## 5. Email Domain

- [ ] Add your sending domain in Resend (resend.com → Domains)
- [ ] Add the required DNS records (SPF, DKIM, DMARC)
- [ ] Wait for verification (usually < 5 minutes)
- [ ] Test: send a test email via Resend dashboard
- [ ] Update `EMAIL_FROM` to use your verified domain

---

## 6. Pre-Deploy Code Checks

- [ ] All tests pass (if any): `npm test`
- [ ] No `console.log` with sensitive data (API keys, passwords)
- [ ] `.env` is in `.gitignore` (never commit secrets)
- [ ] `Dockerfile` doesn't copy `.env` or `*.db` files
- [ ] `node --check server.js routes/*.js` passes (syntax check)

---

## 7. Deploy to Fly.io

```bash
# First deploy
fly launch          # creates fly.toml and provisions a VM
fly secrets set KEY=value ...   # set all env vars

# Every subsequent deploy
fly deploy          # builds Docker image and deploys

# Scale up for more traffic
fly scale count 2   # 2 machines = zero downtime rolling deploys
fly scale vm shared-cpu-2x  # more CPU per machine if needed

# Check logs
fly logs

# SSH into a running machine
fly ssh console
```

---

## 8. Post-Deploy Smoke Tests

Run these after every deploy to confirm the app is healthy:

```bash
BASE=https://your-domain.com

# Health check
curl $BASE/health
# Expected: {"status":"ok","db":"ok","ts":"..."}

# Login page loads
curl -s $BASE/ | grep -c "Tonge"
# Expected: ≥ 1

# Prices endpoint
curl $BASE/api/stripe/prices
# Expected: {"monthly":{"amount":900,...},"yearly":{"amount":7900,...}}

# Auth: invalid code returns 401
curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"code":"INVALID"}' | grep "error"

# Signup (free tier)
curl -s -X POST $BASE/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"smoketest@example.com"}' | grep "token"
```

---

## 9. Monitoring & Observability

- [ ] Set up Fly.io metrics dashboard (built in — fly.io/dashboard)
- [ ] Check `/health` returns 200 and `db: ok`
- [ ] Set up an uptime monitor (e.g. UptimeRobot, Better Uptime) pointing to `/health`
- [ ] Review `ai_usage_logs` weekly: `SELECT date_trunc('day', created_at), COUNT(*), SUM(estimated_cost) FROM ai_usage_logs GROUP BY 1 ORDER BY 1 DESC LIMIT 14;`
- [ ] Review `analytics_events` for conversion funnel:
  ```sql
  SELECT event_name, COUNT(*) FROM analytics_events
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY event_name ORDER BY count DESC;
  ```

---

## 10. Content Pre-Generation (one-time)

After first deploy, pre-generate all AI content so users don't wait:

1. Log in to `/admin` with your `ADMIN_PASSWORD`
2. Go to **Content Library** tab
3. Click **Generate** for each language (or use the API):

```bash
for lang in es pt it de en zh ja ko ru ar; do
  curl -s -X POST https://your-domain.com/api/content/regenerate/$lang \
    -H "x-admin-token: YOUR_ADMIN_TOKEN"
  sleep 10   # avoid rate limits between generations
done
```

This makes ~40 AI calls total (~$0.10) and caches everything forever.

---

## 11. Security Checklist

- [ ] HTTPS enforced (fly.toml `force_https = true`)
- [ ] `x-powered-by` header disabled ✓ (done in server.js)
- [ ] Helmet.js security headers enabled ✓ (done in server.js)
- [ ] CORS restricted to your domain ✓ (done in server.js)
- [ ] Body size limit set to 100kb ✓ (done in server.js)
- [ ] Rate limiting on AI endpoint ✓ (done in routes/claude.js)
- [ ] Stripe webhook signature verified ✓ (done in routes/stripe.js)
- [ ] Stripe event deduplication ✓ (done via stripe_events table)
- [ ] JWT signed and validated ✓ (done in routes/auth.js)
- [ ] Admin endpoint behind token auth ✓ (done in routes/admin.js)
- [ ] No API keys in frontend bundle ✓ (all calls go through server proxy)
- [ ] Input validation on all AI prompts ✓ (done in routes/claude.js)

---

## 12. Rollback Plan

If a deploy breaks something:

```bash
# Fly.io keeps the previous image — instant rollback
fly releases          # list releases
fly deploy --image registry.fly.io/tonge-app:v12  # redeploy previous image

# Or scale down to 0 and back up (last resort)
fly scale count 0
fly scale count 1
```

---

## Common Issues & Fixes

| Symptom | Likely Cause | Fix |
|---|---|---|
| `/health` returns `db: error` | DATABASE_URL wrong or Supabase offline | Check URL, check Supabase dashboard |
| Login returns 500 | JWT_SECRET missing | `fly secrets set JWT_SECRET=...` |
| Stripe webhook returns 400 | STRIPE_WEBHOOK_SECRET wrong | Recopy from Stripe Webhooks tab |
| Emails not sending | RESEND_API_KEY or domain not verified | Check Resend dashboard |
| AI returns 502 | ANTHROPIC_API_KEY missing/invalid | Check key in Anthropic console |
| App crashes on start | Missing required env var | Check `fly logs` for "Missing env var" |
| CORS errors in browser | APP_URL doesn't match your actual URL | Update `APP_URL` secret |

---

_Last updated: May 2026_
