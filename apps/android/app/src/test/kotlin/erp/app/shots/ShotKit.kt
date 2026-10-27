package erp.app.shots

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.test.core.app.ActivityScenario
import erp.app.ErpApp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.ui.AppClock
import erp.app.ui.LocalNoteState
import erp.app.ui.NoteHost
import erp.app.ui.rememberNoteState
import erp.app.ui.theme.ErpTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import java.time.Instant
import org.junit.Assume
import org.junit.Before
import org.junit.Rule
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

// The screenshot harness: a real screen of the app, drawn inside ErpTheme from the demo books (the shell's own demo
// path: Session in demo mode as the owner, Book on assets/demo.json), at a phone's and a tablet's size, light and dark.
// The recorded images are the review baseline: `./gradlew :app:recordRoborazziTaheriDebug` records, and
// `verifyRoborazziTaheriDebug` fails on a screen that changed. Fake nothing: if a screen needs data, the demo has it.

/** One way to look at a screen. [qualifiers] is the Robolectric configuration; [label] names the file. */
class ShotConfig(val label: String, val qualifiers: String, val dark: Boolean) {
    override fun toString() = label
}

/** 411 x 891 dp (a modern phone) at 2x, and 1280 x 800 dp (a tablet) at 1.5x; each light and dark. */
object ShotConfigs {
    private const val PHONE = "w411dp-h891dp"
    private const val TABLET = "w1280dp-h800dp"

    val all: List<ShotConfig> = listOf(
        ShotConfig("phone-light", "$PHONE-notnight-xhdpi", dark = false),
        ShotConfig("phone-dark", "$PHONE-night-xhdpi", dark = true),
        ShotConfig("tablet-light", "$TABLET-notnight-hdpi", dark = false),
        ShotConfig("tablet-dark", "$TABLET-night-hdpi", dark = true),
    )
}

/**
 * The demo is switched on before the app is made: `House.isDemo` is read once, from this property, when the first line
 * of the app runs (debug builds only, as the emulator check does it). Called from the test class's parameter list, which
 * the runner reads before it builds any Android environment.
 */
object ShotEnv {
    fun demo() {
        System.setProperty("erp.demo", "true")
    }
}

/** The base of a screenshot test class: launches an activity at the configured size and draws a composable in it. */
abstract class ShotBase(protected val config: ShotConfig) {
    @get:Rule val compose = createEmptyComposeRule()

    private var scenario: ActivityScenario<ComponentActivity>? = null

    @Before
    fun pinTheClock() {
        // The demo's dates are relative to "now": pinned, a baseline made today still matches next month.
        AppClock.pinned = Instant.parse("2026-10-12T08:00:00Z")
    }

    /** Draws [content] under the house's theme with the session and a toast, and lets the books arrive. */
    protected fun show(content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers(config.qualifiers)
        // Skeletons shimmer forever: the clock is stepped by hand so the screen can be called settled.
        compose.mainClock.autoAdvance = false
        // A test that shows several screens in turn (the real-orders sweep) must not find the last one's nodes.
        scenario?.close()
        val s = ActivityScenario.launch(ComponentActivity::class.java)
        scenario = s
        s.onActivity { activity ->
            activity.setContent {
                ErpTheme {
                    val note = rememberNoteState()
                    CompositionLocalProvider(LocalSession provides ErpApp.session, LocalNoteState provides note) {
                        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                            Box(Modifier.fillMaxSize()) {
                                content()
                                NoteHost(note)
                            }
                        }
                    }
                }
            }
        }
        settle()
    }

    /**
     * A screen at [path] on its own back stack; [below] are the places under it (so Back shows); [sheet] is the
     * create sheet's first screen (it has a Close instead of a tab bar).
     */
    protected fun showPlace(path: String, below: List<String> = emptyList(), sheet: Boolean = false) = show {
        val stack = rememberNavBackStack(*(below + path).mapIndexed { i, p -> Route(p, i) }.toTypedArray())
        StackHost(stack, Modifier.fillMaxSize(), onClose = if (sheet) ({}) else null)
    }

    /**
     * The demo books arrive off the main thread and the clock is ours: step both until the screen has stopped
     * changing (a fixed few seconds of frames, enough for a shelf, a crossfade and a sheet to rise).
     */
    protected fun settle(millis: Int = 2500) {
        repeat(millis / 50) {
            Thread.sleep(20)
            shadowOf(Looper.getMainLooper()).idle()
            compose.mainClock.advanceTimeBy(50)
        }
    }

    /** Records (or verifies) the screen as `<house>/<name>_<phone|tablet>-<light|dark>.png`. */
    protected fun shoot(name: String) {
        settle(400)
        val dir = File("src/test/screenshots/${House.id}")
        compose.onRoot().captureRoboImage(File(dir, "${name}_${config.label}.png").path)
    }

    /** Like [shoot] but on the frame the clock is at: the middle of a transition is the picture, so it is not settled first. */
    protected fun shootFrozen(name: String) {
        val dir = File("src/test/screenshots/${House.id}")
        compose.onRoot().captureRoboImage(File(dir, "${name}_${config.label}.png").path)
    }

    /** Screens whose look does not depend on the house are kept for Taheri only: the baseline stays small. */
    protected fun onlyTaheri() = Assume.assumeTrue(House.id == "taheri")
}
