const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { generateCode, codeExpiryDate } = require("../utils/codes");
const { welcomeEmail, sendEmail } = require("../utils/email");

const router = express.Router();

// ── Admin login brute-force protection (5 attempts / 15 min per IP, DB-backed) ─
async function checkAdminLoginLimit(ip) {
  const { allowed } = await db.checkIpRateLimit(
    `adminlogin_ip:${ip}`, 5, 15 * 60 * 1000
  );
  return allowed;
}

// ── Simple session-based admin auth ───────────────────────────────────────────

function adminAuth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token) return res.status(401).json({ error: "Admin token required." });

  db.get("SELECT id FROM admin_sessions WHERE token = $1 AND expires_at > NOW()", [token])
    .then(session => {
      if (!session) return res.status(401).json({ error: "Invalid or expired admin session." });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error." }));
}

// POST /admin/api/login
router.post("/api/login", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  if (!await checkAdminLoginLimit(ip)) {
    return res.status(429).json({ error: "Too many login attempts. Please wait 15 minutes." });
  }

  const { password } = req.body || {};
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminPass || password !== adminPass) {
    return res.status(401).json({ error: "Invalid admin password." });
  }

  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await db.run("INSERT INTO admin_sessions (token, expires_at) VALUES ($1, $2)", [token, expiresAt]);

  res.json({ token, expiresAt });
});

// GET /admin/api/stats
router.get("/api/stats", adminAuth, async (req, res) => {
  const [
    total, active, codes, monthly, yearly, free,
    aiToday, aiMonth, aiCostToday, aiCostMonth,
    newToday, newMonth,
  ] = await Promise.all([
    db.get("SELECT COUNT(*) AS n FROM users"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS n FROM access_codes WHERE is_active = 1 AND expires_at > NOW()"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE plan = 'monthly' AND status = 'active'"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE plan = 'yearly'  AND status = 'active'"),
    db.get("SELECT COUNT(*) AS n FROM users WHERE plan = 'free'    AND status = 'active'"),
    // AI usage today
    db.get("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= NOW() - INTERVAL '24 hours'"),
    // AI usage this calendar month
    db.get("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE created_at >= date_trunc('month', NOW())"),
    // AI cost today
    db.get("SELECT COALESCE(SUM(estimated_cost),0) AS c FROM ai_usage_logs WHERE created_at >= NOW() - INTERVAL '24 hours'"),
    // AI cost this month
    db.get("SELECT COALESCE(SUM(estimated_cost),0) AS c FROM ai_usage_logs WHERE created_at >= date_trunc('month', NOW())"),
    // New signups today
    db.get("SELECT COUNT(*) AS n FROM users WHERE created_at >= NOW() - INTERVAL '24 hours'"),
    // New signups this month
    db.get("SELECT COUNT(*) AS n FROM users WHERE created_at >= date_trunc('month', NOW())"),
  ]);

  const monthlyCount = parseInt(monthly.n) || 0;
  const yearlyCount  = parseInt(yearly.n)  || 0;
  const freeCount    = parseInt(free.n)    || 0;
  const paidCount    = monthlyCount + yearlyCount;

  // MRR: monthly subscribers × $9 + yearly × ($79/12)
  const mrr = (monthlyCount * 9) + (yearlyCount * (79 / 12));

  // Conversion rate: paid / (paid + free), if any free users exist
  const conversionRate = (paidCount + freeCount) > 0
    ? ((paidCount / (paidCount + freeCount)) * 100).toFixed(1)
    : "0.0";

  res.json({
    totalUsers:      parseInt(total.n)  || 0,
    activeUsers:     parseInt(active.n) || 0,
    activeCodes:     parseInt(codes.n)  || 0,
    monthly:         monthlyCount,
    yearly:          yearlyCount,
    free:            freeCount,
    paid:            paidCount,
    mrr:             Math.round(mrr * 100) / 100,
    conversionRate,
    aiToday:         parseInt(aiToday.n)   || 0,
    aiMonth:         parseInt(aiMonth.n)   || 0,
    aiCostToday:     parseFloat(aiCostToday.c)  || 0,
    aiCostMonth:     parseFloat(aiCostMonth.c)  || 0,
    newSignupsToday: parseInt(newToday.n)  || 0,
    newSignupsMonth: parseInt(newMonth.n)  || 0,
  });
});

// GET /admin/api/users
router.get("/api/users", adminAuth, async (req, res) => {
  const users = await db.all(`
    SELECT u.id, u.email, u.plan, u.status, u.created_at,
           ac.code, ac.is_active, ac.expires_at
    FROM users u
    LEFT JOIN access_codes ac ON ac.user_id = u.id AND ac.is_active = 1
    ORDER BY u.created_at DESC
    LIMIT 200
  `);
  res.json(users);
});

// GET /admin/api/codes
router.get("/api/codes", adminAuth, async (req, res) => {
  const codes = await db.all(`
    SELECT ac.id, ac.code, ac.is_active, ac.expires_at, ac.created_at,
           u.email, u.plan, u.status
    FROM access_codes ac
    JOIN users u ON u.id = ac.user_id
    ORDER BY ac.created_at DESC
    LIMIT 200
  `);
  res.json(codes);
});

// POST /admin/api/codes/generate — manually create a code for an email
router.post("/api/codes/generate", adminAuth, async (req, res) => {
  const { email, plan = "monthly", sendEmail: doSendEmail = true } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required." });

  await db.run(`
    INSERT INTO users (email, plan, status) VALUES ($1, $2, 'active')
    ON CONFLICT(email) DO UPDATE SET plan = excluded.plan, status = 'active'
  `, [email, plan]);

  const user = await db.get("SELECT id FROM users WHERE email = $1", [email]);

  await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [user.id]);

  const code      = generateCode();
  const expiresAt = codeExpiryDate(plan);
  await db.run(
    "INSERT INTO access_codes (user_id, code, is_active, expires_at) VALUES ($1, $2, 1, $3)",
    [user.id, code, expiresAt]
  );

  if (doSendEmail) {
    await welcomeEmail(email, code, plan);
  }

  res.json({ code, expiresAt, email, plan });
});

