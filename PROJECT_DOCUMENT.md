# TONGE — Full Business & Technical Assessment Document
### Version 2.0 · May 2026 · For Independent Review

---

## EXECUTIVE SUMMARY

**Tonge** is an AI-powered language learning SaaS application that lets users learn any of 11 languages through personalized AI coaching, spaced-repetition flashcards, grammar references, pronunciation, and streak tracking — from any browser, no app download required.

**Business model:** Freemium SaaS — free tier with 5 AI messages/day, paid at $9/month or $79/year unlocks unlimited AI + all premium features.

**Current state:** Fully functional MVP. All 11 languages operational. Stripe payments integrated. Admin dashboard live. PostgreSQL database. Ready for production deployment on Fly.io.

**Target:** 300,000 paying users within 3–5 years.

**Market:** $61 billion global language learning market growing at 18% CAGR.

---

## 1. PRODUCT

### What it does
Tonge is a complete AI language learning system — not a flashcard app, not a gamification app. It is the closest thing to having a real language tutor available 24/7 for $9/month.

### Feature Matrix
| Feature | Free | Paid ($9/mo) |
|---|---|---|
| AI Coach (fill-in, translation, roleplay, writing) | 5 msgs/day | Unlimited |
| Grammar Reference Guide (AI-generated, language-specific) | ✓ | ✓ |
| Quick Reference Cheatsheet | ✓ | ✓ |
| Sentence Structures Guide | ✓ | ✓ |
| Vocabulary Lists | ✓ | ✓ |
| Drills | ✗ | ✓ |
| Dialogues / Conversations | ✗ | ✓ |
| Spaced Repetition Flashcards | Local only | Server-synced |
| Daily Streaks (server-synced) | ✗ | ✓ |
| All 11 languages | ✓ | ✓ |
| Text-to-Speech pronunciation | ✓ | ✓ |
| Learning Roadmap (5 phases) | ✓ | ✓ |
| Word Space (translate anything) | ✓ | ✓ |

**Languages:** French · Spanish · English · Portuguese · Italian · German · Chinese · Japanese · Korean · Russian · Arabic

**Pricing:**
- Free: Sign up with email, no credit card, instant access
- Monthly: $9/month (cancel anytime)
- Yearly: $79/year (saves 27%, = $6.58/mo equivalent)

### The Key Insight — Content Cost Moat
Reference content (grammar guides, vocabulary, structures, cheatsheets) is generated **once per language by the server** and cached in PostgreSQL forever. 40 API calls total covers all 11 languages × 4 content tabs. Every subsequent user gets that content for **$0**.

This means:
- At 1 user: content costs ~$4 to generate
- At 1 million users: same content, same $4 total cost
- Only the AI Coach chat feature costs money per user (~$1.20/user/month)
- 99.9% of content delivery is free at any scale

Competitors (Babbel, Busuu) pay human editors millions to produce what Tonge generates for $40. That cost advantage compounds forever.

---

## 2. TECHNICAL ARCHITECTURE

### Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 (CDN), single HTML file, ~4,500 lines | Zero build pipeline. Deploys as static file. |
| Backend | Node.js 20 + Express | Fast, cheap, huge ecosystem |
| Database | PostgreSQL via Supabase | Scales to 100M+ rows; managed; free to start |
| AI | Anthropic Claude claude-sonnet-4-5 | Best quality/cost for language coaching |
| Payments | Stripe (Checkout + Webhooks + Portal) | Handles Apple Pay, Google Pay, all cards |
| Email | Resend | Modern API, $0 to start, excellent deliverability |
| Hosting | Fly.io (Docker) | One-command deploy; auto-scales; global regions |
| CDN/Security | Cloudflare (free) | DDoS protection; free SSL; edge caching |
| TTS | Web Speech API (browser-native) | Zero cost; works offline |
| PWA | Service Worker + Web Manifest | Installable on iOS/Android home screen |
| Auth | JWT (HS256) + nonce rotation | 2-device support; session invalidation on renewal |

### Why This Stack Handles 300k Users
- **Fly.io:** Scale from 1 → 60 machines with `fly scale count 60`. Each machine handles 5,000+ concurrent connections.
- **Supabase:** PostgreSQL pool with PgBouncer. Handles millions of transactions per second.
- **Architecture:** Stateless Node.js servers (no sticky sessions). Load balancer distributes evenly. Add machines to handle any load.
- **Infra cost at 300k users:** ~$1,200/month (Fly.io 40 machines + Supabase Team plan)

