package erp.app.shots

import erp.app.ErpApp
import erp.app.auth.SignInBody
import erp.app.auth.Session
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.screens.businesses.BusinessPicker
import erp.app.screens.businesses.BusinessesPanel
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * One app, many businesses at phone and tablet size, light and dark (docs/features/android-app.md): the cold-start picker, the Businesses
 * screen and its "Found" card for a business typed by address, a business whose Android app is not registered signing in, and Home with the
 * chip at its head. The businesses are the two the app ships (Taheri and House of Mina); the preview card is a made-up ERP.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class BusinessShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    private val list: List<Business> get() = Businesses.list.value

    /** A made-up ERP, as `GET /api/app/business` would describe it. */
    private val found: Business = Business.decode(
        """{"version":1,"id":"example-silver","name":"EXAMPLE SILVER","shortName":"Example ERP","serverURL":"https://erp.example-silver.test","metal":"silver",
        "margin":{"kind":"percent","percent":40},
        "palette":{"light":{"accent":"#1F5A4B","ground":"#F1F5F2","card":"#FFFFFF","onAccent":"#FFFFFF"},"dark":{"accent":"#7FD1B9","ground":"#0F1A16","card":"#17251F","onAccent":"#0B1A14"}},
        "logo":{"aspect":4},"android":null,"flags":{"partnership":true}}""",
    )!!

    @Test fun business_picker() {
        show { BusinessPicker(list, list.first()) }
        shoot("business-picker")
    }

    @Test fun businesses_screen() {
        showPlace("/app/businesses", below = listOf("/settings"))
        shoot("businesses-screen")
    }

    @Test fun businesses_found_card() {
        show { BusinessesPanel(inSheet = true, demo = false, initialPreview = found) }
        shoot("businesses-sheet-found")
    }

    @Test fun business_sign_in_not_set_up() {
        val mina = list.first { it.id == "mina" }
        show { SignInBody(mina, Session.State.NeedsSetup, error = null, canAsk = true, onGoogle = {}, onBrowser = {}) }
        shoot("business-sign-in-not-set-up")
    }

    @Test fun home_with_the_business_chip() {
        showPlace("/")
        shoot("business-home-chip")
    }
}
