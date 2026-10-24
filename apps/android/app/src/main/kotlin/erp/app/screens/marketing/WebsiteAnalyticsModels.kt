package erp.app.screens.marketing

import erp.core.Container
import erp.core.Decodable
import erp.core.logic.Money
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

// What Website -> Interest and Live share (WebsiteAnalyticsKit.swift): the shapes of GET /api/website/analytics and
// /analytics/live (lib/website/site-analytics.ts) and the words for places, sources, devices and pages
// (src/app/website/interest/site-kit.tsx). Every field may be missing; a missing one is zero or empty.

// MARK: Shapes

/** A counted key: a country, a device, a page, a search. */
data class SiteCount(val key: String = "", val value: Int = 0) {
    companion object : Decodable<SiteCount> {
        override fun fromMap(m: Map<String, Any?>): SiteCount = Container(m).let { SiteCount(it.string("key", ""), it.int("value") ?: 0) }
    }
}

/** A source with how far its sessions got. */
data class SiteSource(val key: String = "", val channel: String = "", val name: String = "", val sessions: Int = 0, val piece: Int = 0, val save: Int = 0, val enquire: Int = 0) {
    companion object : Decodable<SiteSource> {
        override fun fromMap(m: Map<String, Any?>): SiteSource = Container(m).let {
            SiteSource(it.string("key", ""), it.string("channel", ""), it.string("name", ""), it.int("sessions") ?: 0, it.int("piece") ?: 0, it.int("save") ?: 0, it.int("enquire") ?: 0)
        }
    }
}

/** A campaign (utm_campaign): its sessions in [value]. */
data class SiteCampaign(val key: String = "", val value: Int = 0, val piece: Int = 0, val save: Int = 0, val enquire: Int = 0) {
    companion object : Decodable<SiteCampaign> {
        override fun fromMap(m: Map<String, Any?>): SiteCampaign = Container(m).let {
            SiteCampaign(it.string("key", ""), it.int("value") ?: 0, it.int("piece") ?: 0, it.int("save") ?: 0, it.int("enquire") ?: 0)
        }
    }
}

data class SiteCity(val cc: String = "", val region: String = "", val city: String = "", val sessions: Int = 0) {
    val id: String get() = "$cc|$region|$city"

    companion object : Decodable<SiteCity> {
        override fun fromMap(m: Map<String, Any?>): SiteCity = Container(m).let { SiteCity(it.string("cc", ""), it.string("region", ""), it.string("city", ""), it.int("sessions") ?: 0) }
    }
}

data class SiteFunnel(val sessions: Int = 0, val piece: Int = 0, val save: Int = 0, val enquire: Int = 0) {
    companion object : Decodable<SiteFunnel> {
        override fun fromMap(m: Map<String, Any?>): SiteFunnel = Container(m).let { SiteFunnel(it.int("sessions") ?: 0, it.int("piece") ?: 0, it.int("save") ?: 0, it.int("enquire") ?: 0) }
    }
}

/** The days' counters added up (Summary in site-analytics.ts). */
data class SiteSummary(
    val sessions: Int = 0,
    val visitors: Int = 0,
    val pageviews: Int = 0,
    val bounces: Int = 0,
    val durMs: Double = 0.0,
    val newSessions: Int = 0,
    val returningSessions: Int = 0,
    val newVisitors: Int = 0,
    val bounceRate: Double = 0.0,
    val avgSessionMs: Double = 0.0,
    val pagesPerSession: Double = 0.0,
    val funnel: SiteFunnel = SiteFunnel(),
    val conversion: Double = 0.0,
    val sources: List<SiteSource> = emptyList(),
    val channels: List<SiteCount> = emptyList(),
    val campaigns: List<SiteCampaign> = emptyList(),
    val countries: List<SiteCount> = emptyList(),
    val cities: List<SiteCity> = emptyList(),
    val devices: List<SiteCount> = emptyList(),
    val os: List<SiteCount> = emptyList(),
    val browsers: List<SiteCount> = emptyList(),
    val landing: List<SiteCount> = emptyList(),
    val exits: List<SiteCount> = emptyList(),
    val pages: List<SiteCount> = emptyList(),
    val collections: List<SiteCount> = emptyList(),
    val notFound: List<SiteCount> = emptyList(),
    val searches: List<SiteCount> = emptyList(),
) {
    companion object : Decodable<SiteSummary> {
        override fun fromMap(m: Map<String, Any?>): SiteSummary = Container(m).let {
            SiteSummary(
                sessions = it.int("sessions") ?: 0, visitors = it.int("visitors") ?: 0, pageviews = it.int("pageviews") ?: 0, bounces = it.int("bounces") ?: 0,
                durMs = it.double("durMs", 0.0), newSessions = it.int("newSessions") ?: 0, returningSessions = it.int("returningSessions") ?: 0,
                newVisitors = it.int("newVisitors") ?: 0, bounceRate = it.double("bounceRate", 0.0), avgSessionMs = it.double("avgSessionMs", 0.0),
                pagesPerSession = it.double("pagesPerSession", 0.0), funnel = it.obj("funnel", SiteFunnel) ?: SiteFunnel(), conversion = it.double("conversion", 0.0),
                sources = it.list("sources", SiteSource), channels = it.list("channels", SiteCount), campaigns = it.list("campaigns", SiteCampaign),
                countries = it.list("countries", SiteCount), cities = it.list("cities", SiteCity), devices = it.list("devices", SiteCount),
                os = it.list("os", SiteCount), browsers = it.list("browsers", SiteCount), landing = it.list("landing", SiteCount),
                exits = it.list("exits", SiteCount), pages = it.list("pages", SiteCount), collections = it.list("collections", SiteCount),
                notFound = it.list("notFound", SiteCount), searches = it.list("searches", SiteCount),
            )
        }
    }
}

