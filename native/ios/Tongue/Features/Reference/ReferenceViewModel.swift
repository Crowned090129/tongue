import Foundation
import SwiftUI

/// Shared view model for the five reference-content screens. Each screen supplies
/// its `ContentTab` and a decoder closure that maps the raw `content` JSONValue
/// into a concrete, screen-specific model.
///
/// Follows the established pattern: created with a stub service via `make`, then
/// `rebind`/`configure` on first appear.
@MainActor
final class ReferenceViewModel<Model>: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var model: Model?
    /// True when this language has no reference content on the API yet (French).
    @Published var unavailable = false
    @Published var didReport = false

    let tab: ContentTab
    private let decode: (JSONValue) -> Model?

    private var contentService: ContentService
    private var language: Language = .default

    private init(
        tab: ContentTab,
        contentService: ContentService,
        decode: @escaping (JSONValue) -> Model?
    ) {
        self.tab = tab
        self.contentService = contentService
        self.decode = decode
    }

    static func make(
        tab: ContentTab,
        contentService: ContentService,
        decode: @escaping (JSONValue) -> Model?
    ) -> ReferenceViewModel<Model> {
        ReferenceViewModel(tab: tab, contentService: contentService, decode: decode)
    }

    func rebind(contentService: ContentService) {
        self.contentService = contentService
    }

    func configure(language: Language) {
        self.language = language
    }

    var currentLanguage: Language { language }

    func load() async {
        errorMessage = nil
        unavailable = false

        guard language.hasReferenceContent else {
            unavailable = true
            model = nil
            return
        }

        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await contentService.fetch(lang: language.code, tab: tab)
            model = decode(res.content)
            if model == nil {
                errorMessage = "We got an unexpected response for this section."
            }
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func report() async {
        guard language.hasReferenceContent, !didReport else { return }
        try? await contentService.report(lang: language.code, tab: tab)
        didReport = true
    }
}
