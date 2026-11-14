package erp.app.shots

import erp.app.ErpApp
import erp.app.nav.RootGate
import erp.app.nav.SEARCH_PATH
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The densest screens at the system's 1.3x font (Inter is wider than the old system face, so this is where a row crowds
 * its trailing amount, a label meets an icon or a word is cut). Looked at when the type or a row changes, not a baseline:
 * it runs only with `ERP_LARGE_TEXT=1` in the environment (`ERP_LARGE_TEXT=1 ./gradlew :app:recordRoborazziTaheriDebug
 * --tests 'erp.app.shots.LargeTextShots'`), so `verifyRoborazzi*` never asks for a picture that is not kept.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class LargeTextShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.largeText.map { arrayOf<Any>(it) }
        }
    }

    @Before
    fun onlyWhenAsked() = Assume.assumeTrue(System.getenv("ERP_LARGE_TEXT") == "1")

    @Test fun home() { show { RootGate() }; shoot("x13-root-home") }
    @Test fun orders_hub() { showPlace("/orders", bottomBar = true); shoot("x13-orders-hub") }
    @Test fun invoices_list() { showPlace("/invoices"); shoot("x13-invoices-list") }
    @Test fun customers() { showPlace("/customers"); shoot("x13-customers") }
    @Test fun search() { showPlace(SEARCH_PATH); shoot("x13-search") }
    @Test fun analytics_overview() { onlyTaheri(); showPlace("/analytics"); shoot("x13-analytics-overview") }
    @Test fun order_page() { onlyTaheri(); showPlace("/orders/ORD-D0002", below = listOf("/orders")); shoot("x13-order-page") }
    @Test fun invoice_page() { onlyTaheri(); showPlace("/invoices/INV-D0002", below = listOf("/invoices")); shoot("x13-invoice-page") }
    @Test fun repairs_list() { onlyTaheri(); showPlace("/repairs"); shoot("x13-repairs-list") }
    @Test fun my_work() { onlyTaheri(); showPlace("/my-work"); shoot("x13-my-work") }
    @Test fun new_order() { onlyTaheri(); showPlace("/orders/add", sheet = true); shoot("x13-new-order-1") }
    @Test fun new_sale() { onlyTaheri(); showPlace("/invoices/new", sheet = true); shoot("x13-new-sale-1") }
    @Test fun settings() { onlyTaheri(); showPlace("/settings"); shoot("x13-settings-root") }
    @Test fun insights() { onlyTaheri(); showPlace("/insights", bottomBar = true); shoot("x13-insights") }
    @Test fun calendar() { onlyTaheri(); showPlace("/calendar"); shoot("x13-calendar") }
    @Test fun drafts() { onlyTaheri(); showPlace("/drafts"); shoot("x13-drafts") }
    @Test fun posts_hub() { onlyTaheri(); showPlace("/posts"); shoot("x13-posts-hub") }
    @Test fun website_menu() { onlyTaheri(); showPlace("/marketing/website"); shoot("x13-website-menu") }
    @Test fun repair_ticket() { onlyTaheri(); showPlace("/repairs?id=REP-D2", below = listOf("/repairs")); settle(); shoot("x13-repair-ticket") }
    @Test fun order_finalize() { onlyTaheri(); showPlace("/orders/ORD-D0004/finalize", below = listOf("/orders", "/orders/ORD-D0004")); shoot("x13-order-finalize") }
    @Test fun alerts() { onlyTaheri(); showPlace("/settings/alerts", below = listOf("/settings")); shoot("x13-settings-alerts") }
    @Test fun activity() { onlyTaheri(); showPlace("/activity-log"); shoot("x13-activity-log") }
}
