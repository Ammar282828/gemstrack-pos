package erp.app.data

import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.UpdateGate
import erp.core.Json
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * The ERP's server routes, as the signed-in person (their Firebase ID token). Every write that moves money
 * goes this way (CONVENTIONS.md rule 1): the rules live once, in the ERP.
 *
 * One per business (`forBusiness`): its address, and the token of its own Firebase app. `shared` is the open business's. A
 * call that began for one business is finished for that business, whichever is open by then (an Outbox entry, a push
 * registration), so nothing of one business's reaches another's server.
 */
class ErpApi private constructor(private val initial: Business) {
    class Failure(val status: Int, override val message: String) : Exception(message)

    private val id = initial.id

    /** The business as the phone has it now (a refresh may have given it its Android sign-in); the address never moves. */
    private val biz: Business get() = Businesses.business(id) ?: initial

    /**
     * The sign-in token goes to the house's own ERP and nowhere else, whatever path is passed in. `timeoutMs` is how
     * long the ERP may take to answer: a page load that has not answered in 15 s is a dead line, not a slow server, so
     * it says so and lets the screen retry; writes and sends keep a minute.
     */
    suspend fun data(path: String, method: String = "GET", json: Map<String, Any?>? = null, timeoutMs: Long? = null): String =
        open(path, method, json, timeoutMs ?: if (method == "GET") GET_TIMEOUT_MS else SEND_TIMEOUT_MS, "application/json").use { r ->
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
    private suspend fun open(path: String, method: String, json: Map<String, Any?>?, timeoutMs: Long, accept: String, form: RequestBody? = null): Response {
        // The demo has no server and no Firebase: every call answers as if offline.
        if (House.isDemo || Businesses.firebaseApp(biz) == null) throw Failure(0, "Not connected to the ERP in the demo.")
        val base = biz.serverURL
        val url = resolve(base, path) ?: throw Failure(0, "Not an address of this ERP.")
        val builder = Request.Builder().url(url).header("Accept", accept)
        token()?.let { builder.header("Authorization", "Bearer $it") }
        if (form != null) {
            builder.method(method, form)
        } else if (json != null) {
            val text = JsonText.of(json) ?: throw Failure(0, "That can't be sent.")
            builder.method(method, text.toRequestBody(JSON))
        } else if (method != "GET") {
            builder.method(method, ByteArray(0).toRequestBody(null))
        }
        // OkHttp's own read and write limits are 10 s each and win over the call's: the bill reader answers in 10-70 s,
        // so it was cut off at 10 s every time (2026-10-28) while the ERP went on to read the bill. The call's limit is the one limit.
        val call = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            // A redirect off the ERP's own host (or off https) is refused, so the Authorization header never
            // follows one somewhere else. Network interceptors see every hop.
            .addNetworkInterceptor { chain ->
                if (!stays(chain.request().url, base)) throw IOException("Redirected away from the ERP.")
                chain.proceed(chain.request())
            }.build().newCall(builder.build())
        return try {
            call.await()
        } catch (e: IOException) {
            throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
        }
    }

    /** One part of a multipart form: a file under its field ("file", "image", "square"). The name is plain ASCII. */
    class FormFile(val field: String, val name: String, val type: String, val bytes: ByteArray)

    /**
     * A multipart form to the ERP, as the web pages send theirs with FormData (Post a piece's photos and AI, Add photos,
     * Edit a piece): the same sign-in, host pinning, demo refusal and failure words as `data`. Answers the route's text.
     */
    suspend fun upload(path: String, fields: List<Pair<String, String>>, files: List<FormFile> = emptyList(), method: String = "POST", timeoutMs: Long = 120_000): String {
        val form = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM).apply {
            for ((name, value) in fields) addFormDataPart(name, value)
            for (f in files) addFormDataPart(f.field, f.name, f.bytes.toRequestBody(f.type.toMediaType()))
        }.build()
        return open(path, method, null, timeoutMs, "application/json", form).use { r ->
            val text = r.body.string()
            if (r.code !in 200..299) throw Failure(r.code, said(text) ?: "The ERP answered ${r.code}.")
            text
        }
    }

