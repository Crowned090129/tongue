import SwiftUI

@main
struct TongueApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(env)
                .environmentObject(env.authStore)
                .environmentObject(PushManager.shared)
                .tint(Color(hex: 0xC0153E))
        }
    }
}
