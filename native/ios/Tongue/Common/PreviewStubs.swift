import Foundation

/// Lightweight, non-networking stand-ins used to construct `@StateObject` view
/// models before the real `AppEnvironment` is readable from the SwiftUI
/// environment. Each view calls `rebind`/`attach` on first appear to swap in the
/// real services, so these stubs are never actually hit at runtime — they just
/// satisfy the initializer.
///
/// They also double as convenient fixtures for SwiftUI previews.
enum PreviewStubs {
    /// An APIClient with no token provider — used only to build placeholder
    /// services. Any real call would throw `.unauthenticated`, which is fine
    /// because views rebind before making requests.
    static let api = APIClient()

    static let contentService = ContentService(api: api)
    static let coachService = CoachService(api: api)
    static let authService = AuthService(api: api)
    static let pushService = PushService(api: api)

    /// Non-persisting flashcard store for building `@StateObject` VMs before the
    /// view configures the real one; also handy for previews.
    static let flashcardStore: FlashcardStoring = InMemoryFlashcardStore()
}
