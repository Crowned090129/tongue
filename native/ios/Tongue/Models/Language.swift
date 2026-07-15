import Foundation

/// A learnable target language. Bundled statically — matches the backend's
/// supported language codes.
///
/// NOTE: French reference content (Grammar / Vocab / etc. tabs) is NOT yet on
/// the API — it currently only exists in the web app. The content screens must
/// handle French gracefully (show an empty / "coming soon" state) while the AI
/// Coach still works for French because /api/claude is language-agnostic.
struct Language: Identifiable, Equatable, Hashable {
    let code: String        // e.g. "fr"
    let name: String        // e.g. "French"
    let flag: String        // country flag emoji (the only emoji allowed in UI)
    let locale: String      // BCP-47 locale, e.g. "fr-FR" (used for speech/TTS)

    var id: String { code }

    /// True when the backend serves reference content (Grammar/Vocab/…) tabs.
    /// French is web-only for now.
    var hasReferenceContent: Bool { code != "fr" }
}

extension Language {
    /// Static catalog, in display order. French first (the app's namesake origin).
    static let all: [Language] = [
        Language(code: "fr", name: "French",     flag: "🇫🇷", locale: "fr-FR"),
        Language(code: "es", name: "Spanish",    flag: "🇪🇸", locale: "es-ES"),
        Language(code: "pt", name: "Portuguese", flag: "🇧🇷", locale: "pt-BR"),
        Language(code: "it", name: "Italian",    flag: "🇮🇹", locale: "it-IT"),
        Language(code: "de", name: "German",     flag: "🇩🇪", locale: "de-DE"),
        Language(code: "en", name: "English",    flag: "🇺🇸", locale: "en-US"),
        Language(code: "zh", name: "Chinese",    flag: "🇨🇳", locale: "zh-CN"),
        Language(code: "ja", name: "Japanese",   flag: "🇯🇵", locale: "ja-JP"),
        Language(code: "ko", name: "Korean",     flag: "🇰🇷", locale: "ko-KR"),
        Language(code: "ru", name: "Russian",    flag: "🇷🇺", locale: "ru-RU"),
        Language(code: "ar", name: "Arabic",     flag: "🇸🇦", locale: "ar-SA"),
        Language(code: "hi", name: "Hindi",      flag: "🇮🇳", locale: "hi-IN"),
    ]

    static func by(code: String) -> Language {
        all.first { $0.code == code } ?? all[0]
    }

    static let `default` = all[0] // French
}

/// Reference-content tabs served by /api/content/{lang}/{tab}.
enum ContentTab: String, CaseIterable, Identifiable {
    case grammar
    case cheatsheet
    case structures
    case vocab
    case dialogues

    var id: String { rawValue }

    var title: String {
        switch self {
        case .grammar:    return "Grammar"
        case .cheatsheet: return "Cheat Sheet"
        case .structures: return "Structures"
        case .vocab:      return "Vocabulary"
        case .dialogues:  return "Dialogues"
        }
    }
}
