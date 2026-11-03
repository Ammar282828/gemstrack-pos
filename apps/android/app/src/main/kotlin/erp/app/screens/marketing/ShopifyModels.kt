package erp.app.screens.marketing

import erp.core.Container
import erp.core.logic.Money
import kotlin.math.roundToInt

// The shapes of House of Mina's Shopify analytics: GET /api/website/shopify-analytics and /live (lib/website/shopify-analytics.ts;
// WebsiteShopifyModels.swift). Every section arrives as `{data}`, `{missingScope, note?}` or `{error}`; one failing never takes the
// others down. Every field may be missing; a missing one is zero or empty. Decoded leniently from the parsed JSON.

// MARK: A section

/** `{ data }`, `{ missingScope, note? }` or `{ error }`; [Absent] when the answer has no such key (a skeleton while loading). */
sealed interface ShopSection<out T> {
    data class Ready<T>(val data: T) : ShopSection<T>
    data class Missing(val scope: String, val note: String?) : ShopSection<Nothing>
    data class Failed(val message: String) : ShopSection<Nothing>
    data object Absent : ShopSection<Nothing>

    /** The scope this section is waiting on, for the card at the top that says what to grant. */
    val missing: Missing? get() = this as? Missing

    companion object {
        fun <T : Any> from(value: Any?, decode: (Any?) -> T?): ShopSection<T> {
            val m = value as? Map<*, *> ?: return Failed("Shopify sent nothing for this one.")
            val c = Container(m.entries.associate { it.key.toString() to it.value })
            if (m.containsKey("data")) decode(m["data"])?.let { return Ready(it) }
            c.string("missingScope")?.let { return Missing(it, c.string("note")) }
            c.string("error")?.let { return Failed(it) }
            return Failed("Shopify sent nothing for this one.")
        }
    }
}

private fun container(value: Any?): Container? = (value as? Map<*, *>)?.let { m -> Container(m.entries.associate { it.key.toString() to it.value }) }

// MARK: Figures and lists

/** `{ name: { value, before } }`. Rates are fractions (0.034 is 3.4%). */
class ShopKpis(private val items: Map<String, Pair<Double, Double?>>) {
    fun value(name: String): Double = items[name]?.first ?: 0.0
    fun before(name: String): Double? = items[name]?.second

    companion object {
        fun from(value: Any?): ShopKpis? {
            val m = value as? Map<*, *> ?: return null
            val out = HashMap<String, Pair<Double, Double?>>()
            for ((k, v) in m) {
                val c = container(v) ?: continue
                out[k.toString()] = c.double("value", 0.0) to c.double("before")
            }
            return ShopKpis(out)
        }
    }
}

/** A ranked row of any list: its value now and in the period before, with a few extras (conversion, orders...). */
data class ShopListRow(
    val key: String = "", val label: String = "", val code: String = "", val value: Double = 0.0, val before: Double? = null, val extra: Map<String, Double> = emptyMap(),
) {
    companion object {
        fun from(value: Any?): ShopListRow? {
            val c = container(value) ?: return null
            val extra = HashMap<String, Double>()
            (value as Map<*, *>)["extra"].let { e -> if (e is Map<*, *>) for ((k, v) in e) (v as? Number)?.toDouble()?.let { extra[k.toString()] = it } }
            return ShopListRow(c.string("key", ""), c.string("label", ""), c.string("code", ""), c.double("value", 0.0), c.double("before"), extra)
        }

        fun list(value: Any?): List<ShopListRow>? = (value as? List<*>)?.mapNotNull { from(it) }
    }
}

data class ShopFunnelStep(val key: String = "", val label: String = "", val value: Double = 0.0, val before: Double? = null) {
    companion object {
        fun list(value: Any?): List<ShopFunnelStep>? = (value as? List<*>)?.mapNotNull { v ->
            container(v)?.let { ShopFunnelStep(it.string("key", ""), it.string("label", ""), it.double("value", 0.0), it.double("before")) }
        }
    }
}

/**
 * One slot of a series. [at] is Shopify's own timestamp, read by its characters as the web does (day: the first ten; hour:
 * characters 11 and 12), so the shop's local time is never shifted.
 */
data class ShopSeriesPoint(val at: String = "", val sessions: Double = 0.0, val visitors: Double = 0.0, val sales: Double = 0.0, val orders: Double = 0.0) {
    /** The hour of the day ("2026-11-03T14:00:00..." is 14). */
    val hour: Int? get() = if (at.length >= 13) at.substring(11, 13).toIntOrNull() else null

    /** "14:07" from the timestamp. */
    val clock: String get() = if (at.length >= 16) at.substring(11, 16) else at

    /** The day, "2026-11-03". */
    val day: String get() = at.take(10)
}

data class ShopSeries(val grain: String = "day", val points: List<ShopSeriesPoint> = emptyList()) {
    companion object {
        fun from(value: Any?): ShopSeries? {
            val c = container(value) ?: return null
            val points = c.list("points") { v ->
                container(v)?.let { ShopSeriesPoint(it.string("at", ""), it.double("sessions", 0.0), it.double("visitors", 0.0), it.double("sales", 0.0), it.double("orders", 0.0)) }
            }
            return ShopSeries(c.string("grain", "day"), points)
        }
    }
}

