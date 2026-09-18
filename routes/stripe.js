const express = require("express");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("./auth");
const { generateCode, codeExpiryDate } = require("../utils/codes");
const { welcomeEmail, renewalEmail, cancellationEmail, paymentFailedEmail } = require("../utils/email");

const router = express.Router();

// Stripe client. Production builds one from STRIPE_SECRET_KEY on every call.
// Tests replace it with module.exports.__setStripeClientForTests(fn), where fn()
// returns an object shaped like the Stripe client; pass null to restore.
// Stripe API used in this file:
//   POST /create-checkout            → checkout.sessions.create
//   POST /create-portal              → billingPortal.sessions.create
//   POST /webhook                    → webhooks.constructEvent (local signature check, no network)
//   checkout.session.completed event → subscriptions.retrieve
let stripeClientForTests = null;
function stripe() {
  if (stripeClientForTests) return stripeClientForTests();
  return require("stripe")(process.env.STRIPE_SECRET_KEY);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── GET /api/stripe/prices ────────────────────────────────────────────────────
router.get("/prices", (_req, res) => {
  res.json({
    monthly: { amount: 900,  interval: "month", label: "$9 / month"  },
    yearly:  { amount: 7900, interval: "year",  label: "$79 / year"  },
  });
});

// ── POST /api/stripe/create-checkout ─────────────────────────────────────────
router.post("/create-checkout", asyncHandler(async (req, res) => {
  const { plan, email } = req.body || {};
  if (typeof plan !== "string" || !["monthly", "yearly"].includes(plan)) {
    return res.status(400).json({ code: "invalid_plan", error: "Invalid plan. Choose monthly or yearly." });
  }

  // Email is optional (Stripe Checkout asks for it when absent), but when sent it must be an address.
  let customerEmail;
  if (email !== undefined && email !== null && email !== "") {
    if (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ code: "invalid_email", error: "Please enter a valid email address." });
    }
    customerEmail = email.trim();
  }

  const priceId = plan === "yearly"
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) return res.status(500).json({ code: "billing_unconfigured", error: "Stripe prices not configured." });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      success_url: `${appUrl}/app?checkout=success`,
      cancel_url:  `${appUrl}/subscribe?checkout=cancelled`,
      metadata: { plan },
      subscription_data: { metadata: { plan } },
      allow_promotion_codes: true,
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: `I agree to the [Terms of Service](${appUrl}/terms) and [Privacy Policy](${appUrl}/privacy).`,
        },
      },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout error:", e.message);
    res.status(500).json({ code: "checkout_failed", error: "Could not create checkout session." });
  }
}));

// ── POST /api/stripe/create-portal ───────────────────────────────────────────
// Signed-in users only, and only for their own Stripe customer. The request body
// is ignored: the customer comes from the verified session, never from input.
router.post("/create-portal", requireAuth, asyncHandler(async (req, res) => {
  const user = await db.get("SELECT stripe_customer_id FROM users WHERE id = $1", [req.user.userId]);
  if (!user?.stripe_customer_id) {
    return res.status(404).json({ code: "no_billing_account", error: "No billing account found for this account." });
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer:   user.stripe_customer_id,
      return_url: appUrl,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Billing portal error:", e.message);
    res.status(500).json({ code: "portal_failed", error: "Could not open billing portal." });
  }
}));

