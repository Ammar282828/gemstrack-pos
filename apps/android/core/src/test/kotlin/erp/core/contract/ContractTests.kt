package erp.core.contract

import erp.core.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The phone's money against the iPhone's and the ERP's. The Kotlin New order / New sale code builds the contract's
 * orders and sales; they must equal, value for value, what the Swift code wrote to apps/iphone/contract/cases.json
 * (numbers compared as doubles, exactly: a difference that is only how a number is printed vanishes in parsing, and
 * any other difference is a bug in the port). apps/android/contract/cases.json, which src/app/api/app/write/contract.test.ts
 * runs the ERP's own money over, must be what the generator writes today, so a change to the entry code that forgets
 * `./gradlew :core:contractCases` fails here (and in CI).
 */
class ContractTests {
    /** The core module's directory: Gradle sets it for the test JVM; run from elsewhere it is the working directory. */
    private val coreDir: File = File(System.getProperty("erp.coreDir") ?: System.getProperty("user.dir")).absoluteFile
    private val iphoneFile = File(coreDir, "../../iphone/contract/cases.json").canonicalFile
    private val androidFile = File(coreDir, "../contract/cases.json").canonicalFile

    private val generated: Map<String, Any?> by lazy { generateCases() }

    @Suppress("UNCHECKED_CAST")
    private fun cases(root: Any?, key: String): List<Map<String, Any?>> = (root as Map<String, Any?>)[key] as List<Map<String, Any?>>

    private fun parsed(file: File): Any? {
        assertTrue(file.isFile, "missing ${file.path}")
        return Json.parse(file.readText(Charsets.UTF_8))
    }

    @Test
    fun hasOrdersAndSalesFromBothHouses() {
        for (key in listOf("orders", "sales")) {
            val houses = cases(generated, key).map { it["house"] }.toSet()
            assertEquals(setOf<Any?>("taheri", "mina"), houses, "$key: both houses")
        }
    }

    @Test
    fun caseCountsAreTheIPhones() {
        val iphone = parsed(iphoneFile)
        for (key in listOf("orders", "sales")) {
            for (house in listOf("taheri", "mina")) {
                val mine = cases(generated, key).count { it["house"] == house }
                val theirs = cases(iphone, key).count { it["house"] == house }
                assertEquals(theirs, mine, "$key for $house")
            }
        }
    }

    @Test
    fun equalsTheIPhonesCasesValueForValue() {
        val problems = ArrayList<String>()
        compare("$", generated, parsed(iphoneFile), problems)
        if (problems.isNotEmpty()) {
            fail("${problems.size} differences from ${iphoneFile.path}; the first:\n" + problems.take(25).joinToString("\n"))
        }
    }

    @Test
    fun androidCasesFileIsWhatTheGeneratorWritesToday() {
        assertTrue(androidFile.isFile, "missing ${androidFile.path}: run ./gradlew :core:contractCases")
        val kept = androidFile.readText(Charsets.UTF_8)
        if (kept != casesText()) {
            fail("${androidFile.path} is out of date: run ./gradlew :core:contractCases from apps/android and commit it")
        }
    }

    // Both sides came through the same parser, so a number is a Long or a Double either way; it is the double that counts.
    private fun compare(path: String, mine: Any?, theirs: Any?, out: MutableList<String>) {
        when {
            mine is Map<*, *> && theirs is Map<*, *> -> {
                for (k in (mine.keys + theirs.keys).map { it.toString() }.toSortedSet()) {
                    if (!mine.containsKey(k)) {
                        out.add("$path.$k: missing here, the iPhone has ${describe(theirs[k])}")
                    } else if (!theirs.containsKey(k)) {
                        out.add("$path.$k: here ${describe(mine[k])}, the iPhone has no such key")
                    } else {
                        compare("$path.$k", mine[k], theirs[k], out)
                    }
                }
            }
            mine is List<*> && theirs is List<*> -> {
                if (mine.size != theirs.size) out.add("$path: ${mine.size} items here, ${theirs.size} on the iPhone")
                for (i in 0 until minOf(mine.size, theirs.size)) compare("$path[$i]", mine[i], theirs[i], out)
            }
            mine is Number && theirs is Number -> {
                val a = mine.toDouble()
                val b = theirs.toDouble()
                if (a != b) out.add("$path: ${describe(mine)} here, ${describe(theirs)} on the iPhone")
            }
            mine == null && theirs == null -> Unit
            mine is String && theirs is String -> if (mine != theirs) out.add("$path: ${describe(mine)} here, ${describe(theirs)} on the iPhone")
            mine is Boolean && theirs is Boolean -> if (mine != theirs) out.add("$path: $mine here, $theirs on the iPhone")
            else -> out.add("$path: ${describe(mine)} here, ${describe(theirs)} on the iPhone")
        }
    }

    private fun describe(v: Any?): String = when (v) {
        null -> "null"
        is String -> "\"" + (if (v.length > 80) v.take(80) + "…" else v) + "\""
        is Map<*, *> -> "an object"
        is List<*> -> "a list of ${v.size}"
        else -> v.toString()
    }
}
