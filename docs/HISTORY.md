# Tongue: project history

Why this file exists: the code only shows the current state. Astra also needs to know what
was already tried, what was deliberately dropped, and which leftovers in the repository are
dead weight rather than design. Every era below is anchored to real commits (`git log`).
55 commits, 2026-06-09 → 2026-09-17.

Read with: `git show <hash> --stat` for any commit named here.

---

## Era 0 — "Tonge", blue, on Railway (2026-06-09 → 2026-07-11)

First commit `a5a4718` already contained most of the business: Express + Postgres (Supabase),
Stripe checkout, access codes, an admin panel, flashcards, the AI coach proxy, and the SEO
landing pages. It shipped as **"Tonge"** — a typo that outlived the era and is still visible
in the second Fly app name.

- **The blue design.** The original palette was a stock blue/slate UI kit: `#2563eb` blue,
  `#64748b` slate, `#0f172a` ink, with emoji tabs and modal-driven navigation. Verify with
  `git show a5a4718:public/index.html | grep -o '#[0-9A-Fa-f]\{6\}' | sort | uniq -c | sort -rn`.
  It was replaced wholesale in Era 1; nothing of it should come back.
- **Railway, then not.** Five commits in six days flip-flopped between Nixpacks and a
  Dockerfile (`43a3280`, `4bf7c43`, `e6f096d`, `113a79b`, `778d740`). Three more fought
  Supabase over IPv6 (`36bc942`, `932c149`, `e63f58a`).
- **Live leftovers from this era:** `railway.json`, `railway.toml`, `nixpacks.toml` (dead —
  deletion is scheduled in migration phase P1), and `--dns-result-order=ipv4first` in the
  Dockerfile `CMD`, which is still load-bearing for the Supabase connection.
- **Security debt born here:** `DEPLOY.md` carried the real `ADMIN_PASSWORD` in commit
  `a5a4718`. The repository is public. The value is redacted in the working tree from
  `b3f6504` onward but remains in history — rotation is the only real fix (gate G5).
- UX overhaul `0aaa80b` and the first docs `0efd847` close the era.

## Era 1 — One accent, one design system (2026-07-11 → 2026-07-14)

`cb2afad` introduced VoiceTutor, TextAnalyzer, ShareCard **and the single-accent design
system** — this is where blue died and crimson `#C0153E` / pink `#FF5F7E` became the brand.
`117253d` doubled per-language content depth; `7a622fc` built the persistent desktop sidebar
and two-pane stage; `4c1a5cf` stripped decorative emoji (357 of them) in favour of Lucide
icons; `e07d5b2` added the content error-report loop (`content_reports`).

Dropped later: the sidebar as primary navigation (Era 8), VoiceTutor (Era 5), ShareCardModal
(now dead code).

## Era 2 — Native clients (2026-07-14)

`e226aa7` and `d01bf11` added `native/ios` (SwiftUI) and `native/android` (Kotlin/Compose) as
API clients — login, home, coach, reference, flashcards. **They were never shipped**, no later
redesign touched them, and they still point at the old `tonge-app` host and gate French out.
Decision on their future is deferred to migration phase P12.

## Era 3 — Content becomes an API, not code (2026-07-17 → 2026-07-19)

The most important architectural move before P0. `9ade309` made drills and roadmap API content
types; `675be53` brought French into the same pipeline and levelled all 12 languages;
`34326f9`, `c5a5ba9` and `f4c55e1` deleted every hardcoded lesson block from the client
(index.html dropped from 669 KB to 376 KB). After this, no lesson content lives in code.

`2d18845` "stop the 6-hourly regeneration loop" was the **first** attempt at the problem P0
finally fixed properly with the `CONTENT_AUTOGEN` freeze: generated content silently rewriting
rows that users' progress points at.

## Era 4 — Ways in (2026-07-19 → 2026-07-21)

Device-language default (`06ad361`), Gmail/SMTP delivery (`1eb768b`), the intent-first home
(`5b64526`, "What do you want to do?"), Google sign-in (`cd30403`, still dormant — needs
`GOOGLE_CLIENT_ID`), and passwordless magic links (`cad7826`). Four sign-in paths now exist
and all funnel through `issueSessionForEmail` in `routes/auth.js`.

## Era 5 — The paid hook, and an honesty pass (2026-09-07 → 2026-09-08)

- `4e3b533` replaced the rigid one-shot voice tutor with the real streaming conversation
  engine (`POST /api/claude/chat`, SSE, 10 server-owned scenarios). This is the monetisation
  feature.
- `2987e4a` "kill the half-done/static tells" — fake resume cards, dead CTAs, `alert()` calls.
- `4dde207` removed "AI" from all user-facing copy (Coach / tutor / Helper / smart). **Keep it
  that way.**
