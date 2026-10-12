package erp.app.screens.repairs

import erp.app.ui.ShopDate
import erp.app.ui.toWhatsAppNumber
import erp.core.ERPDate
import erp.core.logic.OrderTiming
import erp.core.logic.isWalkInName
import erp.core.logic.orderTiming
import erp.core.logic.repairBalance
import erp.core.logic.repairPaid
import erp.core.logic.repairSummary
import erp.core.logic.repairTotal
import erp.core.models.Order
import erp.core.models.Repair
import erp.core.models.RepairPayment
import erp.core.models.RepairStatus
import java.time.Instant
import java.util.Locale

/** One status on the list: In the shop, Ready, Collected, Cancelled. */
class RepairsGroup(
    val id: String,
    val title: String,
    val rows: List<Repair>,
    /** Collected and Cancelled are history, not work: they fold away. */
    val folded: Boolean,
)

/** A repair to open as a sheet: its id, and the ticket itself when it was only just written (the shelf brings it back within a second). */
data class RepairsOpen(val id: String, val seed: Repair? = null)

/**
 * What the Repairs screens share (src/app/repairs/page.tsx, src/lib/repairs.ts): a ticket's sums (core's
 * `repairTotal` / `repairPaid` / `repairBalance` / `repairSummary`), its words, how the list groups it, and the
 * messages and payloads. Pure Kotlin, tested on the JVM (RepairsLogicTests, DemoRepairsTests).
 */
object RepairsKit {
    // MARK: Words

    /** REPAIR_STATUS_LABELS. */
    fun label(s: RepairStatus): String = when (s) {
        RepairStatus.received -> "In the shop"
        RepairStatus.ready -> "Ready"
        RepairStatus.collected -> "Collected"
        RepairStatus.cancelled -> "Cancelled"
        else -> s.rawValue.ifEmpty { "No status" }
    }

    /** The web's STATUS_TONE (warning, success, quiet, destructive) in the kit's tones; a cancelled ticket says nothing, as a cancelled order does. */
    fun tone(s: RepairStatus): erp.app.ui.Tone = when (s) {
        RepairStatus.received -> erp.app.ui.Tone.owed
        RepairStatus.ready -> erp.app.ui.Tone.settled
        else -> erp.app.ui.Tone.quiet
    }

    /** Who it is for: a ticket with no name, or the old "Walk-in Customer", is a walk-in. */
    fun customer(r: Repair): String {
        val n = r.customerName.trim()
        return if (n.isEmpty() || isWalkInName(n)) "Walk-in" else n
    }

    fun trimmed(s: String): String = s.trim()

    fun filled(s: String?): String? = (s ?: "").trim().ifEmpty { null }

    /** A day the way the shop says it, mid-sentence: "ready by tomorrow", "ready by Sat 10 Oct". */
    fun byDay(iso: String?, now: Instant = Instant.now()): String {
        val s = ShopDate.say(iso, now = now)
        return if (s == "Today" || s == "Tomorrow" || s == "Yesterday") s.lowercase(Locale.ROOT) else s
    }

