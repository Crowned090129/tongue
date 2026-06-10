/**
 * utils/push.js — Push notification sender.
 *
 * Supports Firebase Cloud Messaging (FCM) for both Android AND iOS
 * (iOS requires you to upload your APNs key to Firebase — one-time setup).
 *
 * Setup:
 *   1. Create a Firebase project at console.firebase.google.com
 *   2. Project Settings → Service Accounts → Generate new private key → download JSON
 *   3. Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_JSON in your .env
 *   4. For iOS: Firebase Console → Project Settings → Cloud Messaging → upload your APNs Auth Key
 *
 * Without Firebase configured, push notifications are silently skipped (non-fatal).
 */

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return null;
  }
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(
          JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
        ),
      });
    }
    _messaging = admin.messaging();
    return _messaging;
  } catch (e) {
    console.error("[Push] Firebase init failed:", e.message);
    return null;
  }
}

/**
 * Send a push notification to a single device token.
 *
 * @param {string} token    — FCM device token
 * @param {string} title    — notification title
 * @param {string} body     — notification body
 * @param {object} data     — optional key-value data payload
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
async function sendPush(token, title, body, data = {}) {
  const messaging = getMessaging();
  if (!messaging) return false;

  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: "normal",
        notification: { channelId: "tonge_reminders", sound: "default" },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
      },
    });
    return true;
  } catch (e) {
    // Log but never throw — push failures must never crash the server
    if (e.code === "messaging/registration-token-not-registered") {
      // Token is stale — caller should delete it
      throw { stale: true, token };
    }
    console.error("[Push] Send failed:", e.message);
    return false;
  }
}

/**
 * Send a notification to ALL tokens for a user.
 * Automatically removes stale tokens.
 */
async function sendToUser(db, userId, title, body, data = {}) {
  const tokens = await db.all(
    "SELECT id, token FROM push_tokens WHERE user_id = $1",
    [userId]
  );

  for (const row of tokens) {
    try {
      await sendPush(row.token, title, body, data);
    } catch (e) {
      if (e.stale) {
        // Clean up expired token
        await db.run("DELETE FROM push_tokens WHERE id = $1", [row.id]).catch(() => {});
      }
    }
  }
}

/**
 * Send streak reminder to all users who haven't practiced today.
 * Called by the daily cron in server.js.
 */
async function sendStreakReminders(db) {
  const messaging = getMessaging();
  if (!messaging) {
    console.log("[Push] Firebase not configured — skipping streak reminders");
    return;
  }

  // Find users with push tokens who haven't logged practice today
  const usersNeedingReminder = await db.all(`
    SELECT DISTINCT pt.user_id, pt.token
    FROM push_tokens pt
    JOIN users u ON u.id = pt.user_id AND u.status = 'active'
    LEFT JOIN streaks s ON s.user_id = pt.user_id
    WHERE s.last_practice IS NULL
       OR s.last_practice < CURRENT_DATE::TEXT
  `);

  if (usersNeedingReminder.length === 0) return;

  console.log(`[Push] Sending streak reminders to ${usersNeedingReminder.length} users`);

  const messages = [
    { title: "Keep your streak alive! 🔥", body: "You haven't practiced today. Just 5 minutes keeps you on track." },
    { title: "Time to practice! 🌐",       body: "Your daily lesson is waiting. Don't break your streak." },
    { title: "Don't forget Tonge today! 📚", body: "A few minutes of practice goes a long way. Tap to start." },
  ];

  for (const { user_id, token } of usersNeedingReminder) {
    const msg = messages[user_id % messages.length]; // deterministic variety
    try {
      await sendPush(token, msg.title, msg.body, { screen: "practice" });
    } catch (e) {
      if (e.stale) {
        await db.run("DELETE FROM push_tokens WHERE token = $1", [token]).catch(() => {});
      }
    }
  }

  console.log("[Push] Streak reminders sent ✓");
}

module.exports = { sendPush, sendToUser, sendStreakReminders };
