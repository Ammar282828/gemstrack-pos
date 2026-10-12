package erp.app.data

import erp.app.ErpApp
import erp.core.ERPDate
import erp.core.Json
import java.time.Instant

/**
 * The demo build's documents (intent extra `erp.demo`, the emulator check): assets/demo.json, all of it made
 * up (CONVENTIONS.md rule 3), read through the same decoding as the real books.
 *
 * Dates in the file are relative, so "today" always has something in it:
 * "@d-2 14:30" is two days ago at 14:30 in Karachi; "@day+5" is the Karachi day five days on.
 */
object Demo {
    private val collections: Map<String, List<Map<String, Any?>>> by lazy {
        val text = runCatching { ErpApp.instance.assets.open("demo.json").bufferedReader().use { it.readText() } }.getOrNull()
        if (text == null) emptyMap() else parse(text, Instant.now())
    }

    @Suppress("UNCHECKED_CAST")
    fun docs(collection: String): List<Map<String, Any?>> = collections[collection] ?: emptyList()

    /** The file as collections of documents, its relative dates made real as of `now`. */
    @Suppress("UNCHECKED_CAST")
    fun parse(text: String, now: Instant): Map<String, List<Map<String, Any?>>> {
        val json = Json.parse(text) as? Map<String, Any?> ?: return emptyMap()
        val out = LinkedHashMap<String, List<Map<String, Any?>>>()
        for ((name, v) in json) {
            val list = v as? List<*> ?: continue
            out[name] = list.mapNotNull { resolve(it, now) as? Map<String, Any?> }
        }
        return out
    }

    private fun resolve(v: Any?, now: Instant): Any? = when (v) {
        is String -> when_(v, now) ?: v
        is List<*> -> v.map { resolve(it, now) }
        is Map<*, *> -> v.entries.associateTo(LinkedHashMap<String, Any?>()) { it.key.toString() to resolve(it.value, now) }
        else -> v
    }

    /** "@d-2 14:30" or "@day+5"; null for any other text. */
    fun when_(s: String, now: Instant): String? {
        if (!s.startsWith("@")) return null
        val today = ERPDate.karachiDay(now).let { ERPDate.parse(it)!!.minusSeconds(5L * 3600) } // Karachi midnight, as an instant
        fun day(n: Int) = today.plusSeconds(n * 86_400L)
        if (s.startsWith("@day")) {
            s.drop(4).toIntOrNull()?.let { return ERPDate.karachiDay(day(it)) }
        }
        val parts = s.drop(2).split(' ').filter { it.isNotEmpty() }
        if (!s.startsWith("@d") || parts.isEmpty()) return null
        val n = parts.first().toIntOrNull() ?: return null
        val clock = parts.last().split(':')
        if (clock.size != 2) return null
        val h = clock[0].toIntOrNull() ?: return null
        val m = clock[1].toIntOrNull() ?: return null
        return ERPDate.iso(day(n).plusSeconds(h * 3600L + m * 60L))
    }
}
