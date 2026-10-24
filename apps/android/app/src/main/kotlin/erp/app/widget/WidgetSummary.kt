package erp.app.widget

import erp.core.Json
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What the home-screen widget shows (ERPWidgetViews.swift `ERPSummary`): the figures come ready to show from the ERP
 * (/api/widget/summary, lib/widget/summary.ts), and the widget only lays them out, so a change to what they say needs
 * no new build. The same plain data draws the real Glance widget and Settings → Widgets' preview.
 */
class WidgetFigure(val label: String, val value: String, val detail: String?) {
    override fun equals(other: Any?) = other is WidgetFigure && label == other.label && value == other.value && detail == other.detail
    override fun hashCode() = (label + "|" + value + "|" + detail).hashCode()
}

/** What needs someone (late work first, then the biggest unpaid bills): a line that opens its screen. */
class WidgetNeed(val title: String, val detail: String, val tone: String, val path: String)

/** One of the latest sales. */
class WidgetSale(val title: String, val amount: String, val whenText: String, val path: String)

/**
 * The week, the work that needs someone and the latest sales (added after the first widget; absent from an older server, and
 * never able to fail the decode of the figures: every field is lenient). The cache's SCHEMA is the iPhone's 3.
 */
class WidgetExtras(
    /** Revenue per day, the last seven Karachi days, oldest first; the last is today. */
    val days: List<Double> = emptyList(),
    /** Percent against the seven days before those; null when there was nothing to compare. */
    val weekDelta: Int? = null,
    val bench: Int = 0,
    val due: Int = 0,
    val late: Int = 0,
    val needs: List<WidgetNeed> = emptyList(),
    val recent: List<WidgetSale> = emptyList(),
) {
    companion object {
        fun from(value: Any?): WidgetExtras? {
            val m = value as? Map<*, *> ?: return null
            fun int(k: String) = (m[k] as? Number)?.toDouble()?.let { Math.round(it).toInt() }
            return WidgetExtras(
                days = (m["days"] as? List<*>).orEmpty().mapNotNull { (it as? Number)?.toDouble() },
                weekDelta = int("weekDelta"),
                bench = int("bench") ?: 0,
                due = int("due") ?: 0,
                late = int("late") ?: 0,
                needs = (m["needs"] as? List<*>).orEmpty().mapNotNull { n ->
                    val nm = n as? Map<*, *> ?: return@mapNotNull null
                    WidgetNeed(nm["title"] as? String ?: "", nm["detail"] as? String ?: "", nm["tone"] as? String ?: "owed", nm["path"] as? String ?: "/")
                },
                recent = (m["recent"] as? List<*>).orEmpty().mapNotNull { r ->
                    val rm = r as? Map<*, *> ?: return@mapNotNull null
                    WidgetSale(rm["title"] as? String ?: "", rm["amount"] as? String ?: "", rm["when"] as? String ?: "", rm["path"] as? String ?: "/")
                },
            )
        }
    }
}

