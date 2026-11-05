package erp.app.screens.marketing

import erp.core.Json
import kotlinx.coroutines.withContext
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.auth.LocalSession
import erp.app.nav.ScreenTitle
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsRow
import erp.app.screens.ads.AdsTwoPane
import erp.app.screens.ads.adsWords
import erp.app.ui.ChipRow
import erp.app.ui.ErpPullToRefreshBox
import erp.app.ui.FigureGrid
import erp.app.ui.FilterChip
import erp.app.ui.NotAvailableState
import erp.app.ui.NumericText
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.SkeletonLoading
import erp.app.ui.SkeletonShape
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max

// House of Mina's Shopify analytics in Website (docs/decisions.md "Shopify analytics (House of Mina)"; owner, 2026-11-03: "add all Shopify
// website insights like who's live and everything"). WebsiteShopify{Host,Visitors,Live,Parts}.swift; web app/website/interest/shopify-*.tsx.
// Visitors and Live open on Shopify's own analytics where the house's public store is Shopify, with the catalogue's counters a
// "Catalogue" chip away. Owners only: the routes answer 403 to anyone else.

// MARK: The switch

/**
 * Visitors and Live have two sources where the house's public store is Shopify: the Shopify store's own analytics, and the catalogue's
 * counters. This is their route: the catalogue screen alone where the house has no Shopify analytics, otherwise a "Shopify / Catalogue"
 * switch above whichever is chosen, remembered per page on this device (the web keeps `erp.websiteView.<page>` too; Shopify is the first).
 *
 * Whether the house has Shopify analytics: `shop.shopifyAnalytics` (/api/app/me), when the ERP says it. Until it does, an owner's phone
 * asks the route itself once (200: yes, 404: no) and keeps the answer per business; staff, whom the route refuses either way, see the catalogue.
 */
@Composable
fun ShopifySwitchHost(page: String, catalogue: @Composable () -> Unit, shopify: @Composable () -> Unit) {
    val session = LocalSession.current
    val demo = House.isDemo
    val told = session.shop.shopifyAnalytics
    var mode by remember { mutableStateOf(if (Prefs.string("erp.websiteView.$page") == "catalogue") "catalogue" else "shopify") }
    var probe by remember { mutableStateOf(Prefs.string(PROBE_KEY)?.let { if (it == "1") "yes" else if (it == "0") "no" else "unknown" } ?: "unknown") }
    var failed by remember { mutableStateOf(false) }
    val available = !demo && (told ?: (probe == "yes"))
    val waiting = !demo && told == null && session.isOwner && probe != "yes" && probe != "no" && !failed

    // One look at the route, only where the ERP has not said and the answer is not known: 200 is yes, 404 no. A failed look
    // (no line, a slow Shopify) is not an answer: the catalogue shows and the next visit asks again.
    LaunchedEffect(told, probe) {
        if (demo || told != null || !session.isOwner || probe != "unknown") return@LaunchedEffect
        probe = "checking"
        try {
            ErpApi.shared.data("/api/website/shopify-analytics/live")
            Prefs.putString(PROBE_KEY, "1")
            probe = "yes"
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 404) { Prefs.putString(PROBE_KEY, "0"); probe = "no" } else { probe = "unknown"; failed = true }
        } catch (e: Exception) {
            probe = "unknown"; failed = true
        }
    }

    Column(Modifier.fillMaxSize()) {
        if (available) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                listOf("shopify" to "Shopify", "catalogue" to "Catalogue").forEachIndexed { i, (key, label) ->
                    SegmentedButton(
                        selected = mode == key, onClick = { mode = key; Prefs.putString("erp.websiteView.$page", key) },
                        shape = SegmentedButtonDefaults.itemShape(i, 2),
                    ) { Text(label, maxLines = 1) }
                }
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                available && mode == "shopify" -> shopify()
                waiting -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading…", shape = SkeletonShape.Figures)
                else -> catalogue()
            }
        }
    }
}

private const val PROBE_KEY = "erp.shopifyAnalytics.available"
private const val PERIOD_KEY = "erp.shopifyAnalytics.period"

