package erp.app.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.Blob
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.GeoPoint
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.PersistentCacheSettings
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.QuerySnapshot
import erp.app.ErpApp
import erp.app.config.House
import erp.core.Decodable
import erp.core.ERPDate
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * An owner's shelves: Firestore's own listeners, as the web store keeps them (store.ts createDataLoader),
 * with the phone's copy on disk so the app opens with yesterday's books and no connection.
 */
object FirestoreSource {
    /** Listeners answer here, off the main thread: a first answer can be a few thousand documents, and decoding must not stall a scroll. */
    val queue: ScheduledExecutorService by lazy { Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "erp-firestore").apply { isDaemon = true } } }

    /** Once, after FirebaseApp is initialized and before anything reads. */
    fun configure() {
        val settings = FirebaseFirestoreSettings.Builder()
            .setLocalCacheSettings(PersistentCacheSettings.newBuilder().setSizeBytes(512L * 1024 * 1024).build())
            .build()
        FirebaseFirestore.getInstance().firestoreSettings = settings
    }

    /**
     * Signing out forgets the books on this phone: the client is shut, its copy on disk erased, and a fresh one
     * set up as at launch, so the next person to sign in starts from nothing.
     */
    suspend fun forget() {
        if (House.isDemo || !ErpApp.firebaseReady) return
        try {
            val db = FirebaseFirestore.getInstance()
            db.terminate().await()
            db.clearPersistence().await()
        } catch (e: Exception) {
            android.util.Log.w("firestore", "could not clear the phone's copy: ${e.message}")
        }
        configure()
    }

    /** SDK values JSON cannot hold, as text the models read (dates as ISO, as the ERP writes its own). */
    fun plainSDK(v: Any): Any? = when (v) {
        is Timestamp -> ERPDate.iso(Instant.ofEpochSecond(v.seconds, v.nanoseconds.toLong()))
        is DocumentReference -> v.path
        is GeoPoint -> mapOf("latitude" to v.latitude, "longitude" to v.longitude)
        is Blob -> v.toBytes()
        else -> null
    }

    /**
     * A collection unordered (sorted on the phone, so a document missing the sort field is still shown), or one
     * document. Every change after the first answer arrives as just that change. `deliver` runs on the main thread.
     */
    fun <T : Any> listen(name: String, model: Decodable<T>, docId: String?, deliver: (Delivery<T>) -> Unit): () -> Unit {
        val l = Listening(name, model, docId) { d -> ErpApp.scope.launch { deliver(d) } }
        queue.execute { l.start() }
        return { queue.execute { l.stop() } }
    }

    internal fun <T : Any> decode(model: Decodable<T>, id: String, data: Map<String, Any?>): T =
        Book.decodeDoc(model, id, data, ::plainSDK)
}

/** One listener and its retries. Everything in it runs on FirestoreSource.queue (Firestore answers there too), so its state needs no lock. */
private class Listening<T : Any>(
    val name: String,
    val model: Decodable<T>,
    val docId: String?,
    val send: (Delivery<T>) -> Unit,
) {
    private var registration: ListenerRegistration? = null
    private var stopped = false
    private var tries = 0
    private var first = true

    /** The cache flag last handed on, so a metadata-only snapshot is sent only when it flips. */
    private var lastOffline = false

    fun stop() {
        stopped = true
        registration?.remove()
        registration = null
    }

    fun start() {
        if (stopped) return
        registration?.remove()
        first = true
        lastOffline = false
        val db = FirebaseFirestore.getInstance()
        val executor = FirestoreSource.queue
        registration = if (docId != null) {
            db.collection(name).document(docId).addSnapshotListener(executor, MetadataChanges.INCLUDE) { snap, error ->
                if (error != null) return@addSnapshotListener failed(error)
                if (snap == null) return@addSnapshotListener
                val m = snap.data?.let { FirestoreSource.decode(model, snap.id, it) }
                send(Delivery.All(listOfNotNull(m), offline = snap.metadata.isFromCache))
            }
        } else {
            db.collection(name).addSnapshotListener(executor, MetadataChanges.INCLUDE) { snap, error ->
                if (error != null) return@addSnapshotListener failed(error)
                if (snap == null) return@addSnapshotListener
                take(snap)
            }
        }
    }

    private fun decode(d: DocumentSnapshot): T? = d.data?.let { FirestoreSource.decode(model, d.id, it) }

    private fun take(snap: QuerySnapshot) {
        val off = snap.metadata.isFromCache
        if (first) {
            // Even an empty collection is an answer: "loaded, nothing in it".
            first = false
            lastOffline = off
            send(Delivery.All(snap.documents.mapNotNull { decode(it) }, offline = off))
            return
        }
        // Metadata alone (pending write acknowledged, cache -> server) has no changes: it matters only when
        // the cache flag flips, which the shelf takes without counting a change of the books.
        val changes = snap.documentChanges
        if (changes.isEmpty() && off == lastOffline) return
        lastOffline = off
        val upserts = ArrayList<T>()
        val removed = ArrayList<String>()
        for (c in changes) {
            if (c.type == DocumentChange.Type.REMOVED) {
                removed.add(c.document.id)
            } else {
                val m = decode(c.document)
                if (m != null) upserts.add(m) else removed.add(c.document.id) // no longer reads as the model: leaves the shelf
            }
        }
        send(Delivery.Changes(upserts, removed, offline = off))
    }

    private fun failed(error: Exception) {
        val denied = (error as? FirebaseFirestoreException)?.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
        // Just after sign-in a listener can start before Firestore has the person's token: the web retries the
        // same way (store.ts, permission-denied).
        if (denied && tries < 4) {
            val wait = 500L * (1L shl tries)
            tries += 1
            FirestoreSource.queue.schedule({ start() }, wait, TimeUnit.MILLISECONDS)
            return
        }
        send(Delivery.Failed(if (denied) "This account can't read the shop's books." else (error.message ?: "Couldn't read the books.")))
    }
}