data class SiteDay(val day: String = "", val sessions: Int = 0, val visitors: Int = 0, val pageviews: Int = 0, val enquiries: Int = 0) {
    companion object : Decodable<SiteDay> {
        override fun fromMap(m: Map<String, Any?>): SiteDay = Container(m).let {
            SiteDay(it.string("day", ""), it.int("sessions") ?: 0, it.int("visitors") ?: 0, it.int("pageviews") ?: 0, it.int("enquiries") ?: 0)
        }
    }
}

data class SiteHour(val hour: Int = 0, val sessions: Int = 0, val before: Int = 0) {
    companion object : Decodable<SiteHour> {
        override fun fromMap(m: Map<String, Any?>): SiteHour = Container(m).let { SiteHour(it.int("hour") ?: 0, it.int("sessions") ?: 0, it.int("before") ?: 0) }
    }
}

data class SitePeriodRange(val from: String = "", val to: String = "") {
    companion object : Decodable<SitePeriodRange> {
        override fun fromMap(m: Map<String, Any?>): SitePeriodRange = Container(m).let { SitePeriodRange(it.string("from", ""), it.string("to", "")) }
    }
}

/** GET /api/website/analytics. */
data class SiteReport(
    val range: String = "",
    val from: String = "",
    val to: String = "",
    val days: Int = 0,
    val previous: SitePeriodRange = SitePeriodRange(),
    val today: String = "",
    val since: String? = null,
    val visitorsExact: Boolean = true,
    val now: SiteSummary = SiteSummary(),
    val before: SiteSummary = SiteSummary(),
    val series: List<SiteDay> = emptyList(),
    /** Only for a one-day period: its sessions by the hour, with the day before. */
    val hours: List<SiteHour>? = null,
) {
    companion object : Decodable<SiteReport> {
        override fun fromMap(m: Map<String, Any?>): SiteReport = Container(m).let {
            val h = it.list("hours", SiteHour)
            SiteReport(
                range = it.string("range", ""), from = it.string("from", ""), to = it.string("to", ""), days = it.int("days") ?: 0,
                previous = it.obj("previous", SitePeriodRange) ?: SitePeriodRange(), today = it.string("today", ""), since = it.string("since"),
                visitorsExact = it.bool("visitorsExact", true), now = it.obj("now", SiteSummary) ?: SiteSummary(),
                before = it.obj("before", SiteSummary) ?: SiteSummary(), series = it.list("series", SiteDay), hours = h.ifEmpty { null },
            )
        }
    }
}

/** One open session on the live view. The server sends no id: the screen numbers them in order. */
data class SiteLiveVisit(
    val path: String = "/",
    val kind: String = "",
    val cc: String = "",
    val region: String = "",
    val city: String = "",
    val device: String = "",
    val browser: String = "",
    val source: String = "direct",
    val isNew: Boolean = false,
    val pages: Int = 0,
    val forMs: Double = 0.0,
    val ago: Double = 0.0,
) {
    companion object : Decodable<SiteLiveVisit> {
        override fun fromMap(m: Map<String, Any?>): SiteLiveVisit = Container(m).let {
            SiteLiveVisit(
                it.string("path", "/"), it.string("kind", ""), it.string("cc", ""), it.string("region", ""), it.string("city", ""), it.string("device", ""),
                it.string("browser", ""), it.string("source", "direct"), it.bool("isNew", false), it.int("pages") ?: 0, it.double("forMs", 0.0), it.double("ago", 0.0),
            )
        }
    }
}