### Security Architecture
- JWT signed HS256, 30d expiry (paid) / 90d (free)
- 2-device session nonce system: login invalidates oldest device automatically
- Stripe webhook signature verification on every event
- Per-user rate limiting (not IP-based — prevents proxy bypass)
- GDPR erasure: anonymises user record, cancels Stripe subscription, wipes access codes
- All secrets in environment variables, never in source code

---

## 3. MARKET ANALYSIS

### Market Size
| Metric | Value |
|---|---|
| Global language learning market (2024) | $61.8 billion |
| App-based segment | $12.4 billion |
| CAGR | 18.7% |
| Active language learners worldwide | ~2 billion |
| Adults who tried Duolingo and need more depth | ~200 million |

### Competitive Landscape
| Company | Annual Revenue | Users | Price | Weakness |
|---|---|---|---|---|
| Duolingo | $531M ARR | 8M paid, 88M MAU | $7/mo | Tops out at A2. Gamification ≠ fluency. |
| Babbel | ~$200M ARR | ~10M subs | $14/mo | Pre-recorded content, no AI personalization |
| Rosetta Stone | ~$180M ARR | ~3M users | $12/mo | Expensive, dated UX |
| Busuu | ~$50M ARR | 120M total | $10/mo | Social features, not depth |
| Human tutors | N/A | N/A | $50–150/hr | Expensive, inflexible schedule |
| **Tonge** | **$0 (launching)** | **0 (launching)** | **$9/mo** | — |

### Tonge's Position
Not fighting Duolingo for beginners. Targeting the **post-Duolingo intermediate learner** who:
- Has tried Duolingo, hit the A2 wall, feels stuck
- Wants real conversational ability, not gamified badges
- Can't afford or schedule a human tutor
- Is an adult with disposable income and real motivation

**One-line pitch:** *"Tonge is what you use after Duolingo stops working."*

This segment is **200 million people** with **zero dominant player**. It is the biggest open gap in language learning.

---

## 4. UNIT ECONOMICS (PER USER)

### Paid Monthly User ($9/mo)
```
Revenue:                    $9.00
Stripe fees (2.9% + $0.30): -$0.56
Claude API (~120 calls):    -$1.20   ← avg 2 sessions/week × 15 calls × $0.01
Fly.io allocated:           -$0.12
Supabase allocated:         -$0.05
Resend allocated:           -$0.03
──────────────────────────────────
Gross profit per user:       $7.04   (78% gross margin)
```

### Paid Annual User ($79/year = $6.58/mo equivalent)
```
Gross margin: ~75%
Advantage: paid upfront (cash flow), 3× lower churn vs monthly
```

### Free User (uses 3 AI calls/day on average)
```
Revenue:                    $0
Claude API (90 calls/mo):   -$0.90
Infrastructure:             -$0.15
──────────────────────────────────
Net cost per active free user: $1.05/month

BUT at 3% conversion to paid:
  Expected monthly contribution: 3% × ($7.04 LTV) = $2.52/month/free user
  The free tier is NPV-POSITIVE at ≥ 2% conversion rate
```

---

## 5. FINANCIAL PROJECTIONS — WHAT YOU TAKE HOME

> **IMPORTANT:** These are pre-tax figures. US self-employment tax at this income level is 35–40%.
> To get post-tax: multiply by 0.63 (assumes 37% effective rate).
> You are the only employee until Stage 4 (~$4M ARR).

---

### STAGE 1 — Launch (Months 1–3)
*Marketing: Tell friends, post on Reddit, one social media video*

| | |
|---|---|
| Total users | 500 |
| Paying users | 100 (20% of sign-ups convert on free trial) |
| MRR | $900 |
| ARR run rate | $10,800 |

| Monthly Costs | Amount |
|---|---|
| Stripe fees | $27 |
| Fly.io | $20 |
| Supabase | $25 |
| Claude API | $210 |
| **Total** | **$282** |

> ### 💰 You take home: $618/month ($7,416/year)
> After 37% tax: **~$400/month**
> *This is side-project territory. Keep your day job.*

---

### STAGE 2 — Traction (Months 4–9)
*Marketing: SEO kicking in, 2–3 TikToks/Reels, $200/mo Google Ads*

| | |
|---|---|
| Total users | 5,000 |
| Paying monthly | 1,200 |
| Paying annual | 300 (paid $79 upfront) |
| MRR | $12,774 |
| ARR run rate | $153,000 |

