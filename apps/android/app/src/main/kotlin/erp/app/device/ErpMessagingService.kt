package erp.app.device

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import erp.app.ErpApp
import erp.app.MainActivity
import erp.app.R
import kotlinx.coroutines.launch

/**
 * What FCM hands the app: a refreshed token, and a notification that arrives while the app is open (in the background
 * the system shows it itself, on the channel the server named). A tap opens the business in `business`, then the page in `url` (AppRouter).
 */
class ErpMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        ErpApp.scope.launch { Push.tokenRefreshed(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification
        val title = n?.title ?: message.data["title"] ?: return
        val body = n?.body ?: message.data["body"].orEmpty()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val kind = message.data["kind"]
        val open = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("url", message.data["url"].orEmpty())
            // The business that sent it: a tap opens the app on that business, then the page (AppRouter).
            .putExtra("business", message.data["business"].orEmpty())
            .putExtra("kind", kind.orEmpty())
        val id = (message.messageId ?: title).hashCode()
        val tap = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val shown = NotificationCompat.Builder(this, PushLogic.channelFor(kind))
            .setSmallIcon(R.drawable.ic_stat_erp)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(id, shown) }
    }
}
