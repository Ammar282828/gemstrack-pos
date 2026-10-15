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
) {
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
                WidgetFigure("In the drawer", "Rs 3.12 lac", "nothing in yet"),
                WidgetFigure("Owed to you", "Rs 18.6 lac", "41 unpaid"),
                WidgetFigure("Due", "6", "2 late"),
            ),
            teamNote = "Please confirm all collections before closing today.",
        )
    }
}

/** The three faces (the iPhone has more families; Android has no lock screen and its sizes are the grid's). */
enum class WidgetSize { Small, Medium, Large }

/** What a face shows, worked out once from the summary and the size, so Glance and the preview cannot differ. */
class FacePlan(
    val size: WidgetSize,
    val today: WidgetFigure,
    /** The second figure, beside or under the hero. */
    val month: WidgetFigure?,
    /** The shop's pinned message, if there is one. */
    val note: String?,
    val noteLines: Int,
    /** Figures after the first two, in a grid (large only). */
    val supporting: List<WidgetFigure>,
    val columns: Int,
    val compactHeader: Boolean,
    /** Medium puts the note beside the hero with a hairline between; the others stack it. */
    val noteBeside: Boolean,
    val freshness: Freshness,
    /** The hero figure's size in sp, fitted to its room. */
    val heroSp: Float,
    /** The "This month" line's size in sp, fitted to its room. */
    val monthSp: Float,
)

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

    /** Null when there are no figures at all: the face then says to link the widget. */
    fun plan(s: WidgetSummary, size: WidgetSize, now: Instant = Instant.now(), widthDp: Float = nominalWidth(size)): FacePlan? {
        val today = s.figures.firstOrNull() ?: return null
        val note = note(s)
        val beside = size == WidgetSize.Medium
        val room = WidgetFit.heroRoom(widthDp, beside, note != null)
        val month = s.figures.getOrNull(1)
        return FacePlan(
            heroSp = WidgetFit.sp(when (size) { WidgetSize.Small -> 26f; WidgetSize.Medium -> 30f; WidgetSize.Large -> 40f }, today.value, room),
            monthSp = WidgetFit.sp(if (size == WidgetSize.Large) 14f else 12f, month?.let { it.label + " " + it.value }.orEmpty(), room, 0.75f),
            size = size,
            today = today,
            month = month,
            note = note,
            noteLines = when (size) { WidgetSize.Small -> 2; else -> 3 },
            supporting = if (size == WidgetSize.Large) s.figures.drop(2) else emptyList(),
            columns = 2,
            compactHeader = size == WidgetSize.Small,
            noteBeside = beside,
            freshness = Freshness.of(s, now),
        )
    }
}

/**
 * Text sizes that keep a figure inside its room (the iPhone's `minimumScaleFactor`: Glance has no auto-fit, and the
 * preview uses the same numbers so it shows what the widget draws). A bold digit is about 0.58 of its size wide.
 */
object WidgetFit {
    private const val EM = 0.58f

    /** The face's width less the accent bar and padding either side. */
    const val PAD = 36f
    private const val GAP = 13f

    /** The room the hero figure has: the face's width less its padding, and half of it when the note sits beside it. */
    fun heroRoom(widthDp: Float, noteBeside: Boolean, hasNote: Boolean): Float =
        if (noteBeside && hasNote) (widthDp - PAD - GAP) / 2f else widthDp - PAD

    /** [base] sp, shrunk to fit [text] in [roomDp], but never below [minScale] of it. */
    fun sp(base: Float, text: String, roomDp: Float, minScale: Float = 0.6f): Float {
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

/** The widget's way into the ERP: the house's address and a key of its own. The key reads the summary only. */
class WidgetLinkData(val url: String, val key: String, val house: String) {
    fun encode(): String = erp.app.data.JsonText.of(mapOf("url" to url, "key" to key, "house" to house)) ?: "{}"

    companion object {
        fun decode(text: String?): WidgetLinkData? {
            val m = text?.let { runCatching { Json.parse(it) }.getOrNull() } as? Map<*, *> ?: return null
            val url = m["url"] as? String ?: return null
            val key = m["key"] as? String ?: return null
            return WidgetLinkData(url, key, m["house"] as? String ?: "")
        }

        /** `Authorization: Widget <key>` (the route reads nothing else). */
        fun authorization(key: String) = "Widget $key"

        /** POST /api/widget/key's body. */
        fun keyBody(): Map<String, Any?> = mapOf("label" to "Android widget")
    }
}
