package erp.app.screens.marketing

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsRow
import erp.app.screens.ads.AdsSection
import erp.app.screens.ads.AdsTwoPane
import erp.app.screens.ads.adsWords
import erp.app.screens.stock.StockImage
import erp.app.ui.AppClock
import erp.app.ui.ChipRow
import erp.app.ui.ErpPullToRefreshBox
import erp.app.ui.FigureGrid
import erp.app.ui.FilterChip
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Website -> Interest (WebsiteInterest.swift; src/app/website/interest/page.tsx): the site's report for the chosen period
// (GET /api/website/analytics) with the piece rankings for the same days beneath it (GET /api/website/interest), counted
// anonymously by the house's own site. Live is its own screen (WebsiteLive.kt).

private const val PERIOD_KEY = "websiteInterest.period"
private const val LIST_KEY = "websiteInterest.list"

private val periods = listOf("today" to "Today", "yesterday" to "Yesterday", "7d" to "7 days", "30d" to "30 days", "90d" to "90 days", "all" to "All time")

/** How the numbers are counted (the web's note), with the geolocation credit DB-IP's licence asks for. */
private const val COUNTING_NOTE =
    "A session is one visit; a new one starts after 30 minutes away. Visitors are told apart by a random id their browser keeps, never by name or address; " +
        "visitors who ask not to be tracked (Do Not Track) and bots are not counted. Places come from the visitor’s network address, looked up and then " +
        "forgotten — IP Geolocation by DB-IP (db-ip.com); city for Pakistan and the Gulf, the country elsewhere."

@Composable
fun WebsiteInterestScreen() {
    ScreenTitle("Interest")
    val scope = rememberCoroutineScope()
    var storedPeriod by remember { mutableStateOf(Prefs.string(PERIOD_KEY) ?: "30d") }
    var custom by remember { mutableStateOf(false) }
    var customFrom by remember { mutableStateOf("") }
    var customTo by remember { mutableStateOf("") }
    var picking by remember { mutableStateOf(false) }
    var list by remember { mutableStateOf(WebsiteInterestList.of(Prefs.string(LIST_KEY))) }
    var report by remember { mutableStateOf<SiteReport?>(null) }
    var pieces by remember { mutableStateOf<List<WebsiteInterestPiece>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var liveNow by remember { mutableStateOf<Int?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    val periodKey = if (periods.any { it.first == storedPeriod }) storedPeriod else "30d"
    val query = if (custom) "range=custom&from=$customFrom&to=$customTo" else "range=$periodKey"

    // The previous report and list stay while the next period loads; a failure shows only when there is nothing to show.
    suspend fun load() {
        if (custom && (customFrom.isEmpty() || customTo.isEmpty())) return
        try {
            if (House.isDemo) {
                val r = WebsiteDemo.siteReport(if (custom) "custom" else periodKey, AppClock.now(), customFrom, customTo)
                report = r
                pieces = WebsiteDemo.interest()
                problem = null
                return
            }
            val r = ErpApi.shared.get("/api/website/analytics?$query").let { SiteReport.from(it) } ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            report = r
            problem = null
            // The piece rankings for the same days as the report.
            pieces = WebsiteApi.get("/api/website/interest?from=${r.from}&to=${r.to}", WebsiteInterestAnswer).pieces
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (report == null) problem = adsWords(e)
        }
    }
    LaunchedEffect(query) { load() }

    // "N on the site now": asked once on appearing, then every 30 seconds, only while this screen is up.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    liveNow = if (House.isDemo) WebsiteDemo.live().visitors else SiteLive.from(ErpApi.shared.get("/api/website/analytics/live"))?.visitors ?: liveNow
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // The count stays as it was.
                }
                delay(30_000)
            }
        }
    }

    val r = report
    when {
        r != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
            InterestContent(
                r, pieces, list, custom, periodKey, liveNow,
                onPeriod = { k -> if (custom || k != periodKey) { custom = false; storedPeriod = k; Prefs.putString(PERIOD_KEY, k) } },
                onCustom = { picking = true },
                onList = { list = it; Prefs.putString(LIST_KEY, it.name) },
            )
        }
        problem != null -> MarketingErrorState(problem ?: "", if (House.isDemo) null else ({ scope.launch { load() } }))
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Loading…") }
    }
    if (picking) {
        val today = ERPDate.karachiDay(AppClock.now())
        SiteCustomRangeDialog(
            customFrom.ifEmpty { report?.from ?: today }, customTo.ifEmpty { report?.to ?: today }, { picking = false },
            { a, b -> customFrom = a; customTo = b; custom = true },
        )
    }
}

