import SwiftUI

/// The signed-in navigation shell. Four tabs: Home/Explore, Coach, Learn (stub),
/// Settings. SF Symbols only — no emoji.
struct MainTabView: View {
    @Environment(\.theme) private var theme

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Explore", systemImage: "sparkles") }

            CoachView()
                .tabItem { Label("Coach", systemImage: "bubble.left.and.bubble.right.fill") }

            LearnView()
                .tabItem { Label("Learn", systemImage: "book.fill") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(theme.accent)
    }
}
