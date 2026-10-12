// Ported from src/app/activity-log/page.tsx and `ActivityLog` / `LOG_EVENT_TYPES` in src/lib/store.ts
// (tests: ActivityLogRulesTests): Firestore `activity_log`, everything done in the ERP, newest first,
// narrowed by the kind of event and a range of days. Days are Karachi's.
//
// And src/lib/work-drafts.ts (tests: WorkDraftsTests, from work-drafts.test.ts) — the reading side:
// what a draft's card says, when a draft is forgotten, where it opens, and what makes a valid id.
//
// Orders and sales started and not yet saved live in Firestore `drafts`, one document per unfinished form
// (decisions.md "Drafts"). The form's own values (`data`) are the form's business and are not decoded here:
// a draft with sample photos can weigh most of a megabyte, and a list of cards has no use for them.

package erp.core.logic

import erp.core.Container
import erp.core.Decodable
import erp.core.ERPDate
import erp.core.seconds
import java.time.Instant

/** One line of the log: Firestore `activity_log/<id>`. */
data class ActivityLogEntry(
    val id: String,
    /** ISO instant. */
    val timestamp: String,
    /** "invoice.create", "order.update", "rates.update"… (`LogEventType`): a kind, a dot, what was done. */
    val eventType: String,
    /** "Created new product: RIN-000001". */
    val description: String,
    /** "Product: Gold Ring | By: Murtaza". */
    val details: String,
    /** The id of the product, customer, order… */
    val entityId: String,
) {
    companion object : Decodable<ActivityLogEntry> {
        override fun fromMap(m: Map<String, Any?>): ActivityLogEntry {
            val c = Container(m)
            return ActivityLogEntry(
                id = c.string("id") ?: "",
                timestamp = c.string("timestamp", ""),
                eventType = c.string("eventType", ""),
                description = c.string("description", ""),
                details = c.string("details", ""),
                entityId = c.string("entityId", ""),
            )
        }
    }
}

object ActivityLogRules {
    /** The Event Type filter's choices (`LOG_EVENT_TYPES`). An entry is in one when its type starts with the word. */
    val eventTypes = listOf("product", "customer", "karigar", "invoice", "order", "expense", "repair", "rates")

    /** "Invoice", as the filter's menu says it. */
    fun title(type: String): String {
        if (type.isEmpty()) return type
        return type.substring(0, 1).uppercase() + type.substring(1)
    }

    /** The three events the log can undo (`REVERTABLE_EVENTS`): undoing deletes the record, so it asks for the delete code. */
    val revertable = listOf("invoice.create", "order.create", "expense.create")

    fun isRevertable(eventType: String): Boolean = revertable.contains(eventType)

    /** What undoing it does (`revertConsequences`). */
    fun consequence(eventType: String): String? = when (eventType) {
        "invoice.create" -> "All sold products will be restored to active inventory, and all ledger entries for this invoice will be permanently deleted."
        "order.create" -> "The order will be permanently deleted."
        "expense.create" -> "The expense record will be permanently deleted."
        else -> null
    }

    /** How a line is coloured (`getEventTypeColor`). */
    enum class Tone { created, updated, deleted, other }

    fun tone(eventType: String): Tone {
        if (eventType.contains("create") || eventType.contains("payment")) return Tone.created
        if (eventType.contains("update")) return Tone.updated
        if (eventType.contains("delete")) return Tone.deleted
        return Tone.other
    }

    /**
     * The log as the page lists it: the kind chosen ("All" or one of `eventTypes`, matched on the start of the
     * event's type) and the days chosen, newest first.
     *
     * The range is whole days, both ends included. The web builds it as start-of-day to start-of-day
     * (`isWithinInterval(…, { start: startOfDay(from), end: startOfDay(to) })`), which drops everything logged
     * on the last day, and with no end date everything logged today; here the last day counts in full.
     * `fromDay`/`toDay` are "yyyy-MM-dd"; no start means no range, and no end runs to `today`.
     */
    fun filter(logs: List<ActivityLogEntry>, type: String, fromDay: String?, toDay: String?, today: String): List<ActivityLogEntry> {
        val last = toDay ?: today
        // Each line's time is read once: a log runs to thousands of lines, and the sort asks for it at every step.
        val kept = mutableListOf<Pair<ActivityLogEntry, Double>>()
        for (log in logs) {
            if (type != "All" && !log.eventType.startsWith(type)) continue
            val at = JS.parseISO(log.timestamp)
            if (fromDay != null) {
                if (at == null) continue
                val day = ERPDate.karachiDay(at)
                if (day < fromDay || day > last) continue
            }
            kept.add(log to (at?.seconds ?: 0.0))
        }
        return kept.jsSorted { a, b -> b.second - a.second }.map { it.first }
    }
}

/** A month without a keystroke and a draft is clutter, not work in hand. */
const val DRAFT_MAX_AGE_DAYS = 30

