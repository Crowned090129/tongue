import SwiftUI

/// Subscribe screen — payments run through Tongue's own Stripe checkout on the
/// web, so we keep ~100% (no App Store 15–30% cut).
///
/// Compliance note: the app must NOT charge through an in-binary purchase form.
/// It CAN show pricing and link out to the external web checkout — Apple began
/// permitting external-purchase links in the US in 2025 (post-Epic). The user
/// pays on the web via Stripe, receives an access code by email, and signs in
/// here. No StoreKit / IAP is used anywhere.
struct PaywallView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// Optional context message from the server (e.g. the 429 "upgrade" text).
    var reason: String?

    private let subscribeURL = URL(string: "https://tonge-app.fly.dev/subscribe")!

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(theme.brandGradient)
                            .frame(width: 64, height: 64)
                        Image(systemName: "sparkles")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(.white)
                    }

                    Text("Unlock everything")
                        .font(TongueFont.title)
                        .foregroundStyle(theme.text)

                    if let reason {
                        Text(reason)
                            .font(TongueFont.callout)
                            .foregroundStyle(theme.muted)
                    }

                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            benefit("Unlimited AI Coach conversations")
                            benefit("Every language and all reference content")
                            benefit("Voice tutor, analyzer, and flashcards")
                            benefit("Streak reminders and progress tracking")
                        }
                    }

                    // Pricing — mirrors the web /subscribe page.
                    HStack(spacing: Spacing.md) {
                        planCard(title: "Monthly", price: "$9", period: "per month", highlight: false)
                        planCard(title: "Yearly", price: "$79", period: "per year · save $29", highlight: true)
                    }

                    // Opens the Stripe checkout in Safari. You keep ~100% via Stripe.
                    PrimaryButton(title: "Subscribe") {
                        openURL(subscribeURL)
                    }

                    Text("You'll subscribe securely via Stripe on the Tongue website, then get an access code by email — sign in here with that code and everything unlocks. Already subscribed? Just close this and log in with your code.")
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    SecondaryButton(title: "Not now") { dismiss() }
                }
                .padding(Spacing.lg)
            }
            .background(theme.background)
            .navigationTitle("Subscribe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(theme.accent)
                }
            }
        }
        .tongueTheme()
    }

    private func planCard(title: String, price: String, period: String, highlight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(TongueFont.footnote.weight(.bold))
                .foregroundStyle(highlight ? theme.accent : theme.muted)
            Text(price)
                .font(.system(size: 26, weight: .heavy))
                .foregroundStyle(theme.text)
            Text(period)
                .font(TongueFont.footnote)
                .foregroundStyle(theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(highlight ? theme.accent.opacity(0.10) : theme.surface2)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(highlight ? theme.accent : theme.line, lineWidth: highlight ? 1.5 : 1)
                )
        )
    }

    private func benefit(_ text: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.green)
            Text(text)
                .font(TongueFont.callout)
                .foregroundStyle(theme.text)
        }
    }
}
