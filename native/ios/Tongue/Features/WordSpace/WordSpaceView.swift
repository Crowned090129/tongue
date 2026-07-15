import SwiftUI

/// Word Space — translate/look up any word or phrase with audio.
struct WordSpaceView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = WordSpaceViewModel.make(coachService: PreviewStubs.coachService)
    @State private var didBind = false

    private var tName: String { (auth.profile?.language ?? .default).name }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                inputCard

                if vm.isLoading {
                    ReferenceLoading()
                } else if let error = vm.errorMessage {
                    ErrorBanner(message: error)
                } else if let result = vm.result {
                    WordSpaceResult(result: result, lang: vm.lang)
                }
            }
            .padding(Spacing.lg)
        }
        .background(theme.background)
        .navigationTitle("Word Space")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard !didBind else { return }
            vm.rebind(coachService: env.coachService)
            vm.configure(language: auth.profile?.language ?? .default, nativeLang: "en")
            didBind = true
        }
        .sheet(isPresented: $vm.showPaywall) {
            PaywallView(reason: vm.paywallReason)
        }
        .tongueTheme()
    }

    private var inputCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Translate anything")
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
                Text("Type any word or phrase — in \(tName), your language, or English — to see it translated, broken down, and voiced.")
                    .font(TongueFont.footnote)
                    .foregroundStyle(theme.muted)

                TextField("Type a word or phrase…", text: $vm.input, axis: .vertical)
                    .font(TongueFont.body)
                    .foregroundStyle(theme.text)
                    .lineLimit(1...4)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .background(theme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
                    .submitLabel(.search)
                    .onSubmit { Task { await vm.lookUp() } }

                PrimaryButton(
                    title: "Look up",
                    isLoading: vm.isLoading,
                    isEnabled: vm.canLookUp
                ) {
                    Task { await vm.lookUp() }
                }
            }
        }
    }
}

// MARK: - Result

private struct WordSpaceResult: View {
    @Environment(\.theme) private var theme
    let result: JSONValue
    let lang: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            translationCard

            if let breakdown = result["literal_breakdown"].arrayValue, !breakdown.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text("Word by word")
                            .font(TongueFont.caption)
                            .foregroundStyle(theme.muted)
                        ForEach(Array(breakdown.enumerated()), id: \.offset) { _, item in
                            if let w = item["word"].stringValue {
                                TargetLine(target: w, ref: item["meaning"].stringValue, lang: lang)
                            }
                        }
                    }
                }
            }

            if let explanation = result["explanation"].stringValue, !explanation.isEmpty {
                infoCard("How it works", explanation)
            }
            if let comparison = result["ref_comparison"].stringValue, !comparison.isEmpty {
                infoCard("Compared to your language", comparison)
            }

            if let examples = result["examples"].arrayValue, !examples.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text("Examples")
                            .font(TongueFont.caption)
                            .foregroundStyle(theme.muted)
                        ForEach(Array(examples.enumerated()), id: \.offset) { _, ex in
                            if let fr = ex["fr"].stringValue {
                                TargetLine(
                                    target: fr,
                                    ref: ex["ref"].stringValue ?? ex["en"].stringValue,
                                    lang: lang
                                )
                            }
                        }
                    }
                }
            }

            if let tip = result["tip"].stringValue, !tip.isEmpty {
                Card { NoteRow(text: tip) }
            }
        }
    }

    private var translationCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if let target = result["translation_fr"].stringValue, !target.isEmpty {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        PlayButton(text: target, lang: lang, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(target)
                                .font(TongueFont.title2)
                                .foregroundStyle(theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                            if let pron = result["pronunciation"].stringValue, !pron.isEmpty {
                                Text(pron)
                                    .font(TongueFont.footnote)
                                    .foregroundStyle(theme.muted)
                                    .italic()
                            }
                        }
                    }
                }
                if let ref = result["translation_ref"].stringValue, !ref.isEmpty {
                    Divider().overlay(theme.line)
                    Text(ref)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.muted)
                }
            }
        }
    }

    private func infoCard(_ label: String, _ value: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label.uppercased())
                    .font(TongueFont.caption)
                    .foregroundStyle(theme.muted)
                Text(value)
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
