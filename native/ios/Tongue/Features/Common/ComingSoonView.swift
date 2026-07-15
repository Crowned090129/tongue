import SwiftUI

/// Clean placeholder for screens that aren't built yet, so the app compiles and
/// navigates end-to-end.
struct ComingSoonView: View {
    @Environment(\.theme) private var theme
    let title: String
    var subtitle: String = "This part of Tongue is coming soon."

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                Spacer()
                Image(systemName: "hammer.fill")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(theme.accent)
                Text("Coming soon")
                    .font(TongueFont.title2)
                    .foregroundStyle(theme.text)
                Text(subtitle)
                    .font(TongueFont.subhead)
                    .foregroundStyle(theme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.xl)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
        }
        .tongueTheme()
    }
}
