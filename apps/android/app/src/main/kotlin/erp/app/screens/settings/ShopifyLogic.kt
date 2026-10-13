package erp.app.screens.settings

import erp.core.Container
import erp.core.logic.Money
import java.util.Locale

/**
 * GET /api/shopify/status. `configured` alone where the house has no SHOPIFY_STORE_DOMAIN; the store's name, scopes
 * and webhook counts only once the store has answered.
 */
data class ShopifyStatus(
    val configured: Boolean,
    val connected: Boolean?,
    val shop: String?,
    val shopName: String?,
    /** Null when the answer carries no list (the store has not answered). */
    val scopes: List<String>?,
    val webhooksHere: Int?,
    val webhooksTotal: Int?,
    val lastSyncedAt: String?,
    val error: String?,
) {
    companion object {
        fun from(value: Any?): ShopifyStatus {
            val m = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
            val c = Container(m)
            return ShopifyStatus(
                configured = c.bool("configured", false),
                connected = c.bool("connected"),
                shop = c.string("shop"),
                shopName = c.string("shopName"),
                scopes = if (m.containsKey("scopes")) c.strings("scopes") else null,
                webhooksHere = c.int("webhooksHere"),
                webhooksTotal = c.int("webhooksTotal"),
                lastSyncedAt = c.string("lastSyncedAt"),
                error = c.string("error"),
            )
        }
    }
}

/** A resource the ERP needs both halves of. */
class ScopeNeed(val resource: String, val label: String)

/** One Shopify order not yet in the ERP (GET /api/shopify/pull). */
data class PullOrder(val id: String, val title: String, val subtitle: String, val date: String, val amount: Double)

/** What an import answered. */
data class ImportOutcome(val requested: Int, val imported: Int, val errors: List<String>, val whenText: String) {
    val clean: Boolean get() = errors.isEmpty() && imported == requested
}

/** The Shopify page's pure rules (ShopifySettings.swift). */
object ShopifyLogic {
    val scopeNeeds = listOf(
        ScopeNeed("orders", "Orders"),
        ScopeNeed("customers", "Customers"),
        ScopeNeed("products", "Products"),
        ScopeNeed("draft_orders", "Draft orders"),
    )

    /** As the web's card: write_X implies read_X, and read_all_orders covers read_orders. */
    fun holds(scopes: Set<String>, scope: String): Boolean {
        if (scopes.contains(scope)) return true
        if (!scope.startsWith("read_")) return false
        val resource = scope.drop(5)
        return scopes.contains("write_$resource") || scopes.contains("read_all_$resource")
    }

    /** Every read_ and write_ scope the ERP needs. */
    val required: List<String> get() = scopeNeeds.flatMap { listOf("read_${it.resource}", "write_${it.resource}") }

    fun missing(held: Set<String>): List<String> = required.filter { !holds(held, it) }

    /** Granted beyond what the ERP asks for, sorted. */
    fun extra(held: Set<String>): List<String> = (held - required.toSet()).sorted()

    fun statusText(s: ShopifyStatus): String = if (!s.configured) "Not configured" else if (s.connected == true) "Connected" else "Needs attention"

    /**
     * /api/shopify/auth?shop=… (as the web's Re-authorize button). It sets its state cookie and sends the browser on to
     * Shopify, and the callback checks that cookie, so the whole round trip happens in the browser. The route refuses
     * anything but a *.myshopify.com domain, so nothing else is offered.
     */
    fun reauthorizeUrl(s: ShopifyStatus, serverUrl: String): String? {
        val shop = s.shop?.trim(' ', '\t') ?: return null
        if (!shop.endsWith(".myshopify.com")) return null
        return serverUrl.trimEnd('/') + "/api/shopify/auth?shop=" + java.net.URLEncoder.encode(shop, "UTF-8")
    }

    /** The order list as the filter box narrows it. */
    fun visible(orders: List<PullOrder>, query: String): List<PullOrder> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return orders
        return orders.filter { it.title.lowercase().contains(needle) || it.subtitle.lowercase().contains(needle) }
    }

    fun importTitle(count: Int, total: Double): String = "Import $count order${if (count == 1) "" else "s"} · ${Money.pkr(total)}?"

    fun plural(n: Int, one: String, many: String): String = if (n == 1) one else many

    /**
     * An order's id as the route sends it (`String(o.id)`); a number is read too, never rounded through an Int.
     * "0" and blank are no order.
     */
    fun orderId(raw: Any?): String = when (raw) {
        is String -> raw
        is Number -> java.math.BigDecimal(raw.toDouble()).setScale(0, java.math.RoundingMode.HALF_EVEN).toPlainString()
        else -> ""
    }

    fun orders(list: Any?): List<PullOrder> = (list as? List<*>).orEmpty().mapNotNull { o ->
        val m = o as? Map<*, *> ?: return@mapNotNull null
        val c = Container(m.entries.associate { it.key.toString() to it.value })
        val id = orderId(m["id"])
        if (id.isEmpty() || id == "0") null else PullOrder(id, c.string("title", ""), c.string("subtitle", ""), c.string("date", ""), c.double("amount", 0.0))
    }

    /** The webhooks line after registering: what was registered and what was already there. */
    fun webhookMessage(registered: List<String>, skipped: List<String>): String {
        if (registered.isEmpty() && skipped.isEmpty()) return "Shopify answered; nothing to register."
        val parts = ArrayList<String>()
        if (registered.isNotEmpty()) parts.add("Registered ${registered.joinToString(", ")}")
        if (skipped.isNotEmpty()) parts.add("already there: ${skipped.joinToString(", ")}")
        return parts.joinToString("; ") + "."
    }

    fun olderSkipped(n: Int, since: Int?): String {
        val s = since ?: 0
        return "$n older order${plural(n, "", "s")} at or below #$s ${plural(n, "is", "are")} not offered; ${plural(n, "it predates", "they predate")} the ERP."
    }

    fun clock(hour: Int, minute: Int): String = String.format(Locale.US, "%d:%02d %s", if (hour % 12 == 0) 12 else hour % 12, minute, if (hour < 12) "am" else "pm")
}