// MARK: The report

/** GET /api/website/shopify-analytics?range=&compare=1. */
class ShopReport(
    val range: String, val from: String, val to: String, val previousFrom: String?, val previousTo: String?, val currency: String, val storeName: String,
    val sales: ShopSection<ShopKpis>, val traffic: ShopSection<ShopKpis>, val series: ShopSection<ShopSeries>, val funnel: ShopSection<List<ShopFunnelStep>>,
    val products: ShopSection<List<ShopListRow>>, val productPages: ShopSection<List<ShopListRow>>, val channels: ShopSection<List<ShopListRow>>,
    val discounts: ShopSection<List<ShopListRow>>, val customers: ShopSection<List<ShopListRow>>, val sources: ShopSection<List<ShopListRow>>,
    val places: ShopSection<List<ShopListRow>>, val devices: ShopSection<List<ShopListRow>>, val landing: ShopSection<List<ShopListRow>>,
    val searches: ShopSection<List<ShopListRow>>,
) {
    /** Every section, to find the scopes still to grant. */
    val all: List<ShopSection<*>> get() = listOf(sales, traffic, series, funnel, products, productPages, channels, discounts, customers, sources, places, devices, landing, searches)

    companion object {
        fun from(value: Any?): ShopReport? {
            val root = container(value) ?: return null
            val s = (value as Map<*, *>)["sections"] as? Map<*, *>
            fun <T : Any> sec(key: String, decode: (Any?) -> T?): ShopSection<T> = if (s == null || !s.containsKey(key)) ShopSection.Absent else ShopSection.from(s[key], decode)
            val lists = { v: Any? -> ShopListRow.list(v) }
            val previous = container((value as Map<*, *>)["previous"])
            val shop = container(value["shop"])
            return ShopReport(
                root.string("range", ""), root.string("from", ""), root.string("to", ""), previous?.string("from"), previous?.string("to"),
                shop?.string("currency", "") ?: "", shop?.string("name", "") ?: "",
                sec("sales", ShopKpis::from), sec("traffic", ShopKpis::from), sec("series", ShopSeries::from), sec("funnel", ShopFunnelStep::list),
                sec("products", lists), sec("productPages", lists), sec("channels", lists), sec("discounts", lists), sec("customers", lists),
                sec("sources", lists), sec("places", lists), sec("devices", lists), sec("landing", lists), sec("searches", lists),
            )
        }
    }
}

// MARK: Live

/** An order or a checkout of the last half hour. */
data class ShopActivity(
    val kind: String, val ago: Double, val label: String, val amount: Double?, val currency: String, val place: String, val items: List<Pair<String, Int>>, val status: String,
) {
    companion object {
        fun list(value: Any?): List<ShopActivity>? = (value as? List<*>)?.mapNotNull { v ->
            val c = container(v) ?: return@mapNotNull null
            val items = c.list("items") { i -> container(i)?.let { it.string("title", "") to (it.int("quantity") ?: 1) } }
            ShopActivity(c.string("kind", "order"), c.double("ago", 0.0), c.string("label", ""), c.double("amount"), c.string("currency", ""), c.string("place", ""), items, c.string("status", ""))
        }
    }
}

/** GET /api/website/shopify-analytics/live. */
class ShopLive(
    val windowMinutes: Int, val lastHalfHour: Int?, val note: String,
    val sessions: ShopSection<ShopSeries>, val places: ShopSection<List<ShopListRow>>, val today: ShopSection<ShopKpis>, val recent: ShopSection<List<ShopActivity>>,
) {
    val all: List<ShopSection<*>> get() = listOf(sessions, places, today, recent)

    companion object {
        fun from(value: Any?): ShopLive? {
            val root = container(value) ?: return null
            val s = (value as Map<*, *>)["sections"] as? Map<*, *>
            fun <T : Any> sec(key: String, decode: (Any?) -> T?): ShopSection<T> = if (s == null || !s.containsKey(key)) ShopSection.Absent else ShopSection.from(s[key], decode)
            val live = container(value["live"])
            return ShopLive(
                root.int("windowMinutes") ?: 30, live?.int("sessionsLastHalfHour"), live?.string("note", "") ?: "",
                sec("sessions", ShopSeries::from), sec("places", ShopListRow::list), sec("today", ShopKpis::from), sec("recent", ShopActivity::list),
            )
        }
    }
}

// MARK: Words

object ShopWords {
    /** "PKR 12,345" in the store's own currency (PKR when the answer names none). */
    fun money(x: Double, currency: String?): String = (if (currency.isNullOrEmpty()) "PKR" else currency) + " " + Money.grouped(x)

    fun number(x: Double): String = Money.grouped(x)

    /** "just now" under a minute, else "3 min ago". */
    fun ago(ms: Double): String = if (ms < 60_000) "just now" else "${(ms / 60_000).roundToInt()} min ago"

    /** The scopes still to grant, once each, in the order met. */
    fun missing(sections: List<ShopSection<*>>): List<ShopSection.Missing> {
        val out = ArrayList<ShopSection.Missing>()
        for (s in sections) s.missing?.let { m -> if (out.none { it.scope == m.scope }) out += m }
        return out
    }
}
