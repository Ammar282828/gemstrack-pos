package erp.app.shots

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation3.runtime.rememberNavBackStack
import erp.app.ErpApp
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.config.Business
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import erp.app.screens.voice.VoiceModel
import erp.app.screens.voice.VoicePlan
import erp.app.screens.voice.VoiceCapsule
import erp.app.ui.ReadableColumn
import erp.app.widget.WidgetFacePreview
import erp.app.widget.WidgetLinkData
import erp.app.widget.WidgetSize
import erp.app.widget.WidgetSummary
import erp.app.widget.previewHeight
import erp.app.widget.previewWidth
import erp.core.Json
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The device features' screens at phone and tablet size, light and dark: the voice capsule over an open order in its four states (idle,
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

    private fun model() = VoiceModel(ErpApp.instance, ErpApp.scope, ask = { emptyMap() }, write = { _, _ -> })

    private fun plan(json: String, words: String) = VoicePlan(@Suppress("UNCHECKED_CAST") (Json.parse(json) as Map<String, Any?>), words)

    /** The capsule over a live page (an order), as a shell draws it: the page beneath is not covered, only its foot. */
    private fun over(m: VoiceModel, label: String? = "Order ORD-D0002 · Test Buyer · 2 pieces") = show {
        val stack = rememberNavBackStack(Route("/orders/ORD-D0002", 0))
        // The page's own foot bar lifts the capsule above it (voiceClearance), as the shell does.
        val inset = androidx.compose.runtime.remember { erp.app.screens.voice.VoiceInset().apply { bottom = 16.dp } }
        CompositionLocalProvider(LocalNavigator provides noNavigator, erp.app.screens.voice.LocalVoiceInset provides inset) {
            Box(Modifier.fillMaxSize()) {
                StackHost(stack, Modifier.fillMaxSize())
                VoiceCapsule(m, label, "en-PK", {}, {}, {}, Modifier.fillMaxSize().padding(bottom = inset.clearance))
            }
        }
    }

    @Test fun voice_idle() {
        onlyTaheri()
        over(model())
        shoot("voice-idle")
    }

    @Test fun voice_listening() {
        onlyTaheri()
        over(model().apply { listening = true; level = 0.6f; live = "Make the second piece twenty two karat" })
        shoot("voice-listening")
    }

    @Test fun voice_answer() {
        onlyTaheri()
        val words = "What is in the drawer today"
        over(
            model().apply {
                listening = true
                this.words = words
                plan = plan("""{"answer":"The drawer holds Rs 3.12 lac, with Rs 1.4 lac in today.","href":"/today","cards":[]}""", words)
            },
        )
        shoot("voice-answer")
    }

    @Test fun voice_review() {
        onlyTaheri()
        val words = "Make the second piece twenty two karat, and add five thousand advance"
        over(
            model().apply {
                listening = true
                this.words = words
                plan = plan(
                    """{"cards":[
                        {"title":"edit a piece","summary":"Piece 2 of ORD-D0002 becomes 22 karat","href":"/orders/ORD-D0002",
                         "operations":[{"op":"updateOrderPiece","fields":{"orderId":"ORD-D0002","index":1,"karat":"22k"}}]},
                        {"title":"record an advance","summary":"Rs 5,000 advance on ORD-D0002","problem":"How was it paid?","operations":[]}
                    ]}""",
                    words,
                )
            },
        )
        shoot("voice-review")
    }

    @Test fun voice_ready() {
        onlyTaheri()
        val words = "Make it twenty two karat"
        over(
            model().apply {
                listening = true
                this.words = words
                plan = plan(
                    """{"cards":[{"title":"edit a piece","summary":"Piece 1 of ORD-D0002 becomes 22 karat","operations":[{"op":"updateOrderPiece","fields":{"orderId":"ORD-D0002","index":0,"karat":"22k"}}]}]}""",
                    words,
                )
            },
        )
        shoot("voice-ready")
    }

    // The Large face alone (Settings' preview page runs below the fold): one business, then two stacked, as a launcher's 4x4 draws them.
    @Test fun widget_large_faces() {
        // Each business in its own colours, as the widget draws two.
        val gold = Business.Palette(Business.Side("#8A6B42", "#ECE8E1", "#FFFFFF", "#FFFFFF"), Business.Side("#D3B47F", "#030606", "#172020", "#0B1414"))
        val pink = Business.Palette(Business.Side("#380000", "#F2E9E4", "#FFFFFF", "#FBF9F9"), Business.Side("#EBA9B3", "#090405", "#22131A", "#251318"))
        val taheri = WidgetLinkData("taheri", "Taheri ERP", "https://example.invalid", "", gold, "taheri")
        val mina = WidgetLinkData("mina", "House of Mina ERP", "https://example.invalid", "", pink, "mina")
        val one = listOf(taheri to WidgetSummary.sample("Taheri"))
        val two = one + (mina to WidgetSummary.sample("House of Mina"))
        show {
            androidx.compose.foundation.layout.Column(
                androidx.compose.ui.Modifier.padding(16.dp),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp),
            ) {
                WidgetFacePreview(one, WidgetSize.Large, "ERP", androidx.compose.ui.Modifier.size(previewWidth(WidgetSize.Large), previewHeight(WidgetSize.Large)), dark = config.dark)
                WidgetFacePreview(two, WidgetSize.Large, "ERP", androidx.compose.ui.Modifier.size(previewWidth(WidgetSize.Large), previewHeight(WidgetSize.Large)), dark = config.dark)
            }
        }
        shoot("widget-large")
    }
}
