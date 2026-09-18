'use strict';
// Explicitly isolated preview. Never load .env or production/provider credentials.
process.env.NODE_ENV = 'test';
require('../tests/support/assertTestDatabase').assertTestDatabase();
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
Object.assign(process.env, {
  DATABASE_URL:'', ANTHROPIC_API_KEY:'', RESEND_API_KEY:'', STRIPE_SECRET_KEY:'',
  STRIPE_WEBHOOK_SECRET:'', SMTP_HOST:'', SMTP_USER:'', SMTP_PASS:'', EMAIL_FROM:'',
  GOOGLE_CLIENT_ID:'', JWT_SECRET:'local-preview-only', ADMIN_PASSWORD:'local-preview-only',
  APP_URL:`http://127.0.0.1:${port}`, FRONTEND_URL:`http://localhost:${port}`,
  CONTENT_AUTOGEN:'off', CONTENT_SEED_UPGRADE:'off'
});
const db = require('../db');
db.initialize().then(() => require('../routes/content').seedContent())
  .then(() => require('../app').listen(port,'127.0.0.1',() => console.log(`Isolated preview: http://127.0.0.1:${port}/app`)))
  .catch(error => { console.error(error); process.exitCode=1; return db.pool.end(); });
