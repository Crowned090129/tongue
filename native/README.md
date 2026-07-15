# Tongue — Native Apps

Native **iOS (Swift/SwiftUI)** and **Android (Kotlin/Jetpack Compose)** apps for Tongue,
alongside the existing web app. All three share **one backend** — the Node/Express +
Postgres API already running on Fly.io — so there is a single source of truth for auth,
subscriptions, AI, and content.

```
                    ┌─────────────────────────────┐
                    │  Backend (unchanged)         │
                    │  Express + Postgres on Fly   │
                    │  https://tonge-app.fly.dev   │
                    │  Stripe · Claude · Resend    │
                    └──────────────┬──────────────┘
              REST/JSON            │
        ┌──────────────┬───────────┴───────────┬──────────────┐
        ▼              ▼                       ▼              
   Web (React)    iOS (SwiftUI)          Android (Compose)   
   public/        native/ios/            native/android/     
```

## Why a shared backend
The native apps are **clients** of the same API the web app uses. Nothing about
Postgres, Stripe, the Claude proxy, content generation, or email was rewritten — only
the UI is native per platform. Every account, subscription, and generated lesson works
identically across web, iOS, and Android.

## Two things that are deliberately different on native

### 1. Subscriptions use the "reader app" model (for now)
Apple and Google **prohibit** selling digital subscriptions through a web checkout
(Stripe) inside a native app — they require StoreKit / Play Billing and take 15–30%.
To ship compliantly and fast, the native apps do **not** sell subscriptions in-app:

- A user subscribes on the **web** (`/subscribe`, Stripe) and receives an access code by email.
- They **sign in with that code** in the native app.
- Free tier (5 AI messages/day) still works fully in-app.

Adding true in-app purchase (StoreKit 2 / Play Billing) is a later milestone if the
in-app conversion is worth the platform cut.

### 2. French reference content
The French Grammar/Vocabulary/Structures reference is **hardcoded in the web app**, not
served by the content API. The native apps pull the other 11 languages from
`/api/content/{lang}/{tab}`; French falls back gracefully (the AI Coach still works for
French). Moving French into the backend content store is a follow-up that benefits all
three platforms at once.

## Layout
- `native/ios/` — SwiftUI app. See `native/ios/README.md` to build.
- `native/android/` — Jetpack Compose app. See `native/android/README.md` to build.

## Shared API contract (base `https://tonge-app.fly.dev`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | – | Access-code login → `{token, expiresAt, email, plan}` |
| POST | `/api/auth/signup` | – | Free-tier signup by email |
| GET | `/api/auth/validate` | Bearer | Session + profile (`userLevel`, `targetLang`, …) |
| POST | `/api/auth/onboarding` | Bearer | Save level/goal/commitment/language |
| POST | `/api/auth/preferences` | Bearer | Persist language/level changes |
| POST | `/api/claude` | Bearer | AI Coach / analyzer / tutor (dynamic JSON) |
| GET | `/api/content/{lang}/{tab}` | Bearer | Grammar/vocab/structures/cheatsheet/dialogues |
| POST | `/api/content/report` | Bearer | Flag a content error |
| POST | `/api/support` | – | Support chat (Haiku) |
| POST | `/api/push/register` | Bearer | Register device push token |
| DELETE | `/api/push/token` | Bearer | Remove token on sign-out |

## Build/deploy note
The `native/` tree is excluded from the web server's Docker image (`.dockerignore`) and
build artifacts are git-ignored, so it never affects `fly deploy`.
