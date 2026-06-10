# Tonge — Production Deployment Guide
## Stack: Fly.io (Node.js) + Supabase (PostgreSQL) + Cloudflare (CDN)

---

## Step 1 — Create Supabase Database (free tier → scales to millions)

1. Go to **https://supabase.com** → New project
2. Choose a name (e.g. `tonge-prod`), set a strong password, pick a region
3. Once created: **Settings → Database → Connection string → URI**
4. Copy the connection string — looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```
5. Save this as `DATABASE_URL`

> The schema is created automatically on first server start via `db.initialize()`.

---

## Step 2 — Install Fly CLI and deploy

```bash
# Install Fly CLI (macOS)
brew install flyctl

# Login
fly auth login

# Create the app (from inside the french-app directory)
cd /Users/coronado/Downloads/french-app
fly launch --no-deploy   # reads fly.toml, creates the app on Fly
```

---

## Step 3 — Set all environment secrets on Fly

Run these one by one (copy values from your .env file):

```bash
fly secrets set DATABASE_URL="postgresql://postgres:..."
fly secrets set ANTHROPIC_API_KEY="sk-ant-api03-..."
fly secrets set JWT_SECRET="601e578f..."
fly secrets set ADMIN_PASSWORD="FrenchApp$2026!"
fly secrets set STRIPE_SECRET_KEY="sk_live_..."
fly secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
fly secrets set STRIPE_PRICE_MONTHLY="price_..."
fly secrets set STRIPE_PRICE_YEARLY="price_..."
fly secrets set RESEND_API_KEY="re_..."
fly secrets set EMAIL_FROM="noreply@yourdomain.com"
fly secrets set EMAIL_FROM_NAME="Tonge"
fly secrets set APP_URL="https://tonge-app.fly.dev"
fly secrets set NODE_ENV="production"
```

---

## Step 4 — Deploy

```bash
fly deploy
```

This builds the Docker image, pushes it, and starts the server. Takes ~2 minutes.

Check logs:
```bash
fly logs
```

Your app is live at: **https://tonge-app.fly.dev**

---

## Step 5 — Configure Stripe webhooks

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://tonge-app.fly.dev/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing secret** → update `fly secrets set STRIPE_WEBHOOK_SECRET="whsec_..."`

---

## Step 6 — Set up custom domain (optional but recommended)

```bash
fly certs add yourdomain.com
fly certs add www.yourdomain.com
```

Then in your DNS provider, add CNAME:
```
yourdomain.com  →  tonge-app.fly.dev
```

Update `APP_URL`:
```bash
fly secrets set APP_URL="https://yourdomain.com"
```

---

## Scaling

**Current config (fly.toml):** 1 shared-CPU machine, 512MB RAM  
This handles ~1,000–5,000 concurrent users easily.

**To scale horizontally (for 300k users):**

```bash
# Add machines (each handles ~5,000 concurrent)
fly scale count 6   # 6 machines = 30,000 concurrent users covered

# Scale up machine size
fly scale vm performance-1x  # dedicated CPU, 2GB RAM
```

**Database at scale:**
- Supabase Free: 500MB, 2 projects (fine up to ~10k users)
- Supabase Pro ($25/mo): 8GB, unlimited connections, PITR backups
- Supabase $599/mo plan handles millions of rows

**CDN (free with Cloudflare):**
Put Cloudflare in front of your domain:
1. Sign up at cloudflare.com → Add site
2. Change nameservers to Cloudflare
3. Enable "Proxied" mode on your DNS A/CNAME record
4. This gives you: DDoS protection, global CDN, free SSL, ~30% faster globally

---

## Monitoring

**Health check:**
```bash
curl https://tonge-app.fly.dev/health
# → {"status":"ok","ts":"2026-05-26T..."}
```

**App logs:**
```bash
fly logs --app tonge-app
```

**Database dashboard:**
Supabase Dashboard → Table Editor → view users, subscriptions, content_cache

---

## Free Tier vs Paid Tier Summary

| Feature | Free | Paid ($9/mo) |
|---------|------|--------------|
| All 11 languages | ✓ | ✓ |
| Grammar & reference guides | ✓ | ✓ |
| AI Coach | 5/day | Unlimited |
| Drills & Dialogues | ✗ | ✓ |
| Streaks (server-synced) | ✗ | ✓ |
| Flashcard sync | ✗ | ✓ |
| Priority AI | ✗ | ✓ |

Free users upgrade naturally when they run out of AI messages.
Conversion rate target: 3–5% (industry standard for freemium).
