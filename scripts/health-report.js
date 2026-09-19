'use strict';
/**
 * What testers actually hit — crashes, and where missions lose people.
 *
 * Both come from analytics_events, which nothing else reads. Without this, a
 * learner who hits a blank screen is invisible, and a mission that loses
 * everyone at step three looks identical to one that works.
 *
 *   fly ssh console -a tongue-app -C "node /app/scripts/health-report.js"
 */
const { Pool } = require('pg');

const DAYS = Number(process.env.DAYS || 7);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.\nRun it on the machine instead:\n  fly ssh console -a tongue-app -C "node /app/scripts/health-report.js"');
  process.exit(1);
}

(async () => {
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false }, family: 4 });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const since = `NOW() - INTERVAL '${DAYS} days'`;
  const meta = (k) => `(metadata->>'${k}')`;

  console.log(`\nLast ${DAYS} days\n`);

  const errors = await q(`
    SELECT ${meta('message')} AS message, ${meta('build')} AS build,
           COUNT(*)::int AS hits, COUNT(DISTINCT user_id)::int AS learners, MAX(created_at) AS last_seen
    FROM analytics_events WHERE event_name = 'client_error' AND created_at > ${since}
    GROUP BY 1, 2 ORDER BY hits DESC LIMIT 15`);
  console.log(errors.length ? 'Browser errors:' : 'Browser errors: none reported.');
  for (const e of errors) {
    console.log(`  ${String(e.hits).padStart(4)}× ${String(e.learners).padStart(3)} learners  ${e.message}`);
    console.log(`        build ${e.build || '?'} · last ${new Date(e.last_seen).toISOString().slice(0, 16).replace('T', ' ')}`);
  }

  // Where a mission loses people. Started minus completed is the honest number;
  // the per-step abandons say where to look.
  const funnel = await q(`
    SELECT event_name, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS learners
    FROM analytics_events WHERE event_name LIKE 'mission_%' AND created_at > ${since}
    GROUP BY 1 ORDER BY 1`);
  console.log(funnel.length ? '\nMission funnel:' : '\nMission funnel: nobody has started one yet.');
  for (const f of funnel) console.log(`  ${f.event_name.padEnd(22)} ${String(f.n).padStart(5)}  (${f.learners} learners)`);

  const verdicts = await q(`
    SELECT ${meta('stepId')} AS step, ${meta('verdict')} AS verdict, COUNT(*)::int AS n
    FROM analytics_events WHERE event_name = 'mission_step_checked' AND created_at > ${since}
    GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
  if (verdicts.length) {
    console.log('\nAnswers per step — a step that is mostly "unchecked" means the');
    console.log('authored alternatives are too narrow, not that learners are wrong:');
    for (const v of verdicts) console.log(`  ${String(v.step).padEnd(12)} ${String(v.verdict).padEnd(10)} ${String(v.n).padStart(4)}`);
  }

  const abandons = await q(`
    SELECT ${meta('stepId')} AS step, COUNT(*)::int AS n
    FROM analytics_events WHERE event_name = 'mission_abandoned' AND created_at > ${since}
    GROUP BY 1 ORDER BY n DESC`);
  if (abandons.length) {
    console.log('\nLeft mid-mission at:');
    for (const a of abandons) console.log(`  ${String(a.step).padEnd(12)} ${a.n}`);
  }
  console.log('');
  await pool.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
