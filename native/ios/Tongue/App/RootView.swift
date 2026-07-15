import SwiftUI

/// Top-level view that swaps between the launch splash, the auto-signing-in
/// splash, the Login flow, and the main tab shell based on the auth phase.
struct RootView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        // Inject the resolved palette here so `RootContent` (and its background)
        // read the correct light/dark theme.
        RootContent()
            .tongueTheme()
            .animation(.easeInOut(duration: 0.25), value: auth.phase)
            .task {
                await auth.bootstrap()
                // Ask for push permission once we're signed in (non-blocking).
                if auth.phase == .signedIn {
                    await PushManager.shared.requestAuthorizationAndRegister()
                }
            }
    }
}

private struct RootContent: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            theme.background.ignoresSafeArea()

            switch auth.phase {
            case .launching:
                SplashView(message: nil)
            case .autoSigningIn:
                SplashView(message: "Signing you in…")
            case .signedOut:
                LoginView()
                    .transition(.opacity)
            case .signedIn:
                MainTabView()
                    .transition(.opacity)
            }
        }
    }
}

/// Branded launch / auto-login splash.
struct SplashView: View {
    @Environment(\.theme) private var theme
    let message: String?

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(theme.brandGradient)
                    .frame(width: 96, height: 96)
                Text("T")
                    .font(.system(size: 48, weight: .heavy))
                    .foregroundStyle(.white)
            }
            Text("Tongue")
                .font(TongueFont.title)
                .foregroundStyle(theme.text)
            Spacer()
            if let message {
                HStack(spacing: Spacing.sm) {
                    ProgressView().tint(theme.accent)
                    Text(message)
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.muted)
                }
                .padding(.bottom, Spacing.xxl)
            }
        }
        .tongueTheme()
    }
}
