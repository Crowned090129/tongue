import SwiftUI

struct CheatSheetScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore

    @StateObject private var vm = ReferenceViewModel<CheatSheetContent>.make(
        tab: .cheatsheet,
        contentService: PreviewStubs.contentService,
        decode: { ContentDecoding.decode($0, as: CheatSheetContent.self) }
    )
    @State private var didBind = false

    var body: some View {
        ReferenceScaffold(vm: vm, title: ContentTab.cheatsheet.title) { model in
            ForEach(model.categories) { category in
                CheatSheetCategoryCard(category: category, lang: vm.currentLanguage.locale)
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

private struct CheatSheetCategoryCard: View {
    @Environment(\.theme) private var theme
    let category: CheatSheetCategory
    let lang: String

    var body: some View {
        ExpandableCard(initiallyExpanded: true) {
            Text(category.name)
                .font(TongueFont.headline)
                .foregroundStyle(theme.text)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(category.items) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        TargetLine(target: item.target, ref: item.ref, lang: lang)
                        if let note = item.note, !note.isEmpty {
                            NoteRow(text: note)
                                .padding(.leading, Spacing.xl + Spacing.sm)
                        }
                    }
                    if item.id != category.items.last?.id {
                        Divider().overlay(theme.line)
                    }
                }
            }
        }
    }
}
