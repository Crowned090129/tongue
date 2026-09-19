'use strict';
/**
 * What AI actually costs per learner — read from what was really spent.
 *
 * Every AI call already records its true token counts in ai_usage_logs. Nothing
 * has ever read them, so every cost figure in docs/CAPACITY.md is an estimate.
 * This replaces the estimates with measurements, and in particular answers the
 * question that sets the daily allowance: how many messages do the heaviest
 * learners actually send?
 *
 * The stored `estimated_cost` column is NOT used. It was computed with a rate
 * hardcoded at $3/$15 per MTok, which is not necessarily the deployed model's
 * price. Cost here is recomputed from the token columns at the rate you pass in,
 * and the rate used is printed so no number is ever unattributed.
 *
 *   Locally (against a test database):
 *     DATABASE_URL=postgres://... node scripts/ai-usage.js
 *
 *   Against production, without the credential ever leaving the machine:
 *     fly ssh console -a tongue-app -C "node /app/scripts/ai-usage.js"
 *
 *   With a different rate (defaults below are current Claude Sonnet 5 rates):
 *     AI_INPUT_PER_MTOK=2 AI_OUTPUT_PER_MTOK=10 node scripts/ai-usage.js
 */
const { Pool } = require('pg');

const IN_RATE = Number(process.env.AI_INPUT_PER_MTOK || 2);
const OUT_RATE = Number(process.env.AI_OUTPUT_PER_MTOK || 10);
const DAYS = Number(process.env.DAYS || 30);
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set.\nRun it on the machine instead, where it already is:\n  fly ssh console -a tongue-app -C "node /app/scripts/ai-usage.js"');
  process.exit(1);
}

const money = n => '$' + Number(n).toFixed(2);
const cost = (inTok, outTok) => (inTok / 1e6) * IN_RATE + (outTok / 1e6) * OUT_RATE;

(async () => {
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    family: 4,
  });
  const q = (sql, params = []) => pool.query(sql, params).then(r => r.rows);
  const since = `NOW() - INTERVAL '${DAYS} days'`;

  console.log(`\nAI usage over the last ${DAYS} days`);
  console.log(`Rate applied: $${IN_RATE}/MTok input, $${OUT_RATE}/MTok output (override with AI_INPUT_PER_MTOK / AI_OUTPUT_PER_MTOK)\n`);

  const total = (await q(`SELECT COUNT(*)::int calls, COALESCE(SUM(input_length),0)::bigint tin, COALESCE(SUM(output_length),0)::bigint tout, COUNT(DISTINCT user_id)::int learners FROM ai_usage_logs WHERE created_at > ${since}`))[0];
  if (!total.calls) {
    console.log('No AI calls recorded in this window. Nothing to measure yet.\n');
    return pool.end();
  }
  const spend = cost(Number(total.tin), Number(total.tout));
  console.log(`${total.calls} calls from ${total.learners} learners · ${money(spend)} total · ${money(spend / total.calls)} per message`);
  console.log(`Average message: ${Math.round(Number(total.tin) / total.calls)} in / ${Math.round(Number(total.tout) / total.calls)} out\n`);

  console.log('By feature:');
  for (const r of await q(`SELECT feature_type, COUNT(*)::int calls, AVG(input_length)::int avg_in, AVG(output_length)::int avg_out, COALESCE(SUM(input_length),0)::bigint tin, COALESCE(SUM(output_length),0)::bigint tout FROM ai_usage_logs WHERE created_at > ${since} GROUP BY feature_type ORDER BY calls DESC`)) {
    const c = cost(Number(r.tin), Number(r.tout));
    console.log(`  ${String(r.feature_type || 'unknown').padEnd(18)} ${String(r.calls).padStart(6)} calls  ${String(r.avg_in).padStart(5)} in / ${String(r.avg_out).padStart(5)} out  ${money(c).padStart(9)}  ${money(c / r.calls)}/msg`);
  }

  // The number that should set the daily cap: what the heaviest real learner
  // costs, not what the cap theoretically permits.
  console.log('\nBusiest single days per learner (the figure the cap should be set from):');
  const busiest = await q(`
    SELECT msgs, COUNT(*)::int learner_days FROM (
      SELECT user_id, created_at::date d, COUNT(*)::int msgs
      FROM ai_usage_logs WHERE created_at > ${since} AND user_id IS NOT NULL
      GROUP BY user_id, d
    ) x GROUP BY msgs ORDER BY msgs DESC LIMIT 10`);
  for (const r of busiest) console.log(`  ${String(r.msgs).padStart(4)} messages in one day  ×${r.learner_days}`);

  const perLearner = await q(`
    SELECT COALESCE(SUM(input_length),0)::bigint tin, COALESCE(SUM(output_length),0)::bigint tout
    FROM ai_usage_logs WHERE created_at > ${since} AND user_id IS NOT NULL GROUP BY user_id ORDER BY (SUM(input_length)+SUM(output_length)) DESC`);
  if (perLearner.length) {
    const costs = perLearner.map(r => cost(Number(r.tin), Number(r.tout))).sort((a, b) => a - b);
    const at = q2 => costs[Math.min(costs.length - 1, Math.floor(costs.length * q2))];
    console.log(`\nCost per learner over ${DAYS} days: median ${money(at(0.5))} · p90 ${money(at(0.9))} · max ${money(costs[costs.length - 1])}`);
    console.log('Compare the top end against what a subscription actually earns before changing any allowance.\n');
  }
  await pool.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
