package erp.app.data

import erp.app.ErpApp
import java.io.File
import java.security.MessageDigest

/**
 * The last answer of the ERP's read routes, on disk (owner, 2026-11-03: "every screen handles offline"). The books
 * themselves are Firestore's cache and the shelves' snapshots; this is for the screens that ask a route for their data
 * (Overheads, the gold rate, a hisaab reminder, the website pages, the catalogue…): with no line, `ErpApi.data` hands such a
 * screen the last answer instead of an error, so it paints what it showed last time.
 *
 * `cacheDir/erp-reads/<business>/<sha256 of the path>.json`, per business, erased when the business goes. Only JSON
 * answers, and never a route that carries a key, a token or a person's portal: a cache of those is a copy of a secret on
 * disk. (ReadCache.swift.)
 */
object ReadCache {
    /** Larger answers (a backup, a photo list) are not worth a copy. */
    private const val MAX_BYTES = 3 * 1024 * 1024

    /** Routes whose answers are never kept: keys and tokens, the karigar's own portal, binary and one-shot answers. */
    private val never = listOf(
        "/api/agent/", "/api/push/", "/api/widget/", "/api/voice/", "/api/karigar", "/api/staff/collections",
        "/api/app/backup", "/api/app/pdf", "/api/app/labels", "/api/app/diagnostics", "/api/app/launch",
    )

    private fun root(): File? = runCatching { File(ErpApp.instance.cacheDir, "erp-reads") }.getOrNull()

    private fun safe(s: String): String = s.map { if (it.isLetterOrDigit() || it == '-' || it == '_' || it == '.') it else '_' }.joinToString("")

    private fun folder(business: String): File? = root()?.let { File(it, safe(business)) }

    private fun file(path: String, business: String): File? {
        val name = MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return folder(business)?.let { File(it, "$name.json") }
    }

    /** Whether a path's answer may be kept. */
    fun keeps(path: String): Boolean = path.startsWith("/api/") && never.none { path.startsWith(it) }

    /** Kept only when it is a JSON object or array of a sensible size. */
    fun store(data: String, path: String, business: String) {
        if (!keeps(path) || data.length > MAX_BYTES) return
        val first = data.firstOrNull { it != ' ' && it != '\n' && it != '\r' && it != '\t' } ?: return
        if (first != '{' && first != '[') return
        val f = file(path, business) ?: return
        runCatching {
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(data)
            if (!tmp.renameTo(f)) { f.writeText(data); tmp.delete() }
        }
    }

    /** The last answer for this path, if there is one. */
    fun load(path: String, business: String): String? {
        if (!keeps(path)) return null
        val f = file(path, business) ?: return null
        return runCatching { f.takeIf { it.exists() }?.readText() }.getOrNull()
    }

    /** Every kept answer of a business (removing it). */
    fun erase(business: String) { runCatching { folder(business)?.deleteRecursively() } }
}
