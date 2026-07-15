import Foundation
import SwiftUI

@MainActor
final class LoginViewModel: ObservableObject {
    @Published var code: String = ""
    @Published var email: String = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    enum Mode: String, CaseIterable {
        case code = "Access code"
        case email = "Free account"
    }
    @Published var mode: Mode = .code

    /// Injected after construction (see `placeholder()` / `attach(auth:)`), because
    /// SwiftUI can't hand environment objects to a view model's initializer.
    private weak var auth: AuthStore?

    private init() {}

    /// Create an unattached instance for `@StateObject`.
    static func placeholder() -> LoginViewModel { LoginViewModel() }

    /// Wire up the auth store on first appear.
    func attach(auth: AuthStore) {
        self.auth = auth
    }

    var canSubmit: Bool {
        guard !isLoading else { return false }
        switch mode {
        case .code:  return code.trimmingCharacters(in: .whitespaces).count >= 4
        case .email: return email.contains("@") && email.count >= 5
        }
    }

    func submit() async {
        guard let auth else { return }
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        do {
            switch mode {
            case .code:
                try await auth.login(code: code)
            case .email:
                try await auth.signup(email: email)
            }
        } catch let error as APIError {
            handle(error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handle(_ error: APIError) {
        // If the email already has a paid account, nudge the user to the code flow.
        if case .server(_, let message, let body) = error, body?.hasPaid == true {
            errorMessage = message
            mode = .code
            return
        }
        errorMessage = error.errorDescription
    }
}
