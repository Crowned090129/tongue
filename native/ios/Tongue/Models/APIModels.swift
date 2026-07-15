import Foundation

// MARK: - Auth

/// Response for /api/auth/login and /api/auth/signup.
struct AuthResponse: Codable, Equatable {
    let token: String
    let expiresAt: String
    let email: String
    let plan: String

    var isPaid: Bool { plan != "free" }
}

/// Error body returned by 4xx auth responses.
struct APIErrorBody: Codable {
    let error: String
    let hasPaid: Bool?
    let upgrade: Bool?
    let needsRelogin: Bool?
}

/// Response for GET /api/auth/validate.
struct ValidateResponse: Codable, Equatable {
    let valid: Bool
    let email: String?
    let plan: String?
    let onboardingCompleted: Bool?
    let userLevel: String?
    let userGoal: String?
    let dailyCommitment: Int?
    let targetLang: String?
    let needsRelogin: Bool?

    var isPaid: Bool { (plan ?? "free") != "free" }
}

/// Response for the small "saved" acknowledgements.
struct SavedResponse: Codable {
    let saved: Bool
}

// MARK: - Onboarding / preferences request bodies

struct OnboardingBody: Codable {
    let level: String
    let goal: String
    let dailyCommitment: Int
    let language: String
}

struct PreferencesBody: Codable {
    var language: String?
    var level: String?
}

// MARK: - Claude / AI Coach

/// Request body for POST /api/claude.
struct ClaudeRequest: Codable {
    let prompt: String
    let maxTokens: Int
    let language: String
    let nativeLang: String
    let featureType: String
}

/// The AI Coach response is dynamic JSON. We keep the raw value plus a decoded
/// view of the optional `_meta.remaining` quota for free users.
struct ClaudeResponse {
    let raw: JSONValue

    /// Remaining free-tier messages today, if the server surfaced it.
    var remaining: Int? { raw["_meta"]["remaining"].intValue }

    var plan: String? { raw["_meta"]["plan"].stringValue }
}

// MARK: - Content

/// Response for GET /api/content/{lang}/{tab}.
struct ContentResponse: Codable {
    let content: JSONValue
    let generatedAt: String?
    let cached: Bool?

    enum CodingKeys: String, CodingKey {
        case content
        case generatedAt = "generated_at"
        case cached
    }
}

// MARK: - Push

struct PushRegisterBody: Codable {
    let token: String
    let platform: String   // "ios"
}

struct PushTokenBody: Codable {
    let token: String
}