| Monthly Costs | Amount |
|---|---|
| Stripe fees | $383 |
| Fly.io (2 machines) | $40 |
| Supabase Pro | $25 |
| Resend | $20 |
| Claude API | $2,700 |
| Google Ads | $200 |
| **Total** | **$3,368** |

> ### 💰 You take home: $9,406/month ($112,872/year)
> After 37% tax: **~$6,100/month ($73,200/year)**
> *This is your full-time salary. Quit the day job.*

---

### STAGE 3 — Real Growth (Months 10–18)
*Marketing: SEO compounding, affiliate program, referral program, App Store listing*

| | |
|---|---|
| Total users | 25,000 |
| Paying monthly | 6,000 |
| Paying annual | 2,000 |
| MRR | $67,160 |
| ARR run rate | $805,920 |

| Monthly Costs | Amount |
|---|---|
| Stripe fees | $2,015 |
| Fly.io (5 machines) | $120 |
| Supabase Pro | $25 |
| Resend | $40 |
| Claude API | $14,100 |
| Ads + Marketing | $1,000 |
| Misc | $100 |
| **Total** | **$17,400** |

> ### 💰 You take home: $49,760/month ($597,120/year)
> After 37% tax: **~$32,344/month ($388,128/year)**
> *Top 1% income. Work from anywhere. No boss.*

---

### STAGE 4 — Scale (Year 2–3)
*Marketing: Full content engine, App Store featured, press coverage, B2B pilots*

| | |
|---|---|
| Total users | 120,000 |
| Paying monthly | 30,000 |
| Paying annual | 10,000 |
| MRR | $335,800 |
| ARR run rate | $4,029,600 (~$4M ARR) |

| Monthly Costs | Amount |
|---|---|
| Stripe fees | $10,074 |
| Fly.io (15 machines) | $400 |
| Supabase Team | $599 |
| Resend | $90 |
| Claude API | $66,000 |
| Marketing | $5,000 |
| Part-time support | $3,000 |
| Accounting/legal | $1,000 |
| **Total** | **$86,163** |

> ### 💰 Business profit: $249,637/month
> You take a salary of **$50,000/month ($600,000/year)**
> Reinvest remaining $200k/month into growth
> After 37% tax: **~$390,000/year net**

---

### STAGE 5 — Vision (Year 4–5, 300k paying users)

| | |
|---|---|
| Paying users | 300,000 |
| MRR | ~$2,400,000 |
| ARR | ~$28,800,000 |
| Operating costs | ~$800,000/mo (team of 8, infra, API) |
| **Monthly profit** | **~$1,600,000** |

At this point you have three options:

**Option A — Run it as a cash machine**
Take $5–10 million/year personally. No stress. Minimal team.
After 37% tax: **$3.15–6.3M/year net**

**Option B — Raise Series A**
At 10× ARR: **$288M valuation**
Raise $20M. Dilute 15%. Your shares: **85% of $288M = $244.8M**

**Option C — Sell the company**
At 8–12× ARR: **$230–345M acquisition**
Babbel, Duolingo, Pearson, or a PE firm.
You walk away with $230–345M pre-tax.
After capital gains tax (~20%): **$184–276M net**

---

## 6. FOUNDER TAKE-HOME SUMMARY TABLE

| Timeline | Paying Users | MRR | Pre-Tax Annual | **Post-Tax Annual** |
|---|---|---|---|---|
| Month 1–3 | 100 | $900 | $7,416 | **~$4,800** |
| Month 4–9 | 1,500 | $12,774 | $112,872 | **~$73,200** |
| Month 10–18 | 8,000 | $67,160 | $597,120 | **~$388,000** |
| Year 2–3 | 40,000 | $335,800 | Salary $600k | **~$390,000** |
| Year 4–5 | 300,000 | $2,400,000 | $5–10M | **$3.15–6.3M** |

**The break-even point where this replaces a $75k/year job: ~1,100 paying users.**
**Realistic timeline to 1,100 paying users: 6–9 months.**

---

## 7. WHAT NEEDS TO HAPPEN TO ACHIEVE THESE NUMBERS

### Non-negotiables
1. **Free-to-paid conversion ≥ 3%** — If only 1% of free users convert, the economics are worse but still viable. At 5%, the numbers above are conservative.
2. **Churn ≤ 8%/month** — At $9/mo, average LTV = $9 ÷ 0.08 = $112.50. At $200 CAC (Google Ads) that's barely break-even. Annual plan lowers churn to ~2%/month.
3. **Claude API costs controlled** — Current design limits free users to 5 calls/day. Never let free users consume unlimited AI.
4. **SEO working within 6 months** — 11 landing pages targeting "learn [language] AI" are already indexed. This is free, compounding acquisition.

