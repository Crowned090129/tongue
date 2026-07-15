import Foundation

/// Typed error model surfaced by `APIClient`. Carries decoded `{error}` messages
/// and, where relevant, the extra flags the backend sends (`hasPaid`, `upgrade`).
enum APIError: Error, LocalizedError {
    /// A 4xx/5xx with a decoded `{error}` body.
    case server(status: Int, message: String, body: APIErrorBody?)
    /// Networking failure (offline, timeout, DNS…).
    case transport(underlying: Error)
    /// Response could not be decoded into the expected type.
    case decoding(underlying: Error)
    /// We had no auth token but the endpoint requires one.
    case unauthenticated
    /// Free-tier limit reached (HTTP 429 with `upgrade: true`).
    case rateLimited(message: String)

    var errorDescription: String? {
        switch self {
        case .server(_, let message, _):
            return message
        case .transport:
            return "Couldn't reach Tongue. Check your connection and try again."
        case .decoding:
            return "We got an unexpected response from the server."
        case .unauthenticated:
            return "You're signed out. Please sign in again."
        case .rateLimited(let message):
            return message
        }
    }

    /// True when the server indicated the user must upgrade (paywall).
    var requiresUpgrade: Bool {
        switch self {
        case .rateLimited:
            return true
        case .server(_, _, let body):
            return body?.upgrade == true
        default:
            return false
        }
    }

    /// True when the token was rejected (401) — triggers a re-login flow.
    var isAuthFailure: Bool {
        if case .server(let status, _, _) = self { return status == 401 }
        if case .unauthenticated = self { return true }
        return false
    }
}
