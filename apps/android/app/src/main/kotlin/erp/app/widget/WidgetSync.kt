package erp.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** The widget's figures: fetched with each business's own key, kept, and drawn (ERPWidget.swift's provider, in Android's terms). */
object WidgetSync {
    private const val PERIODIC = "erp.widget.periodic"
    private const val NOW = "erp.widget.now"

    /** A half hour, as the iPhone's timeline (WorkManager's own floor is fifteen minutes). */
    const val EVERY_MINUTES = 30L

    private val client: OkHttpClient by lazy {
        // A redirect would carry the key somewhere else: none is followed.
        OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(20, TimeUnit.SECONDS).build()
    }

    /** What the ERP says, or null (offline, refused, not a summary). The key is checked still to be the kept one afterwards. */
    suspend fun fetch(context: Context, link: WidgetLinkData): WidgetSummary? = withContext(Dispatchers.IO) {
        val url = ErpWidgetUrl.summary(link.url, erp.app.config.Business.hostOf(link.url)) ?: return@withContext null
        val request = Request.Builder().url(url).header("Authorization", WidgetLinkData.authorization(link.key)).header("Accept", "application/json").build()
        try {
            client.newCall(request).execute().use { r ->
                if (r.code != 200) return@use null
                val text = r.body.string()
                val summary = WidgetSummary.decode(text) ?: return@use null
                // Signed out or re-linked meanwhile: those figures are not the new link's.
                if (WidgetStore.link(context, link.id)?.key != link.key) return@use null
                WidgetStore.cache(context, link, text)
                summary
            }
        } catch (e: IOException) {
            null
        }
    }

    /** Fetches, keeps and redraws every widget, each business's figures asked for at once. Quiet when the phone has no link. */
    suspend fun refresh(context: Context): Boolean {
        val links = WidgetStore.all(context)
        if (links.isEmpty()) return false
        val fresh = coroutineScope { links.map { async { fetch(context, it) } }.map { it.await() } }
        ErpWidget().updateAll(context)
        return fresh.any { it != null }
    }

    /** The half-hourly refresh: started when the first widget is placed, stopped with the last. */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<WidgetWorker>(EVERY_MINUTES, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    /** Once, now: the app coming to the front, a widget just placed, a key just minted. A run already waiting is enough. */
    fun refreshSoon(context: Context) {
        val request = OneTimeWorkRequestBuilder<WidgetWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
    }
}

/** Where the summary is asked for: the business's own https address only. */
object ErpWidgetUrl {
    fun summary(base: String, serverHost: String): HttpUrl? {
        val url = runCatching { (base.trimEnd('/') + "/api/widget/summary").toHttpUrl() }.getOrNull() ?: return null
        return url.takeIf { it.scheme == "https" && it.host.equals(serverHost, ignoreCase = true) }
    }
}

class WidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        WidgetSync.refresh(applicationContext).let { Result.success() }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.success() // the next half hour tries again
    }
}
