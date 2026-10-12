package erp.app.screens.repairs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.ui.FailureAlert
import erp.app.ui.MoneyFeedback
import erp.app.ui.PaymentSheet
import erp.app.ui.Tone
import erp.app.ui.color
import erp.core.logic.Money
import erp.core.logic.repairBalance
import erp.core.models.Repair
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * What both the list and a repair's sheet do to a ticket: Ready, Collected, a payment, Cancel. One place for the writes
 * (setRepairStatus, recordRepairPayment: owners only, the ERP refuses anyone else), the questions they ask first, and the
 * ERP's own words when it says no.
 *
 * Collected while the ticket still owes asks first. The web's Hand back dialog always offers the balance, and lets the
 * amount go to nothing; here a ticket that owes asks "take it, or hand it back as it is", and one that owes nothing is
 * handed back at once.
 */
@Stable
class RepairsDesk(private val scope: CoroutineScope) {
    sealed interface Ask {
        val repair: Repair
        class Collect(override val repair: Repair) : Ask
        class Cancel(override val repair: Repair) : Ask
    }

    /** The question on screen, if any. */
    var asking by mutableStateOf<Ask?>(null)

    /** The ticket whose balance is being taken on the way out (Hand back). */
    var paying by mutableStateOf<Repair?>(null)

    /** The ticket a payment is being taken on (Take payment). */
    var taking by mutableStateOf<Repair?>(null)

    /** The ERP's words when a write was refused. */
    var failure by mutableStateOf<String?>(null)
    private var busy by mutableStateOf(emptySet<String>())

    /** Bumped as a payment lands, so the screen can tap for it (`MoneyFeedback`). */
    var paymentsTaken by mutableIntStateOf(0)
        private set

    /** Tickets whose balance was taken on the way out but whose status write has not landed: a retry must not charge twice. */
    private val balanceTaken = HashSet<String>()

    fun isBusy(id: String): Boolean = id in busy

    // MARK: The steps

    fun markReady(r: Repair) = setStatus(r, "ready")

    fun collect(r: Repair) {
        if (isBusy(r.id)) return
        if (repairBalance(r) > 0) asking = Ask.Collect(r) else setStatus(r, "collected")
    }

    fun askCancel(r: Repair) {
        if (!isBusy(r.id)) asking = Ask.Cancel(r)
    }

    /** "received" | "ready" | "collected" | "cancelled". */
    fun setStatus(r: Repair, status: String) {
        val id = r.id
        run(id) { ErpApi.shared.write("setRepairStatus", mapOf("repairId" to id, "status" to status)) }
    }

    // MARK: Money

    /** A payment on the ticket (an advance later on, the balance after collection). */
    suspend fun takePayment(r: Repair, amount: Double, method: String) {
        ErpApi.shared.write("recordRepairPayment", mapOf("repairId" to r.id, "amount" to amount, "method" to method))
        paymentsTaken += 1
    }

    /** The page's Hand back: the money first (noted "On collection"), then Collected. */
    suspend fun takeAndCollect(r: Repair, amount: Double, method: String) {
        if (r.id !in balanceTaken) {
            ErpApi.shared.write(
                "recordRepairPayment",
                mapOf("repairId" to r.id, "amount" to amount, "method" to method, "note" to "On collection"),
            )
            balanceTaken.add(r.id)
        }
        ErpApi.shared.write("setRepairStatus", mapOf("repairId" to r.id, "status" to "collected"))
        balanceTaken.remove(r.id)
        paymentsTaken += 1
    }

    // MARK: One write at a time per ticket

    /**
     * The shelf brings the change back within a second or so; until then the ticket stays busy, so a second tap cannot send
     * the same step twice.
     */
    private fun run(id: String, work: suspend () -> Unit) {
        if (isBusy(id)) return
        busy = busy + id
        scope.launch {
            try {
                work()
                delay(1500)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            } finally {
                busy = busy - id
            }
        }
    }
}

@Composable
fun rememberRepairsDesk(): RepairsDesk {
    // The app's own scope, as the iPhone's unstructured Task: a write already sent finishes when the screen is left.
    return remember { RepairsDesk(erp.app.ErpApp.scope) }
}

/** The questions, payment sheets and failure alert of a [RepairsDesk]. */
@Composable
fun RepairsDeskHost(desk: RepairsDesk) {
    MoneyFeedback(success = desk.paymentsTaken, failure = false)
    desk.asking?.let { ask -> RepairsAsk(desk, ask) }
    desk.paying?.let { r ->
        // Hand back: the money first, then Collected.
        PaymentSheet(
            title = "Hand back ${r.id}",
            onDismiss = { desk.paying = null },
            onSave = { entry -> desk.takeAndCollect(r, entry.amount, entry.method) },
            owed = repairBalance(r),
            askReference = false,
        )
    }
    desk.taking?.let { r ->
        val balance = repairBalance(r)
        PaymentSheet(
            title = "Payment on ${r.id}",
            onDismiss = { desk.taking = null },
            onSave = { entry -> desk.takePayment(r, entry.amount, entry.method) },
            owed = if (balance > 0) balance else null,
            askReference = false,
        )
    }
    FailureAlert(desk.failure, onDismiss = { desk.failure = null }, title = "Not changed")
}

/** The confirmation dialog: its title, message and buttons are the iPhone's. */
@Composable
private fun RepairsAsk(desk: RepairsDesk, ask: RepairsDesk.Ask) {
    val r = ask.repair
    val close = { desk.asking = null }
    val title = when (ask) {
        is RepairsDesk.Ask.Collect -> "${r.id} still owes ${Money.pkr(repairBalance(r))}"
        is RepairsDesk.Ask.Cancel -> "Cancel ${r.id}?"
    }
    val message = when (ask) {
        is RepairsDesk.Ask.Collect -> "Take it now, or hand the pieces back and leave it owing."
        is RepairsDesk.Ask.Cancel -> "Cancel keeps the record: the pieces are handed back unrepaired."
    }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                when (ask) {
                    is RepairsDesk.Ask.Collect -> {
                        TextButton(onClick = { close(); desk.paying = r }, Modifier.fillMaxWidth()) { Text("Take the balance") }
                        TextButton(onClick = { close(); desk.setStatus(r, "collected") }, Modifier.fillMaxWidth()) { Text("Hand back without it") }
                        TextButton(onClick = close, Modifier.fillMaxWidth()) { Text("Not yet") }
                    }
                    is RepairsDesk.Ask.Cancel -> {
                        TextButton(onClick = { close(); desk.setStatus(r, "cancelled") }, Modifier.fillMaxWidth()) {
                            Text("Cancel repair", color = Tone.problem.color())
                        }
                        TextButton(onClick = close, Modifier.fillMaxWidth()) { Text("Keep it", color = MaterialTheme.colorScheme.onSurface) }
                    }
                }
            }
        },
    )
}