// DELETE /admin/api/codes/:id — revoke a code
router.delete("/api/codes/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  const result = await db.run("UPDATE access_codes SET is_active = 0 WHERE id = $1", [id]);
  if (result.changes === 0) return res.status(404).json({ error: "Code not found." });
  res.json({ revoked: true });
});

// PATCH /admin/api/users/:id — update user status
router.patch("/api/users/:id", adminAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "cancelled", "suspended"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const result = await db.run("UPDATE users SET status = $1 WHERE id = $2", [status, req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "User not found." });
  if (status !== "active") {
    await db.run("UPDATE access_codes SET is_active = 0 WHERE user_id = $1", [req.params.id]);
  }
  res.json({ updated: true });
});

// POST /admin/api/email — send a custom email to a subscriber
router.post("/api/email", adminAuth, async (req, res) => {
  const { userId, subject, message } = req.body || {};
  if (!userId || !subject || !message) {
    return res.status(400).json({ error: "userId, subject, and message are required." });
  }

  const user = await db.get("SELECT email FROM users WHERE id = $1", [userId]);
  if (!user) return res.status(404).json({ error: "User not found." });

  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const safeMsg = String(message).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  await sendEmail(
    user.email,
    subject,
    `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#2563eb;font-size:18px;margin-bottom:16px">🌐 Tonge</h2>
      <div style="color:#334155;font-size:14px;line-height:1.8;white-space:pre-wrap">${safeMsg}</div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
      <p style="color:#94a3b8;font-size:12px">
        Questions? Reply to this email or visit <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a>
      </p>
    </div>
    `
  );

  res.json({ sent: true, to: user.email });
});

// GET /admin — serve admin dashboard HTML
router.get("/", (req, res) => {
  res.send(adminHTML());
});

// ── Admin Dashboard HTML ──────────────────────────────────────────────────────

