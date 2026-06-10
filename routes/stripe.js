const express = require("express");
const db = require("../db");
const { generateCode, codeExpiryDate } = require("../utils/codes");
const { welcomeEmail, renewalEmail, cancellationEmail, paymentFailedEmail } = require("../utils/email");

const router = express.Router();

function stripe() {
  return require("stripe")(process.env.STRIPE_SECRET_KEY);
}

// ── GET /api/stripe/prices ────────────────────────────────────────────────────
router.get("/prices", (_req, res) => {
  res.json({
    monthly: { amount: 900,  interval: "month", label: "$9 / month"  },
    yearly:  { amount: 7900, interval: "year",  label: "$79 / year"  },
  });
});

// ── POST /api/stripe/create-checkout ─────────────────────────────────────────
router.post("/create-checkout", async (req, res) => {
  const { plan, email } = req.body || {};
  if (!plan || !["monthly", "yearly"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Choose monthly or yearly." });
  }

  const priceId = plan === "yearly"
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) return res.status(500).json({ error: "Stripe prices not configured." });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      success_url: `${appUrl}/?checkout=success`,
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
    res.status(500).json({ error: "Could not create checkout session." });
  }
});

// ── POST /api/stripe/create-portal ───────────────────────────────────────────
router.post("/create-portal", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required." });

  const user = await db.get("SELECT stripe_customer_id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  if (!user?.stripe_customer_id) {
    return res.status(404).json({ error: "No subscription found for that email." });
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
    res.status(500).json({ error: "Could not open billing portal." });
  }
});

// ── POST /api/stripe/webhook ──────────────────────────────────────────────────
// Raw body required — express.raw() is configured in server.js for this route.
router.post("/webhook", async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[Stripe] STRIPE_WEBHOOK_SECRET not set — webhook rejected");
    return res.status(400).json({ error: "Webhook not configured." });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header." });

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[Stripe] Signature verification failed:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  // ── Idempotency: skip already-processed events ────────────────────────────
  try {
    await db.run(
      "INSERT INTO stripe_events (event_id) VALUES ($1)",
      [event.id]
    );
  } catch (e) {
    // Unique constraint violation = already processed
    if (e.code === "23505" || (e.message || "").includes("unique")) {
      console.log(`[Stripe] Duplicate event ${event.id} (${event.type}) — skipped`);
      return res.json({ received: true });
    }
    // Any other DB error: log but continue (don't reject valid events)
    console.error("[Stripe] stripe_events insert error:", e.message);
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    console.error("[Stripe] Handler error:", e.message, "event:", event.id, event.type);
    // Still return 200 so Stripe doesn't retry — the event is already recorded.
    // Investigate via logs; do NOT return 500 here (causes infinite retries).
    res.json({ received: true, warning: "handler error — check server logs" });
  }
});

// ── Event Handlers ────────────────────────────────────────────────────────────

async function handleStripeEvent(event) {
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
      } catch (_) {}

      const code      = generateCode();
      const expiresAt = periodEnd || codeExpiryDate(plan);

      // Upsert user — upgrade free → paid
      await db.run(`
        INSERT INTO users (email, stripe_customer_id, plan, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT(email) DO UPDATE SET
          stripe_customer_id = COALESCE(excluded.stripe_customer_id, users.stripe_customer_id),
          plan               = excluded.plan,
          status             = 'active'
      `, [email.trim().toLowerCase(), customerId, plan]);

      const user = await db.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
      if (!user) { console.error("[Stripe] checkout: could not find user after upsert"); break; }

      // Deactivate old codes, issue new one
      await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      await db.run(
        "INSERT INTO access_codes (user_id, code, is_active, expires_at) VALUES ($1, $2, 1, $3)",
        [user.id, code, expiresAt]
      );

      // Upsert subscription record
      await db.run(`
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

      await welcomeEmail(email, code, plan);
      console.log(`[Stripe] New subscriber: ${email} (${plan}) code: ${code}`);
      db.trackEvent(user.id, "subscription_started", { plan, subscriptionId });
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

      const user = await db.get(
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

      const code      = generateCode();
      const expiresAt = periodEnd || codeExpiryDate(plan);

      await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      await db.run(
        "INSERT INTO access_codes (user_id, code, is_active, expires_at) VALUES ($1, $2, 1, $3)",
        [user.id, code, expiresAt]
      );

      await db.run(`
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

      await db.run("UPDATE users SET status = 'active', plan = $1 WHERE id = $2", [plan, user.id]);

      await renewalEmail(user.email, code, plan);
      console.log(`[Stripe] Renewed: ${user.email} (${plan}) new code: ${code}`);
      db.trackEvent(user.id, "subscription_renewed", { plan, subscriptionId });
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

      const user = await db.get("SELECT id, plan FROM users WHERE stripe_customer_id = $1", [customerId]);
      if (!user) { console.log(`[Stripe] subscription.updated: no user for ${customerId}`); break; }

      // If active or trialing, keep user active; downgrade status otherwise
      const userStatus = (subStatus === "active" || subStatus === "trialing") ? "active" : "cancelled";

      await db.run(
        "UPDATE users SET plan = $1, status = $2 WHERE id = $3",
        [newPlan, userStatus, user.id]
      );

      await db.run(`
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

      // Deactivate codes if subscription is no longer active
      if (subStatus !== "active" && subStatus !== "trialing") {
        await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      }

      console.log(`[Stripe] Sub updated: userId=${user.id} plan=${newPlan} status=${subStatus} cancelAtEnd=${cancelAtPeriodEnd}`);
      db.trackEvent(user.id, "subscription_updated", { newPlan, subStatus, cancelAtPeriodEnd });
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

      const user = await db.get("SELECT id, email FROM users WHERE stripe_customer_id = $1", [customerId]);
      if (!user) break;

      await db.run("UPDATE users SET status = 'cancelled', plan = 'free' WHERE id = $1", [user.id]);
      await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);
      await db.run(`
        UPDATE subscriptions SET
          status             = 'cancelled',
          cancel_at_period_end = FALSE,
          paid_access_until  = COALESCE($1, paid_access_until),
          updated_at         = NOW()
        WHERE user_id = $2
      `, [paidUntil, user.id]);

      await cancellationEmail(user.email);
      console.log(`[Stripe] Subscription deleted (cancelled): ${user.email}`);
      db.trackEvent(user.id, "subscription_cancelled", { paidUntil });
      break;
    }

    // ── Payment failure ─────────────────────────────────────────────────────
    case "invoice.payment_failed": {
      const invoice    = event.data.object;
      const customerId = invoice.customer;
      const attemptCount = invoice.attempt_count || 1;

      const user = await db.get(
        "SELECT id, email FROM users WHERE stripe_customer_id = $1", [customerId]
      );
      if (!user) break;

      // After 3 failed attempts Stripe will cancel — just notify user
      if (user?.email) await paymentFailedEmail(user.email);
      console.log(`[Stripe] Payment failed (attempt ${attemptCount}): ${user?.email || customerId}`);
      db.trackEvent(user?.id, "payment_failed", { attemptCount, invoiceId: invoice.id });
      break;
    }

    default:
      // Log unhandled events for visibility (no-op)
      console.log(`[Stripe] Unhandled event type: ${event.type}`);
      break;
  }
}

module.exports = router;
