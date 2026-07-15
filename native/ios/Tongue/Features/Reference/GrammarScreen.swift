import SwiftUI

struct GrammarScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore

    @StateObject private var vm = ReferenceViewModel<GrammarContent>.make(
        tab: .grammar,
        contentService: PreviewStubs.contentService,
        decode: { ContentDecoding.decode($0, as: GrammarContent.self) }
    )
    @State private var didBind = false

    var body: some View {
        ReferenceScaffold(vm: vm, title: ContentTab.grammar.title) { model in
            ForEach(model.sections) { section in
                GrammarSectionCard(section: section, lang: vm.currentLanguage.locale)
            }
        }
        .onAppear {
            guard !didBind else { return }
            vm.rebind(contentService: env.contentService)
            vm.configure(language: auth.profile?.language ?? .default)
            didBind = true
            Task { await vm.load() }
        }
        .tongueTheme()
    }
}

private struct GrammarSectionCard: View {
    @Environment(\.theme) private var theme
    let section: GrammarSection
    let lang: String

    var body: some View {
        ExpandableCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(section.title)
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
                if let level = section.level, !level.isEmpty {
                    Pill(text: level)
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let rule = section.rule, !rule.isEmpty {
                    Text(rule)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let ex = section.exampleTarget, !ex.isEmpty {
                    TargetLine(target: ex, ref: section.exampleRef, lang: lang)
                }
                if let ex2 = section.exampleTarget2, !ex2.isEmpty {
                    TargetLine(target: ex2, lang: lang)
                }
                if let note = section.note, !note.isEmpty {
                    NoteRow(text: note)
                }
            }
        }
    }
}

/// A subtle info note used across reference cards.
struct NoteRow: View {
    @Environment(\.theme) private var theme
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Image(systemName: "lightbulb")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
                .padding(.top, 2)
            Text(text)
                .font(TongueFont.footnote)
                .foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
