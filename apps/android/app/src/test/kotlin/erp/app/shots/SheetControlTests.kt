package erp.app.shots

import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import erp.app.ErpApp
import erp.app.screens.money.ExpenseFormSheet
import erp.app.ui.PaymentEntry
import erp.app.ui.PaymentSheet
import kotlin.test.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Take payment's controls, tapped and typed on the real sheet: the chip chosen is the method sent. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class SheetControlTests(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return listOf(arrayOf<Any>(ShotConfigs.all[0]))
        }
    }

    private fun tap(text: String) { compose.onNodeWithText(text).performClick(); settle(300) }
    private fun type(label: String, value: String) {
        compose.onNode(hasSetTextAction() and hasText(label)).performTextReplacement(value)
        settle(200)
    }

    @Test fun takePaymentMethodChipsAndAmountAreWhatIsSent() {
        var sent: PaymentEntry? = null
        show { PaymentSheet("Take payment", onDismiss = {}, onSave = { sent = it }, owed = 5000.0) }
        compose.onNodeWithText("Cash").assertIsSelected()
        for (m in listOf("Card", "Bank Transfer", "Cheque", "Cash")) {
            tap(m)
            compose.onNodeWithText(m).assertIsSelected()
        }
        tap("Cheque")
        type("Cheque no.", "123456")
        type("Amount in rupees", "2500")
        tap("Save")
        assertEquals(2500.0, sent!!.amount)
        assertEquals("Cheque", sent!!.method)
        assertEquals("123456", sent!!.reference)
    }

    @Test fun allThatsOwedFillsTheAmountAndCashDropsAReference() {
        var sent: PaymentEntry? = null
        show { PaymentSheet("Take payment", onDismiss = {}, onSave = { sent = it }, owed = 5000.0) }
        tap("Card")
        type("Last 4 digits", "4242")
        tap("Cash")
        tap("All that's owed: PKR 5,000")
        tap("Save")
        assertEquals(5000.0, sent!!.amount)
        assertEquals("Cash", sent!!.method)
        assertEquals("", sent!!.reference)
    }

    @Test fun expensePaidByIsOneOfTheSegmentsAndFollowsTheTap() {
        show { ExpenseFormSheet(null, listOf("Rent"), partnership = true, onDismiss = {}, onSaved = {}) }
        compose.onNodeWithText("Business cash").assertIsOn()
        tap("Ammar")
        compose.onNodeWithText("Ammar").assertIsOn()
        compose.onNodeWithText("Business cash").assertIsOff()
        tap("Mina")
        compose.onNodeWithText("Mina").assertIsOn()
        compose.onNodeWithText("Ammar").assertIsOff()
        tap("Business cash")
        compose.onNodeWithText("Business cash").assertIsOn()
    }
}
