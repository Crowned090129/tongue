import Foundation

/// Typed shapes for the reference-content tabs served by
/// `GET /api/content/{lang}/{tab}`. The transport layer decodes the envelope
/// into `ContentResponse` (whose `content` is a dynamic `JSONValue`); these
/// screens then re-decode that `content` into the tab-specific struct.
///
/// Decoding goes through `JSONValue` → `Data` → typed struct so we reuse the
/// existing envelope decode and stay resilient to missing optional fields.
enum ContentDecoding {
    /// Re-encode a `JSONValue` and decode it into a concrete `Decodable` type.
    static func decode<T: Decodable>(_ value: JSONValue, as _: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Grammar

struct GrammarContent: Decodable {
    let sections: [GrammarSection]
}

struct GrammarSection: Decodable, Identifiable {
    let title: String
    let level: String?
    let rule: String?
    let exampleTarget: String?
    let exampleTarget2: String?
    let exampleRef: String?
    let note: String?

    var id: String { title }

    enum CodingKeys: String, CodingKey {
        case title, level, rule, note
        case exampleTarget = "example_target"
        case exampleTarget2 = "example_target_2"
        case exampleRef = "example_ref"
    }
}

// MARK: - Cheat sheet

struct CheatSheetContent: Decodable {
    let categories: [CheatSheetCategory]
}

struct CheatSheetCategory: Decodable, Identifiable {
    let name: String
    let items: [CheatSheetItem]
    var id: String { name }
}

struct CheatSheetItem: Decodable, Identifiable {
    let target: String
    let ref: String?
    let note: String?
    var id: String { target }
}

// MARK: - Structures

struct StructuresContent: Decodable {
    let structures: [StructureEntry]
}

struct StructureEntry: Decodable, Identifiable {
    let pattern: String?
    let title: String
    let explanation: String?
    let ex1Target: String?
    let ex1Ref: String?
    let ex2Target: String?
    let ex2Ref: String?

    var id: String { title }

    enum CodingKeys: String, CodingKey {
        case pattern, title, explanation
        case ex1Target = "ex1_target"
        case ex1Ref = "ex1_ref"
        case ex2Target = "ex2_target"
        case ex2Ref = "ex2_ref"
    }
}

// MARK: - Vocabulary

struct VocabContent: Decodable {
    let categories: [VocabCategory]
}

struct VocabCategory: Decodable, Identifiable {
    let name: String
    let words: [VocabWord]
    var id: String { name }
}

struct VocabWord: Decodable, Identifiable {
    let t: String            // target
    let p: String?           // pronunciation
    let r: String?           // meaning / reference
    var id: String { t }
}

// MARK: - Dialogues

struct DialoguesContent: Decodable {
    let dialogues: [Dialogue]
}

struct Dialogue: Decodable, Identifiable {
    let title: String
    let scene: String?
    let level: String?
    let lines: [DialogueLine]
    let vocab: [VocabWord]?
    let note: String?
    var id: String { title }
}

struct DialogueLine: Decodable, Identifiable {
    let speaker: String?
    let target: String
    let ref: String?
    var id: String { (speaker ?? "") + target }
}