/** Website: Visitors. */
@Composable
fun WebsiteVisitorsHost() = ShopifySwitchHost("visitors", { WebsiteInterestScreen() }, { ShopifyVisitorsScreen() })

/** Website: Visitors: Live. */
@Composable
fun WebsiteLiveHost() = ShopifySwitchHost("live", { WebsiteLiveScreen() }, { ShopifyLiveScreen() })

// MARK: Visitors

private val shopPeriods = listOf("today" to "Today", "7d" to "7 days", "30d" to "30 days", "90d" to "90 days", "month" to "This month")

@Composable
fun ShopifyVisitorsScreen() {
    val session = LocalSession.current
    if (!session.isOwner) {
        ScreenTitle("Visitors")
        ShopOwnersOnly()
        return
    }
    ScreenTitle("Visitors")
    val scope = rememberCoroutineScope()
    var stored by remember { mutableStateOf(Prefs.string(PERIOD_KEY) ?: "30d") }
    val period = if (shopPeriods.any { it.first == stored }) stored else "30d"
    var report by remember { mutableStateOf<ShopReport?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val path = "/api/website/shopify-analytics?range=$period&compare=1"

    // The previous report stays while the next period loads; a failure shows only when there is nothing to show.
    suspend fun load() {
        try {
            // The last kept report at once, then the ERP's (it replaces it).
            var got = false
            ErpApi.shared.cachedThenFresh(path).collect { read ->
                val r = withContext(kotlinx.coroutines.Dispatchers.Default) { ShopReport.from(Json.parse(read.text)) }
                    ?: if (read.fresh) throw ErpApi.Failure(0, "The ERP's answer couldn't be read.") else return@collect
                report = r
                problem = null
                got = true
            }
            if (!got) throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (report == null) problem = adsWords(e)
        }
    }
    LaunchedEffect(path) { load() }

    val r = report
    Column(Modifier.fillMaxSize()) {
        ChipRow {
            for ((k, label) in shopPeriods) FilterChip(label, chosen = period == k, onClick = { if (k != period) { stored = k; Prefs.putString(PERIOD_KEY, k) } })
        }
        Box(Modifier.weight(1f)) {
            when {
                r != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) { ShopifyVisitorsContent(r) }
                problem != null -> MarketingErrorState(problem ?: "") { scope.launch { load() } }
                else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading…", shape = SkeletonShape.Figures)
            }
        }
    }
}

