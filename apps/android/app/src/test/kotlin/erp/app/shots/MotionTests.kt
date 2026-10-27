package erp.app.shots

import android.app.Activity
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import erp.app.ui.AxisSwap
import erp.app.ui.EntryStep
import erp.app.ui.EntryStepContent
import erp.app.ui.LocalReduceMotion
import erp.app.ui.rememberErpMotion
import androidx.compose.ui.test.performClick
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import erp.app.ErpApp
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.PageActivity
import kotlin.test.assertEquals
import kotlin.test.assertNull
import android.content.Intent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A page is an Activity of its own, so the platform draws the transitions: a tab's Navigator opens a PageActivity
 * with the path as an extra, and the tab's stack never grows. Robolectric records the started Intent.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class MotionTests(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return listOf(arrayOf<Any>(ShotConfigs.all[0]))
        }
    }

    private var stack: NavBackStack<NavKey>? = null
    private var activity: Activity? = null

    @Composable
    private fun Host() {
        val s = rememberNavBackStack(Route("/orders", 0))
        stack = s
        activity = LocalContext.current as? Activity
        StackHost(s, androidx.compose.ui.Modifier)
    }

    private fun frames(n: Int = 40) {
        repeat(n) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.mainClock.advanceTimeBy(16)
        }
    }

    @Test fun tapping_an_order_starts_its_page_activity() {
        show { Host() }
        frames(8)
        compose.onAllNodesWithText("ORD-D0002", substring = true)[0].performClick()
        frames(8)
        val started = shadowOf(activity!!).nextStartedActivity
        assertEquals(PageActivity::class.java.name, started.component?.className)
        assertEquals("/orders/ORD-D0002", started.getStringExtra(PageActivity.EXTRA_PATH))
        // The tab's own stack stays at its root: the page is not pushed onto it.
        assertEquals(1, stack!!.size)
    }

    @Test fun a_page_activity_shows_its_path_and_back_finishes_it() {
        ShotEnv.demo()
        val scenario = ActivityScenario.launch<PageActivity>(PageActivity.intent(ApplicationProvider.getApplicationContext(), "/rates"))
        scenario.onActivity { assertFalse(it.isFinishing) }
        compose.mainClock.autoAdvance = false
        frames(20)
        compose.onNodeWithContentDescription("Back").performClick()
        frames(4)
        scenario.onActivity { assertTrue(it.isFinishing) }
    }

    @Test fun a_page_activity_without_a_path_finishes() {
        val scenario = ActivityScenario.launch<PageActivity>(Intent(ApplicationProvider.getApplicationContext(), PageActivity::class.java))
        assertEquals(androidx.lifecycle.Lifecycle.State.DESTROYED, scenario.state)
    }

    // MARK: Inside a page (paused clock): the tab fade through and the shared axes, at their middle

    private fun frame(ms: Long) {
        shadowOf(Looper.getMainLooper()).idle()
        compose.mainClock.advanceTimeBy(ms)
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Composable
    private fun Swatch(word: String, tint: Color) {
        Box(Modifier.fillMaxSize().padding(24.dp).background(tint, RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
            Text(word, style = MaterialTheme.typography.displaySmall)
        }
    }

    /** A host that swaps once when "go" is tapped; [reduce] pins Reduce Motion. */
    @Composable
    private fun Swap(reduce: Boolean, content: @Composable (swapped: Boolean) -> Unit) {
        var swapped by remember { mutableStateOf(false) }
        CompositionLocalProvider(LocalReduceMotion provides reduce) {
            Box(Modifier.fillMaxSize()) {
                content(swapped)
                Box(Modifier.size(48.dp).align(Alignment.TopEnd).testTag("go").clickable { swapped = true })
            }
        }
    }

    @Test fun tabs_fade_through_both_tabs_show_at_the_middle_and_one_after() {
        show {
            Swap(reduce = false) { swapped ->
                val through = rememberErpMotion().fadeThrough()
                AnimatedContent(swapped, transitionSpec = { through }, label = "tab") { b ->
                    if (b) Swatch("Tab B", MaterialTheme.colorScheme.tertiaryContainer) else Swatch("Tab A", MaterialTheme.colorScheme.primaryContainer)
                }
            }
        }
        compose.onNodeWithTag("go").performClick()
        frame(40)
        // Mid-flight: the old tab is on its way out while the new one grows in.
        compose.onAllNodesWithText("Tab A").assertCountEquals(1)
        compose.onAllNodesWithText("Tab B").assertCountEquals(1)
        shootFrozen("motion-fade-through-mid")
        frame(2000)
        compose.onAllNodesWithText("Tab A").assertCountEquals(0)
        compose.onAllNodesWithText("Tab B").assertCountEquals(1)
    }

    @Test fun steps_move_on_a_shared_axis_y_both_steps_show_at_the_middle() {
        show {
            Swap(reduce = false) { swapped ->
                EntryStepContent(if (swapped) EntryStep.pieces else EntryStep.customer) { step ->
                    Swatch("Step " + step.title, MaterialTheme.colorScheme.secondaryContainer)
                }
            }
        }
        compose.onNodeWithTag("go").performClick()
        frame(40)
        compose.onAllNodesWithText("Step Customer").assertCountEquals(1)
        compose.onAllNodesWithText("Step Pieces").assertCountEquals(1)
        shootFrozen("motion-shared-axis-y-mid")
        frame(2000)
        compose.onAllNodesWithText("Step Customer").assertCountEquals(0)
    }

    @Test fun peers_slide_on_a_shared_axis_x_both_show_at_the_middle() {
        show {
            Swap(reduce = false) { swapped ->
                AxisSwap(if (swapped) "Kinds" else "Sources") { w -> Swatch(w, MaterialTheme.colorScheme.secondaryContainer) }
            }
        }
        compose.onNodeWithTag("go").performClick()
        frame(40)
        compose.onAllNodesWithText("Sources").assertCountEquals(1)
        compose.onAllNodesWithText("Kinds").assertCountEquals(1)
        shootFrozen("motion-shared-axis-x-mid")
        frame(2000)
        compose.onAllNodesWithText("Sources").assertCountEquals(0)
    }

    @Test fun reduce_motion_swaps_at_once_with_no_overlap() {
        show {
            Swap(reduce = true) { swapped ->
                val through = rememberErpMotion().fadeThrough()
                AnimatedContent(swapped, transitionSpec = { through }, label = "tab") { b ->
                    Swatch(if (b) "Tab B" else "Tab A", MaterialTheme.colorScheme.primaryContainer)
                }
            }
        }
        compose.onNodeWithTag("go").performClick()
        frame(40)
        compose.onAllNodesWithText("Tab A").assertCountEquals(0)
        compose.onAllNodesWithText("Tab B").assertCountEquals(1)
    }
}
