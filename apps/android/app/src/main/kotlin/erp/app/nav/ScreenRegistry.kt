package erp.app.nav

import androidx.compose.runtime.Composable
import erp.app.screens.NativeScreens
import erp.app.web.WebScreen
import java.io.ByteArrayOutputStream

/** A native screen for some ERP paths. */
class ScreenRoute(
    val matches: (String) -> Boolean,
    val make: @Composable (String) -> Unit,
) {
    companion object {
        /** Exactly this path (a query is ignored). */
        fun exact(path: String, make: @Composable () -> Unit) = ScreenRoute({ bare(it) == path }, { make() })

        /** "<prefix><id>": the rest of the path, decoded ("/orders/" → "ORD-000123"). */
        fun item(prefix: String, make: @Composable (String) -> Unit) = ScreenRoute(
            matches = { p ->
                val b = bare(p)
                b.startsWith(prefix) && !b.drop(prefix.length).contains('/') && b.length > prefix.length
            },
            make = { p -> make(percentDecode(bare(p).drop(prefix.length))) },
        )

        fun bare(p: String): String = p.substringBefore('?')

        /** `removingPercentEncoding`: %XX bytes read as UTF-8 (a plus stays a plus); unchanged where it is not valid. */
        fun percentDecode(s: String): String {
            if (!s.contains('%')) return s
            val out = ByteArrayOutputStream()
            var i = 0
            while (i < s.length) {
                val c = s[i]
                if (c == '%') {
                    val hex = s.substring(i + 1, minOf(i + 3, s.length))
                    val v = if (hex.length == 2) hex.toIntOrNull(16) else null
                    if (v == null || hex.any { !it.isLetterOrDigit() }) return s
                    out.write(v)
                    i += 3
                } else {
                    out.write(c.toString().toByteArray(Charsets.UTF_8))
                    i += 1
                }
            }
            return String(out.toByteArray(), Charsets.UTF_8)
        }
    }
}

/**
 * Which ERP paths have a native screen. Every other path opens WebScreen: the ERP page itself, inside the app
 * and signed in, so no place the ERP has is ever missing (CONVENTIONS.md rule 5). Each group of screens lists
 * its own routes in its folder (screens/<group>/<Group>Routes.kt) and adds one term to NativeScreens.all.
 */
object ScreenRegistry {
    val routes: List<ScreenRoute> get() = NativeScreens.all

    fun hasNative(path: String): Boolean = hasNative(path, routes)

    fun hasNative(path: String, routes: List<ScreenRoute>): Boolean = !wantsWeb(path) && routes.any { it.matches(path) }

    /**
     * `?web=1` asks for the ERP's own page even where a native screen exists: a native screen's "Open in the ERP"
     * (edit, refund, delete, print: what is not native yet).
     */
    fun wantsWeb(path: String): Boolean = query(path).any { (k, v) -> k == "web" && v == "1" }

    /** The path without `web=1`, for the page itself. */
    fun withoutWebFlag(path: String): String {
        val hash = path.indexOf('#').let { if (it >= 0) path.substring(it) else "" }
        val noHash = if (hash.isEmpty()) path else path.substring(0, path.length - hash.length)
        if (!noHash.contains('?')) return path
        val head = noHash.substringBefore('?')
        val kept = noHash.substringAfter('?').split('&').filter { it.isNotEmpty() && it.substringBefore('=') != "web" }
        return head + (if (kept.isEmpty()) "" else "?" + kept.joinToString("&")) + hash
    }

    private fun query(path: String): List<Pair<String, String>> {
        val noHash = path.substringBefore('#')
        if (!noHash.contains('?')) return emptyList()
        return noHash.substringAfter('?').split('&').filter { it.isNotEmpty() }
            .map { it.substringBefore('=') to (if (it.contains('=')) it.substringAfter('=') else "") }
    }

    /** The screen for a path: the ERP's page where `?web=1` asks for it or nothing native matches. */
    @Composable
    fun Screen(path: String) {
        if (wantsWeb(path)) return WebScreen(withoutWebFlag(path))
        val r = routes.firstOrNull { it.matches(path) }
        if (r != null) r.make(path) else WebScreen(path)
    }
}
