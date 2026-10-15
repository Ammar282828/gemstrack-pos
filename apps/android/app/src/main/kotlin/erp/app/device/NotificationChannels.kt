package erp.app.device

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/** The four channels (Sales, Payments, Orders, Karigar work), made at app start; Android keeps what a person set on them. */
object NotificationChannels {
    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        for (c in PushLogic.channels) {
            manager.createNotificationChannel(
                NotificationChannel(c.id, c.name, NotificationManager.IMPORTANCE_HIGH).apply { description = c.detail },
            )
        }
    }
}
