-- Tongue — Enable Row Level Security on all tables
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- This blocks direct Supabase REST API access to your data.
-- The app connects via DATABASE_URL (direct PostgreSQL) and bypasses RLS,
-- so enabling this does NOT break the app.

ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Block all access via the REST API (no policies = deny all)
-- The app uses direct pg connection which bypasses RLS entirely.
