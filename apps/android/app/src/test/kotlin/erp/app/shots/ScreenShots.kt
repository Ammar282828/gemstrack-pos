package erp.app.shots

import android.os.Looper
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.performClick
import erp.app.ErpApp
import erp.app.auth.SignInScreen
import erp.app.data.Book
import erp.app.nav.RootGate
import erp.app.nav.SEARCH_PATH
import erp.app.screens.sale.SaleStore
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The review baseline: the screens the base is judged by, each at phone and tablet size, light and dark. The look of
 * a house matters on the first few (palette, name, menus), so those are kept for both flavors; the rest for Taheri.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class ScreenShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun root_home() {
        show { RootGate() }
        shoot("root-home")
    }

    @Test fun search() {
        onlyTaheri()
        showPlace(SEARCH_PATH)
        shoot("search")
    }

    @Test fun orders_hub() {
        showPlace("/orders")
        shoot("orders-hub")
    }

    @Test fun order_page() {
        onlyTaheri()
        showPlace("/orders/ORD-D0002", below = listOf("/orders"))
        shoot("order-page")
    }

    @Test fun order_finalize() {
        onlyTaheri()
        showPlace("/orders/ORD-D0004/finalize", below = listOf("/orders", "/orders/ORD-D0004"))
        shoot("order-finalize")
    }

    @Test fun invoices_list() {
        showPlace("/invoices")
        shoot("invoices-list")
    }

    @Test fun invoice_page() {
        onlyTaheri()
        showPlace("/invoices/INV-D0002", below = listOf("/invoices"))
        shoot("invoice-page")
    }

    @Test fun new_sale_customer() {
        onlyTaheri()
        withAPiece()
        showPlace("/invoices/new", sheet = true)
        shoot("new-sale-1-customer")
    }

    @Test fun new_sale_review() {
        onlyTaheri()
        withAPiece()
        showPlace("/invoices/new", sheet = true)
        compose.onNode(hasContentDescription("Step 4 of 4", substring = true)).performClick()
        shoot("new-sale-4-review")
    }

    @Test fun sign_in() {
        show { SignInScreen(ErpApp.session) }
        shoot("sign-in")
    }

    /** The first demo piece on this phone's unfinished sale, so the steps have something to show. */
    private fun withAPiece() {
        val products = Book.shared.products
        products.need()
        repeat(60) {
            if (products.items.value.isNotEmpty()) return@repeat
            Thread.sleep(25)
            shadowOf(Looper.getMainLooper()).idle()
        }
        products.items.value.firstOrNull()?.let { SaleStore.add(it) }
    }
}
