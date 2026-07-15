import SwiftUI

/// The "Learn" hub — a single tab that links out to every learning tool:
/// the five reference tabs, the AI-powered Analyzer and Word Space, and
/// Flashcards. Mirrors how Home links into content.
struct LearnView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    private var language: Language { auth.profile?.language ?? .default }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    section("Practice") {
                        row(.init(
                            title: "Flashcards",
                            subtitle: "Spaced repetition (SM-2)",
                            icon: "rectangle.stack.fill"
                        )) { FlashcardsView() }
                        row(.init(
                            title: "Word Space",
                            subtitle: "Translate anything, with audio",
                            icon: "character.book.closed.fill"
                        )) { WordSpaceView() }
                        row(.init(
                            title: "Analyze Text",
                            subtitle: "Break down lyrics, menus, messages",
                            icon: "text.magnifyingglass"
                        )) { AnalyzerView() }
                    }

                    section("\(language.name) reference") {
                        row(.init(title: ContentTab.grammar.title, subtitle: "Rules and examples", icon: "text.book.closed.fill")) { GrammarScreen() }
                        row(.init(title: ContentTab.vocab.title, subtitle: "Words by category", icon: "list.bullet.rectangle.fill")) { VocabScreen() }
                        row(.init(title: ContentTab.structures.title, subtitle: "Common patterns", icon: "square.stack.3d.up.fill")) { StructuresScreen() }
                        row(.init(title: ContentTab.cheatsheet.title, subtitle: "Quick reference", icon: "doc.text.fill")) { CheatSheetScreen() }
                        row(.init(title: ContentTab.dialogues.title, subtitle: "Real conversations", icon: "bubble.left.and.text.bubble.right.fill")) { DialoguesScreen() }
                    }
                }
                .padding(Spacing.lg)
            }
            .background(theme.background)
            .navigationTitle("Learn")
        }
        .tongueTheme()
    }

    // MARK: - Building blocks

    private struct Item {
        let title: String
        let subtitle: String
        let icon: String
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title.uppercased())
                .font(TongueFont.caption)
                .foregroundStyle(theme.muted)
            content()
        }
    }

    private func row<Destination: View>(
        _ item: Item,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            Card {
                HStack(spacing: Spacing.md) {
                    Image(systemName: item.icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .frame(width: 32, height: 32)
                        .background(theme.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title)
                            .font(TongueFont.headline)
                            .foregroundStyle(theme.text)
                        Text(item.subtitle)
                            .font(TongueFont.footnote)
                            .foregroundStyle(theme.muted)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.muted)
                }
            }
        }
        .buttonStyle(.plain)
    }
}
