package erp.app.screens.money

import erp.app.data.Sort
import erp.core.ERPDate
import erp.core.logic.Partnership
import erp.core.logic.WALK_IN_ENTITY
import erp.core.logic.WALK_IN_NAME
import erp.core.logic.isOwing
import erp.core.models.Expense
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.KarigarBatch
import java.net.URLDecoder
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// What the Money screens work out for themselves, with no Compose in it (MoneyLogic.swift): paths and words,
// Karachi's months, the Hisaab page's summary and a person's running balance. The money rules themselves
// (owed, walk-ins, the partners' shares) are core's; what is here is the pages' own sums, page-local in the
// TypeScript (hisaab/page.tsx accountSummaries, expenses/page.tsx summary).

// MARK: Paths and words

object MoneyPaths {
    private const val PATH_PLAIN = "-._~!$&'()*+,;=:@"
    private const val COMPONENT_PLAIN = "-_.!~*'()"

    private fun escape(s: String, extra: String): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val v = b.toInt() and 0xFF
            val c = v.toChar()
            val plain = v < 0x80 && ((c in 'A'..'Z') || (c in 'a'..'z') || (c in '0'..'9') || c in extra)
            if (plain) out.append(c) else out.append('%').append("%02X".format(v))
        }
        return out.toString()
    }

    /** One part of a path: an id with a "/" or "?" in it must not split the address. */
    fun encode(part: String): String = escape(part, PATH_PLAIN)

    /** What JavaScript's encodeURIComponent leaves alone (a query value). */
    fun component(s: String): String = escape(s, COMPONENT_PLAIN)

    /** The ERP's own pages for what is not native (the expense report's PDF, the Hisaab page's own tools). */
    const val expensesWeb = "/expenses?web=1"
    const val revenueWeb = "/additional-revenue?web=1"
    const val hisaabWeb = "/hisaab?web=1"

    /** The partners' page: a drawing is changed there, with its withdrawal (lib/writes/expense-admin.ts). */
    const val shareholders = "/shareholders"

    /** A repair opens as a sheet on the Repairs list (src/app/additional-revenue/page.tsx RepairLink). */
    fun repair(id: String): String = "/repairs?id=" + component(id)

    fun invoice(id: String): String = "/invoices/" + encode(id)

    /** One person's ledger: "/hisaab/<id>?type=customer|karigar". */
    fun ledger(id: String, isCustomer: Boolean, web: Boolean = false): String =
        "/hisaab/" + encode(id) + "?type=" + (if (isCustomer) "customer" else "karigar") + (if (web) "&web=1" else "")

    /** "/hisaab/CUST-1?type=customer" is the ledger of "CUST-1". Null for the list and for a deeper path. */
    fun ledgerID(fromPath: String): String? {
        val bare = fromPath.substringBefore('?')
        val prefix = "/hisaab/"
        if (!bare.startsWith(prefix)) return null
        val rest = bare.drop(prefix.length)
        if (rest.isEmpty() || rest.contains('/')) return null
        return decoded(rest)
    }

    /** Percent-decoding that leaves a plus alone and the text as it was where it is not valid. */
    private fun decoded(s: String): String =
        if (!s.contains('%')) s else runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)

    fun query(name: String, path: String): String? {
        val q = path.substringBefore('#').substringAfter('?', "")
        if (q.isEmpty()) return null
        for (pair in q.split('&')) {
            if (pair.isEmpty()) continue
            if (pair.substringBefore('=') == name) return decoded(pair.substringAfter('=', ""))
        }
        return null
    }
}

object MoneyFormat {
    /** "25.600 g": grams to the milligram, as the Hisaab page prints them. */
    fun grams(g: Double): String {
        val f = java.text.DecimalFormat("#,##0.000", java.text.DecimalFormatSymbols(Locale.US))
        f.roundingMode = java.math.RoundingMode.HALF_EVEN
        return f.format(java.math.BigDecimal(g.toString())) + " g"
    }
}

/** Swift's `localizedCaseInsensitiveContains`: case and accents ignored. */
fun moneyContains(haystack: String, needle: String): Boolean {
    if (needle.isEmpty()) return true
    return fold(haystack).contains(fold(needle))
}

private fun fold(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() }.lowercase()

// MARK: Months