data class SiteLiveToday(
    val sessions: Int = 0, val visitors: Int = 0, val pageviews: Int = 0, val enquiries: Int = 0, val saves: Int = 0, val pieces: Int = 0,
    val conversion: Double = 0.0, val bounceRate: Double = 0.0, val avgSessionMs: Double = 0.0,
) {
    companion object : Decodable<SiteLiveToday> {
        override fun fromMap(m: Map<String, Any?>): SiteLiveToday = Container(m).let {
            SiteLiveToday(
                it.int("sessions") ?: 0, it.int("visitors") ?: 0, it.int("pageviews") ?: 0, it.int("enquiries") ?: 0, it.int("saves") ?: 0, it.int("pieces") ?: 0,
                it.double("conversion", 0.0), it.double("bounceRate", 0.0), it.double("avgSessionMs", 0.0),
            )
        }
    }
}

/** GET /api/website/analytics/live. */
data class SiteLive(
    val at: Double = 0.0,
    val visitors: Int = 0,
    val newVisitors: Int = 0,
    val pages: List<SiteCount> = emptyList(),
    val countries: List<SiteCount> = emptyList(),
    /** key "CC|Region|City". */
    val cities: List<SiteCount> = emptyList(),
    val sources: List<SiteCount> = emptyList(),
    val devices: List<SiteCount> = emptyList(),
    val sessions: List<SiteLiveVisit> = emptyList(),
    val today: SiteLiveToday = SiteLiveToday(),
) {
    /** The live cities as the report's rows ("CC|Region|City"). */
    val cityRows: List<SiteCity>
        get() = cities.map { x ->
            val p = x.key.split("|")
            SiteCity(p.getOrElse(0) { "" }, p.getOrElse(1) { "" }, p.getOrElse(2) { "" }, x.value)
        }

    companion object : Decodable<SiteLive> {
        override fun fromMap(m: Map<String, Any?>): SiteLive = Container(m).let {
            SiteLive(
                at = it.double("at", 0.0), visitors = it.int("visitors") ?: 0, newVisitors = it.int("newVisitors") ?: 0,
                pages = it.list("pages", SiteCount), countries = it.list("countries", SiteCount), cities = it.list("cities", SiteCount),
                sources = it.list("sources", SiteCount), devices = it.list("devices", SiteCount), sessions = it.list("sessions", SiteLiveVisit),
                today = it.obj("today", SiteLiveToday) ?: SiteLiveToday(),
            )
        }
    }
}

// MARK: Words

/** site-kit.tsx's names, ported. */
object SiteWords {
    fun countryName(cc: String): String {
        if (cc.isEmpty() || cc == "??") return "Unknown"
        val name = Locale("", cc).getDisplayCountry(Locale.ENGLISH)
        return if (name.isEmpty() || name == cc) cc else name
    }

    /** The country's flag from its two letters (regional indicator symbols); a globe when unknown. */
    fun flag(cc: String): String {
        if (cc.length != 2 || !cc.all { it in 'A'..'Z' }) return "🌐"
        val sb = StringBuilder()
        for (c in cc) sb.appendCodePoint(0x1F1A5 + c.code)
        return sb.toString()
    }

    fun channel(key: String): String = when (key) {
        "direct" -> "Direct"
        "search" -> "Search"
        "social" -> "Social"
        "paid" -> "Ads"
        "referral" -> "Other sites"
        "email" -> "Email"
        else -> key
    }

    /** "paid:Instagram" -> "Instagram ads", "search:Google" -> "Google search", "direct" -> "Direct". */
    fun source(key: String): String {
        if (key == "direct") return "Direct"
        val i = key.indexOf(':')
        if (i < 0) return key
        val ch = key.substring(0, i)
        val name = key.substring(i + 1)
        return when (ch) {
            "paid" -> "$name ads"
            "search" -> "$name search"
            else -> name
        }
    }

    fun device(key: String): String = when (key) {
        "mobile" -> "Phone"
        "tablet" -> "Tablet"
        "desktop" -> "Computer"
        else -> key
    }

    /** "/rings-bands/band-147" -> "rings-bands > band-147"; the front page by name. */
    fun page(path: String): String {
        if (path == "/" || path.isEmpty()) return "Front page"
        val trimmed = if (path.startsWith("/")) path.drop(1) else path
        return trimmed.split("/").joinToString(" › ")
    }