// ── POST /api/stripe/webhook ──────────────────────────────────────────────────
// Raw body required — express.raw() is configured in app.js for this route.
router.post("/webhook", asyncHandler(async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[Stripe] STRIPE_WEBHOOK_SECRET not set — webhook rejected");
    return res.status(400).json({ code: "webhook_unconfigured", error: "Webhook not configured." });
  }

  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string" || !sig) {
    return res.status(400).json({ code: "missing_signature", error: "Missing stripe-signature header." });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ code: "invalid_payload", error: "Webhook body must be raw JSON (Content-Type: application/json)." });
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[Stripe] Signature verification failed:", e.message);
    return res.status(400).json({ code: "invalid_signature", error: `Webhook Error: ${e.message}` });
  }

  // ── Idempotency: a stripe_events row only exists once its handler committed ──
  const seen = await db.get("SELECT 1 FROM stripe_events WHERE event_id = $1", [event.id]);
  if (seen) {
    console.log(`[Stripe] Duplicate event ${event.id} (${event.type}) — skipped`);
    return res.json({ received: true, duplicate: true });
  }

  // Record the event and apply the handler's writes in ONE transaction, so both
  // commit or neither does; a failure answers 500 and Stripe retries. The insert
  // runs first so a concurrent delivery of the same event waits on the primary
  // key and gets a unique violation once this one commits. Emails and analytics
  // are collected in afterCommit and never run for rolled-back work.
  const afterCommit = [];
  try {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO stripe_events (event_id) VALUES ($1)", [event.id]);
      await handleStripeEvent(event, tx, afterCommit);
    });
  } catch (e) {
    if (e.code === "23505" && e.table === "stripe_events") {
      console.log(`[Stripe] Duplicate event ${event.id} (${event.type}) delivered concurrently — skipped`);
      return res.json({ received: true, duplicate: true });
    }
    console.error("[Stripe] Handler error, rolled back (Stripe will retry):", e.message, "event:", event.id, event.type);
    return res.status(500).json({ code: "webhook_failed", error: "Webhook handling failed. It will be retried." });
  }

  res.json({ received: true });

  // The event is committed; these failures are logged and never fail the webhook.
  for (const effect of afterCommit) {
    try {
      const ok = await effect.run();
      if (ok === false) console.error(`[Stripe] After-commit ${effect.name} not delivered for event ${event.id} (${event.type})`);
    } catch (e) {
      console.error(`[Stripe] After-commit ${effect.name} failed for event ${event.id} (${event.type}):`, e.message);
    }
  }
}));

// ── Event Handlers ────────────────────────────────────────────────────────────

// B5 interim: a paid period that continues keeps the user's active code (so their
// signed-in sessions stay valid) and carries its expiry to the new period end.
// GREATEST because Stripe may deliver an older event late: expiry never moves back.
function extendActiveCodes(tx, userId, until) {
  return tx.run(
    "UPDATE access_codes SET expires_at = GREATEST(expires_at, $1::timestamptz) WHERE user_id = $2 AND is_active = 1",
    [until, userId]
  );
}

