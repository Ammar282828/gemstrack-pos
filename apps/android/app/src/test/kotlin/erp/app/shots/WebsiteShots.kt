package erp.app.shots

import erp.app.ErpApp
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.dp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Website pages: the menu, Add photos (a tray with one waiting, one failed and one sent), Edit a piece's grid and one
 * piece, Photo weights and Investments. Everything reads the demo's made-up site (WebsiteDemo), not a server. Phone and
 * tablet, light and dark; the menu and Edit a piece change with the house (Mina has no weights, its pieces carry
 * paragraphs and facts, not tags), so those record for both flavors.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class WebsiteShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun website_menu() {
        showPlace("/marketing/website")
        shoot("website-menu")
    }

    @Test fun website_photos() {
        onlyTaheri()
        showPlace("/website/photos")
        shoot("website-photos")
    }

    @Test fun website_edit_grid() {
        showPlace("/website/edit")
        shoot("website-edit")
    }

    @Test fun website_edit_piece() {
        showPlace("/website/edit?id=Rings%2FR-101%2Ewebp", below = listOf("/website/edit"))
        shoot("website-edit-piece")
    }

    @Test fun website_weights() {
        onlyTaheri()
        showPlace("/website/weights")
        shoot("website-weights")
    }

    /** The weight as the site draws it on a photograph (Futura LT Light at 143/3000 of the width), typed as 4.2. */
    @Test fun website_weight_label() {
        onlyTaheri()
        show {
            androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.padding(16.dp).size(360.dp)) {
                erp.app.screens.marketing.WebsiteWeightPhoto(erp.app.screens.marketing.WebsiteDemo.weights()[0], "4.2")
            }
        }
        shoot("website-weight-label")
    }

    @Test fun website_investments() {
        onlyTaheri()
        showPlace("/website/investments")
        shoot("website-investments")
    }
}
