package erp.app.data

import erp.core.Json
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/**
 * The names given to changes on their way, kept on disk per house: the same change asked for again (a double tap, a
 * retry after a timeout, after the app was killed) keeps its name until the ERP has answered, so it is recorded
 * once (/api/app/write claims each name: src/app/api/app/write/idempotency.ts). "When" is not part of what the change
 * is. A name is forgotten after a day, and on the answer (success, or "already recorded"); a second, separate
 * payment of the same amount is entered after that and gets its own. (WriteIntents in ERPAPI.swift.)
 */
class WriteIntents(
    private val load: () -> String?,
    private val save: (String?) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    /** What the change is, as a stable name: the body without its "when" and its own name, hashed. */
    fun key(body: Map<String, Any?>): String {
        val what = LinkedHashMap(body)
        for (k in WHEN) what.remove(k)
        val text = JsonText.of(what, sorted = true) ?: newId()
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    /** The id for this intent: the one it already has, or a new one, kept (and its day renewed). */
    @Synchronized
    fun id(key: String): String {
        val t = now() / 1000
        val map = read().filterValues { (it.substringAfterLast('|').toLongOrNull() ?: return@filterValues false).let { s -> t - s < KEEP_SECONDS } }.toMutableMap()
        val id = map[key]?.substringBefore('|') ?: newId()
        map[key] = "$id|$t"
        write(map)
        return id
    }

    @Synchronized
    fun clear(key: String) {
        val map = read().toMutableMap()
        if (map.remove(key) == null) return
        write(map)
    }

    /** How many names are held (the tests). */
    @Synchronized
    fun held(): Int = read().size

    private fun read(): Map<String, String> =
        ((load()?.let { Json.parse(it) }) as? Map<*, *>)?.mapNotNull { (k, v) -> (k as? String)?.let { key -> (v as? String)?.let { key to it } } }?.toMap().orEmpty()

    private fun write(map: Map<String, String>) = save(if (map.isEmpty()) null else JsonText.of(map))

    companion object {
        const val KEEP_SECONDS = 24 * 3600L
        private val WHEN = listOf("date", "createdAt", "at", "now", "requestId")

        private val all = HashMap<String, WriteIntents>()

        /** A business's own names, in its file: a change is never named by, nor sent under, another business's. */
        @Synchronized
        fun forBusiness(id: String): WriteIntents = all.getOrPut(id) {
            fun file(): File? = OutboxDisk.file("write-intents", id)
            WriteIntents({ OutboxDisk.read(file()) }, { OutboxDisk.write(file(), it) })
        }
    }
}
