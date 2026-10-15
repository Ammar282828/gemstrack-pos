package erp.app.shots

import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import erp.app.ErpApp
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.ui.ZoomRegistry
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Navigation motion does not crash mid-flight. The main clock is ours (paused): each test opens a page and goes back,
 * stepping 16 ms frames through both transitions, once for a row that morphs into its page (an order card -> the order,
 * a shared element) and once for a plain push (no row, the shared axis).
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

    @Composable
    private fun Host() {
        val s = rememberNavBackStack(Route("/orders", 0))
        stack = s
        StackHost(s, androidx.compose.ui.Modifier)
    }

    /** Frames of a transition, the books arriving in between. */
    private fun frames(n: Int = 40) {
        repeat(n) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.mainClock.advanceTimeBy(16)
        }
    }

    @Test fun order_page_slides_in_and_back_out() {
        show { Host() }
        val s = stack!!
        assertEquals(1, s.size)
        // The card the hub shows has registered as a source for its page.
        // Tap the real card: the same click a finger makes.
        compose.onAllNodesWithText("ORD-D0002", substring = true)[0].performClick()
        frames(8)
        assertEquals(2, s.size)
        frames(40)
        assertEquals("/orders/ORD-D0002", (s.last() as Route).path)
        // Back: the page folds into its card.
        s.removeAt(s.lastIndex)
        frames(8)
        frames(40)
        assertEquals(1, s.size)
        compose.onAllNodesWithText("ORD-D0002", substring = true)[0].assertIsDisplayed()
    }

    @Test fun plain_push_and_pop_run_the_shared_axis() {
        show { Host() }
        val s = stack!!
        // No row opens this path: it slides in 30 dp with a fade, and out again.
        s.add(Route("/rates", 1))
        frames(8)
        frames(40)
        assertEquals(2, s.size)
        s.removeAt(s.lastIndex)
        frames(8)
        frames(40)
        assertEquals(1, s.size)
    }
}
