import Foundation
import SwiftUI

/// Word Space — type any word/phrase and get a rich translation + breakdown.
/// Mirrors the web `WordSpace` prompt/shape: `translation_fr` (target),
/// `translation_ref`, `pronunciation`, `literal_breakdown[]`, `explanation`,
/// `ref_comparison`, `examples[]{fr,en,ref}`, `tip`.
@MainActor
final class WordSpaceViewModel: ObservableObject {
    @Published var input = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var result: JSONValue?
    @Published var showPaywall = false
    @Published var paywallReason: String?

    private var coachService: CoachService
    private var language: Language = .default
    private var nativeLang = "en"

    private init(coachService: CoachService) {
        self.coachService = coachService
    }

    static func make(coachService: CoachService) -> WordSpaceViewModel {
        WordSpaceViewModel(coachService: coachService)
    }

    func rebind(coachService: CoachService) { self.coachService = coachService }

    func configure(language: Language, nativeLang: String) {
        self.language = language
        self.nativeLang = nativeLang
    }

    /// TTS locale for the target language (the `translation_fr` strings).
    var lang: String { language.locale }

    var canLookUp: Bool {
        !isLoading && input.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    private var refName: String { Language.by(code: nativeLang).name }

    func lookUp() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2, !isLoading else { return }

        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        let tName = language.name
        let prompt = """
        You are a \(tName) language coach for \(refName) speakers. The user typed: "\(text)". This could be in any language. Detect the language, translate to \(tName) if not already in \(tName) (and also to \(refName) if it was in \(tName)), and provide rich learning content. Return ONLY valid JSON: {"input_lang":"language detected","input_text":"\(text)","translation_fr":"translation in \(tName)","translation_ref":"translation in \(refName)","pronunciation":"phonetic guide for the \(tName) version","literal_breakdown":[{"word":"each \(tName) word","meaning":"what it means"}],"explanation":"grammar and usage explanation — why is it structured this way in \(tName)?","ref_comparison":"how does this compare to \(refName)? same structure? different?","examples":[{"fr":"example 1 in \(tName)","en":"English","ref":"in \(refName)"},{"fr":"example 2","en":"English","ref":"ref"},{"fr":"example 3","en":"English","ref":"ref"}],"tip":"one key thing to remember about this word or phrase"}
        """

        do {
            let res = try await coachService.ask(
                prompt: prompt,
                language: language.code,
                nativeLang: nativeLang,
                featureType: "wordspace",
                maxTokens: 900
            )
            result = res.raw
        } catch let error as APIError {
            if error.requiresUpgrade {
                paywallReason = error.errorDescription
                showPaywall = true
            } else {
                errorMessage = error.errorDescription
            }
        } catch {
            errorMessage = "Could not translate. Check your connection and try again."
        }
    }
}
