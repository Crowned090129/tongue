import SwiftUI

/// Flashcards hub — shows the due count, a start-review CTA, add-card, and the
/// full deck. SM-2 scheduling and persistence live in the view model / store.
///
/// The store has no environment dependency (a singleton), so this VM is created
/// with the real store directly — no rebind dance needed.
struct FlashcardsView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = FlashcardsViewModel.make(store: FlashcardStore.shared)
    @State private var didConfigure = false
    @State private var showReview = false
    @State private var showAdd = false

    private var language: Language { auth.profile?.language ?? .default }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                dueCard
                deckSection
            }
            .padding(Spacing.lg)
        }
        .background(theme.background)
        .navigationTitle("Flashcards")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAdd = true
                } label: {
                    Image(systemName: "plus")
                }
                .tint(theme.accent)
            }
        }
        .onAppear {
            if !didConfigure {
                vm.configure(language: language)
                didConfigure = true
            }
        }
        .sheet(isPresented: $showAdd) {
            AddCardSheet(languageName: language.name) { front, back, note in
                vm.addCard(front: front, back: back, note: note)
            }
            .tongueTheme()
        }
        .fullScreenCover(isPresented: $showReview) {
            ReviewSessionView(vm: vm)
                .tongueTheme()
        }
        .tongueTheme()
    }

    private var dueCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(vm.dueCount) due")
                            .font(TongueFont.title2)
                            .foregroundStyle(theme.text)
                        Text("\(vm.deckCount) cards in your \(language.name) deck")
                            .font(TongueFont.footnote)
                            .foregroundStyle(theme.muted)
                    }
                    Spacer()
                    Image(systemName: "rectangle.stack.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(theme.accent)
                }
                if vm.dueCount > 0 {
                    PrimaryButton(title: "Start review") {
                        vm.startReview()
                        showReview = true
                    }
                } else {
                    Text(vm.deckCount == 0
                         ? "Add your first card to get started."
                         : "All caught up. Come back later for more reviews.")
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                }
            }
        }
    }

    @ViewBuilder
    private var deckSection: some View {
        if !vm.deckSorted.isEmpty {
            Text("ALL CARDS")
                .font(TongueFont.caption)
                .foregroundStyle(theme.muted)
            ForEach(vm.deckSorted) { card in
                DeckRow(card: card, lang: vm.lang) { vm.deleteCard(card) }
            }
        }
    }
}

private struct DeckRow: View {
    @Environment(\.theme) private var theme
    let card: Flashcard
    let lang: String
    let onDelete: () -> Void

    var body: some View {
        Card {
            HStack(spacing: Spacing.sm) {
                PlayButton(text: card.front, lang: lang)
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.front)
                        .font(TongueFont.headline)
                        .foregroundStyle(theme.text)
                    Text(card.back)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                }
                Spacer()
                Menu {
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.muted)
                        .frame(width: 32, height: 32)
                }
            }
        }
    }
}

// MARK: - Add card sheet

private struct AddCardSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let languageName: String
    let onAdd: (String, String, String?) -> Void

    @State private var front = ""
    @State private var back = ""
    @State private var note = ""

    private var canAdd: Bool {
        !front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !back.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    field("\(languageName) term", text: $front)
                    field("Meaning", text: $back)
                    field("Note (optional)", text: $note)

                    PrimaryButton(title: "Add card", isEnabled: canAdd) {
                        onAdd(front, back, note.isEmpty ? nil : note)
                        dismiss()
                    }
                    .padding(.top, Spacing.sm)
                }
                .padding(Spacing.lg)
            }
            .background(theme.background)
            .navigationTitle("New card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.tint(theme.accent)
                }
            }
        }
    }

    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        TongueTextField(placeholder: placeholder, text: text, autocapitalization: .sentences)
    }
}
