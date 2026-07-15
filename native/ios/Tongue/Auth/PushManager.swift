import Foundation
import UIKit
import UserNotifications

/// Owns APNs registration and syncs the device token with the backend.
///
/// Flow:
///  1. `requestAuthorizationAndRegister()` asks the user, then registers with APNs.
///  2. The `AppDelegate` forwards the device token to `didRegister(deviceToken:)`.
///  3. We POST it to /api/push/register (once we have an auth token).
///
/// The current device token is cached so `AuthStore.signOut()` can DELETE it.
@MainActor
final class PushManager: NSObject, ObservableObject {
    static let shared = PushManager()

    @Published private(set) var isAuthorized = false
    private(set) var currentDeviceToken: String?

    /// Set by the DI container so we can register the token server-side.
    var pushService: PushService?

    private override init() { super.init() }

    /// Ask for notification permission and, if granted, register with APNs.
    func requestAuthorizationAndRegister() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            isAuthorized = granted
            guard granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            isAuthorized = false
        }
    }

    /// Called from the AppDelegate with the raw APNs token.
    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        currentDeviceToken = hex
        Task { await syncTokenToBackend(hex) }
    }

    func didFailToRegister(error: Error) {
        // Non-fatal; push simply won't work this session.
        currentDeviceToken = nil
    }

    /// POST the token to the backend. Requires an authenticated session; if the
    /// user isn't signed in yet the APIClient will throw and we silently retry
    /// next launch.
    private func syncTokenToBackend(_ token: String) async {
        do {
            try await pushService?.register(token: token)
        } catch {
            // Ignored — best-effort. Will re-register on next launch.
        }
    }
}

// MARK: - Foreground presentation

extension PushManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }
}