    /** [upload] for a route that answers a file (Design's remove-background answers a PNG): the bytes whole, not text. */
    suspend fun uploadBytes(path: String, fields: List<Pair<String, String>>, files: List<FormFile> = emptyList(), timeoutMs: Long = 120_000): ByteArray {
        val form = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM).apply {
            for ((name, value) in fields) addFormDataPart(name, value)
            for (f in files) addFormDataPart(f.field, f.name, f.bytes.toRequestBody(f.type.toMediaType()))
        }.build()
        return open(path, "POST", null, timeoutMs, "*/*", form).use { r ->
            val body = try {
                r.body.bytes()
            } catch (e: IOException) {
                throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
            }
            if (r.code !in 200..299) throw Failure(r.code, said(String(body, Charsets.UTF_8)) ?: "The ERP answered ${r.code}.")
            body
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
     *
     * `requestId` is the one name for one intent: the Outbox keeps it in the entry for every retry, and the ERP
     * records the change once however often it is sent. Without one, the name is remembered here (`WriteIntents`),
     * on disk, against what the change is, until the ERP has answered: a retry after a timeout, or after the app was
     * killed, goes with the same name, and the ERP replays its first answer (money ops require a name).
     *
     * The request is not cut off when the screen that asked goes away (the iPhone lends a few seconds in the
     * background): the person may have left the sheet, and the write is already on its way.
     */
    suspend fun write(op: String, fields: Map<String, Any?>, requestId: String? = null): Map<String, Any?> {
        // A build older than this ERP's minimum writes nothing (its rules for money may be out of date).
        if (UpdateGate.blocked(biz)) throw Failure(426, UpdateGate.words)
        val body = LinkedHashMap(fields)
        body["op"] = op
        val intents = WriteIntents.forBusiness(id)
        val intent = if (requestId == null) intents.key(body) else null
        body["requestId"] = requestId ?: intents.id(intent!!)
        val out = withContext(NonCancellable) {
            try {
                send("/api/app/write", body = body)
            } catch (e: Failure) {
                // "Already sent and recorded": the earlier try went through. The intent is done.
                if (e.status == 409 && intent != null) intents.clear(intent)
                throw e
            }
        }
        if (intent != null) intents.clear(intent)
        // Staff read the books every 25 seconds: fetch them now, so the balance just paid is never
        // left on screen to be paid again.
        ServerShelf.wake()
        for ((path, followBody) in followUps(out)) {
            ErpApp.scope.launch { runCatching { send(path, body = followBody) } }
        }
        return out
    }

    /**
     * A change that does not move money, queued and returned at once; the Outbox sends it in the background with the
     * same name for every try, and says "Not saved: <label>" app-wide if it cannot (Outbox.kt). Money ops are refused
     * here: they stay awaited through `write`.
     */
    fun enqueue(op: String, fields: Map<String, Any?>, label: String) = Outbox.of(biz).enqueue(op, fields, label)

    suspend fun send(path: String, method: String = "POST", body: Map<String, Any?> = emptyMap(), timeoutMs: Long? = null): Map<String, Any?> {
        val text = data(path, method, body, timeoutMs)
        @Suppress("UNCHECKED_CAST")
        return (Json.parse(text) as? Map<String, Any?>) ?: emptyMap()
    }

    private suspend fun token(): String? = try {
        Businesses.auth(biz)?.currentUser?.getIdToken(false)?.await()?.token
    } catch (e: Exception) {
        null
    }

    companion object {
        private val all = HashMap<String, ErpApi>()

        /** The business's own: its address and its sign-in, whichever business is open. */
        @Synchronized
        fun forBusiness(b: Business): ErpApi = all.getOrPut(b.id) { ErpApi(b) }

        /** The open business's. */
        val shared: ErpApi get() = forBusiness(Businesses.current)

        /** A business was removed from this phone. */
        @Synchronized
        fun drop(id: String) { all.remove(id) }

        private val JSON = "application/json".toMediaType()

        const val GET_TIMEOUT_MS = 15_000L
        const val SEND_TIMEOUT_MS = 60_000L

        /** No cache and no cookie outlives the app's own call (staff's copy of the books comes this way). */
        private val client: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .cache(null)
                .followRedirects(true)
                .followSslRedirects(false)
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

/** OkHttp's call as a suspension that cancels the call with its coroutine. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont: CancellableContinuation<Response> ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWith(Result.failure(e)) }
        override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resumeWith(Result.success(response)) else response.close() }
    })
}