    /** "12%", "4.5%" (a share under 10% keeps a decimal at zero digits), as the web's `pct`. */
    fun pct(x: Double, digits: Int = 0): String {
        val d = if (x > 0 && x < 0.1 && digits == 0) 1 else digits
        return String.format(Locale.US, "%.${d}f%%", x * 100)
    }

    /** "0s", "45s", "3m 20s", "1h 5m". */
    fun duration(ms: Double): String {
        if (ms <= 0) return "0s"
        val s = Math.round(ms / 1000).toInt()
        if (s >= 3600) return "${s / 3600}h ${(s % 3600) / 60}m"
        if (s >= 60) return "${s / 60}m ${s % 60}s"
        return "${s}s"
    }

    fun number(n: Int): String = Money.grouped(n.toDouble())

    private val dayWord = DateTimeFormatter.ofPattern("d MMM", Locale.UK)

    /** "9 Oct" from "2026-10-09". */
    fun shortDay(ymd: String): String = runCatching { dayWord.format(LocalDate.parse(ymd)) }.getOrDefault(ymd)

    /** "9 Oct" or "2 Oct -> 9 Oct". */
    fun span(from: String, to: String): String = if (from == to) shortDay(from) else shortDay(from) + " → " + shortDay(to)

    /** "now" under a minute, else "3m ago". */
    fun ago(ms: Double): String = if (ms < 60_000) "now" else "${(ms / 60_000).roundToInt()}m ago"

    fun pages(n: Int): String = if (n == 1) "1 page" else "$n pages"

    /** The web's `secs` (the interest list): "1m 20s" from a minute up, else "45s". */
    fun secs(ms: Double): String =
        if (ms >= 60_000) "${(ms / 60_000).toInt()}m ${Math.round((ms % 60_000) / 1000).toInt()}s" else "${Math.round(ms / 1000).toInt()}s"
}

// MARK: Delta

/** How a figure moved against the period before, as SiteDelta says it. */
class SiteChange(val up: Boolean, val text: String, val good: Boolean) {
    /** What TalkBack hears. */
    val spoken: String get() = (if (up) "up " else "down ") + text + " on the period before"
}

object SiteDeltaLogic {
    /** Nothing without a before; "same as before" when it moved less than half a percent. */
    fun same(now: Double, before: Double): Boolean = before > 0 && abs((now - before) / before * 100) < 0.5

    /** Null when there is nothing to say (no before, or [same]). `invert` where down is good (bounce rate). */
    fun change(now: Double, before: Double, invert: Boolean = false): SiteChange? {
        if (before <= 0) return null
        val change = (now - before) / before * 100
        if (abs(change) < 0.5) return null
        val ratio = now / before
        val text = if (change > 0 && ratio >= 3) {
            if (ratio >= 10) "${Math.round(ratio)}×" else String.format(Locale.US, "%.1f×", ratio)
        } else "${Math.round(abs(change))}%"
        val up = change > 0
        return SiteChange(up, text, if (invert) !up else up)
    }
}

// MARK: Ranked lists

/** One line of a ranked list. */
data class SiteRankRow(val id: String, val label: String, val value: Int, val lead: String? = null, val sub: String? = null)

object SiteRanks {
    fun counts(xs: List<SiteCount>, label: (String) -> String): List<SiteRankRow> = xs.map { SiteRankRow(it.key, label(it.key), it.value) }

    fun pages(xs: List<SiteCount>): List<SiteRankRow> = counts(xs, SiteWords::page)

    fun plain(xs: List<SiteCount>): List<SiteRankRow> = counts(xs) { it }

    /** Countries, one row each. */
    fun countryRows(countries: List<SiteCount>): List<SiteRankRow> =
        countries.map { SiteRankRow(it.key, SiteWords.countryName(it.key), it.value, lead = SiteWords.flag(it.key)) }

    /**
     * Cities, flat: flag + city, "region, country" beneath. What a country has beyond its listed cities is one row: the
     * country itself when no city is known there, "Other cities" when some are.
     */
    fun cityRows(countries: List<SiteCount>, cities: List<SiteCity>): List<SiteRankRow> {
        val out = ArrayList<SiteRankRow>()
        for (x in cities) {
            val place = if (x.region.isEmpty()) SiteWords.countryName(x.cc) else x.region + ", " + SiteWords.countryName(x.cc)
            out += SiteRankRow(x.id, x.city, x.sessions, lead = SiteWords.flag(x.cc), sub = place)
        }
        for (c in countries) {
            val inside = cities.filter { it.cc == c.key }
            val rest = c.value - inside.sumOf { it.sessions }
            if (rest <= 0) continue
            out += if (inside.isEmpty()) SiteRankRow("country/" + c.key, SiteWords.countryName(c.key), rest, lead = SiteWords.flag(c.key))
            else SiteRankRow("other/" + c.key, "Other cities", rest, lead = SiteWords.flag(c.key), sub = SiteWords.countryName(c.key))
        }
        return out.sortedByDescending { it.value }
    }

