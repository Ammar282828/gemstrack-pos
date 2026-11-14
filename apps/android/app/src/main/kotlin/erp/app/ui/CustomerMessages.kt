package erp.app.ui


import erp.core.logic.Money
import erp.core.logic.OrderStage
import erp.core.logic.isWalkInName
import erp.core.logic.repairBalance
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong

/**
 * The words the Contact control's WhatsApp and Message open with (owner, 2026-11-14: "have pre-created messages … if an
 * order is done and I press the message on WhatsApp … your order is ready at Taheri, please collect it, or something
 * professional"). The web's `lib/customer-messages.ts`, word for word: one message per moment of an order, invoice or
 * repair, typed and ready to change or send. Nothing is sent by itself.
 */
object CustomerMessages {
    /** "Assalam o Alaikum Sana," — the name only for a named customer, never "Walk-in Customer". */
    private fun greet(name: String?): String {
        val n = name?.trim().orEmpty()
        return "Assalam o Alaikum" + (if (n.isEmpty() || isWalkInName(n)) "" else " $n") + ","
    }

    /** Whole rupees owed; 0 when nothing (under a rupee is settled). */
    private fun owes(n: Double): Double = if (n >= 1) n.roundToLong().toDouble() else 0.0

    private val day = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.UK)
    private fun promised(ymd: String?): String =
        runCatching { LocalDate.parse(ymd!!.take(10)).format(day) }.getOrDefault("")

    /** An order's message for where it stands. `balance`: what is still to pay (on its invoice once invoiced). */
    fun order(o: Order, stage: OrderStage, balance: Double, shop: String): String {
        val hi = greet(o.customerName)
        val due = owes(balance)
        return when (stage) {
            OrderStage.ready -> "$hi your order ${o.id} is ready at $shop. Please collect it at your convenience." +
                (if (due > 0) " The balance is ${Money.pkr(due)}." else "") + " Thank you."
            OrderStage.new, OrderStage.karigar -> {
                val by = promised(o.promisedDate)
                "$hi thank you for your order with $shop. Your order ${o.id} is being made" +
                    (if (by.isEmpty()) "" else " and is expected to be ready by $by") + ". We will let you know as soon as it is ready."
            }
            OrderStage.transfer -> "$hi thank you for your order ${o.id} with $shop. We will confirm it as soon as your transfer reaches us."
            OrderStage.payment -> "$hi a gentle reminder from $shop: ${Money.pkr(due)} is still to be paid on your order ${o.id}. Thank you."
            OrderStage.done -> "$hi thank you for choosing $shop. We hope you enjoy your jewellery, and look forward to seeing you again."
            OrderStage.closed -> ""
        }
    }

    /** An invoice's message: a gentle reminder while money is owed, thanks once it is paid. */
    fun invoice(i: Invoice, shop: String): String {
        val hi = greet(i.customerName)
        val due = owes(i.balanceDue)
        return if (due > 0) "$hi a gentle reminder from $shop: ${Money.pkr(due)} is still to be paid on your invoice ${i.id}. Thank you."
        else "$hi thank you for choosing $shop. We hope you enjoy your jewellery, and look forward to seeing you again."
    }

    /** A repair ticket's message; `status` as the screen has it (a change just made counts). */
    fun repair(r: Repair, status: RepairStatus, shop: String): String {
        val hi = greet(r.customerName)
        val one = r.pieces.size == 1
        val what = if (one) "your " + r.pieces[0].item.lowercase() else if (r.pieces.isEmpty()) "your pieces" else "your ${r.pieces.size} pieces"
        val due = owes(repairBalance(r))
        return when (status.rawValue) {
            "ready" -> "$hi $what ${if (one) "is" else "are"} ready for collection at $shop (repair ${r.id})." +
                (if (due > 0) " Balance: ${Money.pkr(due)}." else "") + " Please bring your receipt."
            "collected" -> "$hi thank you for choosing $shop. We hope you are happy with the work."
            "cancelled" -> ""
            else -> "$hi we have received $what for repair at $shop (repair ${r.id}). We will let you know as soon as ${if (one) "it is" else "they are"} ready."
        }
    }
}
