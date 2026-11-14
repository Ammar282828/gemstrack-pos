package erp.app.shots

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.onAllNodesWithText
import erp.app.config.House
import erp.app.screens.neworder.NewOrderPhoneStore
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import erp.app.ErpApp
import erp.app.screens.neworder.DraftHolder
import erp.app.screens.neworder.PieceEditor
import erp.app.screens.sale.SaleLineEditor
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.SaleLine
import erp.core.logic.PricingRates
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Taps and typing on the entry forms' controls, on the real screens: what is tapped is what shows, and what the draft (or the
 * line sent) holds. The forms keep their fields in plain mutable objects, so a control that is handed one of them and not told
 * of the change keeps drawing the old answer: each control below is driven the way a person does and read back both ways.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class FormControlTests(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return listOf(arrayOf<Any>(ShotConfigs.all[0]))
        }
    }

    private fun tap(text: String) { compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick); settle(500) }
    private fun type(label: String, value: String) {
        compose.onNode(hasSetTextAction() and (hasContentDescription(label) or hasText(label))).performTextReplacement(value)
        settle(200)
    }
    private fun on(text: String) { compose.onNodeWithText(text).assertIsOn() }
    private fun off(text: String) { compose.onNodeWithText(text).assertIsOff() }
    /** A menu row: open it by its "<title>, <shown>" label, then take the option. */
    private fun pick(title: String, shown: String, option: String) {
        compose.onNodeWithContentDescription("$title, $shown").performSemanticsAction(SemanticsActions.OnClick); settle(500)
        compose.onNodeWithText(option).performSemanticsAction(SemanticsActions.OnClick); settle(500)
    }

    /** A row of the sale's own kit: open it by its label, then take the option. */
    private fun pickText(label: String, option: String) {
        compose.onNodeWithText(label).performSemanticsAction(SemanticsActions.OnClick); settle(500)
        compose.onNodeWithText(option).performSemanticsAction(SemanticsActions.OnClick); settle(500)
    }

    // New order / Edit order: the piece editor

    private fun pieceEditor(piece: NewOrderPieceDraft, editing: Boolean = false): DraftHolder {
        val holder = DraftHolder(NewOrderDraft.fresh().also { it.pieces.add(piece) })
        show { PieceEditor(holder, piece.id, null, emptyList(), editing, {}, {}, {}) }
        return holder
    }

    @Test fun pieceEditorWastageChips() {
        val piece = NewOrderPieceDraft(metal = "gold", wastage = "10")
        val holder = pieceEditor(piece)
        on("10%")
        tap("15%")
        assertEquals("15", holder.now.pieces[0].wastage)
        on("15%")
        off("10%")
        tap("12%")
        assertEquals("12", holder.now.pieces[0].wastage)
        on("12%")
        tap("25%")
        on("25%")
        assertEquals("25", holder.now.pieces[0].wastage)
    }

    @Test fun pieceEditorWastageOther() {
        val piece = NewOrderPieceDraft(metal = "gold", wastage = "10")
        val holder = pieceEditor(piece)
        tap("Other")
        on("Other")
        type("Wastage (%)", "13")
        assertEquals("13", holder.now.pieces[0].wastage)
        on("Other")
        tap("25%")
        assertEquals("25", holder.now.pieces[0].wastage)
        on("25%")
    }

    @Test fun pieceEditorOpensOnAnOddWastageAsOther() {
        // An order on file at 13% (Edit order): Other is chosen and the box holds the figure.
        val piece = NewOrderPieceDraft(metal = "gold", wastage = "13")
        pieceEditor(piece, editing = true)
        on("Other")
        compose.onNodeWithContentDescription("Wastage (%)").assertExists()
    }

    @Test fun pieceEditorGoldControls() {
        val piece = NewOrderPieceDraft(metal = "gold", karat = "21k", hasStones = false)
        val holder = pieceEditor(piece, editing = true)
        val p = { holder.now.pieces[0] }
        // karat
        on("21K")
        tap("18K")
        on("18K"); off("21K")
        assertEquals("18k", p().karat)
        // how it is priced
        tap("Fixed price")
        on("Fixed price")
        assertTrue(p().manual)
        type("Price (PKR)", "5000")
        assertEquals("5000", p().manualPrice)
        tap("Weight × rate")
        on("Weight × rate")
        assertEquals(false, p().manual)
        // typed numbers
        type("Weight", "5.5"); assertEquals("5.5", p().weight)
        type("Making (PKR)", "1500"); assertEquals("1500", p().making)
        type("Stones (PKR)", "200"); assertEquals("200", p().stones)
        // switches reveal their boxes
        off("Has diamonds")
        tap("Has diamonds")
        on("Has diamonds")
        assertTrue(p().hasDiamonds)
        type("Diamonds (PKR)", "9000"); assertEquals("9000", p().diamond)
        tap("Has diamonds")
        off("Has diamonds")
        assertEquals(false, p().hasDiamonds)
        off("Add stone details")
        tap("Add stone details")
        on("Add stone details")
        assertTrue(p().hasStones)
        type("Stone weight", "0.5"); assertEquals("0.5", p().stoneWeight)
        tap("Add stone details")
        off("Add stone details")
        // the workshop and references
        off("Piece is finished")
        tap("Piece is finished")
        on("Piece is finished")
        assertTrue(p().isCompleted)
        off("Customer provided a physical sample")
        tap("Customer provided a physical sample")
        on("Customer provided a physical sample")
        assertTrue(p().sampleGiven)
        // a wastage chosen, then the weight typed after it: both stay
        tap("15%")
        type("Weight", "7")
        assertEquals("15", p().wastage)
        assertEquals("7", p().weight)
        on("15%")
    }

    @Test fun pieceEditorPickers() {
        val piece = NewOrderPieceDraft(metal = "gold", karat = "21k")
        val holder = pieceEditor(piece)
        val p = { holder.now.pieces[0] }
        pick("Metal", "Gold", "925 Sterling Silver")
        assertEquals("silver", p().metal)
        compose.onNodeWithContentDescription("Metal, 925 Sterling Silver").assertExists()
        // silver: plating and nickel free
        pick("Plating", "No plating", "White Rhodium")
        assertEquals("White Rhodium", p().platingType)
        off("Nickel free")
        tap("Nickel free")
        on("Nickel free")
        assertTrue(p().nickelFree)
        val cat = erp.core.entry.NewOrderWords.categories.first()
        pick("Category", "None", cat.label)
        assertEquals(cat.id, p().category)
    }

    // New sale: the sale line editor

    private val rates = PricingRates(goldRatePerGram21k = 20000.0, silverRatePerGram = 300.0)

    private fun lineEditor(metal: String = "gold"): () -> SaleLine? {
        var applied: SaleLine? = null
        val line = SaleLine.blankFor(metal, "X-1")
        show { SaleLineEditor(line, rates, { applied = it }, {}, create = true) }
        type("Item name", "Ring")
        return { applied }
    }

    @Test fun saleLineWastageChips() {
        val applied = lineEditor()
        on("10%")
        tap("15%")
        on("15%"); off("10%")
        tap("12%")
        on("12%")
        tap("Other")
        on("Other")
        type("Wastage (%)", "13")
        on("Other")
        tap("Add to bill")
        assertEquals(13.0, applied()!!.wastagePercentage)
    }

    @Test fun saleLineWastageChipSent() {
        val applied = lineEditor()
        tap("25%")
        on("25%")
        tap("Add to bill")
        assertEquals(25.0, applied()!!.wastagePercentage)
    }

    @Test fun saleLineControls() {
        val applied = lineEditor()
        tap("Fixed price")
        on("Fixed price")
        type("Price (PKR)", "7000")
        tap("Weight × rate")
        on("Weight × rate")
        type("Weight (g)", "4.2")
        type("Making (PKR)", "800")
        type("Stones (PKR)", "100")
        type("Misc (PKR)", "50")
        off("Has diamonds")
        tap("Has diamonds")
        on("Has diamonds")
        type("Diamonds (PKR)", "3000")
        off("Add stone details")
        tap("Add stone details")
        on("Add stone details")
        type("Stone weight (g)", "0.3")
        pickText("Karat", "18K")
        tap("Add to bill")
        val l = applied()!!
        assertEquals(4.2, l.metalWeightG)
        assertEquals(800.0, l.makingCharges)
        assertEquals(100.0, l.stoneCharges)
        assertEquals(50.0, l.miscCharges)
        assertEquals(3000.0, l.diamondCharges)
        assertEquals(0.3, l.stoneWeightG)
        assertTrue(l.hasDiamonds && l.hasStones)
        assertEquals("18k", l.karat)
        assertEquals(false, l.isCustomPrice)
    }

    @Test fun saleLineSilverControls() {
        val applied = lineEditor("silver")
        type("Weight (g)", "10")
        type("Rate per gram (PKR)", "310")
        tap("25%")
        on("25%")
        off("Nickel free")
        tap("Nickel free")
        on("Nickel free")
        tap("Add to bill")
        val l = applied()!!
        assertEquals(310.0, l.silverRatePerGram)
        assertEquals(25.0, l.wastagePercentage)
        assertTrue(l.nickelFree)
    }

    private fun step(name: String) { compose.onAllNodesWithText(name)[0].performSemanticsAction(SemanticsActions.OnClick); settle(600) }
    private fun field(label: String) = compose.onNode(hasSetTextAction() and hasContentDescription(label))

    /** The whole New order screen: typed figures stay through Save product, another piece and the other steps, and are on the phone's copy. */
    @Test fun newOrderKeepsTypedFiguresBetweenPiecesAndSteps() {
        NewOrderPhoneStore.clear(House.id)
        showPlace("/orders/add")
        step("Pieces")
        tap("Add a piece")
        tap("15%")
        type("Weight", "5.5")
        type("Making (PKR)", "1200")
        tap("Save product")
        tap("Add a piece")
        tap("25%")
        type("Weight", "8")
        tap("Save product")
        step("Payment")
        step("Pieces")
        // the first piece, reopened
        tap("#1")
        on("15%")
        field("Weight").assert(hasText("5.5"))
        field("Making (PKR)").assert(hasText("1200"))
        tap("Save product")
        tap("#2")
        on("25%")
        field("Weight").assert(hasText("8"))
        tap("Save product")
        // what the phone kept
        settle(1000)
        val kept = NewOrderPhoneStore.load(House.id)!!
        assertEquals(listOf("15", "25"), kept.pieces.map { it.wastage })
        assertEquals(listOf("5.5", "8"), kept.pieces.map { it.weight })
        assertEquals("1200", kept.pieces[0].making)
    }
}