/** A document with Karachi's day beside it ("yyyy-MM-dd", "" when it has no readable date). */
data class MoneyLine<T>(val item: T, val day: String, val id: String)

/** One month of a list, with what it came to. */
data class MoneyMonth<T>(val key: String, val title: String, val hint: String, val rows: List<MoneyLine<T>>, val total: Double)

object MoneyMonths {
    private val monthName: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.UK)

    /** Karachi's day of an ISO instant, "" when it has none. */
    fun day(iso: String): String = ERPDate.parse(iso)?.let { ERPDate.karachiDay(it) } ?: ""

    /** "2026-10" as "October 2026". */
    fun title(forKey: String): String {
        val ym = runCatching { YearMonth.parse(forKey) }.getOrNull() ?: return "No date"
        if (forKey.length != 7) return "No date"
        return monthName.format(ym.atDay(1))
    }

    /** Rows already newest first, kept in that order, month by month. */
    fun <T> group(lines: List<MoneyLine<T>>, now: Instant = Instant.now(), amount: (T) -> Double): List<MoneyMonth<T>> {
        val thisMonth = ERPDate.karachiDay(now).take(7)
        val order = ArrayList<String>()
        val members = HashMap<String, MutableList<MoneyLine<T>>>()
        val totals = HashMap<String, Double>()
        for (line in lines) {
            val key = if (line.day.isEmpty()) "undated" else line.day.take(7)
            if (members[key] == null) order.add(key)
            members.getOrPut(key) { ArrayList() }.add(line)
            totals[key] = (totals[key] ?: 0.0) + amount(line.item)
        }
        return order.map { key ->
            MoneyMonth(
                key = key,
                title = if (key == "undated") "No date" else title(key),
                hint = if (key == thisMonth) "This month" else "",
                rows = members[key].orEmpty(),
                total = totals[key] ?: 0.0,
            )
        }
    }
}

// MARK: Expense periods, groups and figures

/** Karachi's calendar: days as "yyyy-MM-dd" strings, weeks from Monday (lib/date-grouping.ts, `weekStartsOn: 1`). */
object MoneyCalendar {
    private fun f(p: String): DateTimeFormatter = DateTimeFormatter.ofPattern(p, Locale.UK)
    private val longDay = f("EEEE d MMM")
    private val shortDay = f("d MMM")
    private val fullDay = f("d MMM yyyy")

    fun date(ofDay: String): LocalDate? = runCatching { LocalDate.parse(ofDay) }.getOrNull()

    /** The day the person picked on the phone's own calendar, as a day string. */
    fun pickedDay(picked: LocalDate): String = "%04d-%02d-%02d".format(picked.year, picked.monthValue, picked.dayOfMonth)

    /** The Monday of the day's week, as a day string. */
    fun weekStart(ofDay: String): String? = date(ofDay)?.let { d -> d.minusDays((d.dayOfWeek.value - 1).toLong()).toString() }

    fun say(day: String, long: Boolean = false): String {
        val d = date(day) ?: return day
        return (if (long) longDay else shortDay).format(d)
    }

    fun sayFull(day: String): String {
        val d = date(day) ?: return day
        return fullDay.format(d)
    }
}

/** An inclusive span of Karachi days; a missing end is no bound at all. */
data class MoneyDayRange(val from: String? = null, val to: String? = null) {
    val isOpen: Boolean get() = from == null && to == null

    /** A day outside the span, or a row with no readable date inside a bounded one, is out. */
    fun contains(day: String): Boolean {
        if (isOpen) return true
        if (day.isEmpty()) return false
        if (from != null && day < from) return false
        if (to != null && day > to) return false
        return true
    }

    /** "1 Oct – 8 Oct 2026", as the page's subtitle says it; null for no bound. */
    val caption: String?
        get() {
            val f = from ?: return null
            val t = to ?: return null
            return "${MoneyCalendar.say(f)} – ${MoneyCalendar.sayFull(t)}"
        }

    companion object {
        /**
         * A range the person picks (periodRange's `custom`; the extra revenue page's date filter): no bound at all
         * until a start is picked, then up to the end of the chosen last day, or of today.
         */
        fun custom(fromDay: String?, toDay: String?, now: Instant = Instant.now()): MoneyDayRange {
            if (fromDay.isNullOrEmpty()) return MoneyDayRange(null, null)
            val today = ERPDate.karachiDay(now)
            val to = if (toDay.isNullOrEmpty()) today else toDay
            return MoneyDayRange(fromDay, to)
        }
    }
}

