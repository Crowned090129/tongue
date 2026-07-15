import SwiftUI

/// Paste any target-language text → deep breakdown with audio on every target
/// string. Renders the JSON returned by `/api/claude`.
struct AnalyzerView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = AnalyzerViewModel.make(coachService: PreviewStubs.coachService)
    @State private var didBind = false

    private var tName: String { (auth.profile?.language ?? .default).name }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if let analysis = vm.analysis {
                    AnalysisResult(analysis: analysis, lang: vm.lang)
                    SecondaryButton(title: "Analyze another text") { vm.reset() }
                } else {
                    inputCard
                    if let error = vm.errorMessage {
                        ErrorBanner(message: error)
                    }
                }
            }
            .padding(Spacing.lg)
        }
        .background(theme.background)
        .navigationTitle("Analyze Text")
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
                Text("Analyze any \(tName) text")
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
                Text("Paste lyrics, a menu, a message, subtitles — get an instant breakdown of the vocabulary and grammar.")
                    .font(TongueFont.footnote)
                    .foregroundStyle(theme.muted)

                TextEditor(text: $vm.text)
                    .font(TongueFont.body)
                    .foregroundStyle(theme.text)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 120)
                    .padding(Spacing.sm)
                    .background(theme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))

                HStack {
                    Text("\(vm.text.count)/\(AnalyzerViewModel.maxChars)")
                        .font(TongueFont.caption)
                        .foregroundStyle(theme.muted)
                    Spacer()
                }

                PrimaryButton(
                    title: "Analyze",
                    isLoading: vm.isLoading,
                    isEnabled: vm.canAnalyze
                ) {
                    Task { await vm.analyze() }
                }
            }
        }
    }
}

// MARK: - Result

private struct AnalysisResult: View {
    @Environment(\.theme) private var theme
    let analysis: JSONValue
    let lang: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            headerCard

            if let words = analysis["words"].arrayValue, !words.isEmpty {
                sectionTitle("Key words & phrases")
                ForEach(Array(words.enumerated()), id: \.offset) { _, w in
                    WordCard(word: w, lang: lang)
                }
            }

            if let points = analysis["grammar_points"].arrayValue, !points.isEmpty {
                sectionTitle("Grammar patterns used")
                ForEach(Array(points.enumerated()), id: \.offset) { _, g in
                    GrammarPointCard(point: g, lang: lang)
                }
            }

            if let tip = analysis["tip"].stringValue, !tip.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("Cultural tip")
                            .font(TongueFont.caption)
                            .foregroundStyle(theme.muted)
                        Text(tip)
                            .font(TongueFont.subhead)
                            .foregroundStyle(theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var headerCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(alignment: .top) {
                    if let summary = analysis["summary"].stringValue {
                        Text(summary)
                            .font(TongueFont.headline)
                            .foregroundStyle(theme.text)
                    }
                    Spacer()
                    if let diff = analysis["difficulty"].stringValue, !diff.isEmpty {
                        Pill(text: diff)
                    }
                }
                if let translation = analysis["translation"].stringValue, !translation.isEmpty {
                    Divider().overlay(theme.line)
                    Text(translation)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.muted)
                        .italic()
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(TongueFont.caption)
            .foregroundStyle(theme.muted)
    }
}

private struct WordCard: View {
    @Environment(\.theme) private var theme
    let word: JSONValue
    let lang: String
    @State private var expanded = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        if let w = word["word"].stringValue {
                            PlayButton(text: w, lang: lang)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(w)
                                    .font(TongueFont.headline)
                                    .foregroundStyle(theme.accent)
                                if let meaning = word["meaning"].stringValue {
                                    Text(meaning)
                                        .font(TongueFont.footnote)
                                        .foregroundStyle(theme.muted)
                                }
                            }
                        }
                        Spacer()
                        Image(systemName: expanded ? "minus" : "plus")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(theme.muted)
                    }
                }
                .buttonStyle(.plain)

                if expanded {
                    if let grammar = word["grammar"].stringValue, !grammar.isEmpty {
                        labeled("Grammar", grammar)
                    }
                    if let ref = word["ref"].stringValue, !ref.isEmpty {
                        labeled("Comparison", ref)
                    }
                }
            }
        }
    }

    private func labeled(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(TongueFont.caption)
                .foregroundStyle(theme.muted)
            Text(value)
                .font(TongueFont.footnote)
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct GrammarPointCard: View {
    @Environment(\.theme) private var theme
    let point: JSONValue
    let lang: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if let pattern = point["pattern"].stringValue, !pattern.isEmpty {
                    Text(pattern)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.accent)
                        .monospaced()
                }
                if let explanation = point["explanation"].stringValue, !explanation.isEmpty {
                    Text(explanation)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let example = point["example"].stringValue, !example.isEmpty {
                    TargetLine(target: example, lang: lang)
                }
            }
        }
    }
}
