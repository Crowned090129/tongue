import Foundation

/// HTTP method.
enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// A typed endpoint describing one backend route.
///
/// `Body` is the encodable request payload (`EmptyBody` for none). The response
/// type is supplied at the call site on `APIClient.send`.
struct Endpoint<Body: Encodable> {
    let method: HTTPMethod
    let path: String            // e.g. "/api/auth/login"
    let body: Body?
    let requiresAuth: Bool

    init(_ method: HTTPMethod, _ path: String, body: Body? = nil, requiresAuth: Bool = true) {
        self.method = method
        self.path = path
        self.body = body
        self.requiresAuth = requiresAuth
    }
}

/// Placeholder for endpoints with no request body.
struct EmptyBody: Encodable {}

// MARK: - Endpoint catalog
//
// Centralises every route so paths and auth requirements live in one place.

enum Endpoints {
    // Auth
    static func login(code: String) -> Endpoint<LoginBody> {
        Endpoint(.post, "/api/auth/login", body: LoginBody(code: code), requiresAuth: false)
    }

    static func signup(email: String) -> Endpoint<SignupBody> {
        Endpoint(.post, "/api/auth/signup", body: SignupBody(email: email), requiresAuth: false)
    }

    static var validate: Endpoint<EmptyBody> {
        Endpoint(.get, "/api/auth/validate")
    }

    static func onboarding(_ body: OnboardingBody) -> Endpoint<OnboardingBody> {
        Endpoint(.post, "/api/auth/onboarding", body: body)
    }

    static func preferences(_ body: PreferencesBody) -> Endpoint<PreferencesBody> {
        Endpoint(.post, "/api/auth/preferences", body: body)
    }

    // AI Coach
    static func claude(_ body: ClaudeRequest) -> Endpoint<ClaudeRequest> {
        Endpoint(.post, "/api/claude", body: body)
    }

    // Content
    static func content(lang: String, tab: ContentTab) -> Endpoint<EmptyBody> {
        Endpoint(.get, "/api/content/\(lang)/\(tab.rawValue)")
    }

    static func reportContent(lang: String, tab: ContentTab) -> Endpoint<ReportBody> {
        Endpoint(.post, "/api/content/report", body: ReportBody(lang: lang, tab: tab.rawValue))
    }

    // Push
    static func registerPush(token: String) -> Endpoint<PushRegisterBody> {
        Endpoint(.post, "/api/push/register", body: PushRegisterBody(token: token, platform: "ios"))
    }

    static func deletePush(token: String) -> Endpoint<PushTokenBody> {
        Endpoint(.delete, "/api/push/token", body: PushTokenBody(token: token))
    }
}

// Small inline bodies
struct LoginBody: Encodable { let code: String }
struct SignupBody: Encodable { let email: String }
struct ReportBody: Encodable { let lang: String; let tab: String }
