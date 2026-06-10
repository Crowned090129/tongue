# French Immersion — Full-Stack Setup

AI-powered French language learning app with subscription billing, access code auth, and Anthropic API proxy.

## Quick Start (local dev)

```bash
cd french-app
npm install
cp .env.example .env   # fill in your keys
node server.js
```

Open `http://localhost:3000` — you'll see the access code login screen.

Generate a test code via the admin panel:

```
http://localhost:3000/admin  (password from ADMIN_PASSWORD in .env)
```

---

## Environment Variables

Copy `.env.example` → `.env` and fill in every value.

| Variable | Description |
|---|---|
| `PORT` | Server port (default 3000) |
| `JWT_SECRET` | Random 64+ char string — never share |
| `ADMIN_PASSWORD` | Password for `/admin` dashboard |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-...`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks (`whsec_...`) |
| `STRIPE_PRICE_MONTHLY` | Stripe Price ID for $9/month plan |
| `STRIPE_PRICE_YEARLY` | Stripe Price ID for $79/year plan |
| `APP_URL` | Your public URL (e.g. `https://french.railway.app`) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `EMAIL_FROM` | Sender address (must be verified in Resend) |
| `DB_PATH` | SQLite file path (use `/data/french.db` on Railway) |

---

## Stripe Setup

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Products
2. Create a product "French Immersion"
3. Add two prices:
   - $9.00 / month → recurring → copy the `price_xxx` ID → `STRIPE_PRICE_MONTHLY`
   - $79.00 / year → recurring → copy the `price_xxx` ID → `STRIPE_PRICE_YEARLY`
4. Go to Developers → Webhooks → Add endpoint
   - URL: `https://your-app.railway.app/api/stripe/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
5. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Email Setup (Resend)

1. Sign up at [resend.com](https://resend.com)
2. Add and verify your domain
3. Create an API key → `RESEND_API_KEY`
4. Set `EMAIL_FROM` to an address on your verified domain

> **Without Resend configured**, emails are printed to the server console instead — useful for local testing.

---

## Deploy to Railway

1. Install Railway CLI: `npm install -g @railway/cli`
2. `railway login`
3. `railway init` (in the `french-app` directory)
4. Add a **Volume** in Railway dashboard, mounted at `/data` — this persists the SQLite database
5. Set all environment variables in Railway dashboard (Settings → Variables)
6. `railway up`

The `railway.json` is already configured with the correct start command and health check.

### Custom Domain on Railway

1. In the Railway dashboard → your service → **Settings → Networking → Custom Domain**
2. Add your domain (e.g. `frenchimmersion.app`)
3. Copy the CNAME target Railway gives you and add it to your DNS provider
4. Wait for DNS propagation (usually 5–30 minutes); Railway provisions TLS automatically
5. Update `APP_URL` in Railway Variables to your new domain (e.g. `https://frenchimmersion.app`)
6. Update your Stripe webhook URL: Stripe Dashboard → Developers → Webhooks → edit endpoint URL to `https://frenchimmersion.app/api/stripe/webhook`

> **Important:** `APP_URL` must match your actual domain — it's embedded in welcome emails and Stripe checkout redirect URLs.

---

## Project Structure

```
french-app/
├── server.js          # Express app entry point
├── db.js              # SQLite schema & connection
├── routes/
│   ├── auth.js        # POST /api/auth/login, GET /api/auth/validate
│   ├── claude.js      # POST /api/claude  (Anthropic proxy)
│   ├── stripe.js      # Checkout, webhook, billing portal
│   └── admin.js       # /admin dashboard + API
├── utils/
│   ├── codes.js       # Access code generation
│   └── email.js       # Transactional email via Resend
├── public/
│   ├── index.html     # Main app (access-code gated)
│   └── subscribe.html # Pricing / checkout page
├── .env.example
├── railway.json
└── package.json
```

---

## API Reference

### Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ code }` | `{ token, expiresAt, email, plan }` |
| `GET` | `/api/auth/validate` | — (Bearer token) | `{ valid, email, plan, expiresAt }` |

### Claude Proxy
| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/claude` | `{ prompt, maxTokens }` | Parsed JSON from Claude |

Requires `Authorization: Bearer <token>` header. Rate limited to 30 req/min per user.

### Stripe
| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/stripe/prices` | — | Plan info |
| `POST` | `/api/stripe/create-checkout` | `{ plan, email }` | `{ url }` |
| `POST` | `/api/stripe/create-portal` | `{ email }` | `{ url }` |
| `POST` | `/api/stripe/webhook` | Stripe payload | — |

### Admin (password-protected at `/admin`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/admin` | Admin dashboard UI |
| `POST` | `/admin/api/login` | `{ password }` → `{ token }` |
| `GET` | `/admin/api/stats` | Subscriber counts |
| `GET` | `/admin/api/users` | All users + active codes |
| `GET` | `/admin/api/codes` | All access codes |
| `POST` | `/admin/api/codes/generate` | `{ email, plan, sendEmail }` → new code |
| `DELETE` | `/admin/api/codes/:id` | Revoke a code |
| `PATCH` | `/admin/api/users/:id` | `{ status }` → update user status |

---

## Subscription Flow

```
User visits /subscribe
  → picks plan → enters email → clicks Subscribe
  → POST /api/stripe/create-checkout → redirect to Stripe
  → Payment succeeds → Stripe fires checkout.session.completed webhook
  → Server creates user + generates access code + sends welcome email
  → User receives code by email → enters it at / → JWT issued → app unlocked

Monthly renewal:
  → Stripe fires invoice.payment_succeeded (billing_reason = subscription_cycle)
  → Old code deactivated → new code generated → renewal email sent

Cancellation:
  → Stripe fires customer.subscription.deleted
  → User status set to cancelled → code deactivated → cancellation email sent
```

---

## Admin Panel

Visit `/admin` and enter your `ADMIN_PASSWORD`.

- **Users tab**: all subscribers, their plan, status, current code and expiry
- **Codes tab**: all access codes with revoke button
- **Generate Code tab**: manually create a code for any email (useful for comps, support)

---

## Security Notes

- API key is **never** sent to the browser — all Claude calls go through the server proxy
- JWTs are validated on every request + code status is re-checked in the database
- Rate limiting: 30 Claude requests/minute per user (in-memory, resets on restart)
- Admin sessions expire after 8 hours
- For production, consider adding Redis for rate limiting persistence across restarts
