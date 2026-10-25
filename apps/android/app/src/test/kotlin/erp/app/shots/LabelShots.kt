package erp.app.shots

import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onLast
import com.github.takahirom.roborazzi.captureRoboImage
import erp.app.ErpApp
import erp.app.config.House
import erp.app.data.Book
import erp.app.screens.settings.label.DesignerState
import erp.app.screens.settings.label.LabelDesignerContent
import erp.app.screens.settings.label.Panel
import erp.app.screens.stock.StockPieceTagSheet
import erp.app.screens.stock.TagPrintJobSheet
import erp.core.logic.LabelDesignerModel
import erp.core.models.LabelLayout
import java.io.File
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The tag designer (with a field selected, and on its Layers and Label panels), the two Settings pages for printing (Printer,
 * Label LIVE), and the Stock sheets that print a piece's tag and a job of tags. Both flavors record: the house shows in the accent.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class LabelShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    /** A window the screen opened over itself (a full-screen sheet): the last root on show. */
    private fun shootWindow(name: String) {
        settle(400)
        compose.onAllNodes(isRoot()).onLast().captureRoboImage(File(File("src/test/screenshots/${House.id}"), "${name}_${config.label}.png").path)
    }

    /** A field is selected only for the Field panel: picking one brings that panel forward over the others. */
    private fun designer(panel: Panel) {
        val model = LabelDesignerModel(LabelLayout.standard, erp.app.screens.settings.label.LabelMeasurer.measure)
        if (panel == Panel.Field) model.select(setOf(model.layout.fields[0].id))
        show { CompositionLocalProvider(LocalNavigator provides noNavigator) { LabelDesignerContent(DesignerState(model), LabelLayout.standard, "Saved", panel) } }
    }

    @Test fun label_designer_field() {
        onlyTaheri()
        designer(Panel.Field)
        shoot("label-designer-field")
    }

    @Test fun label_designer_layers() {
        onlyTaheri()
        designer(Panel.Layers)
        shoot("label-designer-layers")
    }

    @Test fun label_designer_label() {
        onlyTaheri()
        designer(Panel.Label)
        shoot("label-designer-label")
    }

    @Test fun label_designer_preview() {
        onlyTaheri()
        designer(Panel.Preview)
        shoot("label-designer-preview")
    }

    @Test fun label_tag_printer() {
        showPlace("/app/tag-printer", below = listOf("/settings"))
        shoot("label-tag-printer")
    }

    @Test fun label_live() {
        onlyTaheri()
        showPlace("/app/label-live", below = listOf("/settings"))
        shoot("label-live")
    }

    private val noNavigator = object : Navigator {
        override fun open(path: String) {}
        override fun replace(path: String) {}
        override fun back() {}
        override val canGoBack: Boolean = false
    }

    private fun aPiece(): erp.core.models.Product {
        val products = Book.shared.products
        products.need()
        repeat(60) {
            if (products.items.value.isNotEmpty()) return@repeat
            Thread.sleep(25)
            shadowOf(Looper.getMainLooper()).idle()
        }
        return products.items.value.first()
    }

    @Test fun stock_piece_tag() {
        val p = aPiece()
        show { CompositionLocalProvider(LocalNavigator provides noNavigator) { StockPieceTagSheet(p, onDismiss = {}) } }
        shootWindow("stock-piece-tag")
    }

    @Test fun stock_tag_job() {
        val p = aPiece()
        show { CompositionLocalProvider(LocalNavigator provides noNavigator) { TagPrintJobSheet(listOf(p), onDismiss = {}) } }
        shootWindow("stock-tag-job")
    }
}