/** The page from an answer in hand. */
@Composable
fun ShopifyVisitorsContent(r: ShopReport) {
    val cur = r.currency
    AdsPage {
        val span = buildString {
            if (r.storeName.isNotEmpty()) append(r.storeName + " on Shopify · ")
            append(SiteWords.span(r.from, r.to))
            if (!r.previousFrom.isNullOrEmpty()) append(" · compared with " + SiteWords.span(r.previousFrom, r.previousTo ?: r.previousFrom))
            append(" · Shopify may take a few minutes to catch up")
        }
        Text(span, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ShopGrants(ShopWords.missing(r.all))
        ShopGate("Sessions", r.traffic) { k ->
            val count = { x: Double -> ShopWords.number(x) }
            val rate = { x: Double -> SiteWords.pct(x) }
            FigureGrid {
                shopTile(k, "sessions", "Sessions", count, detail = String.format(java.util.Locale.US, "%.1f pages each", k.value("pageviewsPerSession")))
                shopTile(k, "visitors", "Visitors", count)
                shopTile(k, "pageviews", "Page views", count)
                shopTile(k, "conversionRate", "Conversion rate", rate, detail = ShopWords.number(k.value("completedCheckout")) + " checked out")
                shopTile(k, "bounceRate", "Bounce rate", rate, invert = true)
                shopTile(k, "avgSessionSeconds", "Time on site", { x -> SiteWords.duration(x * 1000) }, detail = "a session")
                shopTile(k, "searches", "Searches", count)
                shopTile(k, "productsViewed", "Products viewed", count)
            }
        }
        ShopGate("Sales", r.sales) { k ->
            val cash = { x: Double -> ShopWords.money(x, cur) }
            val count = { x: Double -> ShopWords.number(x) }
            FigureGrid {
                shopTile(k, "totalSales", "Total sales", cash)
                shopTile(k, "orders", "Orders", count)
                shopTile(k, "averageOrderValue", "Average order", cash)
                shopTile(k, "returningCustomerRate", "Returning customers", { x -> SiteWords.pct(x) }, detail = ShopWords.number(k.value("newCustomers")) + " new")
                shopTile(k, "grossSales", "Gross sales", cash)
                shopTile(k, "discounts", "Discounts", cash, invert = true)
                shopTile(k, "netSales", "Net sales", cash)
                shopTile(k, "itemsSold", "Items sold", count)
            }
        }
        ShopGate("Sessions and sales over time", r.series) { s -> ShopSeriesBlock(s) }
        AdsTwoPane(
            left = {
                ShopGate("Conversion funnel", r.funnel) { steps -> ShopFunnelBlock(steps) }
                ShopGate("Top products", r.products) { rows ->
                    ShopRankSection("Top products", ShopRanks.rows(rows, cur, money = true, sub = { x -> x.extra["net_items_sold"]?.takeIf { it > 0 }?.let { ShopWords.number(it) + " sold" } }), "Net sales", "No sales in this period.")
                }
                ShopGate("Where they came from", r.sources) { rows ->
                    ShopRankSection("Where they came from", ShopRanks.rows(rows, cur, sub = { x -> x.extra["sessions_that_completed_checkout"]?.takeIf { it > 0 }?.let { ShopWords.number(it) + " bought" } }), "Sessions", "No sessions yet.")
                }
                ShopGate("Devices", r.devices) { rows ->
                    ShopRankSection("Devices", ShopRanks.rows(rows, cur, label = { x -> SiteWords.device(x.label.lowercase()).let { m -> if (m == x.label.lowercase()) x.label else m } }), null, "No sessions yet.")
                }
                ShopGate("Sales by channel", r.channels) { rows -> ShopRankSection("Sales by channel", ShopRanks.rows(rows, cur, money = true), "Net sales", "No sales in this period.") }
                ShopGate("New and returning customers", r.customers) { rows -> ShopRankSection("New and returning customers", ShopRanks.rows(rows, cur, money = true), "Total sales", "No sales in this period.") }
            },
            right = {
                ShopGate("Where they are", r.places) { rows -> ShopRankSection("Where they are", ShopRanks.rows(rows, cur, lead = true), "Sessions", "No sessions yet.") }
                ShopGate("Product pages people land on", r.productPages) { rows ->
                    ShopRankSection("Product pages people land on", ShopRanks.rows(rows, cur), "Sessions. Shopify keeps no per-product views table.", "None in this period.")
                }
                ShopGate("Pages they arrived on", r.landing) { rows ->
                    ShopRankSection("Pages they arrived on", ShopRanks.rows(rows, cur, sub = { x -> x.extra["bounce_rate"]?.takeIf { it > 0 }?.let { SiteWords.pct(it) + " bounced" } }), "Landing pages, by sessions", "No sessions yet.")
                }
                ShopGate("What they searched for", r.searches) { rows ->
                    ShopRankSection("What they searched for", ShopRanks.rows(rows, cur, label = { x -> "“" + x.label + "”" }), "On the store", "No searches yet.")
                }
                ShopGate("Discount codes", r.discounts) { rows -> ShopRankSection("Discount codes", ShopRanks.rows(rows, cur, money = true), "Discounts given", "No codes used in this period.") }
            },
        )
    }
}

@Composable
private fun shopTile(k: ShopKpis, name: String, label: String, format: (Double) -> String, invert: Boolean = false, detail: String? = null) {
    SiteTile(label, format(k.value(name)), now = k.value(name), before = k.before(name), invert = invert, detail = detail)
}

// MARK: Live

@Composable
fun ShopifyLiveScreen() {
    val session = LocalSession.current
    ScreenTitle("Live")
    if (!session.isOwner) {
        ShopOwnersOnly()
        return
    }
    val scope = rememberCoroutineScope()
    var live by remember { mutableStateOf<ShopLive?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    // A failed poll keeps what is on screen; the message shows only when there is nothing yet.
    suspend fun load() {
        try {
            live = ShopLive.from(ErpApi.shared.get("/api/website/shopify-analytics/live")) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (live == null) problem = adsWords(e)
        }
    }
    // Every 60 seconds while the screen is up and the app active (the server keeps an answer that long).
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                load()
                delay(60_000)
            }
        }
    }
    val l = live
    when {
        l != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) { ShopifyLiveContent(l) }
        problem != null -> MarketingErrorState(problem ?: "") { scope.launch { load() } }
        else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading…", shape = SkeletonShape.Figures)
    }
}