/** How far back Expenses looks (lib/date-grouping.ts PERIODS, in its order, with `periodRange`). */
enum class ExpensePeriod(val title: String) {
    thisMonth("This month"), lastMonth("Last month"), last30("Last 30 days"), thisYear("This year"), all("All time"), custom("Custom range");

    /**
     * The span in Karachi days. Every span but Last month ends at the end of today, and a custom one ends at the
     * end of its last day: `endOfDay(to || now)`. A custom span with no start is no bound at all, as in the web.
     */
    fun range(customFrom: String? = null, customTo: String? = null, now: Instant = Instant.now()): MoneyDayRange {
        val today = ERPDate.karachiDay(now)
        return when (this) {
            all -> MoneyDayRange(null, null)
            thisMonth -> MoneyDayRange(today.take(7) + "-01", today)
            lastMonth -> {
                val first = MoneyCalendar.date(today.take(7) + "-01")
                MoneyDayRange(previousMonth(today) + "-01", first?.minusDays(1)?.toString() ?: today)
            }
            last30 -> MoneyDayRange(ERPDate.karachiDay(now.minusSeconds(29 * 86_400L)), today)
            thisYear -> MoneyDayRange(today.take(4) + "-01-01", today)
            custom -> MoneyDayRange.custom(customFrom, customTo, now)
        }
    }

    companion object {
        /** "2026-10-08" gives "2026-09"; "2026-01-05" gives "2025-12". */
        fun previousMonth(today: String): String {
            val year = today.take(4).toIntOrNull() ?: 0
            val month = today.drop(5).take(2).toIntOrNull() ?: 1
            return if (month > 1) "%04d-%02d".format(year, month - 1) else "%04d-12".format(year - 1)
        }
    }
}

/**
 * What the person chose for a custom span, kept as the dates the pickers hold: nothing at all until "From a date"
 * is on, and no end means today. Shared by Expenses and Extra revenue.
 */
data class MoneyCustomRange(
    val useFrom: Boolean = false,
    /** Offered as the first of this month once "From a date" is turned on. */
    val from: LocalDate = LocalDate.now().withDayOfMonth(1),
    val useTo: Boolean = false,
    val to: LocalDate = LocalDate.now(),
) {
    val fromDay: String? get() = if (useFrom) MoneyCalendar.pickedDay(from) else null
    val toDay: String? get() = if (useFrom && useTo) MoneyCalendar.pickedDay(to) else null

    fun range(now: Instant = Instant.now()): MoneyDayRange = MoneyDayRange.custom(fromDay, toDay, now)

    /** A start picked after the end pulls the end along with it. */
    fun withFrom(picked: LocalDate): MoneyCustomRange = copy(from = picked, to = if (to.isBefore(picked)) picked else to)
}

/** How coarsely the rows are bucketed (GRADUATIONS); the subtotal is per bucket. */
enum class ExpenseGrouping(val title: String) { day("Day"), week("Week"), month("Month") }

data class MoneyBucket(val key: String, val label: String, val sub: String)

/** One bucket of a list with what it came to. */
data class MoneyGroup<T>(val key: String, val label: String, val sub: String, val rows: List<MoneyLine<T>>, val total: Double)

object MoneyBuckets {
    /**
     * lib/date-grouping.ts `bucketOf`, on Karachi days. Day: Today, Yesterday or "Monday 6 Oct", the date (or the
     * year) under it. Week from Monday: "Week of 6 Oct", "This week" or the year of that Monday. Month: "October
     * 2026", "This month".
     */
    fun bucket(day: String, by: ExpenseGrouping, now: Instant = Instant.now()): MoneyBucket {
        if (day.isEmpty()) return MoneyBucket("undated", "No date", "")
        val today = ERPDate.karachiDay(now)
        return when (by) {
            ExpenseGrouping.month -> {
                val key = day.take(7)
                MoneyBucket("m$key", MoneyMonths.title(key), if (key == today.take(7)) "This month" else "")
            }
            ExpenseGrouping.week -> {
                val start = MoneyCalendar.weekStart(day) ?: day
                val thisWeek = start == (MoneyCalendar.weekStart(today) ?: today)
                MoneyBucket("w$start", "Week of " + MoneyCalendar.say(start), if (thisWeek) "This week" else start.take(4))
            }
            ExpenseGrouping.day -> {
                val isToday = day == today
                val isYesterday = day == ERPDate.karachiDay(now.minusSeconds(86_400))
                val label = if (isToday) "Today" else if (isYesterday) "Yesterday" else MoneyCalendar.say(day, long = true)
                val sub = if (isToday || isYesterday) MoneyCalendar.sayFull(day) else day.take(4)
                MoneyBucket("d$day", label, sub)
            }
        }
    }

