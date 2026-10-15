package erp.app.shots

import erp.app.ErpApp
import erp.app.data.Book
import erp.core.Json
import erp.core.Registry
import erp.core.models.Customer
import erp.core.models.GivenItem
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.Order
import erp.core.models.Settings
import java.io.File
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the Orders hub and then the order page for EVERY order in a private export of the real books, so a document
 * shape the demo never has cannot crash the app on a phone. The data is never in the repo: point `ERP_REALDATA` at a
 * folder holding orders.json, invoices.json, customers.json, karigars.json, givenItems.json and settings.json (arrays of
 * documents with `id`, Timestamps already ISO text, as FirestoreSource.plainSDK makes them). Without it the tests skip.
 * `ERP_REALDATA=/path ./gradlew :app:testTaheriDebugUnitTest --tests 'erp.app.shots.RealOrdersCrashTest'`
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class RealOrdersCrashTest(config: ShotConfig) : OrderSweepBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            // The phone's own locales too: a Pakistani phone may speak Urdu or English (Pakistan), and digits and case
            // rules change with them.
            return listOf(
                ShotConfig("phone-light", "w411dp-h891dp-notnight-xhdpi", dark = false),
                ShotConfig("phone-ur", "ur-rPK-w411dp-h891dp-night-xhdpi", dark = true),
                ShotConfig("phone-enPK", "en-rPK-w411dp-h891dp-notnight-xhdpi", dark = false),
                ShotConfig("phone-tr", "tr-rTR-w411dp-h891dp-notnight-xhdpi", dark = false),
                // Large text (the stacked action bar) and a small, narrow phone.
                ShotConfig("phone-large-text", "w320dp-h568dp-notnight-xhdpi", dark = false),
            ).map { arrayOf<Any>(it) }
        }
    }

    /** Today's clock, not the baselines' pinned day: late, due today and urgent read as they do on a phone. */
    @Before fun todayNotPinned() { erp.app.ui.AppClock.pinned = java.time.Instant.parse("2026-10-15T09:00:00Z") }

    private fun dir(): File? = System.getenv("ERP_REALDATA")?.let { File(it) }?.takeIf { it.isDirectory }

    @Suppress("UNCHECKED_CAST")
    private fun docs(dir: File, name: String): List<Map<String, Any?>> {
        val f = File(dir, name)
        if (!f.exists()) return emptyList()
        return (Json.parse(f.readText()) as? List<Any?>)?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()
    }

    private inline fun <reified T : Any> decode(list: List<Map<String, Any?>>, failures: MutableList<String>, what: String): List<T> =
        list.mapNotNull { d ->
            try {
                Book.decodeDoc(Registry.decoder(T::class), d["id"] as? String ?: "", d)
            } catch (e: Throwable) {
                failures += "decode $what ${d["id"]}: $e"
                null
            }
        }

    private fun books(failures: MutableList<String>): SweepBooks? {
        val dir = dir()
        Assume.assumeTrue("ERP_REALDATA is not set", dir != null)
        dir!!
        return SweepBooks(
            orders = decode(docs(dir, "orders.json"), failures, "order"),
            invoices = decode<Invoice>(docs(dir, "invoices.json"), failures, "invoice"),
            customers = decode<Customer>(docs(dir, "customers.json"), failures, "customer"),
            karigars = decode<Karigar>(docs(dir, "karigars.json"), failures, "karigar"),
            given = decode<GivenItem>(docs(dir, "givenItems.json"), failures, "givenItem"),
            settings = decode<Settings>(docs(dir, "settings.json").map { it + ("id" to "global") }, failures, "settings").firstOrNull(),
        )
    }

    private fun report(what: String, total: Int, ok: Int, failures: List<String>) {
        println("REAL ORDERS $what: $total loaded, $ok rendered, ${failures.size} failures")
        failures.forEach { println("FAIL $it") }
        check(failures.isEmpty()) { "${failures.size} failures: " + failures.joinToString("\n") }
    }

    @Test fun every_real_order_renders() {
        val failures = ArrayList<String>()
        val b = books(failures)!!
        failures += sweepLogic(b)
        val (ok, f) = sweepPages(b)
        report("PAGES", b.orders.size, ok, failures + f)
    }

    @Test fun every_real_order_opens_from_its_card() {
        val failures = ArrayList<String>()
        val b = books(failures)!!
        val (ok, f) = sweepTaps(b, shell = false)
        report("TAPS", b.orders.size, ok, failures + f)
    }

    @Test fun every_real_order_opens_through_the_shell() {
        val failures = ArrayList<String>()
        val b = books(failures)!!
        val (ok, f) = sweepTaps(b, shell = true)
        report("SHELL", b.orders.size, ok, failures + f)
    }
}
