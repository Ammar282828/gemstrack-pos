package erp.app.data

import erp.app.ErpApp
import erp.app.config.House
import erp.core.Json
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * The ERP's server routes, as the signed-in person (their Firebase ID token). Every write that moves money
 * goes this way (CONVENTIONS.md rule 1): the rules live once, in the ERP.
 */
class ErpApi private constructor() {
    class Failure(val status: Int, override val message: String) : Exception(message)

    private val requestIds = RequestIds()

    /** The sign-in token goes to the house's own ERP and nowhere else, whatever path is passed in. */
    suspend fun data(path: String, method: String = "GET", json: Map<String, Any?>? = null, timeoutMs: Long = 60_000): String =
        open(path, method, json, timeoutMs, "application/json").use { r ->
            val text = r.body.string()
            if (r.code !in 200..299) throw Failure(r.code, said(text) ?: "The ERP answered ${r.code}.")
            text
        }

    /**
     * A file from the ERP whole (a PDF, a slip's picture): `data` answers text, which would damage the bytes. The same
     * sign-in, host pinning, demo refusal and failure words as `data`. A long default timeout: a bill of many pieces
     * takes a second or two to draw.
     */
    suspend fun bytes(path: String, method: String = "GET", timeoutMs: Long = 90_000): ByteArray =
        open(path, method, null, timeoutMs, "*/*").use { r ->
            val body = try {
                r.body.bytes()
            } catch (e: IOException) {
                throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
            }
            if (r.code !in 200..299) throw Failure(r.code, said(String(body, Charsets.UTF_8)) ?: "The ERP answered ${r.code}.")
            body
        }

    /** The one place a request is built and sent, so text and bytes cannot drift apart in auth, pinning or failure. */
    private suspend fun open(path: String, method: String, json: Map<String, Any?>?, timeoutMs: Long, accept: String): Response {
        // The demo has no server and no Firebase: every call answers as if offline.
        if (House.isDemo || !ErpApp.firebaseReady) throw Failure(0, "Not connected to the ERP in the demo.")
        val url = resolve(House.serverUrl, path) ?: throw Failure(0, "Not an address of this ERP.")
        val builder = Request.Builder().url(url).header("Accept", accept)
        token()?.let { builder.header("Authorization", "Bearer $it") }
        if (json != null) {
            val text = JsonText.of(json) ?: throw Failure(0, "That can't be sent.")
            builder.method(method, text.toRequestBody(JSON))
        } else if (method != "GET") {
            builder.method(method, ByteArray(0).toRequestBody(null))
        }
        val call = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build().newCall(builder.build())
        return try {
            call.await()
        } catch (e: IOException) {
            throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
        }
    }

    /** The answer, parsed (maps, lists, text, numbers); model decoding is core's (`Json.decode<T>`). */
    suspend fun get(path: String): Any? = Json.parse(data(path))

    suspend fun post(path: String, json: Map<String, Any?>): Any? = Json.parse(data(path, "POST", json))

    /** A model from the ERP's answer: null if it is not an object. */
    suspend inline fun <reified T : Any> getModel(path: String): T? = Json.decode<T>(data(path))

    /**
     * A change to the books (/api/app/write): the ERP runs its own shared write, then names what
     * the browser would do next (the WhatsApp alert, a Shopify sync). Those are sent here without
     * waiting, so a slow PDF never holds the sale up.
     */
    suspend fun write(op: String, fields: Map<String, Any?>): Map<String, Any?> {
        val body = LinkedHashMap(fields)
        body["op"] = op
        body["requestId"] = requestIds.idFor(body)
        val out = send("/api/app/write", body = body)
        // Staff read the books every 25 seconds: fetch them now, so the balance just paid is never
        // left on screen to be paid again.
        ServerShelf.wake()
        for ((path, followBody) in followUps(out)) {
            ErpApp.scope.launch { runCatching { send(path, body = followBody) } }
        }
        return out
    }

    suspend fun send(path: String, method: String = "POST", body: Map<String, Any?> = emptyMap(), timeoutMs: Long = 60_000): Map<String, Any?> {
        val text = data(path, method, body, timeoutMs)
        @Suppress("UNCHECKED_CAST")
        return (Json.parse(text) as? Map<String, Any?>) ?: emptyMap()
    }

    private suspend fun token(): String? = try {
        com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
    } catch (e: Exception) {
        null
    }

    companion object {
        val shared: ErpApi by lazy { ErpApi() }

        private val JSON = "application/json".toMediaType()

        /** No cache and no cookie outlives the app's own call (staff's copy of the books comes this way). */
        private val client: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .cache(null)
                .followRedirects(true)
                .followSslRedirects(false)
                // A redirect off the ERP's own host (or off https) is refused, so the Authorization header never
                // follows one somewhere else. Network interceptors see every hop.
                .addNetworkInterceptor { chain ->
                    val u = chain.request().url
                    if (!stays(u, House.serverUrl)) throw IOException("Redirected away from the ERP.")
                    chain.proceed(chain.request())
                }
                .connectTimeout(20, TimeUnit.SECONDS)
                .build()
        }

        private fun stays(url: HttpUrl, base: String): Boolean = url.scheme == "https" && url.host == base.toHttpUrl().host

        /** The full address of `path` on the ERP's host, or null for anything else (another host, plain http). */
        fun resolve(base: String, path: String): HttpUrl? {
            val url = base.toHttpUrl().resolve(path) ?: return null
            return if (stays(url, base)) url else null
        }

        /** The ERP's own words for a refusal (`{ "error": "…" }`). */
        fun said(body: String): String? = ((Json.parse(body) as? Map<*, *>)?.get("error") as? String)?.takeIf { it.isNotBlank() }

        /** What the browser would do next, as the ERP names it: only the ERP's own /api/ routes are sent. */
        fun followUps(out: Map<String, Any?>): List<Pair<String, Map<String, Any?>>> =
            (out["followUps"] as? List<*>).orEmpty().mapNotNull { f ->
                val m = f as? Map<*, *> ?: return@mapNotNull null
                val path = m["path"] as? String ?: return@mapNotNull null
                if (!path.startsWith("/api/")) return@mapNotNull null
                @Suppress("UNCHECKED_CAST")
                val b = m["body"] as? Map<String, Any?> ?: return@mapNotNull null
                path to b
            }
    }
}

/**
 * The same change asked for again within half a minute (a double tap, the sheet opened again over a balance not
 * yet refreshed, a retry after the line dropped) goes with the same name, and the ERP records it once
 * (/api/app/write refuses a name it has seen). A second, genuinely separate payment of the same amount is
 * entered after that.
 */
class RequestIds(private val now: () -> Long = System::currentTimeMillis, private val newId: () -> String = { UUID.randomUUID().toString() }) {
    private val recent = HashMap<String, Pair<String, Long>>()

    @Synchronized
    fun idFor(body: Map<String, Any?>): String {
        val t = now()
        recent.entries.removeAll { t - it.value.second >= WINDOW_MS }
        // "When" is not part of what the change is: two taps a second apart are the same payment.
        val what = LinkedHashMap(body)
        for (k in WHEN) what.remove(k)
        val key = JsonText.of(what, sorted = true) ?: newId()
        val id = recent[key]?.first ?: newId()
        recent[key] = id to t
        return id
    }

    companion object {
        const val WINDOW_MS = 30_000L
        private val WHEN = listOf("date", "createdAt", "at", "now")
    }
}

/** OkHttp's call as a suspension that cancels the call with its coroutine. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont: CancellableContinuation<Response> ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWith(Result.failure(e)) }
        override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resumeWith(Result.success(response)) else response.close() }
    })
}
