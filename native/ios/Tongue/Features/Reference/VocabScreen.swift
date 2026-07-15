import SwiftUI

struct VocabScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore

    @StateObject private var vm = ReferenceViewModel<VocabContent>.make(
        tab: .vocab,
        contentService: PreviewStubs.contentService,
        decode: { ContentDecoding.decode($0, as: VocabContent.self) }
    )
    @State private var didBind = false

    var body: some View {
        ReferenceScaffold(vm: vm, title: ContentTab.vocab.title) { model in
            ForEach(model.categories) { category in
                VocabCategoryCard(category: category, lang: vm.currentLanguage.locale)
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

private struct VocabCategoryCard: View {
    @Environment(\.theme) private var theme
    let category: VocabCategory
    let lang: String

    var body: some View {
        ExpandableCard {
            Text(category.name)
                .font(TongueFont.headline)
                .foregroundStyle(theme.text)
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(category.words) { word in
                    TargetLine(
                        target: word.t,
                        ref: word.r,
                        pronunciation: word.p,
                        lang: lang
                    )
                    if word.id != category.words.last?.id {
                        Divider().overlay(theme.line)
                    }
                }
            }
        }
    }
}
