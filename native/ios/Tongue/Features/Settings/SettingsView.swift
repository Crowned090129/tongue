import SwiftUI

/// Settings — account info, language picker (with country flags), subscription
/// status, and sign out.
struct SettingsView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = SettingsViewModel.make(authService: PreviewStubs.authService)
    @State private var didBind = false
    @State private var showLanguagePicker = false
    @State private var showPaywall = false
    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    accountCard
                    languageCard
                    subscriptionCard
                    if let message = vm.errorMessage {
                        ErrorBanner(message: message)
                    }
                    signOutButton
                    footer
                }
                .padding(Spacing.lg)
            }
            .background(theme.background)
            .navigationTitle("Settings")
        }
        .onAppear {
            if !didBind {
                vm.rebind(authService: env.authService, authStore: auth)
                didBind = true
            }
        }
        .sheet(isPresented: $showLanguagePicker) {
            LanguagePickerView(current: auth.profile?.language ?? .default) { picked in
                Task { await vm.changeLanguage(to: picked) }
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(reason: nil)
        }
        .confirmationDialog("Sign out of Tongue?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await vm.signOut() } }
            Button("Cancel", role: .cancel) {}
        }
        .tongueTheme()
    }

    // MARK: - Cards

    private var accountCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Account")
                    .font(TongueFont.caption)
                    .foregroundStyle(theme.muted)
                Text(auth.profile?.email ?? "—")
                    .font(TongueFont.headline)
                    .foregroundStyle(theme.text)
            }
        }
    }

    private var languageCard: some View {
        Button { showLanguagePicker = true } label: {
            Card {
                HStack(spacing: Spacing.md) {
                    Text((auth.profile?.language ?? .default).flag)
                        .font(.system(size: 32))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Learning")
                            .font(TongueFont.caption)
                            .foregroundStyle(theme.muted)
                        Text((auth.profile?.language ?? .default).name)
                            .font(TongueFont.headline)
                            .foregroundStyle(theme.text)
                    }
                    Spacer()
                    if vm.isSavingLanguage {
                        ProgressView().tint(theme.accent)
                    } else {
                        Image(systemName: "chevron.right")
                            .foregroundStyle(theme.muted)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var subscriptionCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("Plan")
                        .font(TongueFont.headline)
                        .foregroundStyle(theme.text)
                    Spacer()
                    Pill(text: (auth.profile?.plan ?? "free").capitalized,
                         filled: auth.profile?.isPaid == true)
                }
                if auth.profile?.isPaid != true {
                    Text("You're on the free plan. Subscribe on the web to unlock unlimited coaching and all languages.")
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.muted)
                    SecondaryButton(title: "See subscription options") {
                        showPaywall = true
                    }
                }
            }
        }
    }

    private var signOutButton: some View {
        Button(role: .destructive) {
            showSignOutConfirm = true
        } label: {
            Text("Sign out")
                .font(TongueFont.headline)
                .foregroundStyle(theme.red)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.button, style: .continuous)
                        .strokeBorder(theme.line, lineWidth: 1)
                )
        }
    }

    private var footer: some View {
        Text("Tongue v1.0.0")
            .font(TongueFont.footnote)
            .foregroundStyle(theme.muted)
            .frame(maxWidth: .infinity)
            .padding(.top, Spacing.md)
    }
}

/// Language picker sheet. Country flags are allowed here (the only emoji in UI).
struct LanguagePickerView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let current: Language
    let onSelect: (Language) -> Void

    var body: some View {
        NavigationStack {
            List(Language.all) { lang in
                Button {
                    onSelect(lang)
                    dismiss()
                } label: {
                    HStack(spacing: Spacing.md) {
                        Text(lang.flag).font(.system(size: 28))
                        Text(lang.name)
                            .font(TongueFont.body)
                            .foregroundStyle(theme.text)
                        Spacer()
                        if lang == current {
                            Image(systemName: "checkmark")
                                .foregroundStyle(theme.accent)
                        }
                    }
                }
                .listRowBackground(theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(theme.background)
            .navigationTitle("Language")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(theme.accent)
                }
            }
        }
        .tongueTheme()
    }
}