/** One draft as the Drafts list shows it (`WorkDraft` less its `data`). */
data class WorkDraft(
    val id: String,
    /** "order" or "sale". */
    val kind: String,
    /** Who it is for, or "No customer yet". */
    val title: String,
    /** What is in it, in a few words. */
    val detail: String,
    /** Pieces in it. */
    val items: Int,
    /** The running total, PKR (0 when unknown). */
    val total: Double,
    /** The device it was last typed on ("iPhone", "Mac"…). */
    val device: String,
    val createdAt: String,
    val updatedAt: String,
    /** Anything too big to keep and left out (the order's sample photos, rarely). */
    val leftOut: List<String> = emptyList(),
) {
    val isOrder: Boolean get() = kind == "order"
    val isSale: Boolean get() = kind == "sale"

    companion object : Decodable<WorkDraft> {
        override fun fromMap(m: Map<String, Any?>): WorkDraft {
            val c = Container(m)
            return WorkDraft(
                id = c.string("id") ?: "",
                kind = c.string("kind", ""),
                title = c.string("title", ""),
                detail = c.string("detail", ""),
                items = c.int("items") ?: 0,
                total = c.double("total", 0.0),
                device = c.string("device", ""),
                createdAt = c.string("createdAt", ""),
                updatedAt = c.string("updatedAt", ""),
                leftOut = c.strings("leftOut"),
            )
        }
    }
}

/**
 * A draft's id as `newDraftId` makes it: its kind, the time in base 36, a few letters
 * (`DRAFT_ID_RE`, which /api/app/drafts checks before it writes or removes anything).
 */
fun isDraftId(id: String): Boolean {
    val parts = id.split("-")
    if (parts.size != 3 || !(parts[0] == "order" || parts[0] == "sale")) return false
    fun word(s: String, lengths: IntRange): Boolean = s.length in lengths && s.all { it in '0'..'9' || it in 'a'..'z' }
    return word(parts[1], 6..12) && word(parts[2], 1..8)
}

/** `encodeURIComponent`: what a query value leaves alone. */
private const val draftQuerySafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

/** Where the ERP's own form continues a draft (`draftHref`). */
fun draftHref(kind: String, id: String): String {
    val out = StringBuilder()
    for (b in id.toByteArray(Charsets.UTF_8)) {
        val c = (b.toInt() and 0xFF).toChar()
        if (b >= 0 && c in draftQuerySafe) out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
    }
    val query = out.toString()
    return if (kind == "order") "/orders/add?draft=$query" else "/invoices/new?draft=$query"
}

/** Forgotten once a month old, or when it never said when it was last typed (`isExpired`). */
fun isDraftExpired(d: WorkDraft, now: Instant): Boolean {
    val t = ERPDate.parse(d.updatedAt) ?: return true
    return now.seconds - t.seconds > DRAFT_MAX_AGE_DAYS.toDouble() * 86_400
}

data class DraftList(val live: List<WorkDraft>, val expired: List<WorkDraft>)

/** The list as the Drafts page keeps it: the live ones newest-typed first, and the expired ones apart (the web removes those as it sees them). */
fun draftList(drafts: List<WorkDraft>, now: Instant): DraftList {
    val live = mutableListOf<WorkDraft>()
    val expired = mutableListOf<WorkDraft>()
    for (d in drafts) {
        if (isDraftExpired(d, now)) expired.add(d) else live.add(d)
    }
    // ISO instants sort as text; newest last-typed first, as the web sorts (`updatedAt`, descending).
    val sorted = live.jsSorted { a, b ->
        if (a.updatedAt == b.updatedAt) 0.0 else (if (a.updatedAt > b.updatedAt) -1.0 else 1.0)
    }
    return DraftList(sorted, expired)
}

/** "Ruby ring, Bangles +1" — the first two pieces by name, the rest counted. */
private fun draftNames(names: List<String>): String =
    names.take(2).joinToString(", ") + (if (names.size > 2) " +${names.size - 2}" else "")

/** An order draft's second line (`summarizeOrder`): the pieces by what they are, then the advance. `names` are the pieces' words (blank ones left out by the caller); `pieces` is how many there are. */
fun draftOrderDetail(names: List<String>, pieces: Int, advance: Double): String {
    val parts = mutableListOf<String>()
    if (names.isNotEmpty()) {
        parts.add(draftNames(names))
    } else {
        parts.add(if (pieces > 0) "$pieces piece${if (pieces == 1) "" else "s"}" else "No pieces yet")
    }
    if (advance > 0) parts.add("advance ${Money.pkr(advance)}")
    return parts.joinToString(" · ")
}

/** A sale draft's second line (`summarizeSale`): the pieces in the cart, then the discount. */
fun draftSaleDetail(names: List<String>, discount: Double): String {
    val parts = mutableListOf<String>()
    parts.add(if (names.isEmpty()) "No pieces yet" else draftNames(names))
    if (discount > 0) parts.add("discount ${Money.pkr(discount)}")
    return parts.joinToString(" · ")
}

/** A draft's first line: who it is for. */
fun draftTitle(customer: String): String {
    val t = erp.core.swiftTrimNewlines(customer)
    return if (t.isEmpty()) "No customer yet" else t
}
