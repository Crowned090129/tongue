import SwiftUI

// MARK: - Card

/// A rounded surface container used across screens.
struct Card<Content: View>: View {
    @Environment(\.theme) private var theme
    var padding: CGFloat = Spacing.lg
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(theme.line, lineWidth: 1)
            )
    }
}

// MARK: - Primary button

/// Filled gradient button used for the main call-to-action.
struct PrimaryButton: View {
    @Environment(\.theme) private var theme
    let title: String
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if isLoading {
                    ProgressView().tint(.white)
                } else {
                    Text(title)
                        .font(TongueFont.headline)
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(theme.brandGradient)
            .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
            .opacity(isEnabled && !isLoading ? 1 : 0.5)
        }
        .disabled(!isEnabled || isLoading)
    }
}

// MARK: - Secondary button

struct SecondaryButton: View {
    @Environment(\.theme) private var theme
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(TongueFont.headline)
                .foregroundStyle(theme.text)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
        }
    }
}

// MARK: - Pill / Tag

struct Pill: View {
    @Environment(\.theme) private var theme
    let text: String
    var filled: Bool = false

    var body: some View {
        Text(text)
            .font(TongueFont.caption)
            .foregroundStyle(filled ? .white : theme.muted)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.xs + 2)
            .background(
                Group {
                    if filled { AnyView(theme.brandGradient) }
                    else { AnyView(theme.surface2) }
                }
            )
            .clipShape(Capsule())
    }
}

// MARK: - Section header

struct SectionHeader: View {
    @Environment(\.theme) private var theme
    let title: String
    var subtitle: String?

    init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(TongueFont.title2)
                .foregroundStyle(theme.text)
            if let subtitle {
                Text(subtitle)
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Text field

/// Styled text field matching the brand surfaces.
struct TongueTextField: View {
    @Environment(\.theme) private var theme
    let placeholder: String
    @Binding var text: String
    var autocapitalization: TextInputAutocapitalization = .never
    var keyboard: UIKeyboardType = .default

    var body: some View {
        TextField(placeholder, text: $text)
            .font(TongueFont.body)
            .foregroundStyle(theme.text)
            .textInputAutocapitalization(autocapitalization)
            .keyboardType(keyboard)
            .autocorrectionDisabled()
            .padding(.horizontal, Spacing.lg)
            .frame(height: 52)
            .background(theme.surface2)
            .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
    }
}

// MARK: - Error banner

struct ErrorBanner: View {
    @Environment(\.theme) private var theme
    let message: String

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message).font(TongueFont.footnote)
        }
        .foregroundStyle(theme.red)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(theme.red.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
    }
}