### The #1 metric to track
**Weekly free-to-paid conversion rate.** Everything else is a lag indicator.

---

## 8. RISKS

| Risk | Likelihood | What Happens | Mitigation |
|---|---|---|---|
| Claude API price 2× increase | Medium | API costs double → margins drop ~15% | Switch to open-source LLM (Llama 3.1), savings 70–90% on API |
| Duolingo launches AI coach | High (2026–2027) | Competition increases | Tonge is cheaper + deeper. Duolingo's 500M users don't convert overnight. |
| Low conversion rate (<2%) | Medium | Free tier unprofitable | Tighten free limits. Add urgency ("5 of 5 used today"). Email nurture sequences. |
| App Store 30% tax | Medium | Margin hit if iOS revenue | PWA + web checkout avoids Apple cut entirely. |
| Anthropic API outage | Low | AI features down for hours | Cached content still works. Only AI Coach affected. Add retry + fallback message. |
| GDPR violation | Low | €20M fine or 4% revenue | Erasure endpoint implemented. No data sold. Privacy-first by design. |

---

## 9. WHAT YOU OWN

As sole founder/developer:

1. **All source code** — proprietary, not open source, you retain all IP
2. **The "Tonge" brand** — register trademark at $1,000–3,000 when revenue justifies
3. **The user base** — email list of subscribers is the most valuable asset
4. **40 cached language guides** — AI output you own (per Anthropic's ToS, output belongs to you)
5. **11 SEO landing pages** — beginning organic ranking, compounds over time
6. **The content cache architecture** — the marginal cost moat. Hard to replicate without copying your approach.
7. **The access code model** — simple, no App Store dependency, anti-sharing built in

---

## 10. INDEPENDENT REVIEW QUESTIONS

*Ask ChatGPT, an investor, or advisor these:*

1. **Free tier limits:** Is 5 AI messages/day right? Duolingo gives unlimited but gamified. Should Tonge be 3 or 10?

2. **Pricing:** Should the paid tier be $12–15 to signal premium positioning vs Duolingo's $7?

3. **B2B timing:** Language schools and corporate training have higher ACV ($500–5,000/yr per account). Should this be pursued before or after 1,000 paying B2C users?

4. **Geographic focus:** English learners = 1.5 billion market. Should Tonge deprioritise English-to-X languages and focus on X-to-English where the most willing-to-pay users are?

5. **Defensibility:** Duolingo acquires Tonge for $50M vs builds similar feature. Which is more likely? How long before they ship an equivalent?

6. **Content quality moat:** The language-specific prompts prevent hallucination and ensure accuracy. Is this 6 months ahead of a motivated competitor or 3 years?

7. **Churn assumptions:** Is 6% monthly churn reasonable? What would drive it lower — better onboarding, annual plan discount, or feature depth?

---

## 11. TECHNICAL SUMMARY FOR NON-TECHNICAL REVIEWERS

**What was built (in plain English):**
- A website where users can learn any of 11 languages with an AI tutor
- Paying $9/month or signing up free (with limits)
- The AI creates different exercises every time — never the same lesson twice
- Grammar guides for every language are generated by AI once and stored, so they cost nothing to serve to new users
- Payments processed securely by Stripe (same company used by Amazon, Shopify)
- Data stored in PostgreSQL on Supabase (same database technology used by Airbnb, Instagram)
- Deployed on Fly.io which auto-scales globally (add capacity with one command)
- Works on any phone, tablet, or computer — no app to download

**What is NOT built yet (known gaps):**
- Native mobile app (iOS App Store, Google Play) — the web app works as a PWA but App Store listing would add distribution. ~2 days of work with Capacitor.
- Email automation sequences (Day 3, Day 7, Day 14 drip campaigns) — increases LTV
- Referral system ("Give a friend 1 free month, get 1 free month") — viral growth loop
- Analytics dashboard (Mixpanel, Amplitude) — needed to see user behavior, not just revenue

**Time to build what's missing:** 2–3 weeks of part-time work.

---

*Prepared by the founder for independent technical and business assessment.*
*All financial projections are estimates based on published market data, competitor benchmarks, and unit economics modeling.*
*Past performance of similar companies does not guarantee future results.*
*Tax figures assume US self-employment. Consult a tax professional for your specific situation.*
