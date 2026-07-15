import Foundation
import SwiftUI

/// A single turn in the coach conversation.
struct CoachMessage: Identifiable, Equatable {
    enum Role { case user, coach }
    let id = UUID()
    let role: Role
    let text: String
}

@MainActor
final class CoachViewModel: ObservableObject {
    @Published var messages: [CoachMessage] = []
    @Published var draft: String = ""
    @Published var isSending = false
    @Published var errorMessage: String?
    /// Remaining free-tier messages today, surfaced from `_meta.remaining`.
    @Published var remaining: Int?
    /// Set when a 429/upgrade paywall should be shown.
    @Published var showPaywall = false
    @Published var paywallReason: String?

    private var coachService: CoachService
    private var language: Language = .default
    private var nativeLang: String = "en"

    private init(coachService: CoachService) {
        self.coachService = coachService
    }

    static func make(coachService: CoachService) -> CoachViewModel {
        CoachViewModel(coachService: coachService)
    }

    func rebind(coachService: CoachService) {
        self.coachService = coachService
    }

    func configure(language: Language, nativeLang: String) {
        self.language = language
        self.nativeLang = nativeLang
        if messages.isEmpty {
            messages = [
                CoachMessage(
                    role: .coach,
                    text: "Hi! I'm your \(language.name) coach. Ask me anything, or tell me what you'd like to practice today."
                )
            ]
        }
    }

    var canSend: Bool {
        !isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func send() async {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !isSending else { return }

        messages.append(CoachMessage(role: .user, text: prompt))
        draft = ""
        errorMessage = nil
        isSending = true
        defer { isSending = false }

        do {
            let res = try await coachService.ask(
                prompt: prompt,
                language: language.code,
                nativeLang: nativeLang,
                featureType: "conversation"
            )
            remaining = res.remaining
            messages.append(CoachMessage(role: .coach, text: renderReply(res.raw)))
        } catch let error as APIError {
            if error.requiresUpgrade {
                paywallReason = error.errorDescription
                showPaywall = true
            } else {
                errorMessage = error.errorDescription
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// The AI response is dynamic JSON. Pull out the most likely human-readable
    /// field, falling back to a compact rendering.
    private func renderReply(_ json: JSONValue) -> String {
        // Common shapes the backend may return.
        for key in ["reply", "message", "response", "text", "content", "feedback"] {
            if let s = json[key].stringValue, !s.isEmpty { return s }
        }
        // A bare string response.
        if let s = json.stringValue, !s.isEmpty { return s }
        // Last resort: flatten any top-level string values.
        if let obj = json.objectValue {
            let joined = obj
                .filter { !$0.key.hasPrefix("_") }
                .compactMap { $0.value.stringValue }
                .joined(separator: "\n\n")
            if !joined.isEmpty { return joined }
        }
        return "…"
    }
}
