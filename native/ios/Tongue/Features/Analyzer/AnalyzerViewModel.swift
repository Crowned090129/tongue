import Foundation
import SwiftUI

/// Text Analyzer — pastes any target-language text and asks `/api/claude` for a
/// deep JSON breakdown. Mirrors the web `TextAnalyzer` prompt/shape exactly, so
/// the server returns the same object (`summary`, `translation`, `difficulty`,
/// `words[]`, `grammar_points[]`, `tip`).
@MainActor
final class AnalyzerViewModel: ObservableObject {
    static let maxChars = 600

    @Published var text = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var analysis: JSONValue?
    @Published var showPaywall = false
    @Published var paywallReason: String?

    private var coachService: CoachService
    private var language: Language = .default
    private var nativeLang = "en"

    private init(coachService: CoachService) {
        self.coachService = coachService
    }

    static func make(coachService: CoachService) -> AnalyzerViewModel {
        AnalyzerViewModel(coachService: coachService)
    }

    func rebind(coachService: CoachService) { self.coachService = coachService }

    func configure(language: Language, nativeLang: String) {
        self.language = language
        self.nativeLang = nativeLang
    }

    var lang: String { language.locale }

    var canAnalyze: Bool {
        !isLoading && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var refName: String {
        Language.by(code: nativeLang).name
    }

    func analyze() async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isLoading else { return }

        errorMessage = nil
        analysis = nil
        isLoading = true
        defer { isLoading = false }

        let tName = language.name
        let snippet = String(trimmed.prefix(Self.maxChars))
        let prompt = """
        You are a \(tName) language expert. A learner who speaks \(refName) pasted this text:

        "\(snippet)"

        Analyze it deeply. Return JSON:
        {"language":"\(tName) or note if different","translation":"natural \(refName) translation","summary":"what this is in 1 sentence","difficulty":"A1/A2/B1/B2/C1/C2","words":[{"word":"target word or phrase","meaning":"\(refName) meaning","grammar":"part of speech and grammatical form explanation","ref":"how this relates to \(refName) — cognate? false friend? no equivalent?"}],"grammar_points":[{"pattern":"grammar structure used","explanation":"what it is and how it works — 2-3 sentences","example":"new example using the same structure"}],"tip":"one cultural or linguistic insight"}
        """

        do {
            let res = try await coachService.ask(
                prompt: prompt,
                language: language.code,
                nativeLang: nativeLang,
                featureType: "analyzer",
                maxTokens: 900
            )
            analysis = res.raw
        } catch let error as APIError {
            if error.requiresUpgrade {
                paywallReason = error.errorDescription
                showPaywall = true
            } else {
                errorMessage = error.errorDescription
            }
        } catch {
            errorMessage = "Could not analyze. Check your connection and try again."
        }
    }

    func reset() {
        analysis = nil
        text = ""
        errorMessage = nil
    }
}
