package erp.app.screens.marketing

import java.io.File
import java.time.Instant

/**
 * The last website-pieces list each business read, kept on the phone (PostsStore.swift's `kept`/`keep`): From the website
 * paints at once from it and is refreshed behind it, and it stays on screen when the site blips
 * (docs/features/from-the-website.md "When the catalogue blips"). The cache folder, so the system may clear it: then the
 * next read is simply the first.
 */
object SitePiecesKeep {
    /** What the iPhone asks: the lean list (`own`, `words` and an empty `change` left out), and 45 s on a shop's mobile line. */
    const val PATH = "/api/website/site-pieces?lean=1"
    const val TIMEOUT_MS = 45_000L

    private fun file(dir: File, business: String) = File(dir, "erp.sitePieces.$business.json")

    fun keep(dir: File, business: String, text: String) {
        runCatching { dir.mkdirs(); file(dir, business).writeText(text) }
    }

    /** The kept answer and when it was read (the file's own time, as the iPhone takes it), or null. */
    fun kept(dir: File, business: String): Pair<String, Instant>? = runCatching {
        val f = file(dir, business)
        if (!f.isFile) null else f.readText() to Instant.ofEpochMilli(f.lastModified())
    }.getOrNull()
}