- `5731f1b` + `169b411` built the curated seed corpus: 84 files, 12 languages × 7 tabs, so the
  app has real content with zero AI credits. `a87f08c` made seeding upgrade shallower rows —
  the exact mechanism P0 later put behind `CONTENT_SEED_UPGRADE` because it silently remaps
  position-keyed lesson progress.

## Era 6 — The crafted identity (2026-09-08)

`61d1859` rebuilt the landing page and `cb66af2` carried it into the app: **Fraunces** (display)
+ **Instrument Sans** (UI), warm paper ivory, warm brown-black ink, oxblood dark sections.
Space Grotesk and system-ui were retired as "AI-tell" faces. `a19b940` and `ff3e0d7` polished.
This identity is explicitly preserved by the target architecture — do not restyle it.

## Era 7 — The URL fix and a content-forward home (2026-09-09)

`fbc047a` migrated to `tongue-app.fly.dev`, fixing the "tonge" typo. Fly cannot rename apps, so
a **new** app was created sharing the same Supabase database and JWT secret. The old
`tonge-app` was left running — it is still live today on the same production database, running
duplicate cron jobs on 2 machines (gate **G7**).

Also: Word of the Day (`187284b`), a remount-cache patch (`54aae37`), a desktop login fix
(`31d0cb8`), and per-category "Generate more words" (`80f117e`).

## Era 8 — The spatial redesign (2026-09-13)

`ae35713` was a large single commit: top-bar navigation replacing the sidebar, Learn as a
visual course map with progress rings, spatial grids instead of endless lists, tap-a-sentence
breakdown wired everywhere, a 10-theme accent system (crimson default, opt-in), real curated
data for the 9 placeholder languages, access-code email binding, and streaks made free.

**The owner rejected the result** at 2000px — "nothing is understandable, nothing looks right,
it feels static" — and identified the real problem as architectural rather than visual. That
rejection is what produced the forensics review. Treat Era 8 as symptom-level work built on an
architecture that could not support it.

## Era 9 — Forensics, target, plan, and P0 (2026-09-14 → 2026-09-17)

Evidence-first audit of the whole repository plus a live session, adversarially verified:
114 claims, 65 confirmed, 49 partly confirmed, 0 refuted. It produced
`docs/ARCHITECTURE_FORENSICS.md`, `docs/TARGET_ARCHITECTURE.md` and `docs/MIGRATION_PLAN.md`.

Headline finding: **the suspicion that each language had its own implementation was wrong.**
There is one content pipeline and one set of screens parameterised by language. The real
fragmentation is ~15 copies of the language registry, a second hand-authored language data
model in the client, per-feature `localStorage` stores instead of a learner model, read-only
"lessons", and no application shell.

`b3f6504` shipped **P0** (safety and stabilisation) — see `docs/PROJECT_STATE.md` for exactly
what is verified and what is not.

---

## Things that were tried and deliberately dropped

| Dropped | Era | Why | Leftovers to remove |
|---|---|---|---|
| Blue/slate design kit | 1 | Replaced by the single-accent crimson identity | none |
| Railway + Nixpacks | 0→? | Moved to Fly.io | `railway.json`, `railway.toml`, `nixpacks.toml` |
| SQLite (`better-sqlite3`) | 0 | Moved to Postgres | `scripts/prewarm-content.js` (broken), `data/french.db` |
| Capacitor wrapper | 1 | Native apps built instead | `capacitor.config.json`, `cap:*` scripts, push bootstrap in index.html |
| Decorative emoji | 1 | Owner requirement — icons only (flags stay) | do not reintroduce |
| VoiceTutor (voice-only) | 5 | Locked out users without speech recognition | replaced by `Conversation` |
| "AI" branding | 5 | Should read as a smart tutor, not an AI wrapper | do not reintroduce |
| Hardcoded lesson blocks | 3 | Content became API + seed data | none |
| Sidebar as primary nav | 8 | Owner rejected it | `DesktopNav` is dead code |
| 6-hourly regeneration | 3, then P0 | Rewrites rows progress depends on | now behind `CONTENT_AUTOGEN` |

## Recurring mistakes worth not repeating

1. **Patching the symptom.** `54aae37` cached around remount churn; `31d0cb8` fixed one screen's
   layout; `ae35713` restyled screens that had no shared shell. Each closed one symptom and left
   the pattern. The migration plan exists to stop this.
2. **Silent content overwrites.** Attacked twice (`2d18845`, `a87f08c`) before P0 froze it.
3. **Claiming done from a partial pass.** Several times a fix was applied to one screen and
   reported as finished. Verify every call site, then say what you did not check.
4. **Tests that only appeared to run.** The suite silently skipped itself whenever `DATABASE_URL`
   was unset, and it pointed at production when it was set. Both fixed in `b3f6504`.
