import Foundation

/// Thin, testable service wrappers over `APIClient`. Keeps view models free of
/// endpoint construction.

struct AuthService {
    let api: APIClient

    func login(code: String) async throws -> AuthResponse {
        try await api.send(Endpoints.login(code: code), as: AuthResponse.self)
    }

    func signup(email: String) async throws -> AuthResponse {
        try await api.send(Endpoints.signup(email: email), as: AuthResponse.self)
    }

    func validate() async throws -> ValidateResponse {
        try await api.send(Endpoints.validate, as: ValidateResponse.self)
    }

    func saveOnboarding(_ body: OnboardingBody) async throws {
        _ = try await api.send(Endpoints.onboarding(body), as: SavedResponse.self)
    }

    func savePreferences(language: String? = nil, level: String? = nil) async throws {
        _ = try await api.send(
            Endpoints.preferences(PreferencesBody(language: language, level: level)),
            as: SavedResponse.self
        )
    }
}

struct CoachService {
    let api: APIClient

    /// Call the AI Coach. `featureType` selects the exercise/feedback behaviour
    /// server-side (e.g. "conversation", "exercise", "feedback").
    func ask(
        prompt: String,
        language: String,
        nativeLang: String,
        featureType: String,
        maxTokens: Int = 1000
    ) async throws -> ClaudeResponse {
        let req = ClaudeRequest(
            prompt: prompt,
            maxTokens: maxTokens,
            language: language,
            nativeLang: nativeLang,
            featureType: featureType
        )
        let raw = try await api.sendRaw(Endpoints.claude(req))
        return ClaudeResponse(raw: raw)
    }
}

struct ContentService {
    let api: APIClient

    func fetch(lang: String, tab: ContentTab) async throws -> ContentResponse {
        try await api.send(Endpoints.content(lang: lang, tab: tab), as: ContentResponse.self)
    }

    func report(lang: String, tab: ContentTab) async throws {
        try await api.sendDiscardingResult(Endpoints.reportContent(lang: lang, tab: tab))
    }
}

struct PushService {
    let api: APIClient

    func register(token: String) async throws {
        try await api.sendDiscardingResult(Endpoints.registerPush(token: token))
    }

    func unregister(token: String) async throws {
        try await api.sendDiscardingResult(Endpoints.deletePush(token: token))
    }
}