// Every DB write goes through tx (the webhook's transaction). Side effects that
// must not repeat or run for rolled-back work are pushed to afterCommit.
async function handleStripeEvent(event, tx, afterCommit) {
  console.log(`[Stripe] Processing event: ${event.type} (${event.id})`);

  switch (event.type) {

    // ── New subscription ────────────────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") break;

      const email = session.customer_email || session.customer_details?.email;
      if (!email) { console.error("[Stripe] checkout.session.completed: no email"); break; }

      const plan           = session.metadata?.plan || "monthly";
      const customerId     = session.customer;
      const subscriptionId = session.subscription;
      const priceId        = plan === "yearly"
        ? process.env.STRIPE_PRICE_YEARLY
        : process.env.STRIPE_PRICE_MONTHLY;

      // Fetch current_period_end from Stripe for accurate expiry
      let periodEnd = null;
      try {
        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
      } catch (e) {
        console.error(`[Stripe] checkout.session.completed: subscriptions.retrieve(${subscriptionId}) failed, using plan-based expiry:`, e.message);
      }

      const code      = generateCode();
      const expiresAt = periodEnd || codeExpiryDate(plan);

      // Upsert user — upgrade free → paid
      await tx.run(`
        INSERT INTO users (email, stripe_customer_id, plan, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT(email) DO UPDATE SET
          stripe_customer_id = COALESCE(excluded.stripe_customer_id, users.stripe_customer_id),
          plan               = excluded.plan,
          status             = 'active'
      `, [email.trim().toLowerCase(), customerId, plan]);

      const user = await tx.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
      if (!user) { console.error("[Stripe] checkout: could not find user after upsert"); break; }

      // Deactivate old codes, issue new one
      await tx.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      await tx.run(
        "INSERT INTO access_codes (user_id, code, is_active, expires_at) VALUES ($1, $2, 1, $3)",
        [user.id, code, expiresAt]
      );

      // Upsert subscription record
      await tx.run(`
        INSERT INTO subscriptions
          (user_id, stripe_subscription_id, stripe_price_id, plan, status,
           current_period_end, paid_access_until, updated_at)
        VALUES ($1, $2, $3, $4, 'active', $5, $5, NOW())
        ON CONFLICT(user_id) DO UPDATE SET
          stripe_subscription_id = excluded.stripe_subscription_id,
          stripe_price_id        = excluded.stripe_price_id,
          plan                   = excluded.plan,
          status                 = 'active',
          current_period_end     = excluded.current_period_end,
          paid_access_until      = excluded.paid_access_until,
          cancel_at_period_end   = FALSE,
          updated_at             = NOW()
      `, [user.id, subscriptionId, priceId || null, plan, expiresAt]);

      console.log(`[Stripe] New subscriber: ${email} (${plan}) code: ${code}`);
      afterCommit.push({ name: "welcome email", run: () => welcomeEmail(email, code, plan) });
      afterCommit.push({ name: "analytics subscription_started", run: () => db.trackEvent(user.id, "subscription_started", { plan, subscriptionId }) });
      break;
    }

    // ── Successful renewal ──────────────────────────────────────────────────
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      // Only process subscription renewals, not initial payments (handled by checkout.session.completed)
      if (invoice.billing_reason === "subscription_create") break;
      if (!["subscription_cycle", "subscription_update"].includes(invoice.billing_reason)) break;

      const customerId     = invoice.customer;
      const subscriptionId = invoice.subscription;
      const priceId        = invoice.lines?.data?.[0]?.price?.id || null;

      const user = await tx.get(
        "SELECT id, email, plan FROM users WHERE stripe_customer_id = $1", [customerId]
      );
      if (!user) { console.error("[Stripe] invoice.payment_succeeded: no user for", customerId); break; }

      // Determine period end from the invoice line item
      const lineItem = invoice.lines?.data?.[0];
      const periodEnd = lineItem?.period?.end
        ? new Date(lineItem.period.end * 1000).toISOString()
        : null;

      // Determine plan from price
      let plan = user.plan;
      if (priceId === process.env.STRIPE_PRICE_YEARLY)       plan = "yearly";
      else if (priceId === process.env.STRIPE_PRICE_MONTHLY) plan = "monthly";

      const expiresAt = periodEnd || codeExpiryDate(plan);

      // Keep the active code; no new code on renewal (B5 interim, see extendActiveCodes).
      const extended = await extendActiveCodes(tx, user.id, expiresAt);

      // No active code left (e.g. switched off while a payment was failing): issue
      // one as before, otherwise this paying user could not sign in again.
      let newCode = null;
      if (extended.changes === 0) {
        newCode = generateCode();
        await tx.run(
          "INSERT INTO access_codes (user_id, code, is_active, expires_at) VALUES ($1, $2, 1, $3)",
          [user.id, newCode, expiresAt]
        );
      }

      await tx.run(`
        UPDATE subscriptions SET
          status             = 'active',
          plan               = $1,
          current_period_end = $2,
          paid_access_until  = $2,
          stripe_price_id    = COALESCE($3, stripe_price_id),
          cancel_at_period_end = FALSE,
          updated_at         = NOW()
        WHERE user_id = $4
      `, [plan, expiresAt, priceId, user.id]);

      await tx.run("UPDATE users SET status = 'active', plan = $1 WHERE id = $2", [plan, user.id]);

      console.log(`[Stripe] Renewed: ${user.email} (${plan}) until ${expiresAt} — ${newCode ? "no active code, issued a new one" : "active code kept"}`);
      afterCommit.push({ name: "renewal email", run: () => renewalEmail(user.email, newCode, plan) });
      afterCommit.push({ name: "analytics subscription_renewed", run: () => db.trackEvent(user.id, "subscription_renewed", { plan, subscriptionId }) });
      break;
    }

    // ── Subscription state change (cancel scheduling, plan swap, etc.) ──────
    case "customer.subscription.updated": {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const priceId    = sub.items?.data?.[0]?.price?.id || null;
      const subStatus  = sub.status;
      const cancelAtPeriodEnd = sub.cancel_at_period_end || false;

      let newPlan = null;
      if (priceId === process.env.STRIPE_PRICE_YEARLY)       newPlan = "yearly";
      else if (priceId === process.env.STRIPE_PRICE_MONTHLY) newPlan = "monthly";
      else if (sub.metadata?.plan)                           newPlan = sub.metadata.plan;
      if (!newPlan) newPlan = "monthly";

      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      const user = await tx.get("SELECT id, plan FROM users WHERE stripe_customer_id = $1", [customerId]);
      if (!user) { console.log(`[Stripe] subscription.updated: no user for ${customerId}`); break; }

      // If active or trialing, keep user active; downgrade status otherwise
      const isActive   = subStatus === "active" || subStatus === "trialing";
      const userStatus = isActive ? "active" : "cancelled";

      await tx.run(
        "UPDATE users SET plan = $1, status = $2 WHERE id = $3",
        [newPlan, userStatus, user.id]
      );

      await tx.run(`
        UPDATE subscriptions SET
          plan                 = $1,
          status               = $2,
          stripe_price_id      = COALESCE($3, stripe_price_id),
          current_period_end   = COALESCE($4, current_period_end),
          paid_access_until    = COALESCE($4, paid_access_until),
          cancel_at_period_end = $5,
          updated_at           = NOW()
        WHERE user_id = $6
      `, [newPlan, subStatus, priceId, periodEnd, cancelAtPeriodEnd, user.id]);

      if (isActive) {
        // Keep the active code and carry its expiry to the period end (B5 interim)
        if (periodEnd) await extendActiveCodes(tx, user.id, periodEnd);
      } else {
        // Deactivate codes if subscription is no longer active
        await tx.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      }

      console.log(`[Stripe] Sub updated: userId=${user.id} plan=${newPlan} status=${subStatus} cancelAtEnd=${cancelAtPeriodEnd}`);
      afterCommit.push({ name: "analytics subscription_updated", run: () => db.trackEvent(user.id, "subscription_updated", { newPlan, subStatus, cancelAtPeriodEnd }) });
      break;
    }

    // ── Hard cancellation (period ended, or immediate cancel) ───────────────
    case "customer.subscription.deleted": {
      const sub        = event.data.object;
      const customerId = sub.customer;

      // paid_access_until: use current_period_end so user keeps access to end of paid period
      const paidUntil = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      const user = await tx.get("SELECT id, email FROM users WHERE stripe_customer_id = $1", [customerId]);
      if (!user) break;

      await tx.run("UPDATE users SET status = 'cancelled', plan = 'free' WHERE id = $1", [user.id]);
      await tx.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      await tx.run(`
        UPDATE subscriptions SET
          status             = 'cancelled',
          cancel_at_period_end = FALSE,
          paid_access_until  = COALESCE($1, paid_access_until),
          updated_at         = NOW()
        WHERE user_id = $2
      `, [paidUntil, user.id]);

      console.log(`[Stripe] Subscription deleted (cancelled): ${user.email}`);
      afterCommit.push({ name: "cancellation email", run: () => cancellationEmail(user.email) });
      afterCommit.push({ name: "analytics subscription_cancelled", run: () => db.trackEvent(user.id, "subscription_cancelled", { paidUntil }) });
      break;
    }

    // ── Payment failure ─────────────────────────────────────────────────────
    case "invoice.payment_failed": {
      const invoice    = event.data.object;
      const customerId = invoice.customer;
      const attemptCount = invoice.attempt_count || 1;

      const user = await tx.get(
        "SELECT id, email FROM users WHERE stripe_customer_id = $1", [customerId]
      );
      if (!user) break;

      // After 3 failed attempts Stripe will cancel — just notify user
      if (user.email) afterCommit.push({ name: "payment-failed email", run: () => paymentFailedEmail(user.email) });
      console.log(`[Stripe] Payment failed (attempt ${attemptCount}): ${user.email || customerId}`);
      afterCommit.push({ name: "analytics payment_failed", run: () => db.trackEvent(user.id, "payment_failed", { attemptCount, invoiceId: invoice.id }) });
      break;
    }

    default:
      // Log unhandled events for visibility (no-op)
      console.log(`[Stripe] Unhandled event type: ${event.type}`);
      break;
  }
}

module.exports = router;

// Test seam (see stripe() above). Refuses to run outside NODE_ENV=test so
// production can never be pointed at a stub.
module.exports.__setStripeClientForTests = (fn) => {
  if (process.env.NODE_ENV !== "test") throw new Error("__setStripeClientForTests is only available when NODE_ENV=test");
  stripeClientForTests = fn || null;
};