/** The page from answers in hand (the screenshot tests draw it from made-up numbers). */
@Composable
fun InterestContent(
    r: SiteReport, pieces: List<WebsiteInterestPiece>?, list: WebsiteInterestList, custom: Boolean, periodKey: String, liveNow: Int?,
    onPeriod: (String) -> Unit, onCustom: () -> Unit, onList: (WebsiteInterestList) -> Unit,
) {
    val n = r.now
    AdsPage {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ChipRow(Modifier.fullBleed()) {
                for ((k, label) in periods) FilterChip(label, chosen = !custom && periodKey == k, onClick = { onPeriod(k) })
                FilterChip("Custom", chosen = custom, onClick = onCustom)
            }
            Text(
                SiteWords.span(r.from, r.to) + " · compared with " + SiteWords.span(r.previous.from, r.previous.to),
                Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LiveLink(liveNow)
        if (n.sessions == 0 && r.before.sessions == 0) {
            Text(
                "Nothing counted in this period yet. Visits are counted from 23 October 2026; piece interest from 22 October. It fills as people use the website.",
                Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Tiles(r)
        SiteChartSection(r)
        AdsTwoPane(
            left = {
                SiteFunnelSection(n, r.before)
                SiteRankSection("Where they came from", SiteRanks.sourceRows(n.sources), total = n.sessions, empty = "No sessions yet.", alt = SiteRanks.channelRows(n.channels), picks = listOf("Sources", "Kinds"))
                SiteSourcesSection(n.sources)
                SiteRankSection("Campaigns", SiteRanks.campaignRows(n), total = n.sessions)
                SiteRankSection("Device", SiteRanks.counts(n.devices, SiteWords::device), total = n.sessions, empty = "No sessions yet.")
                SiteRankSection("System", SiteRanks.plain(n.os), total = n.sessions, empty = "No sessions yet.")
                SiteRankSection("Browser", SiteRanks.plain(n.browsers), total = n.sessions, empty = "No sessions yet.", note = "Instagram and Facebook are their in-app browsers.")
            },
            right = {
                SiteRankSection("Where they are", SiteRanks.cityRows(n.countries, n.cities), total = n.sessions, empty = "No sessions yet.", alt = SiteRanks.countryRows(n.countries), picks = listOf("Cities", "Countries"))
                SiteRankSection("Pages they arrived on", SiteRanks.pages(n.landing), total = n.sessions, empty = "No sessions yet.")
                SiteRankSection("Pages they left from", SiteRanks.pages(n.exits), total = n.sessions, empty = "No sessions yet.")
                SiteRankSection("Most viewed pages", SiteRanks.pages(n.pages), total = n.pageviews, empty = "No page views yet.")
                SiteRankSection("Collections browsed", SiteRanks.pages(n.collections), empty = "No collection pages opened yet.")
                SiteRankSection("What they searched for", SiteRanks.searchRows(n))
                SiteRankSection("Pages not found", SiteRanks.pages(n.notFound), note = "A broken link somewhere, or a piece taken down.")
            },
        )
        InterestPieces(pieces, list, onList)
    }
}

@Composable
private fun LiveLink(liveNow: Int?) {
    val navigator = LocalNavigator.current
    AdsSection(null) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open("/website/interest/live") }.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.GraphicEq, contentDescription = null, tint = if ((liveNow ?: 0) > 0) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                if (liveNow != null) "$liveNow on the site now" else "Live",
                Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits),
            )
            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Tiles(r: SiteReport) {
    val n = r.now
    val b = r.before
    val share = if (n.sessions > 0) n.returningSessions.toDouble() / n.sessions else 0.0
    FigureGrid {
        SiteTile("Sessions", SiteWords.number(n.sessions), now = n.sessions.toDouble(), before = b.sessions.toDouble(), detail = String.format(java.util.Locale.US, "%.1f pages each", n.pagesPerSession))
        SiteTile("Visitors", SiteWords.number(n.visitors), now = n.visitors.toDouble(), before = b.visitors.toDouble(), detail = if (r.visitorsExact) null else "day by day, added")
        SiteTile("Page views", SiteWords.number(n.pageviews), now = n.pageviews.toDouble(), before = b.pageviews.toDouble())
        SiteTile("Time on site", SiteWords.duration(n.avgSessionMs), now = n.avgSessionMs, before = b.avgSessionMs, detail = "a session, on average")
        SiteTile("Bounce rate", SiteWords.pct(n.bounceRate), now = n.bounceRate, before = b.bounceRate, invert = true, detail = "left after one page")
        SiteTile("Asked on WhatsApp", SiteWords.number(n.funnel.enquire), now = n.funnel.enquire.toDouble(), before = b.funnel.enquire.toDouble(), detail = SiteWords.pct(n.conversion, 1) + " of sessions")
        SiteTile("Saved a piece", SiteWords.number(n.funnel.save), now = n.funnel.save.toDouble(), before = b.funnel.save.toDouble(), detail = "sessions")
        SiteTile(
            "Returning", SiteWords.pct(share), now = n.returningSessions.toDouble(), before = b.returningSessions.toDouble(),
            detail = SiteWords.number(n.returningSessions) + " sessions · " + SiteWords.number(n.newVisitors) + " new people",
        )
    }
}

// MARK: Pieces

@Composable
internal fun InterestPieces(pieces: List<WebsiteInterestPiece>?, list: WebsiteInterestList, onList: (WebsiteInterestList) -> Unit) {
    val rows = list.ranked(pieces ?: emptyList())
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        erp.app.ui.LedgerHeading("Pieces", Modifier.padding(horizontal = 4.dp))
        // Four names that should not be clipped at large text: chips that scroll, not a segmented bar.
        ChipRow(Modifier.fullBleed()) {
            for (l in WebsiteInterestList.entries) FilterChip(l.title, chosen = l == list, onClick = { onList(l) })
        }
        AdsSection(null, footer = { Text(COUNTING_NOTE) }) {
            if (pieces != null && rows.isEmpty()) AdsRow { Text(list.emptyTitle + ". It fills as people use the website.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            rows.forEachIndexed { i, p -> PieceRow(p, i + 1, list) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PieceRow(r: WebsiteInterestPiece, rank: Int, list: WebsiteInterestList) {
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val hasLink = r.url.isNotEmpty()
    val name = r.name.ifEmpty { r.piece }
    Box {
        Row(
            Modifier.fillMaxWidth()
                .combinedClickable(enabled = hasLink, role = Role.Button, onClick = { openPiece(context, r.url) }, onLongClick = { menu = true }, onLongClickLabel = "Open or copy the link")
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("$rank", Modifier.padding(end = 0.dp), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
            StockImage(r.thumb, name, r.piece, Modifier.size(44.dp).clip(Radius.thumbShape))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, style = MaterialTheme.typography.bodyLarge)
                Text(list.say(r), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (r.collection.isNotEmpty()) Text(r.collection, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f))
            }
        }
        if (hasLink) {
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Open on the website") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, null) },
                    onClick = { menu = false; openPiece(context, r.url) },
                )
                DropdownMenuItem(
                    text = { Text("Copy link") }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) },
                    onClick = {
                        menu = false
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Link", r.url))
                    },
                )
            }
        }
    }
}

private fun openPiece(context: Context, url: String) {
    if (url.isEmpty()) return
    erp.app.device.openAddress(context, Intent.ACTION_VIEW, url)
}
