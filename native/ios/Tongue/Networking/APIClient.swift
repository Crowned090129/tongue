import Foundation

/// Thread-safe holder for the current bearer token.
///
/// `APIClient.perform` runs off the main actor, but the token is owned by the
/// main-actor `AuthStore`. Rather than hop actors on every request (or read a
/// main-actor property from a background context — an isolation hazard), the
/// auth store *pushes* the current token into this lock-guarded box, and the
/// client reads it synchronously from anywhere.
final class TokenStore: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    var token: String? {
        get { lock.lock(); defer { lock.unlock() }; return value }
        set { lock.lock(); value = newValue; lock.unlock() }
    }
}

/// The single networking entry point. `async/await` URLSession, typed endpoints,
/// automatic bearer-token injection, and a throwing error model that decodes
/// `{error}` bodies into `APIError`.
final class APIClient {
    static let baseURL = URL(string: "https://tonge-app.fly.dev")!

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Shared token store; `AuthStore` writes it, `perform` reads it.
    let tokens = TokenStore()

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Public typed sends

    /// Send an endpoint and decode a `Decodable` response.
    func send<Body: Encodable, Response: Decodable>(
        _ endpoint: Endpoint<Body>,
        as _: Response.Type
    ) async throws -> Response {
        let data = try await perform(endpoint)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(underlying: error)
        }
    }

    /// Send an endpoint expecting dynamic JSON (used by the AI Coach).
    func sendRaw<Body: Encodable>(_ endpoint: Endpoint<Body>) async throws -> JSONValue {
        let data = try await perform(endpoint)
        do {
            return try decoder.decode(JSONValue.self, from: data)
        } catch {
            throw APIError.decoding(underlying: error)
        }
    }

    /// Send an endpoint whose response we don't need.
    @discardableResult
    func sendDiscardingResult<Body: Encodable>(_ endpoint: Endpoint<Body>) async throws -> Data {
        try await perform(endpoint)
    }

    // MARK: - Core

    private func perform<Body: Encodable>(_ endpoint: Endpoint<Body>) async throws -> Data {
        var request = URLRequest(url: APIClient.baseURL.appendingPathComponent(endpoint.path))
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 45

        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try encoder.encode(body)
            } catch {
                throw APIError.decoding(underlying: error)
            }
        }

        if endpoint.requiresAuth {
            guard let token = tokens.token, !token.isEmpty else {
                throw APIError.unauthenticated
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(underlying: error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.decoding(underlying: URLError(.badServerResponse))
        }

        guard (200..<300).contains(http.statusCode) else {
            throw mapError(status: http.statusCode, data: data)
        }

        return data
    }

    private func mapError(status: Int, data: Data) -> APIError {
        let body = try? decoder.decode(APIErrorBody.self, from: data)
        let message = body?.error ?? "Something went wrong (HTTP \(status))."

        if status == 429, body?.upgrade == true {
            return .rateLimited(message: message)
        }
        return .server(status: status, message: message, body: body)
    }
}
