import Foundation

/// On-device persistence for flashcards, keyed by nothing more than a single
/// UserDefaults JSON blob. Small, synchronous, and correct — the deck is at most
/// a few hundred cards, well within UserDefaults' comfort zone.
///
/// A protocol lets tests / previews inject an in-memory implementation.
protocol FlashcardStoring {
    func load() -> [Flashcard]
    func save(_ cards: [Flashcard])
}

final class FlashcardStore: FlashcardStoring {
    static let shared = FlashcardStore()

    private let defaults: UserDefaults
    private let key = "tongue.flashcards.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> [Flashcard] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Flashcard].self, from: data)) ?? []
    }

    func save(_ cards: [Flashcard]) {
        guard let data = try? JSONEncoder().encode(cards) else { return }
        defaults.set(data, forKey: key)
    }
}

/// In-memory store for previews / stubs.
final class InMemoryFlashcardStore: FlashcardStoring {
    private var cards: [Flashcard]
    init(cards: [Flashcard] = []) { self.cards = cards }
    func load() -> [Flashcard] { cards }
    func save(_ cards: [Flashcard]) { self.cards = cards }
}
