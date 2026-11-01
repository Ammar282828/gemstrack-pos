package erp.app.shots

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AColor
import android.graphics.Paint
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import erp.app.screens.invoices.WhatsAppOrderPill
import erp.app.screens.neworder.DraftHolder
import erp.app.screens.neworder.SampleField
import erp.app.screens.orders.OrderPieceRow
import erp.app.screens.orders.PhotoViewerContent
import erp.app.ui.ReadableColumn
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderExtraPhoto
import erp.core.entry.NewOrderPieceDraft
import erp.core.logic.PhotoSource
import erp.core.models.Invoice
import erp.core.models.OrderItem
import java.io.ByteArrayOutputStream
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Android column of the 2026-10-30 parity rows: a piece's several reference photos (its row with "+n", the editor's row of tiles, the full-screen
 * viewer) and the order WhatsApp chip on an invoice. The pictures are plain colour swatches made here; nothing is a real customer's.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class PhotoShots(config: ShotConfig) : ShotBase(config) {
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

    @Composable private fun column(content: @Composable () -> Unit) =
        CompositionLocalProvider(LocalNavigator provides noNavigator) { ReadableColumn(maxWidth = 720.dp, content = content) }

    /** A 300 x 400 picture of one colour with a lighter disc in it, as PNG bytes. */
    private fun swatch(color: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(300, 400, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(color)
        canvas.drawCircle(150f, 200f, 90f, Paint().apply { this.color = AColor.argb(110, 255, 255, 255); isAntiAlias = true })
        return ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
    }

    private fun dataUri(bytes: ByteArray) = "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(bytes)

    private val colors = listOf(0xFF8A6B42.toInt(), 0xFF3D5A80.toInt(), 0xFF6B8F71.toInt(), 0xFFA23B72.toInt())

    private val sources: List<PhotoSource> get() = colors.mapIndexed { i, c -> PhotoSource("s$i", data = swatch(c)) }

    @Test fun order_piece_with_several_photos() {
        onlyTaheri()
        val item = OrderItem.fromMap(
            mapOf(
                "description" to "Demo solitaire ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 4.25, "totalEstimate" to 185_000.0,
                "sampleImageDataUri" to dataUri(swatch(colors[0])),
                "extraPhotos" to colors.drop(1).map { mapOf("dataUri" to dataUri(swatch(it))) },
            ),
        )
        show { column { OrderPieceRow(0, item, karigar = "Ustad Demo", canTick = true, busy = false, showBreakdown = true, onTick = {}, modifier = Modifier.padding(16.dp)) } }
        shoot("order-piece-photos")
    }

    @Test fun order_editor_photo_row() {
        onlyTaheri()
        EntryHouse.id = "taheri"
        val piece = NewOrderPieceDraft()
        piece.description = "Demo solitaire ring"
        piece.photo = swatch(colors[0])
        piece.extras = colors.drop(1).map { NewOrderExtraPhoto(data = swatch(it)) }.toMutableList()
        val draft = NewOrderDraft.fresh()
        draft.pieces.add(piece)
        val holder = DraftHolder(draft)
        show { column { Column(Modifier.padding(16.dp)) { SampleField(holder, piece.id) } } }
        shoot("order-editor-photos")
    }

    @Test fun order_photo_viewer() {
        onlyTaheri()
        show { PhotoViewerContent(sources, "Demo solitaire ring", 1) {} }
        shoot("order-photo-viewer")
    }

    @Test fun invoice_whatsapp_chips() {
        onlyTaheri()
        val states = listOf("awaiting-confirmation", "confirmed", "declined", "awaiting-payment", "slip-received", "paid", "sent", "failed", "no-whatsapp")
        show {
            column {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (s in states) WhatsAppOrderPill(Invoice.fromMap(mapOf("id" to "INV-1", "whatsappOrder" to mapOf("state" to s, "at" to "2026-10-30T10:00:00.000Z"))))
                }
            }
        }
        shoot("invoice-whatsapp-chips")
    }
}
