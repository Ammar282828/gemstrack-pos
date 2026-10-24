package erp.app.data

import erp.app.ErpApp
import erp.core.DocJSON
import erp.core.Decodable
import erp.core.Json
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Staff and marketing: the ERP's server, polled (store.ts attachStaffPoll, 25 s). */
object ServerShelf {
    const val EVERY_SECONDS = 25

    /** Bumped after every change the phone makes: each poller stops waiting and reads again. */
    private val nudges = AtomicInteger(0)

    fun wake() { nudges.incrementAndGet() }

    /** `api` is the business's own: the poll goes to its server whichever business is open. */
    fun <T : Any> poll(api: ErpApi, name: String, single: Boolean, model: Decodable<T>, deliver: (Delivery<T>) -> Unit): () -> Unit {
        val job = ErpApp.scope.launch {
            while (isActive) {
                try {
                    val text = api.data("/api/staff/collections?name=$name")
                    // Read and decoded off the main thread: staff's whole copy arrives every 25 seconds.
                    val items = withContext(Dispatchers.Default) { decode(model, text, single) }
                    deliver(Delivery.All(items, offline = false))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ErpApi.Failure) {
                    if (e.status == 403) {
                        // Not this person's to read (a marketing account and the books): an empty shelf, not an error.
                        deliver(Delivery.All(emptyList(), offline = false))
                        return@launch
                    }
                    deliver(Delivery.Failed(e.message))
                } catch (e: Exception) {
                    deliver(Delivery.Failed(e.message ?: "Couldn't read the books."))
                }
                // Wait out the interval, unless a change made on this phone asks for the books now.
                val seen = nudges.get()
                var waited = 0
                while (isActive && nudges.get() == seen && waited < EVERY_SECONDS) {
                    delay(1000)
                    waited++
                }
            }
        }
        return { job.cancel() }
    }

    /**
     * The server's answer as models: `{ docs: [...] }` for a collection (each carries its own id), `{ doc: {...} }`
     * for the one settings document.
     */
    fun <T : Any> decode(model: Decodable<T>, text: String, single: Boolean): List<T> {
        val json = Json.parse(text) as? Map<*, *> ?: emptyMap<Any?, Any?>()
        if (single) {
            val doc = json["doc"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
            val id = doc["id"] as? String ?: "global"
            @Suppress("UNCHECKED_CAST")
            return listOf(Book.decodeDoc(model, id, doc as Map<String, Any?>))
        }
        return DocJSON.decodeListWith(model, json["docs"] as? List<Any?> ?: emptyList())
    }
}