class WidgetSummary(
    /** "Taheri", "House of Mina". */
    val house: String,
    /** When the ERP worked the figures out, as the shop reads a time ("4:05 pm"). */
    val updated: String,
    /** Revenue today and this month first; supporting shop figures follow. */
    val figures: List<WidgetFigure>,
    val teamNote: String? = null,
    /** The shop's day the figures are for (yyyy-MM-dd), when they are not necessarily today's. */
    val asOf: String? = null,
    val extras: WidgetExtras? = null,
) {
    fun figure(label: String): WidgetFigure? = figures.firstOrNull { it.label == label }

    companion object {
        /** The route's JSON (Codable's `ERPSummary`, leniently); null when it is not a summary at all. */
        fun decode(json: String): WidgetSummary? {
            val m = runCatching { Json.parse(json) }.getOrNull() as? Map<*, *> ?: return null
            val list = m["figures"] as? List<*> ?: return null
            val figures = list.mapNotNull { f ->
                val fm = f as? Map<*, *> ?: return@mapNotNull null
                val label = fm["label"] as? String ?: return@mapNotNull null
                val value = fm["value"] as? String ?: return@mapNotNull null
                WidgetFigure(label, value, fm["detail"] as? String)
            }
            return WidgetSummary(
                house = m["house"] as? String ?: "",
                updated = m["updated"] as? String ?: "",
                figures = figures,
                teamNote = m["teamNote"] as? String,
                asOf = m["asOf"] as? String,
                extras = WidgetExtras.from(m["extras"]),
            )
        }

        /** Made-up figures for the preview and for the picker (`ERPSummary.sample`). */
        fun sample(house: String = "Taheri") = WidgetSummary(
            house = house,
            updated = "4:05 pm",
            figures = listOf(
                WidgetFigure("Made today", "Rs 3.12 lac", "revenue"),
                WidgetFigure("This month", "Rs 28.4 lac", "revenue"),
                WidgetFigure("Gold 24k", "Rs 2.45 lac", "a tola"),
                WidgetFigure("Today's cash", "Rs 3.12 lac", "in the drawer"),
                WidgetFigure("Owed to you", "Rs 18.6 lac", "41 customers"),
                WidgetFigure("Orders due", "6", "2 late"),
            ),
            teamNote = "Please confirm all collections before closing today.",
            extras = WidgetExtras(
                days = listOf(180_000.0, 240_000.0, 150_000.0, 310_000.0, 270_000.0, 205_000.0, 312_000.0), weekDelta = 12, bench = 14, due = 6, late = 2,
                needs = listOf(
                    WidgetNeed("Ayesha Khan", "3 days late", "late", "/orders"), WidgetNeed("Bilal Traders", "2 days late", "late", "/orders"),
                    WidgetNeed("Sana Malik", "owes Rs 1.8 lac", "owed", "/invoices"), WidgetNeed("Omar Jewellers", "owes Rs 95,000", "owed", "/invoices"),
                ),
                recent = listOf(
                    WidgetSale("Hira Siddiqui", "Rs 1.4 lac", "23 Oct", "/invoices"), WidgetSale("Walk-in", "Rs 62,000", "23 Oct", "/invoices"),
                    WidgetSale("Zain Ali", "Rs 1.1 lac", "22 Oct", "/invoices"),
                ),
            ),
        )
    }
}

/** The three sizes (the iPhone has more families; Android has no lock screen and its sizes are the grid's). */
enum class WidgetSize { Small, Medium, Large }

/** The shape one business's face takes: alone, or sharing the widget with another (`ERPWidgetSize` .smallHalf and .mediumHalf). */
enum class FaceKind { Small, Medium, Large, SmallHalf, MediumHalf }

/** How a widget carrying two businesses sets them: small stacks two rows, medium sets two columns, large stacks two medium faces. */
enum class WidgetArrangement { Single, Rows, Columns, Stacked }

enum class ChartKind { None, Sparkline, Bars }

/** Owed to you, due, on the bench: a value and a small label; `late` paints the value in the late tone. */
class WidgetStat(val value: String, val label: String, val late: Boolean = false)

/** "▲ 12%" against the seven days before: up is green, down is red. */
class WidgetDelta(val percent: Int) {
    val up: Boolean get() = percent >= 0
    val text: String get() = "${if (up) "▲" else "▼"} ${Math.abs(percent)}%"
    val speech: String get() = "${Math.abs(percent)} percent ${if (up) "up" else "down"} on last week"
}

/** What one business's face shows, worked out once from its summary and the room, so Glance and the preview cannot differ. */
class FacePlan(
    val kind: FaceKind,
    /** The business's name in its accent where two share the widget, and the wordmark's stand-in. */
    val name: String,
    val today: WidgetFigure,
    val delta: WidgetDelta?,
    val chart: ChartKind,
    val days: List<Double>,
    val stats: List<WidgetStat>,
    val needs: List<WidgetNeed>,
    val recent: List<WidgetSale>,
    /** The figures after the first two, in a grid: the large face's, only when the ERP sent no needs and no sales. */
    val supporting: List<WidgetFigure>,
    val columns: Int,
    val note: String?,
    /** "Updated 23 Oct", only when the figures are not from today. */
    val stamp: String?,
    /** The hero number's size in sp, fitted to its room. */
    val heroSp: Float,
) {
    /** "Rs" small and quiet, the number large. */
    val heroPrefix: String? get() = if (today.value.startsWith("Rs ")) "Rs" else null
    val heroNumber: String get() = if (heroPrefix != null) today.value.drop(3) else today.value

    /** The wordmark sits in the corner of the single faces; the halves carry the name tag instead. */
    val showsWordmark: Boolean get() = kind != FaceKind.SmallHalf && kind != FaceKind.MediumHalf
}

