import SwiftUI

struct StructuresScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore

    @StateObject private var vm = ReferenceViewModel<StructuresContent>.make(
        tab: .structures,
        contentService: PreviewStubs.contentService,
        decode: { ContentDecoding.decode($0, as: StructuresContent.self) }
    )
    @State private var didBind = false

    var body: some View {
        ReferenceScaffold(vm: vm, title: ContentTab.structures.title) { model in
            ForEach(model.structures) { entry in
                StructureCard(entry: entry, lang: vm.currentLanguage.locale)
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

private struct StructureCard: View {
    @Environment(\.theme) private var theme
    let entry: StructureEntry
    let lang: String

    var body: some View {
        ExpandableCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title)
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
                if let pattern = entry.pattern, !pattern.isEmpty {
                    Text(pattern)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.accent)
                        .monospaced()
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let explanation = entry.explanation, !explanation.isEmpty {
                    Text(explanation)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let ex1 = entry.ex1Target, !ex1.isEmpty {
                    TargetLine(target: ex1, ref: entry.ex1Ref, lang: lang)
                }
                if let ex2 = entry.ex2Target, !ex2.isEmpty {
                    TargetLine(target: ex2, ref: entry.ex2Ref, lang: lang)
                }
            }
        }
    }
}
