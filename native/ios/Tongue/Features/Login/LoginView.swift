import SwiftUI

/// Login screen. Two modes:
///  • Access code — for paid subscribers (matches the web app's primary flow).
///  • Free account — email-only signup for the free tier.
///
/// On success `AuthStore` flips the phase to `.signedIn` and the root swaps to
/// the tab shell, so this view has no navigation of its own.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    /// Built lazily on first appear, once the `AuthStore` is available from the
    /// environment (SwiftUI can't inject env objects into a view model's init).
    @StateObject private var vm = LoginViewModel.placeholder()
    @State private var didBind = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                header

                Picker("Mode", selection: $vm.mode) {
                    ForEach(LoginViewModel.Mode.allCases, id: \.self) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)

                fields

                if let message = vm.errorMessage {
                    ErrorBanner(message: message)
                }

                PrimaryButton(
                    title: primaryTitle,
                    isLoading: vm.isLoading,
                    isEnabled: vm.canSubmit
                ) {
                    Task { await vm.submit() }
                }

                subscribeHint

                Spacer(minLength: Spacing.xl)
            }
            .padding(Spacing.lg)
            .padding(.top, Spacing.xxl)
        }
        .background(theme.background)
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            if !didBind {
                vm.attach(auth: auth)
                didBind = true
            }
        }
        .tongueTheme()
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(theme.brandGradient)
                    .frame(width: 60, height: 60)
                Text("T")
                    .font(.system(size: 32, weight: .heavy))
                    .foregroundStyle(.white)
            }
            Text("Welcome to Tongue")
                .font(TongueFont.title)
                .foregroundStyle(theme.text)
            Text("Learn a language with an AI coach that adapts to you.")
                .font(TongueFont.callout)
                .foregroundStyle(theme.muted)
        }
    }

    @ViewBuilder
    private var fields: some View {
        if vm.mode == .code {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Enter your access code")
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
                TongueTextField(
                    placeholder: "e.g. TONGUE-XXXX",
                    text: $vm.code,
                    autocapitalization: .characters
                )
                Text("We emailed this code when you subscribed on the web.")
                    .font(TongueFont.footnote)
                    .foregroundStyle(theme.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Start free with your email")
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
                TongueTextField(
                    placeholder: "you@example.com",
                    text: $vm.email,
                    autocapitalization: .never,
                    keyboard: .emailAddress
                )
            }
        }
    }

    private var subscribeHint: some View {
        Button {
            openURL(URL(string: "https://tonge-app.fly.dev/subscribe")!)
        } label: {
            Text("Don't have a code? Subscribe on the web →")
                .font(TongueFont.footnote)
                .foregroundStyle(theme.accent)
        }
    }

    private var primaryTitle: String {
        vm.mode == .code ? "Sign in" : "Create free account"
    }
}
