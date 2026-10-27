package erp.app.screens.ads

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.NavMap
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import java.time.Instant
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A failure said in the ERP's own words. */
fun adsWords(e: Throwable): String = (e as? ErpApi.Failure)?.message ?: e.message ?: "Something went wrong. Try again."

/** The clock, "4:05 pm", in Karachi (MarketingTime.clock). TODO(shared): MarketingKit.MarketingTime.clock. */
fun adsClock(iso: String?): String {
    val d = erp.core.ERPDate.parse(iso) ?: return ""
    return java.time.format.DateTimeFormatter.ofPattern("h:mm a", Locale.UK).withZone(erp.core.ERPDate.karachi).format(d)
        .replace(Regex("(?i)\\s*([ap])\\.?m\\.?$")) { " ${it.groupValues[1].lowercase()}m" }
}

/** Whether the map shows this person a place (MarketingKit.has). TODO(shared): MarketingKit.has. */
fun adsMapHas(href: String, role: String): Boolean {
    val map = NavMap.current.visible(role)
    for (e in map.entries) {
        if (e.href == href) return true
        if ((e.tabs ?: emptyList()).any { it.href == href }) return true
        if ((e.pages ?: emptyList()).any { it.href == href }) return true
    }
    return false
}

/**
 * Ads → Overview (src/app/ads/page.tsx): what the house's Meta ads cost and brought over a range, each against the
 * same length of time before, day by day, the ads that spent most, who saw them, and what Meta has flagged. Read from
 * /api/ads/overview, which answers owners and marketing accounts. The one thing done here is the web's own: pause a
 * flagged ad set, or run a paused one again (asked first, since it spends).
 */
