import Foundation

/// Composition root / dependency container. Wires the API client, services, and
/// stores together so the rest of the app receives them via the SwiftUI
/// environment instead of reaching for singletons.
@MainActor
final class AppEnvironment: ObservableObject {
    let api: APIClient
    let authService: AuthService
    let coachService: CoachService
    let contentService: ContentService
    let pushService: PushService

    let authStore: AuthStore

    init() {
        let api = APIClient()
        self.api = api
        self.authService = AuthService(api: api)
        self.coachService = CoachService(api: api)
        self.contentService = ContentService(api: api)
        self.pushService = PushService(api: api)

        // The auth store writes the bearer token into the API client's token
        // store, which the client reads on every authed request.
        self.authStore = AuthStore(auth: authService, push: pushService, tokens: api.tokens)

        // Give the push manager a way to sync tokens.
        PushManager.shared.pushService = pushService
    }
}
