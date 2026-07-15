import Foundation

/// A single flashcard with its SM-2 scheduling state. Cards are per-language.
///
/// SM-2 (SuperMemo 2) fields:
///  • `easeFactor`  — difficulty multiplier, starts at 2.5, floored at 1.3.
///  • `interval`    — days until next review.
///  • `repetitions` — count of consecutive correct (grade ≥ 3) reviews.
struct Flashcard: Codable, Identifiable, Equatable {
    let id: UUID
    let lang: String            // language code, e.g. "es"
    var front: String           // target-language term (spoken)
    var back: String            // meaning / translation
    var note: String?

    // SM-2 state
    var easeFactor: Double
    var interval: Int
    var repetitions: Int
    var dueDate: Date
    let createdAt: Date

    init(lang: String, front: String, back: String, note: String? = nil, now: Date = Date()) {
        self.id = UUID()
        self.lang = lang
        self.front = front
        self.back = back
        self.note = note
        self.easeFactor = 2.5
        self.interval = 0
        self.repetitions = 0
        self.dueDate = now          // due immediately
        self.createdAt = now
    }

    /// Due for review at/before `date`.
    func isDue(at date: Date = Date()) -> Bool { dueDate <= date }
}

/// A review grade, mapped to the SM-2 quality scale (0–5).
enum ReviewGrade: Int, CaseIterable, Identifiable {
    case again = 1    // complete blackout / wrong
    case hard  = 3    // correct with serious difficulty
    case good  = 4    // correct after hesitation
    case easy  = 5    // perfect recall

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .again: return "Again"
        case .hard:  return "Hard"
        case .good:  return "Good"
        case .easy:  return "Easy"
        }
    }
}

// MARK: - SM-2 scheduling

enum SM2 {
    /// Apply the SM-2 algorithm to `card` given a `grade`, returning the updated
    /// card. Grades below 3 reset the repetition streak (relearn from interval 1);
    /// grades ≥ 3 advance the interval and adjust the ease factor.
    static func schedule(_ card: Flashcard, grade: ReviewGrade, now: Date = Date()) -> Flashcard {
        var c = card
        let q = Double(grade.rawValue)

        if grade.rawValue < 3 {
            // Failed recall — reset streak, review again after 1 day.
            c.repetitions = 0
            c.interval = 1
        } else {
            switch c.repetitions {
            case 0: c.interval = 1
            case 1: c.interval = 6
            default: c.interval = Int((Double(c.interval) * c.easeFactor).rounded())
            }
            c.repetitions += 1
        }

        // Update ease factor (SM-2 formula), never below 1.3.
        let newEase = c.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        c.easeFactor = max(1.3, newEase)

        c.dueDate = Calendar.current.date(byAdding: .day, value: max(1, c.interval), to: now) ?? now
        return c
    }
}
