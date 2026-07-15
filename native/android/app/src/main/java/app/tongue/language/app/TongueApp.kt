package app.tongue.language.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import app.tongue.language.R
import dagger.hilt.android.HiltAndroidApp

/**
 * Application entry point. `@HiltAndroidApp` triggers Hilt's code generation and
 * creates the app-level dependency container. Also registers the default
 * notification channel used by FCM messages.
 */
@HiltAndroidApp
class TongueApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createDefaultNotificationChannel()
    }

    private fun createDefaultNotificationChannel() {
        // API 26+ (minSdk 26) always requires a channel for notifications.
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            getString(R.string.default_notification_channel_id),
            getString(R.string.default_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Practice reminders and streak nudges."
        }
        manager.createNotificationChannel(channel)
    }
}