    /** Rows already newest first, kept in that order, bucket by bucket in the order first met. */
    fun <T> group(lines: List<MoneyLine<T>>, by: ExpenseGrouping, now: Instant = Instant.now(), amount: (T) -> Double): List<MoneyGroup<T>> {
        val order = ArrayList<MoneyBucket>()
        val members = HashMap<String, MutableList<MoneyLine<T>>>()
        val totals = HashMap<String, Double>()
        for (line in lines) {
            val b = bucket(line.day, by, now)
            if (members[b.key] == null) order.add(b)
            members.getOrPut(b.key) { ArrayList() }.add(line)
            totals[b.key] = (totals[b.key] ?: 0.0) + amount(line.item)
        }
        return order.map { MoneyGroup(it.key, it.label, it.sub, members[it.key].orEmpty(), totals[it.key] ?: 0.0) }
    }
}

/** The page's `summary` (src/app/expenses/page.tsx). */
data class ExpenseSummary(
    val total: Double = 0.0,
    val count: Int = 0,
    val karigarTotal: Double = 0.0,
    /** Rounded, a whole percent. */
    val karigarShare: Int = 0,
    /** The total over the number of buckets (at least 1). */
    val perBucket: Double = 0.0,
    /** The biggest bucket; the first of equals. "—" and 0 with no rows. */
    val biggestLabel: String = "—",
    val biggestTotal: Double = 0.0,
)

object ExpenseFigures {
    // TODO(logic): port the Expenses page's summary (src/app/expenses/page.tsx; page-local in the TypeScript).
    fun summary(lines: List<MoneyLine<Expense>>, groups: List<MoneyGroup<Expense>>): ExpenseSummary {
        var total = 0.0
        var karigarTotal = 0.0
        for (line in lines) {
            total += line.item.amount
            if (!line.item.karigarId.isNullOrEmpty()) karigarTotal += line.item.amount
        }
        // Swift's `.rounded()` is half away from zero; the share is never negative.
        val share = if (total > 0) Math.floor(karigarTotal / total * 100 + 0.5).toInt() else 0
        var biggestLabel = "—"
        var biggestTotal = 0.0
        for (g in groups) if (g.total > biggestTotal) {
            biggestTotal = g.total
            biggestLabel = g.label
        }
        return ExpenseSummary(total, lines.size, karigarTotal, share, total / max(groups.size, 1).toDouble(), biggestLabel, biggestTotal)
    }

    /**
     * The expenses page's filter list (`filterCategories`): the house's own list (the ERP says it:
     * `session.shop.expenseCategories`, with the two partner names and "Other"), then any other name an expense
     * carries, sorted. With no house list (the demo, an old cached answer) the names the books use, the most used first.
     */
    fun categories(shop: List<String>, expenses: List<Expense>): List<String> {
        if (shop.isEmpty()) return categoriesByUse(expenses)
        val known = shop.toSet()
        val extra = sortedSetOf<String>()
        for (e in expenses) if (e.category.isNotEmpty() && e.category !in known) extra.add(e.category)
        return shop + extra
    }

    /** What the Add expense form offers: the same, and with no house list "Other" last. */
    fun formCategories(shop: List<String>, expenses: List<Expense>): List<String> {
        val all = categories(shop, expenses)
        if (shop.isNotEmpty()) return all
        return all.filter { it != "Other" } + "Other"
    }

