import Foundation
import SwiftUI

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var isSavingLanguage = false
    @Published var errorMessage: String?

    private var authService: AuthService
    private weak var authStore: AuthStore?

    private init(authService: AuthService) {
        self.authService = authService
    }

    static func make(authService: AuthService) -> SettingsViewModel {
        SettingsViewModel(authService: authService)
    }

    func rebind(authService: AuthService, authStore: AuthStore) {
        self.authService = authService
        self.authStore = authStore
    }

    /// Persist the target language both locally and server-side.
    func changeLanguage(to language: Language) async {
        errorMessage = nil
        isSavingLanguage = true
        defer { isSavingLanguage = false }
        do {
            try await authService.savePreferences(language: language.code)
            authStore?.updateLanguage(language.code)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        await authStore?.signOut()
    }
}
