package erp.app.shots

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import erp.app.screens.voice.VoiceModel
import erp.app.screens.voice.VoicePlan
import erp.app.screens.voice.VoiceScreen
import erp.app.ui.ReadableColumn
import erp.core.Json
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The device features' screens at phone and tablet size, light and dark: the voice sheet in its four states (idle,
 * listening, an answer, a plan to confirm). The widget preview is in [SettingsShots] (`settings-widgets`). Made-up
 * names and amounts only.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class DeviceShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    private val noNavigator = object : Navigator {
        override fun open(path: String) {}
        override fun replace(path: String) {}
        override fun back() {}
        override val canGoBack: Boolean = false
    }

    @Composable private fun sheet(content: @Composable () -> Unit) =
        CompositionLocalProvider(LocalNavigator provides noNavigator) { ReadableColumn(maxWidth = 720.dp, content = content) }

    private fun model() = VoiceModel(ErpApp.instance, ErpApp.scope, ask = { emptyMap() }, write = { _, _ -> })

    private fun plan(json: String, words: String) = VoicePlan(@Suppress("UNCHECKED_CAST") (Json.parse(json) as Map<String, Any?>), words)

    @Test fun voice_idle() {
        onlyTaheri()
        showPlace("/voice", sheet = true)
        shoot("voice-idle")
    }

    @Test fun voice_listening() {
        onlyTaheri()
        val m = model().apply { listening = true; level = 0.6f; words = "Record a payment of five thousand from Test Buyer" }
        show { sheet { VoiceScreen(m) } }
        shoot("voice-listening")
    }

    @Test fun voice_answer() {
        onlyTaheri()
        val words = "What is in the drawer today"
        val m = model().apply {
            this.words = words
            plan = plan("""{"answer":"The drawer holds Rs 3.12 lac, with Rs 1.4 lac in today.","href":"/today","cards":[]}""", words)
        }
        show { sheet { VoiceScreen(m) } }
        shoot("voice-answer")
    }

    @Test fun voice_review() {
        onlyTaheri()
        val words = "Test Buyer paid five thousand by bank transfer, and tea expense three hundred"
        val m = model().apply {
            this.words = words
            plan = plan(
                """{"cards":[
                    {"title":"record a payment","summary":"Rs 5,000 by bank transfer from Test Buyer on INV-000128","href":"/invoices/INV-000128",
                     "operations":[{"op":"addPayment","fields":{"invoiceId":"INV-000128","amount":5000,"method":"Bank Transfer"}}]},
                    {"title":"add an expense","summary":"Tea, Rs 300","problem":"Which account did this come out of?","operations":[]}
                ]}""",
                words,
            )
        }
        show { sheet { VoiceScreen(m) } }
        shoot("voice-review")
    }
}