    /** Every category an expense carries, the most used first (ties by name). */
    fun categoriesByUse(expenses: List<Expense>): List<String> {
        val counts = LinkedHashMap<String, Int>()
        for (e in expenses) if (e.category.isNotEmpty()) counts[e.category] = (counts[e.category] ?: 0) + 1
        val byName = Sort.byName<String> { it }
        return counts.keys.sortedWith { a, b ->
            val ca = counts[a] ?: 0
            val cb = counts[b] ?: 0
            if (ca != cb) cb.compareTo(ca) else byName.compare(a, b)
        }
    }
}

/** The two partners (lib/shareholders.ts SHAREHOLDERS), a constant of the code, not a collection. */
data class MoneyPartner(val id: String, val name: String)

object MoneyPartners {
    val all = listOf(MoneyPartner("ammar", "Ammar"), MoneyPartner("mina", "Mina"))

    /** lib/partnership.ts PARTNER_SALARY: read by name, with the partner it paid in `shareholderId`. */
    const val salaryCategory = Partnership.partnerSalary

    /** lib/partnership.ts PARTNER_DRAWINGS: money a partner took out, written with a withdrawal on that partner's ledger. */
    const val drawingsCategory = Partnership.partnerDrawings

    fun name(id: String?): String? = all.firstOrNull { it.id == (id ?: "") }?.name

    /** A salary row is described as the Shareholders page writes it: "Mina salary — <what it was for>". */
    fun salaryDescription(partnerId: String, typed: String): String {
        val who = name(partnerId) ?: partnerId
        return "$who salary — ${typed.trim()}"
    }
}

/**
 * The expense form's number box (components/ui/amount-input.tsx): only digits and the first dot count, two
 * decimals at most, so "PKR 1,25,000" is 125000 and "1 250.50" is 1250.5.
 */
object MoneyParse {
    fun amount(raw: String, maxDecimals: Int = 2): Double? {
        val out = StringBuilder()
        var seenDot = false
        var decimals = 0
        for (ch in raw) {
            if (ch in '0'..'9') {
                if (seenDot) {
                    if (decimals >= maxDecimals) continue
                    decimals += 1
                }
                out.append(ch)
            } else if (ch == '.' && !seenDot) {
                seenDot = true
                out.append(ch)
            }
        }
        if (out.isEmpty() || out.toString() == ".") return null
        return out.toString().toDoubleOrNull()
    }

    /**
     * A sum of money typed into a box, in whole rupees (owner, 2026-10-17: "there should be no decimals"): any
     * paise pasted in are rounded away, as the ERP rounds every sum to the rupee.
     */
    fun rupees(raw: String): Double? = amount(raw)?.let { erp.app.ui.PaymentText.rounded(it) }
}

/** Filing a karigar's payment under one of his hisaabs (expense-form.tsx). */
object ExpenseFiling {
    /** "Deliberately not in a hisaab", apart from "none chosen". */
    const val direct = "__direct__"

    fun isOpen(b: KarigarBatch): Boolean = b.closedDate.isNullOrEmpty()

    /** His hisaabs, an open one first, then the newest start. */
    fun batches(forKarigar: String, all: List<KarigarBatch>): List<KarigarBatch> {
        if (forKarigar.isEmpty()) return emptyList()
        val keyed = all.filter { it.karigarId == forKarigar }.map { it to (ERPDate.parse(it.startDate)?.toEpochMilli() ?: 0L) }
        return keyed.sortedWith { x, y ->
            val ox = isOpen(x.first)
            val oy = isOpen(y.first)
            when {
                ox != oy -> if (ox) -1 else 1
                x.second != y.second -> y.second.compareTo(x.second)
                else -> x.first.id.compareTo(y.first.id)
            }
        }.map { it.first }
    }

    /** What the picker shows until it is touched: his open hisaab, else a direct payment; nothing for no karigar. */
    fun defaultChoice(karigarId: String, batches: List<KarigarBatch>): String {
        if (karigarId.isEmpty()) return ""
        return batches.firstOrNull { isOpen(it) }?.id ?: direct
    }

    /** The batch id the expense is filed under; null for a direct payment or no choice. */
    fun filedBatchId(choice: String): String? = if (choice.isEmpty() || choice == direct) null else choice

    /** "Open", or "Settled 5 Oct 2026". */
    fun hint(b: KarigarBatch): String {
        if (isOpen(b)) return "Open"
        val closed = ERPDate.parse(b.closedDate) ?: return "Settled"
        return "Settled " + MoneyCalendar.sayFull(ERPDate.karachiDay(closed))
    }
}

