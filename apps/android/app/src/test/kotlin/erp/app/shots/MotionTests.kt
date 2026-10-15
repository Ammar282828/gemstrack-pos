package erp.app.shots

import android.app.Activity
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithText
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
}
