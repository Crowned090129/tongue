import Foundation
import SwiftUI

/// Where the app currently is in the auth lifecycle.
enum AuthPhase: Equatable {
    case launching              // deciding what to show at startup
    case autoSigningIn          // "Signing you in…" splash (silent code re-login)
    case signedOut              // show the Login screen
    case signedIn               // show Home
}

/// The user profile the app knows about once authenticated.
struct UserProfile: Equatable {
    var email: String
    var plan: String
    var onboardingCompleted: Bool
    var userLevel: String?
    var userGoal: String?
    var dailyCommitment: Int?
    var targetLang: String

    var isPaid: Bool { plan != "free" }
    var language: Language { Language.by(code: targetLang) }
}

/// Owns the JWT + access code (both in the Keychain), the resolved auth phase,
/// and the current user profile. Injected as an `@EnvironmentObject`.
///
/// Auth behaviour mirrors the web app:
///  • On launch, if a token exists → validate; if valid → Home.
///  • Else if a saved access code exists → silently re-login (brief splash).
///  • Else → Login screen.
///  • On sign out, clear token + code and DELETE the push token.
@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var phase: AuthPhase = .launching
    @Published private(set) var profile: UserProfile?

    private let auth: AuthService
    private let push: PushService
    /// Shared with `APIClient` — we push the bearer token here on every change.
    private let tokens: TokenStore

    /// The current JWT; kept in sync with `tokens` and the Keychain.
    private var token: String? {
        didSet { tokens.token = token }
    }

    init(auth: AuthService, push: PushService, tokens: TokenStore) {
        self.auth = auth
        self.push = push
        self.tokens = tokens
        let existing = Keychain.get(.authToken)
        self.token = existing
        self.tokens.token = existing
    }

    // MARK: - Startup

    /// Decide the initial screen. Call once when the app appears.
    func bootstrap() async {
        // 1. Have a token? Validate it.
        if let existing = Keychain.get(.authToken), !existing.isEmpty {
            token = existing
            if await validateAndAdopt() { return }
        }

        // 2. No valid token but a saved code? Silent auto-login.
        if let code = Keychain.get(.accessCode), !code.isEmpty {
            phase = .autoSigningIn
            do {
                let res = try await auth.login(code: code)
                await adopt(auth: res, savedCode: code)
                return
            } catch {
                // Code rejected / expired — fall through to the Login screen.
                Keychain.delete(.authToken)
            }
        }

        // 3. Nothing usable — show Login.
        phase = .signedOut
    }

    /// Validate the current token and, if valid, load the profile & go to Home.
    /// Returns whether we adopted a signed-in state.
    private func validateAndAdopt() async -> Bool {
        do {
            let v = try await auth.validate()
            guard v.valid else { return false }
            profile = UserProfile(
                email: v.email ?? "",
                plan: v.plan ?? "free",
                onboardingCompleted: v.onboardingCompleted ?? false,
                userLevel: v.userLevel,
                userGoal: v.userGoal,
                dailyCommitment: v.dailyCommitment,
                targetLang: v.targetLang ?? Language.default.code
            )
            phase = .signedIn
            return true
        } catch {
            return false
        }
    }

    // MARK: - Explicit login

    /// Log in with an access code (paid subscriber). Saves token + code.
    func login(code: String) async throws {
        let normalized = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let res = try await auth.login(code: normalized)
        await adopt(auth: res, savedCode: normalized)
    }

    /// Create a free account by email (no payment). Saves token; no code to save.
    func signup(email: String) async throws {
        let res = try await auth.signup(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
        await adopt(auth: res, savedCode: nil)
    }

    /// Persist a successful auth result and refresh the profile from /validate.
    private func adopt(auth res: AuthResponse, savedCode: String?) async {
        Keychain.set(res.token, for: .authToken)
        if let savedCode { Keychain.set(savedCode, for: .accessCode) }
        token = res.token

        // Pull the full profile (onboarding flags, level, etc.).
        if await validateAndAdopt() { return }

        // Fallback to the minimal profile from the auth response.
        profile = UserProfile(
            email: res.email,
            plan: res.plan,
            onboardingCompleted: false,
            userLevel: nil,
            userGoal: nil,
            dailyCommitment: nil,
            targetLang: Language.default.code
        )
        phase = .signedIn
    }

    // MARK: - Sign out

    /// Clear all local auth and DELETE the push token on the server.
    func signOut() async {
        if let pushToken = PushManager.shared.currentDeviceToken {
            try? await push.unregister(token: pushToken)
        }
        Keychain.clearAll()
        token = nil
        profile = nil
        phase = .signedOut
    }

    // MARK: - Profile mutation helpers

    func updateLanguage(_ code: String) {
        profile?.targetLang = code
    }

    func updatePlan(_ plan: String) {
        profile?.plan = plan
    }
}