// MARK: Hisaab

enum class HisaabSide {
    /** The person owes the shop ("You will get"). */
    get,

    /** The shop owes the person ("You will give"). */
    give,
}

/** An invoice still owing, as a Hisaab card lists it. */
data class HisaabUnpaid(val id: String, val grandTotal: Double, val amountPaid: Double, val balanceDue: Double)

/** One person's balance: debit less credit over their rows (positive: they owe us). */
data class HisaabAccount(
    val id: String,
    val name: String,
    val isCustomer: Boolean,
    val cash: Double,
    val gold: Double,
    val unpaid: List<HisaabUnpaid>,
) {
    /** Walk-in sales left owing sit under one fixed entity, with no account page (lib/walk-in.ts). */
    val isWalkIn: Boolean get() = id == WALK_IN_ENTITY

    val hasCash: Boolean get() = abs(cash) > 0.001

    /** Which way the cash runs; a balance held only in metal goes by the metal. */
    val side: HisaabSide
        get() {
            if (cash > 0.001) return HisaabSide.get
            if (cash < -0.001) return HisaabSide.give
            return if (gold >= 0) HisaabSide.get else HisaabSide.give
        }

    /** How big, for ordering: the cash, else the metal. */
    val size: Double get() = if (hasCash) abs(cash) else abs(gold)
}

data class HisaabSummary(
    val accounts: List<HisaabAccount> = emptyList(),
    val receivable: Double = 0.0,
    val payable: Double = 0.0,
    val receivableGold: Double = 0.0,
    val payableGold: Double = 0.0,
)

/** Which side of the book: everyone, only those who owe the shop, only those the shop owes. */
enum class HisaabChip(val title: String) {
    all("All"), get("You will get"), give("You will give");

    fun matches(a: HisaabAccount): Boolean = when (this) {
        all -> true
        get -> a.side == HisaabSide.get
        give -> a.side == HisaabSide.give
    }
}

enum class HisaabKind(val title: String) {
    everyone("Everyone"), customers("Customers"), karigars("Karigars");

    fun matches(a: HisaabAccount): Boolean = when (this) {
        everyone -> true
        customers -> a.isCustomer
        karigars -> !a.isCustomer
    }
}

/** By name is the web's order (hisaab/page.tsx sorts by name); who owes first is the phone's extra. */
enum class HisaabOrder(val title: String) { byName("By name"), owesFirst("Who owes you first") }

object HisaabBook {
    private class Sum(val name: String, val type: HisaabEntityType) {
        var cash = 0.0
        var gold = 0.0
    }

    // TODO(logic): port the Hisaab page's summary (src/app/hisaab/page.tsx accountSummaries; it is page-local in the
    // TypeScript, not in src/lib) to core with a test.
    fun summary(entries: List<HisaabEntry>, invoices: List<Invoice>, customerIds: Set<String>): HisaabSummary {
        val order = ArrayList<String>()
        val sums = HashMap<String, Sum>()
        // Walk-in sales left owing have no customer to hold them, so their entries sit under the entity 'walk-in':
        // one row, or "You will get" would miss them.
        val walkInInvoiceIds = HashSet<String>()
        for (e in entries) {
            if (e.entityId.isEmpty()) continue
            val walkIn = e.entityId == WALK_IN_ENTITY
            val linked = e.linkedInvoiceId
            if (walkIn && !linked.isNullOrEmpty()) walkInInvoiceIds.add(linked)
            val sum = sums.getOrPut(e.entityId) {
                order.add(e.entityId)
                Sum(if (walkIn) WALK_IN_NAME else e.entityName, e.entityType)
            }
            sum.cash += e.cashDebit - e.cashCredit
            sum.gold += e.goldDebitGrams - e.goldCreditGrams
        }

        val unpaidBy = HashMap<String, MutableList<HisaabUnpaid>>()
        for (inv in invoices) {
            val cid = inv.customerId
            if (!isOwing(inv) || cid.isNullOrEmpty() || cid == WALK_IN_ENTITY) continue
            unpaidBy.getOrPut(cid) { ArrayList() }.add(HisaabUnpaid(inv.id, inv.grandTotal, inv.amountPaid, inv.balanceDue))
        }
        if (sums[WALK_IN_ENTITY] != null) {
            val rows = ArrayList<HisaabUnpaid>()
            for (inv in invoices) {
                if (inv.id in walkInInvoiceIds && inv.balanceDue >= 1 && inv.status != InvoiceStatus.refunded) {
                    rows.add(HisaabUnpaid(inv.id, inv.grandTotal, inv.amountPaid, inv.balanceDue))
                }
            }
            unpaidBy[WALK_IN_ENTITY] = rows
        }

        val accounts = ArrayList<HisaabAccount>()
        var receivable = 0.0
        var payable = 0.0
        var receivableGold = 0.0
        var payableGold = 0.0
        for (id in order) {
            val s = sums[id] ?: continue
            if (abs(s.cash) <= 0.001 && abs(s.gold) <= 0.001) continue
            val isCustomer = when (s.type) {
                HisaabEntityType.customer -> true
                HisaabEntityType.karigar -> false
                else -> id == WALK_IN_ENTITY || id in customerIds
            }
            accounts.add(HisaabAccount(id, s.name, isCustomer, s.cash, s.gold, unpaidBy[id].orEmpty()))
            receivable += max(0.0, s.cash)
            payable += abs(min(0.0, s.cash))
            receivableGold += max(0.0, s.gold)
            payableGold += abs(min(0.0, s.gold))
        }
        val byName = Sort.byName<HisaabAccount> { it.name }
        return HisaabSummary(accounts.sortedWith(byName), receivable, payable, receivableGold, payableGold)
    }

