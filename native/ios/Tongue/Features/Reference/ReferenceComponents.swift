import SwiftUI

/// Shared UI for the reference-content screens (Grammar, Vocab, Structures,
/// Cheat Sheet, Dialogues). Built from the existing design tokens/components.

// MARK: - Expandable card

/// A `Card` with a tappable header that expands to reveal its body. Used to keep
/// long reference lists scannable.
struct ExpandableCard<Header: View, Content: View>: View {
    @Environment(\.theme) private var theme
    @State private var expanded: Bool
    let header: () -> Header
    let content: () -> Content

    init(
        initiallyExpanded: Bool = false,
        @ViewBuilder header: @escaping () -> Header,
        @ViewBuilder content: @escaping () -> Content
    ) {
        _expanded = State(initialValue: initiallyExpanded)
        self.header = header
        self.content = content
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        header()
                        Spacer(minLength: Spacing.sm)
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.muted)
                            .padding(.top, 3)
                    }
                }
                .buttonStyle(.plain)

                if expanded {
                    content()
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }
}

// MARK: - Target line

/// A single target-language string with its play button and optional reference
/// translation / pronunciation underneath.
struct TargetLine: View {
    @Environment(\.theme) private var theme
    let target: String
    var ref: String?
    var pronunciation: String?
    var speaker: String?
    let lang: String

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            PlayButton(text: target, lang: lang)
            VStack(alignment: .leading, spacing: 2) {
                if let speaker, !speaker.isEmpty {
                    Text(speaker)
                        .font(TongueFont.caption)
                        .foregroundStyle(theme.accent)
                }
                Text(target)
                    .font(TongueFont.callout)
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let pronunciation, !pronunciation.isEmpty {
                    Text(pronunciation)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                        .italic()
                }
                if let ref, !ref.isEmpty {
                    Text(ref)
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - States

/// Centered loading spinner for a full screen.
struct ReferenceLoading: View {
    @Environment(\.theme) private var theme
    var body: some View {
        HStack { Spacer(); ProgressView().tint(theme.accent); Spacer() }
            .padding(.vertical, Spacing.xxl)
    }
}

/// Graceful "reference not on the API for this language yet" state (French).
struct ReferenceUnavailable: View {
    @Environment(\.theme) private var theme
    let language: Language
    let tabTitle: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "globe")
                        .foregroundStyle(theme.accent)
                    Text("\(tabTitle) is on the web")
                        .font(TongueFont.headline)
                        .foregroundStyle(theme.text)
                }
                Text("\(language.name) reference content isn't in the app yet — you can find it on the website. The AI Coach still fully supports \(language.name).")
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
            }
        }
    }
}

/// A footer "Report an error" button shared by every reference screen.
struct ReportErrorButton: View {
    @Environment(\.theme) private var theme
    let didReport: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                Image(systemName: didReport ? "checkmark.circle.fill" : "flag")
                Text(didReport ? "Thanks — reported" : "Report an error")
            }
            .font(TongueFont.footnote)
            .foregroundStyle(didReport ? theme.green : theme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
        }
        .disabled(didReport)
    }
}
