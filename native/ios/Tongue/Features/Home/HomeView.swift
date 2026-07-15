import SwiftUI

/// Home / Explore. Shows the current language, a tab strip of reference-content
/// categories, and renders whatever the API returns for the selected tab.
///
/// Because `/api/content` returns dynamic JSON, we render it with the generic
/// `JSONContentView` rather than a rigid schema. French shows a graceful empty
/// state (its reference content is web-only for now).
struct HomeView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = HomeViewModel.make(contentService: PreviewStubs.contentService)
    @State private var didBind = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    greeting
                    tabStrip
                    contentArea
                }
                .padding(Spacing.lg)
            }
            .background(theme.background)
            .navigationTitle("Explore")
            .refreshable { await vm.load() }
        }
        .onAppear {
            if !didBind {
                vm.rebind(contentService: env.contentService)
                vm.configure(language: currentLanguage)
                didBind = true
                Task { await vm.load() }
            }
        }
        .tongueTheme()
    }

    private var currentLanguage: Language {
        auth.profile?.language ?? .default
    }

    // MARK: - Pieces

    private var greeting: some View {
        Card {
            HStack(spacing: Spacing.md) {
                Text(currentLanguage.flag)
                    .font(.system(size: 40))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Learning \(currentLanguage.name)")
                        .font(TongueFont.headline)
                        .foregroundStyle(theme.text)
                    Text(auth.profile?.email ?? "")
                        .font(TongueFont.footnote)
                        .foregroundStyle(theme.muted)
                }
                Spacer()
                if let plan = auth.profile?.plan {
                    Pill(text: plan.capitalized, filled: plan != "free")
                }
            }
        }
    }

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(ContentTab.allCases) { tab in
                    Button {
                        Task { await vm.selectTab(tab) }
                    } label: {
                        Pill(text: tab.title, filled: vm.selectedTab == tab)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var contentArea: some View {
        if vm.isLoading {
            HStack { Spacer(); ProgressView().tint(theme.accent); Spacer() }
                .padding(.vertical, Spacing.xxl)
        } else if vm.contentUnavailable {
            unavailableCard
        } else if let message = vm.errorMessage {
            VStack(spacing: Spacing.md) {
                ErrorBanner(message: message)
                SecondaryButton(title: "Retry") { Task { await vm.load() } }
            }
        } else if vm.content.isNull {
            Text("No content for this tab yet.")
                .font(TongueFont.subhead)
                .foregroundStyle(theme.muted)
                .padding(.vertical, Spacing.xl)
        } else {
            Card { JSONContentView(value: vm.content) }
        }
    }

    private var unavailableCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "globe")
                        .foregroundStyle(theme.accent)
                    Text("\(currentLanguage.name) reference is on the web")
                        .font(TongueFont.headline)
                        .foregroundStyle(theme.text)
                }
                Text("Grammar and vocabulary reference for \(currentLanguage.name) isn't in the app yet — you can find it on the website. Meanwhile, the AI Coach fully supports \(currentLanguage.name).")
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
            }
        }
    }
}
