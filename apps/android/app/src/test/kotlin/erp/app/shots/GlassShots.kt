package erp.app.shots

import androidx.navigation3.runtime.rememberNavBackStack
import androidx.compose.foundation.layout.fillMaxSize
import erp.app.ErpApp
import erp.app.config.Businesses
import erp.app.nav.RootGate
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.screens.businesses.BusinessPicker
import erp.app.ui.GlassLayer
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Interface style "glass" (ui/Glass.kt) forced on, since the demo's settings say Standard: Home, an order and an invoice (record
 * headers), Analytics (KPI tiles), the cold-start picker. The point is the look (the ground, the tinted cards, the hairline) in both themes
 * and both houses. Robolectric draws no RenderEffect, so the blur itself is a phone's to show; the tint over the ground is what is judged here.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class GlassShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    private fun showGlassPlace(path: String, below: List<String> = emptyList()) = show {
        GlassLayer(true) {
            val stack = rememberNavBackStack(*(below + path).mapIndexed { i, p -> Route(p, i) }.toTypedArray())
            StackHost(stack, androidx.compose.ui.Modifier.fillMaxSize())
        }
    }

    @Test fun glass_home() {
        show { GlassLayer(true) { RootGate() } }
        shoot("glass-home")
    }

    @Test fun glass_order() {
        onlyTaheri()
        showGlassPlace("/orders/ORD-D0002", below = listOf("/orders"))
        shoot("glass-order")
    }

    @Test fun glass_invoice() {
        onlyTaheri()
        showGlassPlace("/invoices/INV-D0002", below = listOf("/invoices"))
        shoot("glass-invoice")
    }

    @Test fun glass_analytics() {
        onlyTaheri()
        showGlassPlace("/analytics")
        shoot("glass-analytics")
    }

    @Test fun glass_picker() {
        show { GlassLayer(true) { BusinessPicker(Businesses.list.value, Businesses.list.value.first()) } }
        shoot("glass-picker")
    }
}
