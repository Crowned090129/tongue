import SwiftUI

struct DialoguesScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore

    @StateObject private var vm = ReferenceViewModel<DialoguesContent>.make(
        tab: .dialogues,
        contentService: PreviewStubs.contentService,
        decode: { ContentDecoding.decode($0, as: DialoguesContent.self) }
    )
    @State private var didBind = false

    var body: some View {
        ReferenceScaffold(vm: vm, title: ContentTab.dialogues.title) { model in
            ForEach(model.dialogues) { dialogue in
                DialogueCard(dialogue: dialogue, lang: vm.currentLanguage.locale)
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

private struct DialogueCard: View {
    @Environment(\.theme) private var theme
    let dialogue: Dialogue
    let lang: String

    var body: some View {
        ExpandableCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(dialogue.title)
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
                HStack(spacing: Spacing.xs) {
                    if let scene = dialogue.scene, !scene.isEmpty {
                        Text(scene)
                            .font(TongueFont.footnote)
                            .foregroundStyle(theme.muted)
                    }
                    if let level = dialogue.level, !level.isEmpty {
                        Pill(text: level)
                    }
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(dialogue.lines) { line in
                    TargetLine(
                        target: line.target,
                        ref: line.ref,
                        speaker: line.speaker,
                        lang: lang
                    )
                }

                if let vocab = dialogue.vocab, !vocab.isEmpty {
                    Divider().overlay(theme.line)
                    Text("Vocabulary")
                        .font(TongueFont.caption)
                        .foregroundStyle(theme.accent)
                    ForEach(vocab) { word in
                        TargetLine(target: word.t, ref: word.r, pronunciation: word.p, lang: lang)
                    }
                }

                if let note = dialogue.note, !note.isEmpty {
                    NoteRow(text: note)
                }
            }
        }
    }
}