    /** Search and the kind of person: everything but the side, so each chip can count what it would show. */
    fun scope(all: List<HisaabAccount>, kind: HisaabKind, search: String): List<HisaabAccount> {
        val q = search.trim()
        return all.filter { kind.matches(it) && (q.isEmpty() || moneyContains(it.name, q)) }
    }

    /** By name, as the web lists them; or who owes the shop first, the biggest debt first, then those the shop owes. */
    fun ordered(list: List<HisaabAccount>, order: HisaabOrder): List<HisaabAccount> {
        val byName = Sort.byName<HisaabAccount> { it.name }
        return when (order) {
            HisaabOrder.byName -> list.sortedWith(byName)
            HisaabOrder.owesFirst -> list.sortedWith { a, b ->
                val sa = if (a.side == HisaabSide.get) 0 else 1
                val sb = if (b.side == HisaabSide.get) 0 else 1
                when {
                    sa != sb -> sa.compareTo(sb)
                    a.hasCash != b.hasCash -> if (a.hasCash) -1 else 1
                    a.size != b.size -> b.size.compareTo(a.size)
                    else -> byName.compare(a, b)
                }
            }
        }
    }
}

/** A row of a person's ledger and where the balances stood once it was written. */
data class HisaabLedgerLine(val entry: HisaabEntry, val cash: Double, val gold: Double) {
    val id: String get() = entry.id
}

data class HisaabLedgerPage(
    /** Newest first, as the page shows them. */
    val lines: List<HisaabLedgerLine> = emptyList(),
    val cash: Double = 0.0,
    val gold: Double = 0.0,
    val hasGold: Boolean = false,
)

object HisaabLedger {
    // TODO(logic): port the person page's running balance (src/app/hisaab/[entityId]/page.tsx; page-local in the
    // TypeScript) to core with a test.
    /** Oldest first, adding debit less credit as it goes, then turned back newest first. */
    fun page(rows: List<HisaabEntry>): HisaabLedgerPage {
        val keyed = rows.map { it to (ERPDate.parse(it.date)?.let { d -> d.epochSecond + d.nano / 1e9 } ?: 0.0) }
            .sortedWith { a, b -> if (a.second != b.second) a.second.compareTo(b.second) else a.first.id.compareTo(b.first.id) }
        var cash = 0.0
        var gold = 0.0
        var hasGold = false
        val lines = ArrayList<HisaabLedgerLine>()
        for ((entry, _) in keyed) {
            cash += entry.cashDebit - entry.cashCredit
            gold += entry.goldDebitGrams - entry.goldCreditGrams
            if (entry.goldDebitGrams > 0 || entry.goldCreditGrams > 0) hasGold = true
            lines.add(HisaabLedgerLine(entry, cash, gold))
        }
        return HisaabLedgerPage(lines.reversed(), cash, gold, hasGold)
    }
}
