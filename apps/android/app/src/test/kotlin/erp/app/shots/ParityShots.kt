package erp.app.shots

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import erp.app.screens.settings.BookPreview
import erp.app.screens.settings.TaheriBookImportPage
import erp.app.screens.settings.WebsitePricing
import erp.app.screens.settings.WebsiteSellingConfig
import erp.app.screens.settings.WebsiteSellingForm
import erp.app.screens.workshop.WorkshopJob
import erp.app.screens.workshop.WorkshopPieceAsk
import erp.app.screens.workshop.WorkshopPieceDetailsSheet
import erp.app.ui.ReadableColumn
import erp.app.ui.UpdateNotice
import erp.core.Json
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The screens that brought Android level with the iPhone on 2026-10-25: the Workshop's piece Details sheet (an order's
 * piece and a sold one), Selling on the website, the Taheri Software book import, and the update line. Made-up figures only.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class ParityShots(config: ShotConfig) : ShotBase(config) {
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

    private fun piece(source: WorkshopJob.Source, id: String, orderId: String? = null, invoiceId: String? = null) = WorkshopJob(
        id = id, source = source, karigarId = "K1", karigarName = "Ustad Demo", description = "Demo solitaire ring",
        status = WorkshopJob.Status.pending, assignedDate = "2026-10-01T00:00:00.000Z", ageDays = 11, urgency = WorkshopJob.Urgency.ok,
        sortTime = 0.0, orderId = orderId, invoiceId = invoiceId, itemIndex = 0, size = "12", weightG = 4.25,
        referenceSku = "RNG-0001", notes = "Rhodium plating, set the stone last.",
    )

    @Test fun workshop_piece_details_order() {
        onlyTaheri()
        val ask = WorkshopPieceAsk(piece(WorkshopJob.Source.order, "order:O1:0", orderId = "O1"), WorkshopPieceAsk.Target.Order("O1", 0))
        show { WorkshopPieceDetailsSheet(ask) {} }
        shoot("workshop-piece-details-order")
    }

    @Test fun workshop_piece_details_sold_piece() {
        onlyTaheri()
        val ask = WorkshopPieceAsk(piece(WorkshopJob.Source.invoice, "invoice:I1:0", invoiceId = "I1"), WorkshopPieceAsk.Target.Invoice("I1", 0))
        show { WorkshopPieceDetailsSheet(ask) {} }
        shoot("workshop-piece-details-sold")
    }

    private val selling = WebsiteSellingConfig(
        enabled = true,
        defaultPricing = WebsitePricing("21k", 3.0, 900.0, 0.0),
        categoryPricing = mapOf(
            "Rings" to WebsitePricing("18k", null, 1100.0, 500.0),
            "Bangles" to WebsitePricing(null, 2.5, null, null),
        ),
        diamondPolicy = "gold_only", diamondChargesDefault = 20_000.0, palladiumKarat = "18k", deliveryCharge = 300.0,
        freeDeliveryOver = 150_000.0, maxRateAgeHours = null, posCategoryId = "cat001", updatedAt = "2026-10-20T08:00:00.000Z",
    )

    @Test fun settings_website_selling() {
        onlyTaheri()
        show { column { WebsiteSellingForm(selling) } }
        shoot("settings-website-selling")
    }

    @Test fun settings_website_selling_not_ready() {
        onlyTaheri()
        show { column { WebsiteSellingForm(WebsiteSellingConfig()) } }
        shoot("settings-website-selling-empty")
    }

    private val book = BookPreview(
        Json.parse(
            """{"source":"Demo book","inFile":{"customers":120,"karigars":9},
            "counts":{"customersNew":80,"customersSettled":30,"customersConflict":2,"karigarsNew":5,"karigarsSettled":3,"karigarsConflict":1},
            "halfMatches":[{"id":"h1","kind":"customer","name":"Amina Example","verdict":"same_name","matches":["Amina E."],"carried":3},
                           {"id":"h2","kind":"karigar","name":"Bilal Example","verdict":"same_phone","matches":["Bilal"],"carried":1}],
            "willAdd":{"only":85,"withHalfMatches":88},"fingerprint":"fp-1"}""",
        ) as Map<*, *>,
    )

    @Test fun settings_taheri_book_import() {
        onlyTaheri()
        show { column { TaheriBookImportPage(book) } }
        shoot("settings-taheri-book-import")
    }

    @Test fun settings_taheri_book_imported() {
        onlyTaheri()
        show { column { TaheriBookImportPage(book, initialDone = 85 to 6) } }
        shoot("settings-taheri-book-imported")
    }

    @Test fun update_line() {
        onlyTaheri()
        show { column { Column { UpdateNotice() } } }
        shoot("update-line")
    }
}
