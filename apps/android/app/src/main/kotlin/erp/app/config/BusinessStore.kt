package erp.app.config

import erp.app.data.JsonText
import erp.core.Json
import java.io.File

/** A reason in the shop's words, shown as it is (Businesses.Failure). */
class BusinessFailure(message: String) : Exception(message)

/** What asking an ERP for its descriptor came to: the status, the host the answer finally came from, and its text. */
class DescriptorAnswer(val status: Int, val finalHost: String, val body: String)

/**
 * The rules of adding a business (Businesses.swift `describe`, `origin`, `slug`, `keepingIdentity`, `merged`): plain Kotlin,
 * so each runs on the JVM. A descriptor speaks for the host it came from and no other, or it could point the sign-in token
 * at a stranger's server.
 */
object BusinessRules {
    /** `https://host` from what a person types; nothing else survives (path, query, port, scheme). */
    fun origin(address: String): String {
        var text = address.trim()
        if (text.isEmpty()) throw BusinessFailure("Type the ERP's address.")
        if (!text.contains("://")) text = "https://$text"
        val bad = BusinessFailure("That doesn't look like an ERP address.")
        val uri = try { java.net.URI(text) } catch (e: Exception) { throw bad }
        val host = uri.host?.lowercase() ?: throw bad
        if (!host.contains('.') || !Regex("^[a-z0-9.-]+$").matches(host)) throw bad
        if (uri.userInfo != null || (uri.port != -1 && uri.port != 443)) throw bad
        return "https://$host"
    }

    fun slug(text: String): String {
        val s = text.lowercase().map { if (it.isLetterOrDigit()) it else '-' }.joinToString("")
        return s.replace(Regex("-+"), "-").trim('-').take(40)
    }

    /** The other of an ERP's two addresses: each house is reached at erp.* and pos.*. */
    fun twin(host: String): String = host.replace(Regex("^(erp|pos)\\.")) { if (it.groupValues[1] == "erp") "pos." else "erp." }

    /**
     * Judges an ERP's answer to `GET /api/app/business` asked of `origin`: it must be a success from that host, read as a
     * business, name that host (or its erp./pos. twin) as its own address, and be usable. The returned business has the typed
     * address as its own, so the sign-in token goes where the person pointed it and nowhere else.
     */
    fun judge(origin: String, answer: DescriptorAnswer, known: List<Business>): Business {
        val host = Business.hostOf(origin)
        if (answer.status !in 200..299 || answer.finalHost.lowercase() != host) throw BusinessFailure("That address isn't an ERP this app can open.")
        val found = Business.decode(answer.body) ?: throw BusinessFailure("That address isn't an ERP this app can open.")
        val named = Business.hostOf(found.serverURL)
        if (named != host && named != twin(host)) throw BusinessFailure("That ERP names a different address for itself.")
        var b = found.copy(serverURL = origin)
        if (b.id == Business.DEMO_ID) b = b.copy(id = "demo-" + host.replace('.', '-'))
        val existing = known.firstOrNull { it.id == b.id }
        // The same brand id on another address (a second Taheri-like ERP) is a business of its own.
        if (existing != null && existing.host != b.host) b = b.copy(id = slug(b.id + "-" + host))
        b.problem?.let { throw BusinessFailure(it) }
        return b
    }

    /** A refresh never moves what a Firebase app is already configured with, nor the address the sign-in token goes to. */
    fun keepingIdentity(old: Business, new: Business): Business =
        new.copy(id = old.id, serverURL = old.serverURL, android = old.android ?: new.android, storeName = if (old.art != null) old.storeName else new.storeName)

    /**
     * The persisted list with the bundled built-ins that are not in it (and not removed) added. An update of the app that
     * brings a built-in's Android sign-in, when the saved copy has none, gives it to the saved copy (a built-in has no other
     * way to learn it; an added business's refresh does that).
     */
    fun merged(bundled: List<Business>, saved: List<Business>?, removed: List<String>): List<Business> {
        val list = saved.orEmpty().map { s ->
            val fresh = bundled.firstOrNull { it.id == s.id }
            if (fresh != null && s.android == null && fresh.android != null) s.copy(android = fresh.android) else s
        }.toMutableList()
        for (b in bundled) if (list.none { it.id == b.id } && b.id !in removed) list.add(b)
        return if (list.isEmpty()) bundled else list
    }
}

/**
 * The businesses on this phone and the built-ins the person removed, kept in one small file in the app's own folder
 * (BusinessStorage.File). Written whole through a temp file and renamed.
 */
class BusinessStore(private val file: File?, private val bundled: List<Business>) {
    var list: List<Business> = emptyList()
        private set
    var removed: List<String> = emptyList()
        private set

    init {
        val text = runCatching { file?.takeIf { it.exists() }?.readText() }.getOrNull()
        val m = text?.let { runCatching { Json.parse(it) }.getOrNull() } as? Map<*, *>
        val saved = (m?.get("businesses") as? List<*>)?.mapNotNull { Business.from(it) }
        removed = (m?.get("removed") as? List<*>)?.mapNotNull { it as? String }.orEmpty()
        list = BusinessRules.merged(bundled, saved, removed)
    }

    /** Adds the business, or refreshes the one it is (its place in the list and its identity kept). */
    fun put(b: Business): Business {
        val i = list.indexOfFirst { it.id == b.id }
        val kept = if (i >= 0) BusinessRules.keepingIdentity(list[i], b) else b
        list = if (i >= 0) list.toMutableList().also { it[i] = kept } else list + kept
        removed = removed - b.id
        save()
        return kept
    }

    /** Replaces a business's descriptor in place without touching the file's other entries (a quiet refresh). */
    fun replace(b: Business) {
        val i = list.indexOfFirst { it.id == b.id }
        if (i < 0) return
        list = list.toMutableList().also { it[i] = b }
        save()
    }

    /** The last one cannot go; a built-in is hidden, not deleted (it comes back by typing its address). */
    fun remove(id: String): Boolean {
        if (list.size <= 1 || list.none { it.id == id }) return false
        list = list.filter { it.id != id }
        if (id in Business.bundledIds) removed = removed + id
        save()
        return true
    }

    /** Moves the business at `from` to `to` (the sheet's reorder). */
    fun move(from: Int, to: Int) {
        if (from !in list.indices || to !in list.indices || from == to) return
        list = list.toMutableList().also { it.add(to, it.removeAt(from)) }
        save()
    }

    private fun save() {
        val f = file ?: return
        val text = JsonText.of(mapOf("businesses" to list.map { it.toMap() }, "removed" to removed)) ?: return
        runCatching {
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(f)) { f.writeText(text); tmp.delete() }
        }
    }

    companion object {
        /**
         * Where the cold start opens: the one open last if it is still here, else the build's own business (Taheri for the one app,
         * Mina for the deprecated Mina flavor), else the first.
         */
        fun start(list: List<Business>, savedId: String?, buildId: String): Business =
            list.firstOrNull { it.id == savedId } ?: list.firstOrNull { it.id == buildId } ?: list.first()
    }
}
