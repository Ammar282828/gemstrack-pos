package erp.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Android's regex engine (ICU) refuses flags the JVM accepts — (?U), UNICODE_CHARACTER_CLASS, \p{java…} — and a
 * refused pattern in a top-level val fails its whole class on a phone while every JVM test passes (the order page,
 * 2026-10-15). No source of ours may use them.
 */
class AndroidRegexTests {
    @Test
    fun noPatternUsesAFlagAndroidRefuses() {
        val roots = listOf(File("src/main/kotlin"), File("../app/src/main/kotlin")).filter { it.isDirectory }
        val banned = listOf(Regex("""\(\?[a-zA-Z]*U"""), Regex("UNICODE_CHARACTER_CLASS"), Regex("""\\p\{java"""))
        val hits = roots.flatMap { root ->
            root.walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
                f.readLines().withIndex().filter { (_, line) -> banned.any { it.containsMatchIn(line) } }.map { "${f.path}:${it.index + 1}" }
            }
        }
        assertTrue(hits.isEmpty(), "Patterns Android refuses: $hits")
    }
}
