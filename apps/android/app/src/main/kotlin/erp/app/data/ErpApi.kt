package erp.app.data

import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.UpdateGate
import erp.core.Json
import erp.core.logic.MoveRefusal
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
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
import kotlinx.coroutines.flow.mapNotNull
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
    /**
     * `offline`: the ERP could not be reached at all (no line): not a refusal, and not an answer. A write waits for it in the
     * Outbox; a read is answered from [ReadCache] where there is a last answer. `neverLeft`: the request certainly never left
     * the phone (no line at all), so even a send that must never go twice may wait for it.
     */
    class Failure(
        val status: Int, override val message: String, val offline: Boolean = false, val neverLeft: Boolean = false,
        /**
         * A move the state machines refuse (409 `{ error, machine, from, to, allowed }`, lib/machines/http.ts): [message] is already its
         * reason, in the shop's words, for the person to read. Null for any other failure, a duplicate request's 409 included.
         */
        val refusal: MoveRefusal? = null,
    ) : Exception(message) {
        companion object {
            /** What an action that needs the ERP says with no line. Plain, and the same everywhere. */
            fun needsConnection(what: String = "This"): Failure =
                Failure(0, "Needs a connection. $what will work when you're back online.", offline = true, neverLeft = true)
        }
    }

    private val id = initial.id

    /** The business as the phone has it now (a refresh may have given it its Android sign-in); the address never moves. */
    private val biz: Business get() = Businesses.business(id) ?: initial

    /**
     * The sign-in token goes to the house's own ERP and nowhere else, whatever path is passed in. `timeoutMs` is how
     * long the ERP may take to answer: a page load that has not answered in 15 s is a dead line, not a slow server, so
     * it says so and lets the screen retry; writes and sends keep a minute.
     */
    suspend fun data(path: String, method: String = "GET", json: Map<String, Any?>? = null, timeoutMs: Long? = null): String =
        dataSourced(path, method, json, timeoutMs).first

    /** What [data] answers, and whether it is the kept last answer (no line) rather than the ERP's own. */
    private suspend fun dataSourced(path: String, method: String, json: Map<String, Any?>?, timeoutMs: Long?): Pair<String, Boolean> = withContext(Dispatchers.IO) {
        val readsFromCache = method == "GET" && !House.isDemo
        try {
            val text = open(path, method, json, timeoutMs ?: if (method == "GET") GET_TIMEOUT_MS else SEND_TIMEOUT_MS, "application/json").use { r ->
                // An answer cut off half way is a lost line too: the change may or may not have been recorded.
                val text = try {
                    r.body.string()
                } catch (e: IOException) {
                    throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.", offline = true)
                }
                if (r.code !in 200..299) throw Failure(r.code, said(text) ?: "The ERP answered ${r.code}.", refusal = if (r.code == 409) MoveRefusal.parse(text) else null)
                text
            }
            if (readsFromCache) ReadCache.store(text, path, id)
            text to false
        } catch (e: Failure) {
            if (!Connection.lost(e)) throw e
            // No line: a read paints the last answer it had (nothing blocks on the network), anything else says so plainly.
            val cached = if (readsFromCache) ReadCache.load(path, id) else null
            if (cached != null) cached to true
            else if (Connection.neverLeft(e)) throw Failure.needsConnection()
            else throw e
        }
    }

    /** One answer of [cachedThenFresh]: [fresh] is false for the last answer kept on the phone, true for the ERP's own. */
    class Read(val text: String, val fresh: Boolean)

    /**
     * Stale-while-revalidate for a read route: the last kept answer at once (if there is one), then the ERP's. The network answer is
     * the authority: a screen that adopts the first must replace it with the second, and anything that decides money waits for
     * `fresh`. The ERP failing after a kept answer was shown is thrown to the collector (it keeps what it has). A GET only; in
     * the demo and for routes [ReadCache] never keeps there is no first answer, only the network's.
     */
    fun cachedThenFresh(path: String, timeoutMs: Long? = null): kotlinx.coroutines.flow.Flow<Read> = kotlinx.coroutines.flow.flow {
        val kept = if (House.isDemo) null else withContext(Dispatchers.IO) { ReadCache.load(path, id) }
        if (kept != null) emit(Read(kept, fresh = false))
        val (text, fromCache) = dataSourced(path, "GET", null, timeoutMs)
        // No line: the kept answer is all there is, and it was already shown.
        if (!(fromCache && kept == text)) emit(Read(text, fresh = !fromCache))
    }

    /** [cachedThenFresh], decoded as a model (an answer that is not an object is skipped). */
    inline fun <reified T : Any> modelCachedThenFresh(path: String): kotlinx.coroutines.flow.Flow<Pair<T, Boolean>> =
        cachedThenFresh(path).mapNotNull { r ->
            withContext(Dispatchers.Default) { Json.decode<T>(r.text) }?.let { it to r.fresh }
        }

    /**
     * A file from the ERP whole (a PDF, a slip's picture): `data` answers text, which would damage the bytes. The same
     * sign-in, host pinning, demo refusal and failure words as `data`. A long default timeout: a bill of many pieces
     * takes a second or two to draw.
     */
    suspend fun bytes(path: String, method: String = "GET", timeoutMs: Long = 90_000): ByteArray = withContext(Dispatchers.IO) {
        open(path, method, null, timeoutMs, "*/*").use { r ->
            val body = try {
                r.body.bytes()
            } catch (e: IOException) {
                throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
            }
            if (r.code !in 200..299) throw Failure(r.code, said(String(body, Charsets.UTF_8)) ?: "The ERP answered ${r.code}.")
            body
        }
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
            // Our own refusal of a redirect off the ERP's host is not a lost line.
            val ours = e.message?.startsWith("Redirected away") == true
            throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.", offline = !ours, neverLeft = !ours && (Connection.neverLeftIo(e) || Connection.isOffline.value))
        }
    }

    /** One part of a multipart form: a file under its field ("file", "image", "square"). The name is plain ASCII. */
    class FormFile(val field: String, val name: String, val type: String, val bytes: ByteArray)

    /**
     * A multipart form to the ERP, as the web pages send theirs with FormData (Post a piece's photos and AI, Add photos,
     * Edit a piece): the same sign-in, host pinning, demo refusal and failure words as `data`. Answers the route's text.
     */
    suspend fun upload(path: String, fields: List<Pair<String, String>>, files: List<FormFile> = emptyList(), method: String = "POST", timeoutMs: Long = 120_000): String = withContext(Dispatchers.IO) {
        val form = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM).apply {
            for ((name, value) in fields) addFormDataPart(name, value)
            for (f in files) addFormDataPart(f.field, f.name, f.bytes.toRequestBody(f.type.toMediaType()))
        }.build()
        open(path, method, null, timeoutMs, "application/json", form).use { r ->
            val text = r.body.string()
            if (r.code !in 200..299) throw Failure(r.code, said(text) ?: "The ERP answered ${r.code}.")
            text
        }
    }

    /** [upload] for a route that answers a file (Design's remove-background answers a PNG): the bytes whole, not text. */
    suspend fun uploadBytes(path: String, fields: List<Pair<String, String>>, files: List<FormFile> = emptyList(), timeoutMs: Long = 120_000): ByteArray = withContext(Dispatchers.IO) {
        val form = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM).apply {
            for ((name, value) in fields) addFormDataPart(name, value)
            for (f in files) addFormDataPart(f.field, f.name, f.bytes.toRequestBody(f.type.toMediaType()))
        }.build()
        open(path, "POST", null, timeoutMs, "*/*", form).use { r ->
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
    suspend fun get(path: String): Any? = data(path).let { t -> withContext(Dispatchers.Default) { Json.parse(t) } }

    suspend fun post(path: String, json: Map<String, Any?>): Any? = data(path, "POST", json).let { t -> withContext(Dispatchers.Default) { Json.parse(t) } }

    /** A model from the ERP's answer: null if it is not an object. */
    suspend inline fun <reified T : Any> getModel(path: String): T? = data(path).let { t -> withContext(Dispatchers.Default) { Json.decode<T>(t) } }

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
     * Offline (owner, 2026-11-03): a creation or a payment (`OutboxEngine.queueableOps`: createOrder, createInvoice, recordPayment,
     * recordOrderAdvance…) that cannot reach the ERP is kept on this phone with its name and sent by the Outbox when the line is
     * back; the answer is then `{queued: true, requestId}`, with no record in it. A screen that needs the new record's number
     * checks [wasQueued] first. `pending` says what the waiting row in the list reads. The Outbox's own sends pass
     * `queueOffline = false`: they are the queue. Deletes, refunds and settlements are never queued: they fail at once with
     * "Needs a connection".
     *
     * The request is not cut off when the screen that asked goes away (the iPhone lends a few seconds in the
     * background): the person may have left the sheet, and the write is already on its way.
     */
    suspend fun write(
        op: String, fields: Map<String, Any?>, requestId: String? = null,
        queueOffline: Boolean = true, pending: PendingSummary? = null,
    ): Map<String, Any?> {
        // A build older than this ERP's minimum writes nothing (its rules for money may be out of date).
        if (UpdateGate.blocked(biz)) throw Failure(426, UpdateGate.words)
        val body = LinkedHashMap(fields)
        body["op"] = op
        val intents = WriteIntents.forBusiness(id)
        val intent = if (requestId == null) intents.key(body) else null
        val name = requestId ?: intents.id(intent!!)
        body["requestId"] = name
        val mayQueue = queueOffline && op in OutboxEngine.queueableOps && !House.isDemo
        // No line at all: no need to wait for a request to fail.
        if (mayQueue && Connection.isOffline.value) return Outbox.of(biz).queueForLater(op, fields, name, intent, pending)
        val out = try {
            withContext(NonCancellable) {
                try {
                    send("/api/app/write", body = body)
                } catch (e: Failure) {
                    // "Already sent and recorded": the earlier try went through. The intent is done.
                    if (e.status == 409 && intent != null) intents.clear(intent)
                    throw e
                } catch (e: IOException) {
                    throw Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.", offline = true)
                }
            }
        } catch (e: Failure) {
            // The line dropped, or no answer came: the change may or may not have been recorded. It is kept with its name, so
            // sending it again is never a second one.
            if (mayQueue && Connection.lost(e)) return Outbox.of(biz).queueForLater(op, fields, name, intent, pending)
            throw e
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
        return withContext(Dispatchers.Default) { (Json.parse(text) as? Map<String, Any?>) ?: emptyMap() }
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

        /** The write was kept to be sent later (see `write`): there is no record in the answer yet. */
        fun wasQueued(answer: Map<String, Any?>): Boolean = answer["queued"] == true

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
                .connectTimeout(10, TimeUnit.SECONDS)
                // One more try for a read that hit a dead or slow line; a write is never sent twice.
                .addInterceptor { chain ->
                    val request = chain.request()
                    if (request.method != "GET") return@addInterceptor chain.proceed(request)
                    try {
                        chain.proceed(request)
                    } catch (e: IOException) {
                        // Our own refusal of a redirect off the ERP's host is not a flaky line; a cancelled call is not either.
                        if (chain.call().isCanceled() || e.message?.startsWith("Redirected away") == true) throw e
                        chain.proceed(request)
                    }
                }
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
