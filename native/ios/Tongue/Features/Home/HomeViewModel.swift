import Foundation
import SwiftUI

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var selectedTab: ContentTab = .grammar
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var content: JSONValue = .null
    /// True when the selected language has no reference content on the API yet
    /// (currently French — it's web-only). AI Coach still works for it.
    @Published var contentUnavailable = false

    private var contentService: ContentService
    private var language: Language = .default

    private init(contentService: ContentService) {
        self.contentService = contentService
    }

    static func make(contentService: ContentService) -> HomeViewModel {
        HomeViewModel(contentService: contentService)
    }

    /// Swap in the real service once the environment is available (the
    /// `@StateObject` is created with a stub before `env` can be read).
    func rebind(contentService: ContentService) {
        self.contentService = contentService
    }

    func configure(language: Language) {
        self.language = language
    }

    func load() async {
        errorMessage = nil
        contentUnavailable = false

        // French reference content is not on the API yet — handle gracefully.
        guard language.hasReferenceContent else {
            contentUnavailable = true
            content = .null
            return
        }

        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await contentService.fetch(lang: language.code, tab: selectedTab)
            content = res.content
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectTab(_ tab: ContentTab) async {
        selectedTab = tab
        await load()
    }

    func report() async {
        guard language.hasReferenceContent else { return }
        try? await contentService.report(lang: language.code, tab: selectedTab)
    }
}