    /** Sources, flat, with how many asked on WhatsApp beside each. */
    fun sourceRows(xs: List<SiteSource>): List<SiteRankRow> =
        xs.map { SiteRankRow(it.key, SiteWords.source(it.key), it.sessions, sub = if (it.enquire > 0) "${it.enquire} asked" else null) }

    /** Kinds of source (direct, search, social, ads, other sites, email). */
    fun channelRows(xs: List<SiteCount>): List<SiteRankRow> = counts(xs, SiteWords::channel)

    fun campaignRows(n: SiteSummary): List<SiteRankRow> =
        n.campaigns.map { SiteRankRow(it.key, it.key, it.value, sub = "${it.piece} opened a piece · ${it.enquire} asked") }

    fun searchRows(n: SiteSummary): List<SiteRankRow> = n.searches.map { SiteRankRow(it.key, "“" + it.key + "”", it.value) }
}

// MARK: Piece interest

/** One piece's counts, as /api/website/interest sends them. Any number may be missing. */
data class WebsiteInterestPiece(
    val piece: String = "", val name: String = "", val thumb: String = "", val url: String = "", val collection: String = "",
    val views: Int = 0, val saves: Int = 0, val unsaves: Int = 0, val netSaves: Int = 0, val enquiries: Int = 0,
    val dwellMs: Double = 0.0, val dwellN: Int = 0, val avgDwellMs: Double = 0.0,
) {
    companion object : Decodable<WebsiteInterestPiece> {
        override fun fromMap(m: Map<String, Any?>): WebsiteInterestPiece = Container(m).let {
            WebsiteInterestPiece(
                it.string("piece", ""), it.string("name", ""), it.string("thumb", ""), it.string("url", ""), it.string("collection", ""),
                it.int("views") ?: 0, it.int("saves") ?: 0, it.int("unsaves") ?: 0, it.int("netSaves") ?: 0, it.int("enquiries") ?: 0,
                it.double("dwellMs", 0.0), it.int("dwellN") ?: 0, it.double("avgDwellMs", 0.0),
            )
        }
    }
}

data class WebsiteInterestAnswer(val pieces: List<WebsiteInterestPiece> = emptyList()) {
    companion object : Decodable<WebsiteInterestAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteInterestAnswer = WebsiteInterestAnswer(Container(m).list("pieces", WebsiteInterestPiece))
    }
}

/** The four lists, with the web's ranking and wording (LISTS in the page). */
enum class WebsiteInterestList(val title: String, val emptyTitle: String) {
    Saved("Saved", "No saves in this period"),
    Asked("Asked about", "No enquiries in this period"),
    Longest("Looked at longest", "Nothing looked at long enough in this period"),
    Opened("Opened", "No opens in this period");

    /** What ranks the piece; 0 keeps it out. A minimum of three looks, so one long stare doesn't top the list. */
    fun rank(r: WebsiteInterestPiece): Double = when (this) {
        Saved -> r.netSaves.toDouble()
        Asked -> r.enquiries.toDouble()
        Longest -> if (r.dwellN >= 3) r.avgDwellMs else 0.0
        Opened -> r.views.toDouble()
    }

    fun say(r: WebsiteInterestPiece): String = when (this) {
        Saved -> "${r.netSaves} saved"
        Asked -> "${r.enquiries} on WhatsApp"
        Longest -> "${SiteWords.secs(r.avgDwellMs)} on average · ${r.dwellN} looks"
        Opened -> "${r.views} opens"
    }

    /** Ranked, highest first, ties in the server's order, the top 40 (as the web). */
    fun ranked(all: List<WebsiteInterestPiece>): List<WebsiteInterestPiece> =
        all.withIndex().filter { rank(it.value) > 0 }
            .sortedWith { a, b -> val ra = rank(a.value); val rb = rank(b.value); if (ra == rb) a.index.compareTo(b.index) else rb.compareTo(ra) }
            .take(40).map { it.value }

    companion object {
        fun of(raw: String?): WebsiteInterestList = entries.firstOrNull { it.name == raw } ?: Saved
    }
}
