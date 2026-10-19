package erp.app.shots

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import com.github.takahirom.roborazzi.captureRoboImage
import erp.app.ErpApp
import erp.app.config.House
import erp.app.screens.marketing.DesignEngines
import java.io.File
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Posts › Design: the start screen, the workspace with a made-up piece open (laid out by a stand-in for the engine, which a JVM test
 * cannot run), the Publish sheet over it, the Saved shelf, Photos and the designer. The shop's demo supplies the shelf, the website's
 * pieces and the Publish sheet's destinations (DesignDemo); the house shows in the accent and the site, so both flavors record.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class DesignShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Before fun standInForTheEngine() { DesignEngines.factory = { FakeDesignEngine(it) } }

    @After fun theRealEngineAgain() { DesignEngines.factory = null }

    /** A window the screen opened over itself (a full-screen sheet, the designer): the last root on show. */
    private fun shootWindow(name: String) {
        settle(400)
        compose.onAllNodes(isRoot()).onLast().captureRoboImage(File(File("src/test/screenshots/${House.id}"), "${name}_${config.label}.png").path)
    }

    /** "Edit design" pressed through its semantics: the page is drawn on a paused clock, so nothing here waits for it to be idle. */
    private fun openTheDesigner() {
        compose.onAllNodes(hasText("Edit design") and hasClickAction()).onFirst().performSemanticsAction(SemanticsActions.OnClick)
    }

    @Test fun design_start() {
        showPlace("/design", below = listOf("/posts"))
        shoot("design-start")
    }

    @Test fun design_workspace() {
        showPlace("/design?open=demo", below = listOf("/posts"))
        settle(3000)
        shoot("design-workspace")
    }

    @Test fun design_publish() {
        showPlace("/design?open=demo&sheet=publish", below = listOf("/posts"))
        settle(3000)
        shootWindow("design-publish")
    }

    @Test fun design_resize() {
        onlyTaheri()
        showPlace("/design?open=demo&sheet=resize", below = listOf("/posts"))
        settle(3000)
        shootWindow("design-resize")
    }

    @Test fun design_saved() {
        onlyTaheri()
        showPlace("/design?v=saved", below = listOf("/posts"))
        shoot("design-saved")
    }

    @Test fun design_photos() {
        onlyTaheri()
        showPlace("/design?v=photos", below = listOf("/posts"))
        shoot("design-photos")
    }

    @Test fun design_editor() {
        onlyTaheri()
        showPlace("/design?open=demo", below = listOf("/posts"))
        settle(3000)
        openTheDesigner()
        settle(1500)
        shootWindow("design-editor")
    }

    @Test fun design_editor_layer() {
        onlyTaheri()
        showPlace("/design?open=demo", below = listOf("/posts"))
        settle(3000)
        openTheDesigner()
        settle(1500)
        // The headline's box on the page is chosen: its own controls, blend and effects, and rich text come up.
        compose.onAllNodes(hasText("Headline") and hasClickAction()).onLast().performSemanticsAction(SemanticsActions.OnClick)
        settle(1500)
        shootWindow("design-editor-layer")
    }
}