@Composable
fun AdsOverviewScreen() {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val mayRead = adsMayUse(session.role)
    val rangeKey = AdsRangeStore.key
    val changes by AdsChanges.count.collectAsStateWithLifecycle()

    var data by remember { mutableStateOf<AdOverview?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var acting by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<AdAttention?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Ads")
    if (mayRead) ScreenActions { AdsRangeMenu() }

    suspend fun load(fresh: Boolean) {
        try {
            data = backend.overview(AdsRangeStore.key, fresh)
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    // The range, and a change made on a page opened from here, read it again (a change comes fresh).
    LaunchedEffect(rangeKey, changes, mayRead) { if (mayRead) load(fresh = changes > 0) }

    if (!mayRead) {
        AdsOwnersOnly()
        return
    }
    val d = data
    when {
        d != null -> PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; load(fresh = true); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            AdsOverviewContent(
                d = d, rangeKey = rangeKey, problem = problem, acting = acting, role = session.role,
                onPause = { a ->
                    scope.launch {
                        acting = a.targetId
                        try {
                            backend.setRunning(a.level, a.targetId, false)
                            load(fresh = true)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            failure = adsWords(e)
                        } finally {
                            acting = null
                        }
                    }
                },
                onRunAgain = { asking = it },
            )
        }
        problem != null -> AdsUnavailable("Ads aren't ready", problem ?: "") {
            // The demo has no ERP to ask again: no button that can only fail.
            if (!House.isDemo) AdsTonalButton("Try again", { scope.launch { load(fresh = true) } })
            AdsTonalButton("Open Setup", { navigator.open("/ads/setup") })
        }
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the ads") }
    }

    asking?.let { a ->
        AdsConfirm(
            title = "Run it again?", message = "${a.targetName} will spend its budget again.", confirm = "Run again",
            onDismiss = { asking = null },
            onConfirm = {
                scope.launch {
                    acting = a.targetId
                    try {
                        backend.setRunning(a.level, a.targetId, true)
                        load(fresh = true)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = adsWords(e)
                    } finally {
                        acting = null
                    }
                }
            },
        )
    }
    erp.app.ui.FailureAlert(failure, { failure = null }, "Meta didn't take that")
}

/** "Thu 1 Oct to Wed 7 Oct, compared with …" in the shop's date words. */
fun adsPeriodLine(d: AdOverview, rangeKey: String): String {
    fun span(a: String?, b: String?): String {
        if (a == null || b == null) return ""
        return if (a == b) ShopDate.say(a) else "${ShopDate.say(a)} to ${ShopDate.say(b)}"
    }
    val now = span(d.since, d.until)
    val before = span(d.beforeSince, d.beforeUntil)
    if (now.isEmpty()) return AdsRange.label(rangeKey)
    return if (before.isEmpty()) now else "$now, compared with $before"
}

/** The page itself, from an answer already in hand (the screenshot tests draw it from made-up numbers). */
@Composable
fun AdsOverviewContent(
    d: AdOverview,
    rangeKey: String,
    problem: String?,
    acting: String?,
    role: String,
    onPause: (AdAttention) -> Unit,
    onRunAgain: (AdAttention) -> Unit,
) {
    val cur = d.account.currency
    AdsPage {
        AdsTwoPane(
            left = {
                AccountCard(d, rangeKey)
                if (problem != null) AdsSection("Couldn't refresh") { AdsWarningRow(problem, Tone.quiet, Symbols.WifiOff) }
                Figures(d, cur)
                Brought(d)
                Attention(d, acting, onPause, onRunAgain)
            },
            right = {
                MonthCard(d, cur)
                DayByDay(d, cur)
                TopAds(d, cur, rangeKey)
                Split("Who saw them", d.ageGender, cur)
                Split("Where", d.placement, cur)
                Split("Region", d.region, cur)
                ElsewhereInAds(d, role)
            },
        )
    }
}

@Composable
private fun AccountCard(d: AdOverview, rangeKey: String) {
    val words = AdsStatusWords.ofAccount(d.account.status)
    AdsSection(null, footer = { Text(adsPeriodLine(d, rangeKey)) }) {
        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(d.account.name, style = MaterialTheme.typography.titleMedium)
                if (!d.account.funding.isNullOrEmpty()) {
                    Text(d.account.funding, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            erp.app.ui.Pill(words.label, tone = AdsStatusWords.tone(words.tone))
        }
    }
}

@Composable
private fun Figures(d: AdOverview, cur: String) {
    val t = d.totals
    val b = d.before
    val main = AdsResults.headlineResult(t)
    val spentNote = listOfNotNull(AdsFormat.change(t.spend, b?.spend), "${AdsFormat.money(d.account.amountSpent, cur)} all time").joinToString(" · ")
    val reachNote = AdsFormat.change(t.reach, b?.reach) ?: "${AdsFormat.compact(t.impressions)} views"
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FigureRow(spacing = 10.dp) {
            FigureTile("Spent", AdsFormat.money(t.spend, cur), Modifier.share(), detail = spentNote, number = t.spend)
            FigureTile("People reached", AdsFormat.compact(t.reach), Modifier.share(), detail = reachNote, number = t.reach)
        }
        FigureRow(spacing = 10.dp) {
            // The result the account mostly buys, or clicks where it has none.
            if (main.key == "reach") {
                FigureTile("Clicks", AdsFormat.count(t.clicks), Modifier.share(), detail = if (t.clicks > 0) "${AdsFormat.money(t.cpc, cur)} each" else null, number = t.clicks)
            } else {
                val before = b?.let { AdsResults.value(it, main.key) }
                val each = if (main.value > 0) "${AdsFormat.money(t.spend / main.value, cur)} each" else null
                FigureTile(main.label, AdsFormat.count(main.value), Modifier.share(), detail = AdsFormat.change(main.value, before) ?: each, number = main.value)
            }
            FigureTile("Click-through", AdsFormat.pct(t.ctr), Modifier.share(), detail = "${AdsFormat.money(t.cpm, cur)} per 1,000 views", number = t.ctr)
        }
        SalesTiles(t, b, cur)
    }
}

/** What the ads sold, when they sold anything (ads/page.tsx: Sales from ads · ROAS · Cost per purchase). */
@Composable
private fun SalesTiles(t: AdMetrics, b: AdMetrics?, cur: String) {
    val s = AdsResults.sales(t)
    if (s.purchases <= 0 && s.value <= 0) return
    val before = b?.let { AdsResults.sales(it) }
    FigureRow(spacing = 10.dp) {
        FigureTile("Sales from ads", AdsFormat.money(s.value, cur), Modifier.share(),
            detail = AdsFormat.change(s.value, before?.value) ?: "${AdsFormat.count(s.purchases)} order${if (s.purchases == 1.0) "" else "s"}", number = s.value)
        FigureTile("ROAS", AdsResults.roasText(s.roas), Modifier.share(),
            detail = s.costPerPurchase?.let { "${AdsFormat.money(it, cur)} per order" } ?: "Sales for every rupee spent")
    }
}

@Composable
private fun Brought(d: AdOverview) {
    val actions = AdsResults.headlineActions(d.totals, limit = 10)
    if (actions.isEmpty()) return
    AdsSection("What it brought") {
        for (a in actions) ValueRow(a.label) {
            Text(AdsFormat.count(a.value), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
        }
    }
}

@Composable
private fun Attention(d: AdOverview, acting: String?, onPause: (AdAttention) -> Unit, onRunAgain: (AdAttention) -> Unit) {
    val navigator = LocalNavigator.current
    AdsSection("Needs a look", count = d.attention.size) {
        if (d.attention.isEmpty()) {
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Symbols.CheckCircle, contentDescription = null, Modifier.size(20.dp), tint = Tone.settled.color())
                Text("Nothing needs attention.", color = Tone.settled.color())
            }
        } else {
            for (a in d.attention) {
                val tap = a.doing == "open" && a.href.isNotEmpty()
                AdsRow(onClick = if (tap) ({ navigator.open(a.href) }) else null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Icon(
                            if (a.severity == "tip") Symbols.Lightbulb else Symbols.Warning, contentDescription = null,
                            Modifier.size(20.dp).padding(top = 2.dp),
                            tint = when (a.severity) { "bad" -> Tone.problem.color(); "warn" -> Tone.owed.color(); else -> MaterialTheme.colorScheme.onSurfaceVariant },
                        )
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(a.title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                            Text(a.why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (a.doing == "pause") AdsTonalButton("Pause", { onPause(a) }, enabled = acting == null)
                            else if (a.doing == "resume") AdsTonalButton("Run again", { onRunAgain(a) }, enabled = acting == null)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthCard(d: AdOverview, cur: String) {
    val m = d.month ?: return
    if (!(m.spent > 0 || m.lastMonth > 0)) return
    AdsSection("This month") {
        ValueRow("Spent so far") { Text(AdsFormat.money(m.spent, cur), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits)) }
        ValueRow("Heading for") { Text(AdsFormat.money(m.projected, cur), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits)) }
        if (m.lastMonth > 0) ValueRow("Last month") { Text(AdsFormat.money(m.lastMonth, cur), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits)) }
        AdsRow {
            Text("Day ${m.dayOfMonth} of ${m.daysInMonth}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            AdsMeter(minOf(m.dayOfMonth, m.daysInMonth).toDouble(), m.daysInMonth.toDouble(), "Day ${m.dayOfMonth} of ${m.daysInMonth}")
        }
    }
}

@Composable
private fun DayByDay(d: AdOverview, cur: String) {
    // A chart of one day is a dot: it needs two.
    val days = d.daily.filter { runCatching { java.time.LocalDate.parse(it.date) }.isSuccess }
    if (days.size <= 1) return
    AdsSection("Day by day", divided = false, footer = { Text("Spend each day, in ${cur.uppercase()}.") }) {
        AdsDayBars(days, cur, Modifier.padding(16.dp))
    }
}

@Composable
private fun TopAds(d: AdOverview, cur: String, rangeKey: String) {
    val navigator = LocalNavigator.current
    AdsSection("The ads that spent most") {
        if (d.topAds.isEmpty()) {
            AdsRow { Text("No ad spent anything in ${AdsRange.label(rangeKey).lowercase()}.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            for (a in d.topAds) {
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open("/ads/campaigns?ad=${a.id}") }.ledgerRow(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AdsPicture(a.thumbnail, a.name, a.id, Modifier.size(48.dp).clip(Radius.thumbShape))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(a.campaign, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(AdsFormat.money(a.metrics.spend, cur), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
                        Text(resultLine(a, cur), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

fun resultLine(a: AdTop, cur: String): String {
    val s = AdsResults.sales(a.metrics)
    val roas = if (s.value > 0) " · ${AdsResults.roasText(s.roas)} ROAS" else ""
    val r = AdsResults.of(a.metrics, a.goal) ?: return "${AdsFormat.compact(a.metrics.reach)} reached$roas"
    val each = if (r.value > 0) " · ${AdsFormat.money(a.metrics.spend / r.value, cur)} each" else ""
    return "${AdsFormat.count(r.value)} ${r.label.lowercase()}$each$roas"
}

@Composable
private fun Split(title: String, rows: List<AdSplit>, cur: String) {
    val top = rows.take(8)
    if (top.isEmpty()) return
    val bySpend = top.any { it.metrics.spend > 0 }
    val biggest = top.maxOf { if (bySpend) it.metrics.spend else it.metrics.impressions }
    AdsSection(title) {
        for (r in top) {
            val v = if (bySpend) r.metrics.spend else r.metrics.impressions
            val shown = if (bySpend) AdsFormat.money(v, cur) else "${AdsFormat.compact(v)} views"
            AdsRow(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(r.label, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(shown, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                AdsMeter(v, maxOf(biggest, 1.0), "${r.label}: $shown")
            }
        }
    }
}

@Composable
private fun ElsewhereInAds(d: AdOverview, role: String) {
    AdsSection(
        null,
        footer = {
            if (d.at.isNotEmpty()) {
                Text("From Meta, ${adsClock(d.at)}. Today's numbers keep changing for a few hours; reach across days can't be added up, so \"people reached\" is Meta's own count for the whole range.")
            }
        },
    ) {
        AdsLink("Campaigns", Symbols.Checklist, "/ads/campaigns", "Every campaign, ad set and ad; run or pause them")
        if (adsMapHas("/ads/studio", role)) AdsLink("Studio", Symbols.Palette, "/ads/studio", "Make the creative before the ad")
        AdsLink("New ad", Symbols.Send, "/ads/new", "Boost a piece or an Instagram post")
        AdsLink("Setup", Symbols.Tune, "/ads/setup", "The Meta connection, ad account, audiences and rules")
    }
}
