package app.tongue.language.push

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import app.tongue.language.R
import app.tongue.language.data.repo.PushRepository
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Firebase Cloud Messaging service.
 *
 *  - [onNewToken] registers the device token with the backend (`/api/push/register`).
 *  - [onMessageReceived] renders a data/notification message into a system
 *    notification on the default channel.
 *
 * NOTE (owner action): FCM requires `google-services.json` in `app/` and the
 * `com.google.gms.google-services` Gradle plugin enabled (both are documented in
 * the README). Until then the app compiles and runs; push simply won't deliver.
 */
@AndroidEntryPoint
class TonguePushService : FirebaseMessagingService() {

    @Inject lateinit var pushRepository: PushRepository

    // The service can be torn down; use a lightweight IO scope for the register call.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        scope.launch { runCatching { pushRepository.register(token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.app_name)
        val body = message.notification?.body ?: message.data["body"] ?: return
        showNotification(title, body)
    }

    private fun showNotification(title: String, body: String) {
        val notification = NotificationCompat.Builder(
            this,
            getString(R.string.default_notification_channel_id),
        )
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
