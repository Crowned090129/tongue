# Tongue — Native iOS App

A native SwiftUI rewrite of the Tongue AI language-learning app. It reuses the
existing shared backend REST API (`https://tonge-app.fly.dev`) — the backend is
**not** part of this project and must not be rewritten here.

This directory contains a production-grade **foundation**: design system,
networking, secure auth, models, navigation shell, push setup, and build config,
plus four fully-working screens that prove the stack end-to-end — **Login
(access code / free signup)**, **Home / Explore**, **AI Coach (live API)**, and
**Settings**. Other screens are clean "Coming soon" placeholders.

---

## Prerequisites

- **macOS** with **Xcode 15 or newer** (iOS 16 SDK).
- **XcodeGen** to generate the Xcode project from `project.yml`:
  ```sh
  brew install xcodegen
  ```

## Generate the Xcode project

The `.xcodeproj` is generated, not committed. From this directory:

```sh
cd native/ios
xcodegen generate
open Tongue.xcodeproj
```

This produces `Tongue.xcodeproj` with:
- Bundle identifier `app.tongue.language`
- Display name **Tongue**
- iOS **16.0** deployment target
- The `Info.plist` and `Tongue.entitlements` under `Tongue/Resources/`

Re-run `xcodegen generate` any time you add/remove/rename source files.

## Run on the Simulator

1. Open `Tongue.xcodeproj`.
2. Select the **Tongue** scheme and an iOS 16+ Simulator (e.g. iPhone 15).
3. Press **Run** (⌘R).

The Simulator can't receive real APNs pushes, but the whole app — login,
Explore content, live AI Coach, and Settings — works against the real backend.

## Configure signing, team, and push (APNs)

Push notifications require a real device and a paid Apple Developer account.

1. In Xcode, select the **Tongue** target → **Signing & Capabilities**.
2. Set your **Team**. (You can also set `DEVELOPMENT_TEAM` in `project.yml`
   under `settings.base` and regenerate.)
3. Signing is **Automatic**; Xcode manages the provisioning profile.
4. Add the **Push Notifications** capability. This works together with the
   `aps-environment` key already declared in `Tongue/Resources/Tongue.entitlements`
   (`development` for debug/TestFlight-internal, `production` for the App Store).
5. **Background Modes → Remote notifications** is already declared in
   `Info.plist` (`UIBackgroundModes = remote-notification`).
6. On first launch after sign-in the app asks for notification permission,
   registers with APNs, and POSTs the device token to `POST /api/push/register`
   (`{ token, platform: "ios" }`). On sign out it calls `DELETE /api/push/token`.

You'll also need an **APNs key/certificate** configured on the backend side to
actually deliver pushes; that lives with the backend, not this app.

## Permissions declared

`Info.plist` includes usage strings for the (scaffolded) voice tutor:
- `NSMicrophoneUsageDescription`
- `NSSpeechRecognitionUsageDescription`

The voice flow itself is stubbed (`Features/Coach/VoiceInputStub.swift`) — the
permissions and Info.plist entries are in place so it can be built out without
further configuration.

---

## Subscriptions — the reader-app model

