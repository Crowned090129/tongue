# Tongue — Native Android

A native Android rewrite of Tongue (AI language learning) in **Kotlin + Jetpack
Compose**, reusing the existing shared backend REST API at
`https://tonge-app.fly.dev`. This module is a production-grade **foundation**:
design system, networking, secure auth, navigation shell, push setup, and four
fully-working screens (Login, Home/Explore, AI Coach, Settings). Remaining
screens are clean "Coming soon" placeholders so the app compiles and navigates.

> The backend is **not** part of this module and is not modified. This app is a
> pure client of the existing API.

---

## Prerequisites

- **Android Studio** Koala (2024.1.1) or newer.
- **JDK 17** (bundled with recent Android Studio; `File → Settings → Build →
  Gradle → Gradle JDK` should point at a 17 JDK).
- **Android SDK Platform 34** and build-tools installed (via the SDK Manager).
- Minimum device / emulator: **API 26 (Android 8.0)**.

The project uses the **Gradle Kotlin DSL** with a **version catalog**
(`gradle/libs.versions.toml`) and **Gradle 8.9** via the wrapper.

---

## Open, sync, and run

1. In Android Studio: **File → Open** and select
   `native/android/` (this directory).
2. Let Gradle sync. First sync downloads the Gradle distribution and all
   dependencies (needs network).
3. Pick the `app` run configuration and a device/emulator, then **Run**.

> **Gradle wrapper jar**: `gradlew`/`gradlew.bat` and
> `gradle/wrapper/gradle-wrapper.properties` are included. If
> `gradle/wrapper/gradle-wrapper.jar` is missing (it's a binary and may be
> stripped by tooling), regenerate it once with a locally installed Gradle:
> `gradle wrapper --gradle-version 8.9`. Android Studio can also restore it on
> first sync.

Base URLs are compiled in via `buildConfigField` in `app/build.gradle.kts`
(`API_BASE_URL`, `SUBSCRIBE_URL`) — change them there if you point at a staging
backend.

---

## Firebase Cloud Messaging (push) — owner action required

Push is wired up (`push/TonguePushService`, `POST /api/push/register`,
`DELETE /api/push/token`) but needs the Firebase config the app owner controls:

1. In the Firebase console, add an Android app with package name
   **`app.tongue.language`** (and `app.tongue.language.debug` for debug builds if
   you want push in debug).
2. Download **`google-services.json`** and drop it in **`app/google-services.json`**
   (git-ignored).
3. Enable the Google Services plugin:
   - In `app/build.gradle.kts`, uncomment `alias(libs.plugins.google.services)`.
   - The root `build.gradle.kts` already declares the plugin `apply false`.
4. Re-sync. The FCM token now registers with the backend on first launch / token
   refresh, and unregisters on sign-out.

Until `google-services.json` is added, the app compiles and runs normally; push
messages simply won't be delivered.

`POST_NOTIFICATIONS` (Android 13+) is declared in the manifest. Request the
runtime permission from a screen before relying on notifications (not wired into
a screen in this foundation).

---

## Reader-app subscription model (no Google Play Billing)

This app **intentionally does not implement Google Play Billing.** Google Play
policy requires Play Billing for in-app purchases of digital goods; we instead
use the permitted **reader-app** model:

- A free user who hits a paywall sees `feature/placeholder/PaywallScreen`, which
  opens `https://tonge-app.fly.dev/subscribe` in a **Chrome Custom Tab**.
- The user subscribes on the web and receives an **access code** by email.
- They return to the app and sign in with that code on the Login screen.

This keeps all payment handling on the web (already built) and avoids the Play
Billing requirement. See the compliance comment in `PaywallScreen.kt`.

---

## Authentication behavior (matches the web app)

- The JWT token **and** the entered access code are stored with
  **`EncryptedSharedPreferences`** (AES-256, Keystore-backed) in
  `auth/SecureAuthStore`. Never in plain prefs. The file is excluded from
  backups (`res/xml/backup_rules.xml`).
- **On launch** (`AuthRepository.bootstrap`):
  1. If a token exists → `GET /api/auth/validate`. If valid → straight to Home.
  2. Else if a saved code exists → **silent auto-login** by `POST /api/auth/login`
     with the saved code, showing a brief "Signing you in…" splash.
  3. Else (or if the code is rejected) → show the Login screen.
- On **login success**, the token + code are persisted.
- On **sign out**, the push token is `DELETE`d, then the secure store is cleared.

---

## Configure signing for a release `.aab`

1. Create a keystore (once):
   ```
   keytool -genkeypair -v -keystore tongue-release.jks \
     -alias tongue -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Copy `keystore.properties.example` → `keystore.properties` (git-ignored) and
   fill in `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
   `app/build.gradle.kts` reads this file and wires the `release` signing config
   automatically when it's present.
3. Build the App Bundle:
   ```
   ./gradlew :app:bundleRelease
   ```
   Output: `app/build/outputs/bundle/release/app-release.aab`.

Release builds use R8 minification + resource shrinking (`isMinifyEnabled = true`)
with `proguard-rules.pro` (keeps kotlinx.serialization serializers, Retrofit
interfaces, and Firebase classes).

---

## Architecture

- **MVVM** — `ViewModel` + `StateFlow`, Kotlin coroutines.
- **DI** — Hilt (`di/AppModule`, `@HiltAndroidApp TongueApp`).
- **Networking** — Retrofit + OkHttp + kotlinx.serialization. An
  `AuthInterceptor` injects `Authorization: Bearer <token>`. `ApiResult` decodes
  the `{error}` envelope and flags auth/paywall/upgrade cases.
- **Dynamic AI JSON** — `/api/claude` is decoded into `JsonObject` and read
  defensively via `common/JsonExt`.
- **Navigation** — Navigation-Compose. `AuthState` selects the auth graph vs the
  bottom-bar main shell.

### Package layout

```
app/                app + activity + root VM + nav
designsystem/       Compose theme (Material3), color tokens, components
network/            Retrofit API, ApiResult, AuthInterceptor
data/model/         DTOs, Language catalog, domain models
data/repo/          Auth / Coach / Content / Push repositories
auth/               SecureAuthStore (EncryptedSharedPreferences)
feature/login/      Login (access code)
feature/home/       Home / Explore (live content)
feature/coach/      AI Coach (live /api/claude)
feature/settings/   Settings
feature/placeholder Coming-soon + Paywall
push/               FirebaseMessagingService
common/             JSON helpers, Custom Tabs helper
di/                 Hilt module
```

## Languages & content note

The supported languages are bundled statically in `data/model/Language.kt`.
**French reference content is not yet served by the backend** content API
(`/api/content/{lang}/{tab}`) — it's web-only for now. The content screens
degrade gracefully for French with a friendly note, while the **AI Coach fully
supports French** (and every other language) via `/api/claude`.
