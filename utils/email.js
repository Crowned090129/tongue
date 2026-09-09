const { Resend } = require("resend");
const nodemailer = require("nodemailer");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// SMTP transport (e.g. Gmail). Set SMTP_HOST + SMTP_USER + SMTP_PASS to enable.
// For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=you@gmail.com,
// SMTP_PASS=<16-char Google App Password> (requires 2-Step Verification on).
const smtpTransport = (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "465", 10),
      secure: (process.env.SMTP_PORT || "465") === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

// Sender: falls back to the SMTP user (Gmail address) so Gmail doesn't reject it.
const FROM = `${process.env.EMAIL_FROM_NAME || "Tongue"} <${process.env.EMAIL_FROM || process.env.SMTP_USER || "noreply@example.com"}>`;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const emailHeader = `
  <div style="background:linear-gradient(135deg,#C0153E,#FF5F7E);padding:24px 28px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:36px;margin-bottom:4px">👅</div>
    <div style="color:#fff;font-size:20px;font-weight:900;letter-spacing:0.5px">TONGUE</div>
    <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Speak Every Tongue</div>
  </div>`;

const emailFooter = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
  <p style="color:#94a3b8;font-size:11px;text-align:center">
    © Tongue · <a href="${APP_URL}" style="color:#C0153E;text-decoration:none">${APP_URL}</a><br>
    Questions? Reply to this email.
  </p>`;

async function sendEmail(to, subject, html) {
  // Prefer SMTP (Gmail) when configured, then Resend, then log to console.
  if (smtpTransport) {
    try {
      const info = await smtpTransport.sendMail({ from: FROM, to, subject, html });
      console.log(`[EMAIL] ✓ sent via SMTP to ${to} (id=${info.messageId}, accepted=${JSON.stringify(info.accepted)}, rejected=${JSON.stringify(info.rejected)})`);
      return true;
    } catch (e) {
      console.error(`[EMAIL] ✗ SMTP send failed to ${to}: ${e.message}${e.code ? ` [${e.code}]` : ""}${e.responseCode ? ` (${e.responseCode})` : ""}`);
      // fall through to Resend if available
    }
  }
  if (resend) {
    try {
      const r = await resend.emails.send({ from: FROM, to, subject, html });
      if (r && r.error) { console.error(`[EMAIL] ✗ Resend rejected to ${to}: ${JSON.stringify(r.error)}`); }
      else { console.log(`[EMAIL] ✓ sent via Resend to ${to} (id=${r && r.data && r.data.id})`); return true; }
    } catch (e) {
      console.error(`[EMAIL] ✗ Resend send failed to ${to}: ${e.message}`);
    }
  }
  if (!smtpTransport && !resend) {
    console.log(`[EMAIL] (no transport configured) To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, "")}\n`);
  }
  console.error(`[EMAIL] ✗ ALL transports failed for ${to} — email NOT delivered`);
  return false;
}

function welcomeEmail(email, code, plan) {
  const planLabel = plan === "yearly" ? "Annual ($79/year)" : "Monthly ($9/month)";
  return sendEmail(
    email,
    "Your Tongue Access Code 👅",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
      ${emailHeader}
      <div style="padding:28px">
        <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px">Welcome! Your subscription is active.</h1>
        <p style="color:#334155;font-size:14px;margin:0 0 20px">Here is your personal access code. Keep it safe — you'll need it to log in on any device.</p>

        <div style="background:#fff0f4;border:2px solid #C0153E;border-radius:12px;padding:22px;text-align:center;margin-bottom:22px">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Your Access Code</div>
          <div style="font-size:30px;font-weight:900;color:#C0153E;letter-spacing:4px">${code}</div>
        </div>

        <p style="color:#334155;font-size:14px;font-weight:700;margin:0 0 8px">How to use it:</p>
        <ol style="color:#334155;font-size:14px;line-height:2;margin:0 0 20px;padding-left:18px">
          <li>Go to <a href="${APP_URL}" style="color:#C0153E">${APP_URL}</a></li>
          <li>Click <strong>"I Have a Code"</strong></li>
          <li>Enter the code above and tap <strong>Access App</strong></li>
        </ol>

        <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#64748b">
          <strong>Plan:</strong> ${planLabel}<br>
          Your code renews automatically each billing cycle — we'll email you the new one.
        </div>

        ${emailFooter}
      </div>
    </div>
    `
  );
}

function renewalEmail(email, code, plan) {
  const planLabel = plan === "yearly" ? "Annual" : "Monthly";
  return sendEmail(
    email,
    "Your New Tongue Access Code 🔄",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
      ${emailHeader}
      <div style="padding:28px">
        <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px">Your ${planLabel} subscription renewed!</h1>
        <p style="color:#334155;font-size:14px;margin:0 0 20px">Here is your new access code. Your old code has been deactivated.</p>

        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:22px;text-align:center;margin-bottom:22px">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">New Access Code</div>
          <div style="font-size:30px;font-weight:900;color:#16a34a;letter-spacing:4px">${code}</div>
        </div>

        <p style="color:#64748b;font-size:13px">Sign in again at <a href="${APP_URL}" style="color:#C0153E">${APP_URL}</a> with the new code above.</p>

        ${emailFooter}
      </div>
    </div>
    `
  );
}

function cancellationEmail(email) {
  return sendEmail(
    email,
    "Your Tongue subscription has been cancelled",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
      ${emailHeader}
      <div style="padding:28px">
        <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px">Subscription cancelled</h1>
        <p style="color:#334155;font-size:15px;margin:0 0 14px">
          We're sorry to see you go. Your access code will stay active until the end of your current billing period.
        </p>
        <p style="color:#64748b;font-size:14px;margin:0 0 20px">
          Changed your mind? You can resubscribe anytime at
          <a href="${APP_URL}/subscribe" style="color:#C0153E">${APP_URL}/subscribe</a>
        </p>
        <p style="color:#94a3b8;font-size:13px">Thank you for learning with Tongue. We hope to see you again. 👅</p>

        ${emailFooter}
      </div>
    </div>
    `
  );
}

function paymentFailedEmail(email) {
  return sendEmail(
    email,
    "⚠️ Action required — Tongue payment failed",
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
      ${emailHeader}
      <div style="padding:28px">
        <h1 style="color:#dc2626;font-size:20px;margin:0 0 8px">⚠️ Payment failed</h1>
        <p style="color:#334155;font-size:15px;margin:0 0 16px">
          We couldn't process your Tongue subscription payment. Please update your payment method to keep your access.
        </p>

        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;margin-bottom:20px">
          <p style="color:#dc2626;font-size:14px;margin:0 0 10px;font-weight:700">How to update your payment method:</p>
          <ol style="color:#334155;font-size:14px;line-height:1.9;margin:0;padding-left:18px">
            <li>Open the app at <a href="${APP_URL}" style="color:#C0153E">${APP_URL}</a></li>
            <li>Tap <strong>Account</strong> → <strong>Manage Billing</strong></li>
            <li>Update your card details in the Stripe portal</li>
          </ol>
        </div>

        <p style="color:#64748b;font-size:13px">
          Stripe will retry your payment automatically over the next few days.
          If all retries fail, your access will be deactivated.
        </p>

        ${emailFooter}
      </div>
    </div>
    `
  );
}

module.exports = { sendEmail, welcomeEmail, renewalEmail, cancellationEmail, paymentFailedEmail };