/** One business on the widget: how it looks, and its face (null while its figures have not come). */
class WidgetItem(val look: WidgetLook, val face: FacePlan?)

/** The widget as one launcher size draws it: which businesses, set how. Null items: the widget is not linked. */
class WidgetPlan(val size: WidgetSize, val arrangement: WidgetArrangement, val items: List<WidgetItem>) {
    val linked: Boolean get() = items.isNotEmpty()
}

object WidgetLayout {
    /** The face for the room a launcher gives the widget (Glance's responsive sizes land on one of these). */
    fun sizeFor(widthDp: Float, heightDp: Float): WidgetSize = when {
        heightDp >= 220f && widthDp >= 180f -> WidgetSize.Large
        widthDp >= 200f -> WidgetSize.Medium
        else -> WidgetSize.Small
    }

    /** The note, only when it says something. */
    fun note(s: WidgetSummary): String? = s.teamNote?.trim()?.takeIf { it.isNotEmpty() }

    /** The width a face is drawn at in the preview, and what the plan is made for when no better is known. */
    fun nominalWidth(size: WidgetSize): Float = if (size == WidgetSize.Small) 160f else 340f

    /**
     * Which businesses a widget shows (ERPProvider.link / .second): with "Show both businesses" on (the default) and two or more
     * linked, the open business first and the next linked one after it (the list's order, wrapping round); else just the first
     * (the open business, if linked). `order` is the businesses' order in the app, `openId` the one open now.
     */
    fun pick(linked: List<WidgetLinkData>, order: List<String>, openId: String?, both: Boolean): List<WidgetLinkData> {
        if (linked.isEmpty()) return emptyList()
        val sorted = linked.sortedBy { l -> order.indexOf(l.id).let { if (it < 0) Int.MAX_VALUE else it } }
        val first = sorted.firstOrNull { it.id == openId } ?: sorted.first()
        if (!both || sorted.size < 2) return listOf(first)
        val i = sorted.indexOf(first)
        return listOf(first, sorted[(i + 1) % sorted.size])
    }

    /**
     * The widget for the businesses chosen and the figures each has: one face per business, set as the size says. A business with no
     * figures yet still has its place (its half says so); nothing linked is an unlinked widget (no items).
     */
    fun plan(shown: List<Pair<WidgetLinkData, WidgetSummary?>>, size: WidgetSize, now: Instant = Instant.now(), widthDp: Float = nominalWidth(size)): WidgetPlan {
        if (shown.isEmpty()) return WidgetPlan(size, WidgetArrangement.Single, emptyList())
        val pair = shown.size > 1
        val arrangement = if (!pair) WidgetArrangement.Single else when (size) {
            WidgetSize.Small -> WidgetArrangement.Rows
            WidgetSize.Medium -> WidgetArrangement.Columns
            WidgetSize.Large -> WidgetArrangement.Stacked
        }
        val kind = when (size) {
            WidgetSize.Small -> if (pair) FaceKind.SmallHalf else FaceKind.Small
            WidgetSize.Medium -> if (pair) FaceKind.MediumHalf else FaceKind.Medium
            // Two businesses on a large widget are two medium faces, one above the other.
            WidgetSize.Large -> if (pair) FaceKind.Medium else FaceKind.Large
        }
        val items = shown.take(2).map { (link, summary) -> WidgetItem(link.look, summary?.let { face(it, link.look.tag, kind, now, widthDp) }) }
        return WidgetPlan(size, arrangement, items)
    }

