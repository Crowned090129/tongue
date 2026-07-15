import SwiftUI

/// The review session: shows one due card at a time, flips to reveal the answer,
/// then grades it (Again/Hard/Good/Easy) which feeds SM-2 and advances the queue.
struct ReviewSessionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var vm: FlashcardsViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.xl) {
                if let card = vm.currentCard {
                    Spacer()
                    CardFace(card: card, isFlipped: vm.isFlipped, lang: vm.lang)
                        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { vm.flip() } }
                    Spacer()
                    controls
                } else {
                    Spacer()
                    doneState
                    Spacer()
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.background)
            .navigationTitle("Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.tint(theme.accent)
                }
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        if vm.isFlipped {
            HStack(spacing: Spacing.sm) {
                ForEach(ReviewGrade.allCases) { grade in
                    GradeButton(grade: grade) { vm.grade(grade) }
                }
            }
        } else {
            PrimaryButton(title: "Show answer") {
                withAnimation(.easeInOut(duration: 0.2)) { vm.flip() }
            }
        }
    }

    private var doneState: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44))
                .foregroundStyle(theme.green)
            Text("Session complete")
                .font(TongueFont.title2)
                .foregroundStyle(theme.text)
            Text("You reviewed \(vm.reviewedThisSession) card\(vm.reviewedThisSession == 1 ? "" : "s").")
                .font(TongueFont.subhead)
                .foregroundStyle(theme.muted)
            SecondaryButton(title: "Done") { dismiss() }
                .padding(.top, Spacing.md)
                .padding(.horizontal, Spacing.xxl)
        }
    }
}

// MARK: - Card face

private struct CardFace: View {
    @Environment(\.theme) private var theme
    let card: Flashcard
    let isFlipped: Bool
    let lang: String

    var body: some View {
        VStack(spacing: Spacing.lg) {
            PlayButton(text: card.front, lang: lang, size: 44)

            Text(card.front)
                .font(TongueFont.title)
                .foregroundStyle(theme.text)
                .multilineTextAlignment(.center)

            if isFlipped {
                Divider().overlay(theme.line).padding(.horizontal, Spacing.xxl)
                Text(card.back)
                    .font(TongueFont.title2)
                    .foregroundStyle(theme.accent)
                    .multilineTextAlignment(.center)
                if let note = card.note, !note.isEmpty {
                    Text(note)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                        .multilineTextAlignment(.center)
                }
            } else {
                Text("Tap to reveal")
                    .font(TongueFont.footnote)
                    .foregroundStyle(theme.muted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Spacing.xl)
        .frame(minHeight: 260)
        .background(theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(theme.line, lineWidth: 1)
        )
    }
}

private struct GradeButton: View {
    @Environment(\.theme) private var theme
    let grade: ReviewGrade
    let action: () -> Void

    private var tint: Color {
        switch grade {
        case .again: return theme.red
        case .hard:  return theme.muted
        case .good:  return theme.accent
        case .easy:  return theme.green
        }
    }

    var body: some View {
        Button(action: action) {
            Text(grade.title)
                .font(TongueFont.caption)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(tint)
                .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
        }
    }
}
