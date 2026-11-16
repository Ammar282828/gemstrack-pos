package erp.app.shots

import erp.app.ErpApp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The daily screens the Material audit (docs/android-material-audit.md) judged that the main baseline did not hold. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class AuditShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun customers() { onlyTaheri(); showPlace("/customers"); shoot("audit-customers") }
    @Test fun customer_page() { onlyTaheri(); showPlace("/customers/CUST-D01", below = listOf("/customers")); shoot("audit-customer-page") }
    @Test fun collect() { onlyTaheri(); showPlace("/collect", below = listOf("/")); shoot("audit-collect") }
    @Test fun new_order() { onlyTaheri(); showPlace("/orders/add", sheet = true); shoot("audit-new-order") }
}