    /** "12.5 g": up to three decimals, none trailing. */
    fun grams(w: Double): String {
        var s = String.format(Locale.US, "%.3f", w)
        while (s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return "$s g"
    }

    /** A figure back in the form's box: up to `decimals` places, none trailing; nothing or 0 is blank (sale-flow fields show 0 as blank). */
    fun typed(v: Double?, decimals: Int): String {
        if (v == null || v <= 0) return ""
        var s = String.format(Locale.US, "%.${decimals}f", v)
        while (s.contains('.') && s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return s
    }

    /** "Today · Cash · Advance": a payment taken on a ticket, in a line. */
    fun paymentWords(p: RepairPayment, now: Instant = Instant.now()): String =
        listOf(ShopDate.say(p.date, now = now), p.method?.rawValue ?: "", p.note ?: "").filter { it.isNotEmpty() }.joinToString(" · ")

    /** Karachi's day, `n` days on from now (the form's quick dates), as "yyyy-MM-dd". */
    fun day(adding: Int, from: Instant = Instant.now()): String = ERPDate.karachiDay(from.plusSeconds(adding * 86_400L))

    // MARK: Promised dates

    /**
     * The web's `daysLate` for a repair still in the shop: the same rule an order in progress is timed by. A ticket with no
     * promised date, or one that has left the shop, has no timing (null), as on the web.
     */
    fun timing(r: Repair, now: Instant): OrderTiming? {
        val promised = filled(r.promisedDate)
        if (r.status != RepairStatus.received || promised == null) return null
        val fields = mapOf("id" to r.id, "createdAt" to r.receivedAt, "status" to "In Progress", "promisedDate" to promised)
        return orderTiming(Order.fromMap(fields), now)
    }

    // MARK: The list

    /** The web's search: REP number, name, phone, karigar, or any piece or work on the ticket. [q] is trimmed and lower-cased already. */
    fun matches(r: Repair, q: String): Boolean {
        val fields = ArrayList<String>()
        fields.add(r.id); fields.add(r.customerName); fields.add(r.customerContact ?: ""); fields.add(r.karigarName ?: "")
        for (p in r.pieces) { fields.add(p.item); fields.add(p.work) }
        for (f in fields) if (f.lowercase(Locale.ROOT).contains(q)) return true
        // A number typed with its spaces or dashes still finds the customer.
        val digits = onlyDigits(q)
        val typedANumber = q.all { it in '0'..'9' || it == ' ' || it == '-' || it == '+' }
        if (digits.length >= 3 && typedANumber) return onlyDigits(r.customerContact ?: "").contains(digits)
        return false
    }

    private fun onlyDigits(s: String): String = s.filter { it in '0'..'9' }

    /** Still in the shop: by the day promised (undated last). The rest: the latest thing that happened first. */
    fun groups(repairs: List<Repair>): List<RepairsGroup> {
        val inShop = ArrayList<Repair>(); val ready = ArrayList<Repair>(); val collected = ArrayList<Repair>()
        val cancelled = ArrayList<Repair>(); val other = ArrayList<Repair>()
        for (r in repairs) {
            when (r.status) {
                RepairStatus.received -> inShop.add(r)
                RepairStatus.ready -> ready.add(r)
                RepairStatus.collected -> collected.add(r)
                RepairStatus.cancelled -> cancelled.add(r)
                else -> other.add(r)
            }
        }
        val out = ArrayList<RepairsGroup>()
        if (inShop.isNotEmpty()) out.add(RepairsGroup("received", "In the shop", inShop.sortedWith(::promisedSooner), false))
        if (ready.isNotEmpty()) out.add(RepairsGroup("ready", "Ready", ready.sortedWith(::latestFirst), false))
        if (collected.isNotEmpty()) out.add(RepairsGroup("collected", "Collected", collected.sortedWith(::latestFirst), true))
        if (cancelled.isNotEmpty()) out.add(RepairsGroup("cancelled", "Cancelled", cancelled.sortedWith(::latestFirst), true))
        if (other.isNotEmpty()) out.add(RepairsGroup("other", "Other", other.sortedWith(::latestFirst), true))
        return out
    }

    // Swift compares Strings by their unicode scalars, as these ISO texts compare here.
    private fun promisedSooner(a: Repair, b: Repair): Int {
        val pa = filled(a.promisedDate) ?: "9999"
        val pb = filled(b.promisedDate) ?: "9999"
        if (pa != pb) return pa.compareTo(pb)
        if (a.receivedAt != b.receivedAt) return b.receivedAt.compareTo(a.receivedAt)
        return b.id.compareTo(a.id)
    }

    private fun latestFirst(a: Repair, b: Repair): Int {
        val la = latest(a)
        val lb = latest(b)
        if (la != lb) return lb.compareTo(la)
        return b.id.compareTo(a.id)
    }

    private fun latest(r: Repair): String = filled(r.collectedAt) ?: filled(r.readyAt) ?: filled(r.receivedAt) ?: ""

    // MARK: What a ticket still allows

    /** Ready, Collected, Take payment: the buttons under a ticket. Cancelled owes nothing to take. */
    fun hasActions(r: Repair): Boolean {
        if (r.status == RepairStatus.received || r.status == RepairStatus.ready) return true
        return r.status != RepairStatus.cancelled && repairBalance(r) > 0
    }

    // MARK: Phones and WhatsApp

    /** utils.ts `normalizePhoneNumber` (core has no Phones port yet): +92 for a Pakistani number, a "+" number as typed. */
    // TODO(shared): replace with core's normalizePhoneNumber when Phones.swift is ported to core.
    fun normalizePhone(phone: String?): String {
        if (phone.isNullOrEmpty()) return ""
        val clean = phone.filter { !it.isWhitespace() && it != '-' && it != '(' && it != ')' && it != '.' }
        if (clean.startsWith("+")) return clean
        if (clean.startsWith("0") && clean.length >= 10) return "+92" + clean.drop(1)
        if (clean.startsWith("92") && clean.length >= 12) return "+$clean"
        return phone
    }

    /** What can be dialled: digits, and a leading "+"; null when there are none. */
    fun callUri(phone: String?): String? {
        val out = StringBuilder()
        for (ch in (phone ?: "").trim()) {
            if (ch == '+' && out.isEmpty()) out.append(ch) else if (ch in '0'..'9') out.append(ch)
        }
        return if (out.isEmpty()) null else "tel:$out"
    }

    /** The page's "Tell them" message, word for word. [shopName] is the shop's own (session.shop.name), since the customer reads it. */
    fun readyMessage(r: Repair, shopName: String): String {
        var greeting = "Assalam o Alaikum"
        filled(r.customerName)?.let { if (!isWalkInName(it)) greeting += " $it" }
        val what = if (r.pieces.size == 1) "your ${r.pieces[0].item.lowercase(Locale.ROOT)} is" else "your ${r.pieces.size} pieces are"
        var text = "$greeting, $what ready for collection at $shopName (repair ${r.id})."
        val owing = repairBalance(r)
        if (owing > 0) text += " Balance: ${erp.core.logic.Money.pkr(owing)}."
        return "$text Please bring your receipt."
    }

    /** wa.me with the message, for a ticket that is Ready and has a number. */
    fun whatsAppUrl(r: Repair, shopName: String): String? {
        val number = toWhatsAppNumber(r.customerContact)
        if (number.isEmpty()) return null
        return "https://wa.me/$number?text=" + encodeComponent(readyMessage(r, shopName))
    }

    /** JavaScript's `encodeURIComponent`: these stay as they are. */
    fun encodeComponent(s: String): String {
        val keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()"
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in keep) out.append(c) else out.append('%').append(String.format(Locale.US, "%02X", b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** The ERP's own page for a ticket (it opens the ticket; the card under it has Print). */
    fun webPath(id: String): String = "/repairs?id=${urlQuery(id)}&web=1"

    // `.urlQueryAllowed`: query characters stay, everything else (space, #, %, non-ASCII) is escaped.
    private fun urlQuery(s: String): String {
        val keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~!$&'()*+,;=:@/?"
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in keep && b >= 0) out.append(c) else out.append('%').append(String.format(Locale.US, "%02X", b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** A value in a path's query ("/repairs?id=REP-000012"), decoded; null when absent. */
    fun query(name: String, path: String): String? {
        if (!path.contains('?')) return null
        for (part in path.substringAfter('?').substringBefore('#').split('&')) {
            if (part.isEmpty()) continue
            val key = part.substringBefore('=')
            if (key == name) return erp.app.nav.ScreenRoute.percentDecode(part.substringAfter('=', ""))
        }
        return null
    }
}