**Tongue does not use In-App Purchase / StoreKit.** It follows Apple's
["reader" app model](https://developer.apple.com/app-store/reader-apps/):

- The app **does not sell** digital subscriptions inside the app, and shows no
  in-app price or "Buy" button.
- Subscriptions are purchased and managed **on the web** at
  `https://tonge-app.fly.dev/subscribe`, which the app opens in Safari.
- After subscribing, the backend emails the user an **access code**. The user
  signs in here with that code and everything unlocks.

This is why `Features/Common/PaywallView.swift` only *explains* the model and
opens the web account page — it deliberately never presents an in-app purchase
or a checkout button. (Apple rejects Stripe / web checkout for digital goods
presented *inside* the app; a reader app pointing existing external subscribers
to sign in, and to a web account page, is permitted.)

Free users get an email-based free tier via `POST /api/auth/signup`, and the
backend enforces free-tier limits on `POST /api/claude` (surfacing
`_meta.remaining`, and a `429 { upgrade: true }` at the limit, which drives the
paywall sheet).

---

## Auth behaviour (matches the web app)

- The JWT is stored in the **Keychain** (never UserDefaults). The entered
  **access code** is also stored securely so returning users never re-type it.
- **On launch**:
  1. If a token exists → `GET /api/auth/validate`; if valid → go straight to Home.
  2. Else if a saved code exists → **silently auto-login** by POSTing the code,
     showing a brief *"Signing you in…"* splash.
  3. Otherwise → show the Login screen.
- **On login success** → save token + code.
- **On sign out** → clear token + code and `DELETE /api/push/token`.

See `Auth/AuthStore.swift` for the phase machine
(`launching → autoSigningIn → signedOut / signedIn`).

---

## Project structure

```
native/ios/
├── project.yml                 # XcodeGen spec → Tongue.xcodeproj
├── README.md
└── Tongue/
    ├── App/                    # @main, delegate, DI container, nav shell
    │   ├── TongueApp.swift
    │   ├── AppDelegate.swift        # APNs UIKit bridge
    │   ├── AppEnvironment.swift     # composition root / DI
    │   ├── RootView.swift           # phase-driven root + splash
    │   └── MainTabView.swift        # signed-in tab shell
    ├── DesignSystem/           # brand palette, type scale, components
    │   ├── Theme.swift              # light/dark palette, env-injected
    │   ├── Typography.swift         # SF Pro scale, radii, spacing
    │   └── Components.swift         # Card, buttons, pills, fields…
    ├── Networking/
    │   ├── APIClient.swift          # async/await URLSession, bearer inject
    │   ├── Endpoint.swift           # typed endpoint catalog
    │   ├── Services.swift           # Auth/Coach/Content/Push services
    │   ├── APIError.swift           # typed errors w/ decoded {error}
    │   └── Keychain.swift           # secure token + code storage
    ├── Models/
    │   ├── APIModels.swift          # Codable request/response models
    │   ├── JSONValue.swift          # flexible JSON for /api/claude
    │   └── Language.swift           # static language catalog + tabs
    ├── Auth/
    │   ├── AuthStore.swift          # auth phase machine + profile
    │   └── PushManager.swift        # APNs registration + backend sync
    ├── Common/
    │   ├── JSONContentView.swift    # renders dynamic content JSON
    │   └── PreviewStubs.swift       # placeholder services for @StateObject
    ├── Features/
    │   ├── Login/                   # access-code + free-signup screen
    │   ├── Home/                    # Explore + reference content
    │   ├── Coach/                   # live AI Coach chat + voice stub
    │   ├── Settings/                # account, language picker, sign out
    │   └── Common/                  # ComingSoon + Paywall
    └── Resources/
        ├── Info.plist
        ├── Tongue.entitlements      # aps-environment
        └── Assets.xcassets          # AppIcon, AccentColor, BackgroundColor
```

## Architecture notes

- **SwiftUI, iOS 16+, MVVM.** Each feature has a `@MainActor` `ObservableObject`
  view model. View models are created as `@StateObject` with a placeholder
  service (`PreviewStubs`) and `rebind`/`attach` the real services from
  `AppEnvironment` on first appear — because SwiftUI can't inject environment
  objects into a view model's initializer.
- **Networking** is a single `APIClient` using `async/await` `URLSession`, typed
  `Endpoint` values, automatic `Authorization: Bearer` injection (via the
  `TokenProviding` protocol that `AuthStore` conforms to), and a throwing
  `APIError` that decodes `{error, hasPaid?, upgrade?}` bodies.
- **Dynamic JSON** from `POST /api/claude` and `GET /api/content` is decoded
  into the recursive `JSONValue` enum and rendered generically, so backend shape
  changes don't break the client.
- **Theming** is environment-driven (`\.theme`) with full light/dark palettes in
  `Theme.swift`; attach with `.tongueTheme()`.

### A note on French content

French reference content (Grammar / Vocab / etc.) is **web-only for now** — it's
not served by `GET /api/content/fr/...`. The `Language` model flags this
(`hasReferenceContent == false` for `fr`), and Home shows a graceful "on the web"
state for French while the **AI Coach still fully works** for French (the
`/api/claude` endpoint is language-agnostic).
```