    /** One business's face, or null when its summary has no figures at all. */
    fun face(s: WidgetSummary, name: String, kind: FaceKind, now: Instant = Instant.now(), widthDp: Float = 340f): FacePlan? {
        val today = s.figures.firstOrNull() ?: return null
        val e = s.extras
        val days = e?.days.orEmpty()
        val chart = when {
            days.size < 2 -> ChartKind.None
            kind == FaceKind.Small || kind == FaceKind.MediumHalf -> ChartKind.Sparkline
            kind == FaceKind.Medium || kind == FaceKind.Large -> ChartKind.Bars
            else -> ChartKind.None
        }
        val stats = if (kind == FaceKind.Medium || kind == FaceKind.Large) stats(s) else emptyList()
        val needs = if (kind == FaceKind.Large) e?.needs.orEmpty().take(4) else emptyList()
        val recent = if (kind == FaceKind.Large) e?.recent.orEmpty().take(3) else emptyList()
        val fresh = Freshness.of(s, now)
        val number = if (today.value.startsWith("Rs ")) today.value.drop(3) else today.value
        return FacePlan(
            kind = kind, name = name, today = today, delta = e?.weekDelta?.let { WidgetDelta(it) }, chart = chart, days = days,
            stats = stats, needs = needs, recent = recent,
            supporting = if (kind == FaceKind.Large && needs.isEmpty() && recent.isEmpty()) s.figures.drop(2) else emptyList(),
            columns = 2,
            note = if (kind == FaceKind.Large) note(s) else null,
            stamp = if (fresh.stale && (kind == FaceKind.Small || kind == FaceKind.MediumHalf || kind == FaceKind.Medium)) "Updated ${fresh.short}" else null,
            heroSp = WidgetFit.sp(base(kind), number, WidgetFit.heroRoom(kind, widthDp)),
        )
    }

    /** Owed to you, due, on the bench (the iPhone's `stats`). Without the ERP's extras, the "Due" figure stands in. */
    fun stats(s: WidgetSummary): List<WidgetStat> = buildList {
        s.figure("Owed to you")?.let { add(WidgetStat(it.value, "Owed to you")) }
        val e = s.extras
        if (e != null) {
            add(WidgetStat("${e.due}", if (e.late > 0) "Due · ${e.late} late" else "Orders due", late = e.late > 0))
            add(WidgetStat("${e.bench}", "On the bench"))
        } else {
            s.figure("Due")?.let { add(WidgetStat(it.value, it.detail ?: "Orders due")) }
        }
    }

    private fun base(kind: FaceKind): Float = when (kind) {
        FaceKind.Small -> 30f
        FaceKind.SmallHalf -> 22f
        FaceKind.MediumHalf -> 26f
        FaceKind.Medium -> 30f
        FaceKind.Large -> 40f
    }
}

/**
 * Text sizes that keep a figure inside its room (the iPhone's `minimumScaleFactor`: Glance has no auto-fit, and the
 * preview uses the same numbers so it shows what the widget draws). A bold digit is about 0.58 of its size wide.
 */
object WidgetFit {
    private const val EM = 0.58f

    /** The face's width less the padding either side. */
    const val PAD = 32f
    private const val GAP = 14f

    /** The room the hero number has: the widget's width less its padding, or half of it where the face is a column beside another text. */
    fun heroRoom(kind: FaceKind, widthDp: Float): Float = when (kind) {
        FaceKind.Small, FaceKind.SmallHalf, FaceKind.Large -> widthDp - PAD - (if (kind == FaceKind.Large) 40f else 0f)
        FaceKind.Medium -> (widthDp - PAD - GAP) / 2f - 14f
        FaceKind.MediumHalf -> (widthDp - PAD - GAP) / 2f - 14f
    }

    /** [base] sp, shrunk to fit [text] in [roomDp], but never below [minScale] of it. */
    fun sp(base: Float, text: String, roomDp: Float, minScale: Float = 0.5f): Float {
        val fit = roomDp / (EM * text.length.coerceAtLeast(1))
        return fit.coerceIn(base * minScale, base)
    }
}

/** When the figures were worked out; carries the day when they are not today's (`ERPFreshness`). */
class Freshness(val text: String, val short: String, val stale: Boolean) {
    companion object {
        private val karachi: ZoneId = ZoneId.of("Asia/Karachi")

        fun of(s: WidgetSummary, now: Instant = Instant.now()): Freshness {
            val day = s.asOf ?: return Freshness(s.updated, s.updated, false)
            val today = LocalDate.ofInstant(now, karachi)
            val parsed = runCatching { LocalDate.parse(day) }.getOrNull()
            if (parsed == today || day == today.toString()) return Freshness(s.updated, s.updated, false)
            val shown = parsed?.format(DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)) ?: day
            return Freshness("$shown · ${s.updated}", shown, true)
        }
    }
}