/** The page from an answer in hand. */
@Composable
fun ShopifyLiveContent(l: ShopLive) {
    AdsPage {
        ShopGrants(ShopWords.missing(l.all))
        ShopLiveHero(l)
        if (l.note.isNotEmpty()) Text(l.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ShopGate("Today so far", l.today) { k ->
            SiteBlock("Today so far", divided = false) {
                Column(Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) {
                    FigureGrid {
                        SiteTile("Sessions", ShopWords.number(k.value("sessions")), detail = "today")
                        SiteTile("Visitors", ShopWords.number(k.value("visitors")))
                        SiteTile("Added to cart", ShopWords.number(k.value("addedToCart")), detail = "sessions")
                        SiteTile("Reached checkout", ShopWords.number(k.value("reachedCheckout")), detail = ShopWords.number(k.value("completedCheckout")) + " completed")
                    }
                }
            }
        }
        AdsTwoPane(
            left = {
                ShopGate("Orders and checkouts", l.recent) { list -> ShopRecent(list, l.windowMinutes) }
            },
            right = {
                ShopGate("Sessions by the minute", l.sessions) { s -> ShopMinuteBlock(s) }
                ShopGate("Where they are", l.places) { rows -> ShopRankSection("Where they are", ShopRanks.rows(rows, "", lead = true), "Sessions today", "No sessions yet today.") }
            },
        )
    }
}

@Composable
private fun ShopLiveHero(l: ShopLive) {
    val n = l.lastHalfHour
    val on = (n ?: 0) > 0
    Row(
        Modifier.ledgerCard().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(if (on) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)).clearAndSetSemantics {})
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            NumericText(n?.toString() ?: "–", (n ?: 0).toDouble(), style = ErpType.tileValue.copy(fontSize = 34.sp, lineHeight = 40.sp))
            Text("sessions on the store in the last ${l.windowMinutes} minutes", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ShopRecent(list: List<ShopActivity>, window: Int) {
    SiteBlock("Orders and checkouts", note = "The last $window minutes, newest first.") {
        if (list.isEmpty()) {
            AdsRow { Text("No orders or checkouts in the last $window minutes.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            for (a in list) {
                val items = a.items.joinToString(", ") { (title, quantity) -> "$title ×$quantity" }
                val detail = listOf(items, a.place).filter { it.isNotEmpty() }.joinToString(" · ")
                AdsRow(Modifier.semantics(mergeDescendants = true) {}) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                        Icon(if (a.kind == "order") Symbols.ShoppingBag else Symbols.ShoppingCart, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(if (a.kind == "order") "Order " + a.label else a.label, style = MaterialTheme.typography.bodyLarge)
                            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            a.amount?.let { Text(ShopWords.money(it, a.currency), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits)) }
                            Text(ShopWords.ago(a.ago), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

/** Live's sessions by the minute (by the hour where Shopify gave no minutes): the last thirty slots. */
@Composable
private fun ShopMinuteBlock(series: ShopSeries) {
    val points = series.points.takeLast(30)
    val minute = series.grain == "minute"
    SiteBlock(
        if (minute) "Sessions by the minute" else "Sessions by the hour, today",
        note = if (minute) "The last half hour; Shopify’s reports lag by a few minutes." else "Shopify gave no minutes, so the hours of today.",
        divided = false,
    ) {
        AdsRow {
            if (points.isEmpty()) {
                Text("Nothing yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                ShopBars(points.map { it.sessions }, "Sessions each ${if (minute) "minute" else "hour"}", height = 120)
                Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
                    val grey = MaterialTheme.colorScheme.onSurfaceVariant
                    Text(points.first().clock, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits), color = grey)
                    Text(points.last().clock, style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits), color = grey)
                }
            }
        }
    }
}

// MARK: Blocks

/** Bars for a series, one per slot, tall to the tallest; a touch or a drag reads a slot beneath when [labels] are given. */
@Composable
private fun ShopBars(values: List<Double>, spoken: String, height: Int, picked: Int = -1, onPick: ((Int) -> Unit)? = null) {
    val accent = ErpColors.accent
    val base = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    val top = values.maxOrNull() ?: 0.0
    var modifier = Modifier.fillMaxWidth().height(height.dp).semantics { contentDescription = spoken + ": " + values.joinToString(", ") { ShopWords.number(it) } }
    if (onPick != null && values.isNotEmpty()) {
        modifier = modifier
            .pointerInput(values.size) { detectTapGestures { p -> onPick(((p.x / size.width) * values.size).toInt().coerceIn(0, values.size - 1)) } }
            .pointerInput(values.size) { detectHorizontalDragGestures { c, _ -> onPick(((c.position.x / size.width) * values.size).toInt().coerceIn(0, values.size - 1)) } }
    }
    Canvas(modifier) {
        val slot = size.width / max(values.size, 1)
        val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
        val floor = size.height - 0.5.dp.toPx()
        values.forEachIndexed { i, v ->
            val h = if (top > 0) ((v / top).toFloat() * (floor - 2.dp.toPx())).coerceAtLeast(0f) else 0f
            if (h > 0f) {
                val color = if (picked == i) accent else accent.copy(alpha = if (picked < 0) 0.85f else 0.4f)
                drawRoundRect(color, Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(minOf(bar / 2, 3.dp.toPx())))
            }
        }
        drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
    }
}

/** Sessions or sales over the period: bars by the day (by the hour for one day), with the switch beside the title. */
@Composable
private fun ShopSeriesBlock(series: ShopSeries) {
    var mode by remember { mutableIntStateOf(0) }
    var picked by remember(series, mode) { mutableIntStateOf(-1) }
    val hourly = series.grain == "hour"
    val points = series.points
    val values = points.map { if (mode == 0) it.sessions else it.sales }
    fun label(p: ShopSeriesPoint) = if (hourly) p.hour?.let { String.format(java.util.Locale.US, "%02d:00", it) } ?: p.at else SiteWords.shortDay(p.day)
    SiteBlock(
        if (mode == 0) "Sessions over time" else "Total sales over time",
        note = if (hourly) "By the hour, Karachi time" else "Day by day",
        options = listOf("Sessions", "Sales"), choice = mode, onChoice = { mode = it }, divided = false,
    ) {
        AdsRow {
            if (points.isEmpty()) {
                Text("Nothing in this period yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                ShopBars(values, if (mode == 0) "Sessions each ${if (hourly) "hour" else "day"}" else "Total sales each ${if (hourly) "hour" else "day"}", 200, picked) { picked = it }
                val grey = MaterialTheme.colorScheme.onSurfaceVariant
                Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
                    Text(label(points.first()), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = grey)
                    Text(label(points.last()), style = MaterialTheme.typography.labelSmall, color = grey)
                }
                val p = points.getOrNull(picked)
                Text(
                    p?.let { label(it) + ": " + if (mode == 0) ShopWords.number(it.sessions) + " sessions" else ShopWords.number(it.sales) + " sales" } ?: "Touch the chart to read a slot.",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (p == null) FontWeight.Normal else FontWeight.Medium),
                    color = if (p == null) grey else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/** Sessions, added to cart, reached checkout, completed: each step against the first, and against the period before. */
@Composable
private fun ShopFunnelBlock(steps: List<ShopFunnelStep>) {
    val top = max(1.0, steps.firstOrNull()?.value ?: 1.0)
    SiteBlock("Conversion funnel", note = "Sessions that…") {
        steps.forEachIndexed { i, s ->
            AdsRow(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(s.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text(ShopWords.number(s.value), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
                    if (i > 0) Text(SiteWords.pct(s.value / top, 1) + " of sessions", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    s.before?.let { SiteDelta(s.value, it) }
                }
                SiteBar(s.value / top)
            }
        }
    }
}

/** One line of a ranked list, its value already said. */
data class ShopRankRow(val id: String, val lead: String?, val label: String, val sub: String?, val value: Double, val text: String)

object ShopRanks {
    /** Shopify's rows as ranked rows: the flag of a place (`lead`), a second line (`sub`), money or a count. */
    fun rows(
        list: List<ShopListRow>, currency: String, money: Boolean = false, lead: Boolean = false, label: ((ShopListRow) -> String)? = null, sub: ((ShopListRow) -> String?)? = null,
    ): List<ShopRankRow> = list.mapIndexed { i, r ->
        ShopRankRow(
            "$i|${r.key}", if (lead) SiteWords.flag(r.code) else null, label?.invoke(r) ?: r.label, sub?.invoke(r), r.value,
            if (money) ShopWords.money(r.value, currency) else ShopWords.number(r.value),
        )
    }
}

/** A block of ranked rows with a bar under each: the first few, then "Show all". */
@Composable
private fun ShopRankSection(title: String, rows: List<ShopRankRow>, note: String?, empty: String, show: Int = 5) {
    var all by remember { mutableStateOf(false) }
    SiteBlock(title, note = note) {
        if (rows.isEmpty()) {
            AdsRow { Text(empty, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            val sum = rows.sumOf { it.value }
            val top = max(1.0, rows.maxOf { it.value })
            for (r in if (all) rows else rows.take(show)) {
                val share = if (sum > 0) r.value / sum else 0.0
                AdsRow(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (r.lead != null) Text(r.lead, Modifier.clearAndSetSemantics {})
                        Column(Modifier.weight(1f)) {
                            Text(r.label, style = MaterialTheme.typography.bodyLarge)
                            if (r.sub != null) Text(r.sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(r.text, style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
                        Text(SiteWords.pct(share), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    SiteBar(r.value / top)
                }
            }
            if (rows.size > show) {
                AdsRow(onClick = { all = !all }) {
                    Text(if (all) "Show fewer" else "Show all ${rows.size}", style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
                }
            }
        }
    }
}

// MARK: Gate and grant card

/**
 * A section's content when there is data; a skeleton while it has not arrived; a scope not granted draws nothing here (one card at the
 * top says what to grant); a section Shopify failed to answer says so in its own block.
 */
@Composable
private fun <T : Any> ShopGate(title: String, section: ShopSection<T>, content: @Composable (T) -> Unit) {
    when (section) {
        is ShopSection.Ready -> content(section.data)
        is ShopSection.Failed -> SiteBlock(title) {
            AdsRow { Text("Shopify did not answer this one: " + section.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        is ShopSection.Missing -> Unit
        ShopSection.Absent -> Unit
    }
}

/** "Grant read_reports in Shopify", with the steps. Owners see it where a section came back without its scope. */
@Composable
private fun ShopGrants(missing: List<ShopSection.Missing>) {
    for (m in missing) {
        val why = if (m.scope == "read_orders") "Without it the orders and checkouts of the last half hour stay empty." else "Without it Shopify’s sessions, sales and sources stay empty here."
        val steps = listOf(
            "In the Shopify admin, open Settings, then Apps and sales channels, then Develop apps (or the app in the Dev Dashboard).",
            "Open the app’s Configuration, then Admin API access scopes.",
            "Tick ${m.scope} and save.",
            "Install the app again, so Shopify hands the ERP the new token.",
        )
        SiteBlock("Grant ${m.scope} in Shopify", divided = false) {
            AdsRow(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    Icon(Symbols.Lock, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                steps.forEachIndexed { i, step ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                        Text("${i + 1}.", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(step, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (!m.note.isNullOrEmpty()) Text(m.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Shopify's reports are the owners' (the routes answer 403 to anyone else). */
@Composable
private fun ShopOwnersOnly() {
    NotAvailableState("Shopify analytics are for the owners", why = "Ask an owner how the online store is doing.", icon = Symbols.Lock)
}
