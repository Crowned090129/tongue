# Tonge Admin Manual

**URL:** https://tonge-app.fly.dev/admin  
**Password:** stored in `ADMIN_PASSWORD` environment variable

---

## 1. Accessing the Admin Panel

1. Go to `https://tonge-app.fly.dev/admin`
2. Enter the admin password
3. Click **Login**

Your session is stored in the browser. It persists until you click **Logout** or clear your browser data.

---

## 2. Dashboard Overview

The top of the admin panel shows live stats pulled from the database:

| Stat | What it means |
|---|---|
| Paid Users | Total users with an active paid subscription |
| MRR (est.) | Monthly Recurring Revenue estimate |
| Monthly / Yearly | Breakdown of subscription types |
| Free Users | Users on the free tier |
| Conversion Rate | % of free users who upgraded |
| AI Calls Today / Month | How many times the AI was called |
| AI Cost Today / Month | Estimated Anthropic API cost |
| Signups Today | New accounts created today |
| Total Users | All users ever created |

---

## 3. Users Tab

Shows all users with email, plan, status, access code, expiry, and signup date.

### Actions per user:

**Cancel** — Deactivates the user's subscription. Their access code stops working immediately. Use when a customer requests a cancellation or when Stripe flags a failed payment.

**Reactivate** — Re-enables a cancelled account. Use after a payment is resolved.

**Email** — Opens a compose window to send a one-off email to that specific user. Use for personal support messages, renewal notices, or special offers.

---

## 4. Access Codes Tab

Lists all access codes with their status (Active / Inactive), plan type, and expiry.

**Revoking a code:** Click **Revoke** next to any active code. The user will be logged out on their next app load and will receive a "session expired" message.

---

## 5. Generating Access Codes (for new paid subscribers)

Go to the **Generate** tab:

1. Enter the subscriber's **email address**
2. Select **Plan**: Monthly or Yearly
3. Check **Send welcome email** to automatically email the code to the subscriber
4. Click **Generate Code**

The code is in format `TG-XXXXXXXX`. If the email fails to send, copy the code manually and send it yourself.

**When to generate codes manually:**
- After a Stripe payment (normally handled automatically by webhook)
- When a customer pays via bank transfer or invoice
- Comp codes for influencers, partners, or support resolutions

---

## 6. Content Tab

Shows the status of all pre-generated AI content across 11 languages × 5 content types (grammar, cheatsheet, structures, vocabulary, dialogues).

- **Green** = content exists in the database
- **Red / Missing** = content needs to be generated

**To regenerate a single item:** Click **Regenerate** next to it.  
**To fill all missing items:** Click **Generate All Missing** at the top.

> Note: Each generation calls the Anthropic API and costs ~$0.01–0.05. Generating all 55 items costs ~$1–2 total.

---

## 7. Broadcast Email Tab

Send a message to **one specific user** by User ID (visible in the Users table).

For sending to all users, use Resend's broadcast feature directly at resend.com.

---

## 8. Stripe Management

Stripe is managed separately at **dashboard.stripe.com**. The admin panel does not duplicate Stripe's billing features.

**Key Stripe tasks:**
- **Issue a refund:** Stripe Dashboard → Payments → find the charge → Refund
- **View subscription status:** Stripe Dashboard → Customers → search by email
- **Cancel subscription:** Stripe Dashboard → Customers → subscription → Cancel
- **Update webhook:** Stripe Dashboard → Developers → Webhooks → update endpoint URL if the app URL changes

**Webhook URL:** `https://tonge-app.fly.dev/api/stripe/webhook`

---

## 9. Common Support Scenarios

### "I paid but I didn't get my access code"
1. Check Stripe dashboard — confirm payment succeeded
2. Check the Users tab — find their email, check if a code was generated
3. If no code: go to Generate tab, enter their email, select their plan, check Send email, click Generate
4. If code exists but email failed: use the Email button to send them the code manually

### "My access code isn't working"
1. Find the user in Users tab
2. Check: Is the code Active? Is the expiry in the future? Is the account status "active"?
3. If expired: generate a new code (their plan renews automatically via Stripe, but you may need to manually extend)
4. If inactive: click Reactivate

### "I want a refund"
1. Issue refund in Stripe dashboard
2. Click Cancel in the Users tab to deactivate their access
3. Optional: send a confirmation email via the Email button

### "I can't log in / forgot my code"
Direct them to `https://tonge-app.fly.dev/resend-code.html` — they enter their email and receive their code automatically.

---

## 10. Monitoring & Health

**Health check:** `https://tonge-app.fly.dev/health` — returns `{"status":"ok","db":"ok"}` when everything is running.

**App logs:** Run `flyctl logs --app tonge-app` in the terminal (requires Fly CLI installed and logged in).

**Database:** Access via Supabase dashboard at supabase.com — project `fhtbxahbabesyjoantmo`.

**If the app is down:**
1. Check `https://tonge-app.fly.dev/health` — if no response, the machines are stopped
2. Run `flyctl status --app tonge-app` to see machine state
3. Run `flyctl deploy --app tonge-app` to restart
4. Check Fly.io billing — machines stop if the account has no payment method

---

## 11. Environment Variables Reference

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Signs all user and admin JWT tokens |
| `ADMIN_PASSWORD` | Admin panel login password |
| `ANTHROPIC_API_KEY` | Claude AI for content generation and coach |
| `STRIPE_SECRET_KEY` | Stripe API (restricted key) |
| `STRIPE_WEBHOOK_SECRET` | Validates incoming Stripe webhook events |
| `STRIPE_PRICE_MONTHLY` | Stripe Price ID for monthly plan |
| `STRIPE_PRICE_YEARLY` | Stripe Price ID for yearly plan |
| `RESEND_API_KEY` | Transactional email sending |
| `APP_URL` | Public URL of the app (used in email links) |

To update any variable: `flyctl secrets set KEY=value --app tonge-app`