function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admin — Tonge</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;min-height:100vh}
    .container{max-width:960px;margin:0 auto;padding:20px}
    h1{font-size:20px;font-weight:900;color:#2563eb;margin-bottom:4px}
    .subtitle{color:#64748b;font-size:13px;margin-bottom:20px}
    .card{background:#fff;border-radius:12px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
    .stat{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
    .stat-n{font-size:28px;font-weight:900;color:#2563eb}
    .stat-l{font-size:11px;color:#64748b;margin-top:2px}
    input,select,textarea{width:100%;padding:9px 12px;border-radius:8px;border:1px solid #e2e8f0;font-size:13px;margin-bottom:8px;font-family:inherit}
    textarea{resize:vertical;height:100px}
    button{padding:9px 18px;border-radius:8px;border:none;font-size:13px;font-weight:700;cursor:pointer}
    .btn-primary{background:#2563eb;color:#fff}
    .btn-danger{background:#dc2626;color:#fff}
    .btn-neutral{background:#f1f5f9;color:#334155}
    .btn-sm{padding:4px 10px;font-size:11px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;padding:8px 10px;background:#f8fafc;font-weight:700;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
    tr:hover td{background:#f8fafc}
    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700}
    .badge-active{background:#dcfce7;color:#16a34a}
    .badge-cancelled{background:#fee2e2;color:#dc2626}
    .badge-inactive{background:#f1f5f9;color:#94a3b8}
    .login-box{max-width:340px;margin:80px auto}
    #err{color:#dc2626;font-size:12px;margin-top:6px}
    #status{color:#16a34a;font-size:12px;margin-top:6px}
    .tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
    .tab{padding:6px 16px;border-radius:8px;border:2px solid #e2e8f0;background:#fff;font-size:12px;font-weight:700;color:#64748b;cursor:pointer}
    .tab.active{border-color:#2563eb;color:#2563eb;background:#eff6ff}
    .hidden{display:none!important}
    /* Email modal */
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px}
    .modal-box{background:#fff;border-radius:14px;padding:24px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
    .modal-title{font-size:15px;font-weight:700;margin-bottom:14px;color:#0f172a}
  </style>
</head>
<body>
<div class="container">
  <div id="login-view">
    <div class="login-box">
      <div class="card">
        <h1 style="margin-bottom:16px">🌐 Admin Login</h1>
        <input type="password" id="pw" placeholder="Admin password" onkeydown="if(event.key==='Enter')login()"/>
        <button class="btn-primary" onclick="login()" style="width:100%">Login</button>
        <div id="err"></div>
      </div>
    </div>
  </div>

  <div id="admin-view" class="hidden">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
      <h1>🌐 Tonge Admin</h1>
      <button class="btn-neutral btn-sm" onclick="logout()">Log out</button>
    </div>
    <p class="subtitle">Subscriber management</p>

    <div class="stats" id="stats"></div>

    <div class="tabs">
      <button class="tab active" onclick="showTab('users')">Users</button>
      <button class="tab" onclick="showTab('codes')">Access Codes</button>
      <button class="tab" onclick="showTab('generate')">Generate Code</button>
      <button class="tab" onclick="showTab('broadcast')">Email Subscriber</button>
      <button class="tab" onclick="showTab('content')">Content Library</button>
    </div>

    <!-- Users tab -->
    <div id="tab-users" class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <strong>Subscribers</strong>
        <button class="btn-primary btn-sm" onclick="loadUsers()">Refresh</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Email</th><th>Plan</th><th>Status</th><th>Code</th><th>Expires</th><th>Joined</th><th></th></tr></thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Codes tab -->
    <div id="tab-codes" class="card hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <strong>Access Codes</strong>
        <button class="btn-primary btn-sm" onclick="loadCodes()">Refresh</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Code</th><th>Email</th><th>Plan</th><th>Active</th><th>Expires</th><th></th></tr></thead>
          <tbody id="codes-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Generate tab -->
    <div id="tab-generate" class="card hidden">
      <strong style="display:block;margin-bottom:12px">Generate Access Code</strong>
      <input id="gen-email" placeholder="Subscriber email" type="email"/>
      <select id="gen-plan">
        <option value="monthly">Monthly ($9/month)</option>
        <option value="yearly">Yearly ($79/year)</option>
      </select>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="gen-send" checked style="width:auto;margin:0"/> Send welcome email with code
      </label>
      <button class="btn-primary" onclick="generateCode()">Generate Code</button>
      <div id="status"></div>
    </div>

    <!-- Content Library tab -->
    <div id="tab-content" class="card hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <strong>Content Library</strong>
          <p style="font-size:12px;color:#64748b;margin-top:2px">Server-cached grammar, vocab, cheatsheet and structures for all 10 languages. Generated once, served to everyone.</p>
        </div>
        <button class="btn-primary btn-sm" onclick="loadContentStatus()">Refresh Status</button>
      </div>
      <div id="content-grid" style="font-size:13px;color:#64748b;padding:20px 0;text-align:center">Loading…</div>
    </div>

    <!-- Email Subscriber tab -->
    <div id="tab-broadcast" class="card hidden">
      <strong style="display:block;margin-bottom:4px">Email a Subscriber</strong>
      <p style="font-size:12px;color:#64748b;margin-bottom:12px">Send a custom email to any subscriber by their user ID. Find the ID in the Users tab.</p>
      <input id="bc-userid" placeholder="User ID (number from Users table)" type="number"/>
      <input id="bc-subject" placeholder="Subject"/>
      <textarea id="bc-message" placeholder="Message (plain text)"></textarea>
      <button class="btn-primary" onclick="sendBroadcast()">Send Email</button>
      <div id="bc-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  </div>
</div>

<!-- Email modal (opened from Users table row) -->
<div id="email-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-title">Email subscriber: <span id="email-modal-addr" style="color:#2563eb"></span></div>
    <input id="em-subject" placeholder="Subject"/>
    <textarea id="em-body" placeholder="Message (plain text)..."></textarea>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn-primary" onclick="sendModalEmail()" style="flex:1">Send</button>
      <button class="btn-neutral" onclick="closeEmailModal()" style="flex:1">Cancel</button>
    </div>
    <div id="em-status" style="font-size:12px;margin-top:8px"></div>
  </div>
</div>

<script>
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let adminToken = localStorage.getItem('admin_token');
if (adminToken) { document.getElementById('login-view').classList.add('hidden'); document.getElementById('admin-view').classList.remove('hidden'); loadDashboard(); }

async function login() {
  const pw = document.getElementById('pw').value;
  const r = await fetch('/admin/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw}) });
  const d = await r.json();
  if (!r.ok) { document.getElementById('err').textContent = d.error; return; }
  adminToken = d.token;
  localStorage.setItem('admin_token', adminToken);
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('admin-view').classList.remove('hidden');
  loadDashboard();
}

function headers() { return { 'Content-Type':'application/json', 'x-admin-token': adminToken }; }

async function loadDashboard() { await Promise.all([loadStats(), loadUsers()]); }

async function loadStats() {
  const r = await fetch('/admin/api/stats', { headers: headers() });
  if (r.status === 401) { logout(); return; }
  const d = await r.json();
  const fmt$ = n => '$' + Number(n).toFixed(2);
  document.getElementById('stats').innerHTML = \`
    <div class="stat"><div class="stat-n">\${d.paid}</div><div class="stat-l">Paid Users</div></div>
    <div class="stat"><div class="stat-n" style="color:#16a34a">$\${Math.round(d.mrr)}</div><div class="stat-l">MRR (est.)</div></div>
    <div class="stat"><div class="stat-n">\${d.monthly}</div><div class="stat-l">Monthly</div></div>
    <div class="stat"><div class="stat-n">\${d.yearly}</div><div class="stat-l">Yearly</div></div>
    <div class="stat"><div class="stat-n">\${d.free}</div><div class="stat-l">Free Users</div></div>
    <div class="stat"><div class="stat-n">\${d.conversionRate}%</div><div class="stat-l">Conversion</div></div>
    <div class="stat"><div class="stat-n">\${d.aiToday}</div><div class="stat-l">AI Calls Today</div></div>
    <div class="stat"><div class="stat-n" style="color:#dc2626">\${fmt$(d.aiCostToday)}</div><div class="stat-l">AI Cost Today</div></div>
    <div class="stat"><div class="stat-n">\${d.aiMonth}</div><div class="stat-l">AI Calls/Month</div></div>
    <div class="stat"><div class="stat-n" style="color:#dc2626">\${fmt$(d.aiCostMonth)}</div><div class="stat-l">AI Cost/Month</div></div>
    <div class="stat"><div class="stat-n">\${d.newSignupsToday}</div><div class="stat-l">Signups Today</div></div>
    <div class="stat"><div class="stat-n">\${d.totalUsers}</div><div class="stat-l">Total Users</div></div>
  \`;
}

async function loadUsers() {
  const r = await fetch('/admin/api/users', { headers: headers() });
  const users = await r.json();
  document.getElementById('users-tbody').innerHTML = users.map(u => \`
    <tr>
      <td>\${esc(u.email)}</td>
      <td>\${esc(u.plan)}</td>
      <td><span class="badge badge-\${esc(u.status)}">\${esc(u.status)}</span></td>
      <td style="font-family:monospace;font-weight:700">\${esc(u.code) || '—'}</td>
      <td>\${u.expires_at ? new Date(u.expires_at).toLocaleDateString() : '—'}</td>
      <td>\${new Date(u.created_at).toLocaleDateString()}</td>
      <td style="white-space:nowrap;display:flex;gap:4px">
        \${u.status === 'active'
          ? \`<button class="btn-danger btn-sm" onclick="setStatus(\${u.id},'cancelled')">Cancel</button>\`
          : \`<button class="btn-primary btn-sm" onclick="setStatus(\${u.id},'active')">Reactivate</button>\`
        }
        <button class="btn-neutral btn-sm" onclick="openEmailModal(\${u.id},this.dataset.email)" data-email="\${esc(u.email)}">Email</button>
      </td>
    </tr>
  \`).join('');
}

async function loadCodes() {
  const r = await fetch('/admin/api/codes', { headers: headers() });
  const codes = await r.json();
  document.getElementById('codes-tbody').innerHTML = codes.map(c => \`
    <tr>
      <td style="font-family:monospace;font-weight:700">\${esc(c.code)}</td>
      <td>\${esc(c.email)}</td>
      <td>\${esc(c.plan)}</td>
      <td><span class="badge \${c.is_active ? 'badge-active' : 'badge-inactive'}">\${c.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>\${new Date(c.expires_at).toLocaleDateString()}</td>
      <td>\${c.is_active ? \`<button class="btn-danger btn-sm" onclick="revokeCode(\${c.id})">Revoke</button>\` : ''}</td>
    </tr>
  \`).join('');
}

async function setStatus(id, status) {
  if (!confirm(\`Set user status to \${status}?\`)) return;
  await fetch(\`/admin/api/users/\${id}\`, { method:'PATCH', headers:headers(), body:JSON.stringify({status}) });
  loadUsers(); loadStats();
}

async function revokeCode(id) {
  if (!confirm('Revoke this code?')) return;
  await fetch(\`/admin/api/codes/\${id}\`, { method:'DELETE', headers:headers() });
  loadCodes(); loadStats();
}

async function generateCode() {
  const email = document.getElementById('gen-email').value;
  const plan = document.getElementById('gen-plan').value;
  const sendEmail = document.getElementById('gen-send').checked;
  const status = document.getElementById('status');
  if (!email) { status.style.color='#dc2626'; status.textContent='Email required'; return; }
  const r = await fetch('/admin/api/codes/generate', { method:'POST', headers:headers(), body:JSON.stringify({email,plan,sendEmail}) });
  const d = await r.json();
  if (!r.ok) { status.style.color='#dc2626'; status.textContent = d.error; return; }
  status.style.color='#16a34a';
  status.textContent = \`Code generated: \${d.code} (expires \${new Date(d.expiresAt).toLocaleDateString()})\`;
  loadStats();
}

async function sendBroadcast() {
  const userId = document.getElementById('bc-userid').value;
  const subject = document.getElementById('bc-subject').value.trim();
  const message = document.getElementById('bc-message').value.trim();
  const el = document.getElementById('bc-status');
  if (!userId || !subject || !message) { el.style.color='#dc2626'; el.textContent='All fields required.'; return; }
  el.style.color='#64748b'; el.textContent='Sending…';
  const r = await fetch('/admin/api/email', { method:'POST', headers:headers(), body:JSON.stringify({userId:Number(userId),subject,message}) });
  const d = await r.json();
  if (!r.ok) { el.style.color='#dc2626'; el.textContent=d.error; return; }
  el.style.color='#16a34a'; el.textContent=\`Sent to \${d.to}\`;
}

// Email modal helpers
let _emailModalUserId = null;
function openEmailModal(userId, email) {
  _emailModalUserId = userId;
  document.getElementById('email-modal-addr').textContent = email;
  document.getElementById('em-subject').value = '';
  document.getElementById('em-body').value = '';
  document.getElementById('em-status').textContent = '';
  document.getElementById('email-modal').classList.remove('hidden');
}
function closeEmailModal() {
  document.getElementById('email-modal').classList.add('hidden');
  _emailModalUserId = null;
}
async function sendModalEmail() {
  const subject = document.getElementById('em-subject').value.trim();
  const message = document.getElementById('em-body').value.trim();
  const el = document.getElementById('em-status');
  if (!subject || !message) { el.style.color='#dc2626'; el.textContent='Subject and message required.'; return; }
  el.style.color='#64748b'; el.textContent='Sending…';
  const r = await fetch('/admin/api/email', { method:'POST', headers:headers(), body:JSON.stringify({userId:_emailModalUserId,subject,message}) });
  const d = await r.json();
  if (!r.ok) { el.style.color='#dc2626'; el.textContent=d.error; return; }
  el.style.color='#16a34a'; el.textContent=\`Sent to \${d.to}\`;
  setTimeout(closeEmailModal, 1400);
}

// ── Content Library ──────────────────────────────────────────────────────────
const LANG_FLAGS = {es:'🇪🇸',de:'🇩🇪',en:'🇺🇸',pt:'🇧🇷',it:'🇮🇹',zh:'🇨🇳',ja:'🇯🇵',ko:'🇰🇷',ru:'🇷🇺',ar:'🇸🇦'};
const LANG_NAMES_ADMIN = {es:'Spanish',de:'German',en:'English',pt:'Portuguese',it:'Italian',zh:'Chinese',ja:'Japanese',ko:'Korean',ru:'Russian',ar:'Arabic'};
const TABS_ADMIN = ['grammar','cheatsheet','structures','vocab'];

async function loadContentStatus() {
  const el = document.getElementById('content-grid');
  el.textContent = 'Loading…';
  const r = await fetch('/api/content/status', { headers: headers() });
  if (!r.ok) { el.textContent = 'Failed to load status.'; return; }
  const d = await r.json();
  const langs = d.langs || Object.keys(LANG_NAMES_ADMIN);
  let html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">Language</th>';
  TABS_ADMIN.forEach(t => { html += \`<th style="padding:6px 8px;border-bottom:2px solid #e2e8f0;text-transform:capitalize">\${t}</th>\`; });
  html += '<th style="padding:6px 8px;border-bottom:2px solid #e2e8f0">Refresh</th></tr></thead><tbody>';
  langs.forEach(lang => {
    const cached = d.cached[lang] || {};
    const allDone = TABS_ADMIN.every(t => cached[t]);
    html += \`<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px;font-weight:700">\${LANG_FLAGS[lang] || ''} \${LANG_NAMES_ADMIN[lang] || lang}</td>\`;
    TABS_ADMIN.forEach(t => {
      const ts = cached[t];
      html += \`<td style="text-align:center;padding:8px">
        \${ts
          ? \`<span title="Generated \${new Date(ts).toLocaleString()}" style="color:#16a34a;font-size:16px" onclick="regenOne('\${lang}','\${t}',this)" style="cursor:pointer">✓</span>\`
          : \`<span style="color:#dc2626;font-size:16px;cursor:pointer" onclick="regenOne('\${lang}','\${t}',this)">✗</span>\`
        }
      </td>\`;
    });
    html += \`<td style="text-align:center;padding:8px">
      <button class="btn-neutral btn-sm" onclick="regenLang('\${lang}', this)" \${allDone ? '' : 'style="background:#2563eb;color:#fff"'}>
        \${allDone ? 'Refresh' : 'Generate'}
      </button>
    </td></tr>\`;
  });
  html += \`</tbody></table></div>
    <div style="margin-top:12px;font-size:11px;color:#94a3b8">
      \${d.total}/\${d.possible} items cached · ✓ = ready · ✗ = not generated yet · Click ✓/✗ to regenerate single item
    </div>\`;
  el.innerHTML = html;
}

async function regenLang(lang, btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generating…';
  const r = await fetch(\`/api/content/regenerate/\${lang}\`, { method:'POST', headers:headers() });
  const d = await r.json();
  btn.textContent = orig; btn.disabled = false;
  // Reload status after a few seconds (generation runs in background)
  setTimeout(loadContentStatus, 8000);
}

async function regenOne(lang, tab, el) {
  const orig = el.textContent;
  el.textContent = '⏳';
  const r = await fetch(\`/api/content/regenerate/\${lang}/\${tab}\`, { method:'POST', headers:headers() });
  el.textContent = orig;
  setTimeout(loadContentStatus, 6000);
}

function showTab(name) {
  ['users','codes','generate','broadcast','content'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tab').forEach((el,i) => {
    el.classList.toggle('active', ['users','codes','generate','broadcast','content'][i] === name);
  });
  if (name === 'codes') loadCodes();
  if (name === 'content') loadContentStatus();
}

function logout() { localStorage.removeItem('admin_token'); location.reload(); }
</script>
</body>
</html>`;
}

// Export adminAuth as requireAdmin so content.js can use it
module.exports = router;
module.exports.requireAdmin = adminAuth;
