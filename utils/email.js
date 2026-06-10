const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = `${process.env.EMAIL_FROM_NAME || "Tonge"} <${process.env.EMAIL_FROM || "noreply@example.com"}>`;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function sendEmail(to, subject, html) {
  if (!resend) {
    console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, "")}\n`);
    return;
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (e) {
    console.error("Email send failed:", e.message);
  }
}

function welcomeEmail(email, code, plan) {
  const planLabel = plan === "yearly" ? "Annual ($79/year)" : "Monthly ($9/month)";
  return sendEmail(
    email,
    "Your Tonge Access Code",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h1 style="color:#2563eb;font-size:24px;margin-bottom:4px">🌐 Welcome to Tonge!</h1>
      <p style="color:#334155;font-size:15px">Your subscription is active. Here is your access code:</p>

      <div style="background:#f1f5f9;border:2px solid #2563eb;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Your Access Code</div>
        <div style="font-size:28px;font-weight:900;color:#2563eb;letter-spacing:4px">${code}</div>
      </div>

      <p style="color:#334155;font-size:14px"><strong>How to use it:</strong></p>
      <ol style="color:#334155;font-size:14px;line-height:1.8">
        <li>Go to <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a></li>
        <li>Enter your access code when prompted</li>
        <li>Start learning!</li>
      </ol>

      <p style="color:#64748b;font-size:13px;margin-top:20px">
        <strong>Plan:</strong> ${planLabel}<br>
        Your code renews automatically each billing cycle — we'll email you the new one.
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
      <p style="color:#94a3b8;font-size:12px">
        Questions? Reply to this email.<br>
        To cancel, open the app at <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a>
        and go to <strong>Account → Manage Billing</strong>.
      </p>
    </div>
    `
  );
}

function renewalEmail(email, code, plan) {
  const planLabel = plan === "yearly" ? "Annual" : "Monthly";
  return sendEmail(
    email,
    "Your New Tonge Access Code",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h1 style="color:#2563eb;font-size:22px">🌐 Your subscription renewed!</h1>
      <p style="color:#334155;font-size:15px">Your ${planLabel} subscription has renewed. Here is your new access code:</p>

      <div style="background:#f1f5f9;border:2px solid #16a34a;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">New Access Code</div>
        <div style="font-size:28px;font-weight:900;color:#16a34a;letter-spacing:4px">${code}</div>
      </div>

      <p style="color:#64748b;font-size:13px">Your old code has been deactivated. Sign in again at <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a> with the new code above.</p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
      <p style="color:#94a3b8;font-size:12px">
        To cancel future renewals, open the app and go to <strong>Account → Manage Billing</strong>.
      </p>
    </div>
    `
  );
}

function cancellationEmail(email) {
  return sendEmail(
    email,
    "Tonge Subscription Cancelled",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h1 style="color:#334155;font-size:22px">Your subscription has been cancelled</h1>
      <p style="color:#334155;font-size:15px">
        We're sorry to see you go. Your access code will remain active until the end of your current billing period.
      </p>
      <p style="color:#64748b;font-size:14px">
        If this was a mistake, you can resubscribe anytime at
        <a href="${APP_URL}/subscribe" style="color:#2563eb">${APP_URL}/subscribe</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
      <p style="color:#94a3b8;font-size:12px">Thank you for being a subscriber. Good luck with your language learning! 🌐</p>
    </div>
    `
  );
}

function paymentFailedEmail(email) {
  return sendEmail(
    email,
    "⚠️ Action required: payment failed for Tonge",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h1 style="color:#dc2626;font-size:20px;margin-bottom:8px">⚠️ Payment failed</h1>
      <p style="color:#334155;font-size:15px;margin-bottom:16px">
        We couldn't process your Tonge subscription payment. Please update your payment method to avoid losing access.
      </p>

      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="color:#dc2626;font-size:14px;margin:0 0 10px;font-weight:700">How to update your payment method:</p>
        <ol style="color:#334155;font-size:14px;line-height:1.9;margin:0;padding-left:18px">
          <li>Open the app at <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a></li>
          <li>Tap <strong>Account</strong> → <strong>Manage Billing</strong></li>
          <li>Update your card details in the Stripe portal</li>
        </ol>
      </div>

      <p style="color:#64748b;font-size:13px">
        Stripe will retry your payment automatically over the next few days.
        If all retries fail, your subscription will be cancelled and your access code deactivated.
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
      <p style="color:#94a3b8;font-size:12px">Questions? Reply to this email.</p>
    </div>
    `
  );
}

module.exports = { sendEmail, welcomeEmail, renewalEmail, cancellationEmail, paymentFailedEmail };
