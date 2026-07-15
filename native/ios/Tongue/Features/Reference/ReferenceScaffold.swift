import SwiftUI

/// Common chrome for a reference screen: NavigationStack, title, loading /
/// error / unavailable states, the decoded content, and a Report-an-error
/// footer. Screens pass their loaded content via `content`.
struct ReferenceScaffold<Model, Body: View>: View {
    @Environment(\.theme) private var theme
    @ObservedObject var vm: ReferenceViewModel<Model>
    let title: String
    @ViewBuilder let content: (Model) -> Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if vm.isLoading {
                    ReferenceLoading()
                } else if vm.unavailable {
                    ReferenceUnavailable(language: vm.currentLanguage, tabTitle: title)
                } else if let message = vm.errorMessage {
                    ErrorBanner(message: message)
                    SecondaryButton(title: "Retry") { Task { await vm.load() } }
                } else if let model = vm.model {
                    content(model)
                    ReportErrorButton(didReport: vm.didReport) {
                        Task { await vm.report() }
                    }
                } else {
                    Text("No content yet.")
                        .font(TongueFont.subhead)
                        .foregroundStyle(theme.muted)
                        .padding(.vertical, Spacing.xl)
                }
            }
            .padding(Spacing.lg)
        }
        .background(theme.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await vm.load() }
    }
}
