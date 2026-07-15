import Foundation
import SwiftUI

@MainActor
final class FlashcardsViewModel: ObservableObject {
    /// All cards for the current language (persisted).
    @Published private(set) var cards: [Flashcard] = []
    /// The due-review queue for this session.
    @Published private(set) var reviewQueue: [Flashcard] = []
    @Published var isFlipped = false

    private let store: FlashcardStoring
    private var language: Language = .default

    private init(store: FlashcardStoring) {
        self.store = store
    }

    static func make(store: FlashcardStoring) -> FlashcardsViewModel {
        FlashcardsViewModel(store: store)
    }

    func configure(language: Language) {
        self.language = language
        reload()
    }

    var lang: String { language.locale }

    // MARK: - Derived

    /// Cards for the current language only.
    private var deck: [Flashcard] {
        cards.filter { $0.lang == language.code }
    }

    var deckCount: Int { deck.count }

    var dueCount: Int {
        let now = Date()
        return deck.filter { $0.isDue(at: now) }.count
    }

    var currentCard: Flashcard? { reviewQueue.first }

    var reviewedThisSession: Int { startedQueueCount - reviewQueue.count }
    private var startedQueueCount = 0

    // MARK: - Loading

    private func reload() {
        cards = store.load()
    }

    // MARK: - Review flow

    /// Build the due queue (oldest-due first) and start a review session.
    func startReview() {
        let now = Date()
        reviewQueue = deck
            .filter { $0.isDue(at: now) }
            .sorted { $0.dueDate < $1.dueDate }
        startedQueueCount = reviewQueue.count
        isFlipped = false
    }

    func flip() { isFlipped.toggle() }

    /// Grade the current card, persist the SM-2 update, and advance the queue.
    func grade(_ grade: ReviewGrade) {
        guard let card = reviewQueue.first else { return }
        let updated = SM2.schedule(card, grade: grade)

        if let idx = cards.firstIndex(where: { $0.id == card.id }) {
            cards[idx] = updated
        }
        store.save(cards)

        reviewQueue.removeFirst()
        // If the card was failed, re-show it later in the same session.
        if grade == .again {
            reviewQueue.append(updated)
        }
        isFlipped = false
    }

    // MARK: - Editing

    func addCard(front: String, back: String, note: String?) {
        let f = front.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = back.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !f.isEmpty, !b.isEmpty else { return }
        let card = Flashcard(
            lang: language.code,
            front: f,
            back: b,
            note: note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        )
        cards.insert(card, at: 0)
        store.save(cards)
    }

    func deleteCard(_ card: Flashcard) {
        cards.removeAll { $0.id == card.id }
        reviewQueue.removeAll { $0.id == card.id }
        store.save(cards)
    }

    /// Cards for the current language, newest first (for the "All cards" list).
    var deckSorted: [Flashcard] {
        deck.sorted { $0.createdAt > $1.createdAt }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
