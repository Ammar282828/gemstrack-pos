package erp.app.screens.marketing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.ScreenTitle
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsRow
import erp.app.screens.ads.AdsTwoPane
import erp.app.screens.ads.adsWords
import erp.app.ui.ErpPullToRefreshBox
import erp.app.ui.FigureGrid
import erp.app.ui.FigureTile
import erp.app.ui.LedgerHeading
import erp.app.ui.NumericText
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Website -> Interest -> Live (WebsiteLive.swift; src/app/website/interest/live/page.tsx): who is on the house's website
// right now (seen in the last five minutes), where, on which page, from where; and today's running totals.
// GET /api/website/analytics/live, asked again every 15 seconds, only while this screen is up.

@Composable
fun WebsiteLiveScreen() {
    ScreenTitle("Live")
    val scope = rememberCoroutineScope()
    var live by remember { mutableStateOf<SiteLive?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    // A failed poll keeps what is on screen; the message shows only when there is nothing yet.
    suspend fun load() {
        try {
            live = if (House.isDemo) WebsiteDemo.live() else SiteLive.from(ErpApi.shared.get("/api/website/analytics/live")) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (live == null) problem = adsWords(e)
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                load()
                delay(15_000)
            }
        }
    }

    val l = live
    when {
        l != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) { LiveContent(l) }
        problem != null -> MarketingErrorState(problem ?: "", if (House.isDemo) null else ({ scope.launch { load() } }))
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Loading…") }
    }
}

/** The page from an answer in hand (the screenshot tests draw it from made-up numbers). */
@Composable
fun LiveContent(l: SiteLive) {
    AdsPage {
        Hero(l)
        Today(l.today)
        if (l.visitors > 0) {
            AdsTwoPane(
                left = {
                    SiteRankSection("Where they are", SiteRanks.cityRows(l.countries, l.cityRows), total = l.visitors, alt = SiteRanks.countryRows(l.countries), picks = listOf("Cities", "Countries"))
                    SiteRankSection("How they came", SiteRanks.counts(l.sources, SiteWords::source), total = l.visitors)
                    SiteRankSection("On", SiteRanks.counts(l.devices, SiteWords::device), total = l.visitors)
                },
                right = {
                    SiteRankSection("What they’re looking at", SiteRanks.pages(l.pages), total = l.visitors)
                    Visits(l.sessions)
                },
            )
        } else {
            Text(
                "No one on the site at the moment. Visits are counted from 23 October 2026.",
                Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Hero(l: SiteLive) {
    val who = if (l.visitors == 1) "person" else "people"
    val words = buildString {
        append("$who on the site now")
        if (l.visitors > 0) append(" · ${l.newVisitors} new, ${maxOf(0, l.visitors - l.newVisitors)} returning")
    }
    Row(
        Modifier.ledgerCard().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(10.dp).clip(CircleShape).background(if (l.visitors > 0) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
                .clearAndSetSemantics {},
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            NumericText("${l.visitors}", l.visitors.toDouble(), style = ErpType.tileValue.copy(fontSize = 34.sp, lineHeight = 40.sp))
            Text(words, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Today(t: SiteLiveToday) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LedgerHeading("Today so far", Modifier.padding(horizontal = 4.dp))
        FigureGrid {
            FigureTile("Sessions", SiteWords.number(t.sessions), detail = SiteWords.number(t.visitors) + " people", number = t.sessions.toDouble())
            FigureTile("Page views", SiteWords.number(t.pageviews), detail = SiteWords.duration(t.avgSessionMs) + " a session", number = t.pageviews.toDouble())
            FigureTile("Opened a piece", SiteWords.number(t.pieces), detail = SiteWords.number(t.saves) + " saved one", number = t.pieces.toDouble())
            FigureTile("Asked on WhatsApp", SiteWords.number(t.enquiries), detail = SiteWords.pct(t.conversion, 1) + " of sessions", number = t.enquiries.toDouble())
        }
    }
}

// MARK: Each visit

@Composable
private fun Visits(visits: List<SiteLiveVisit>) {
    SiteBlock("Each visit", note = "Newest first; no names, no addresses.") {
        for (v in visits) VisitRow(v)
    }
}

private fun place(v: SiteLiveVisit): String = (listOfNotNull(v.city.ifEmpty { null }) + SiteWords.countryName(v.cc)).joinToString(", ")

private fun detail(v: SiteLiveVisit): String {
    val device = SiteWords.device(v.device) + if (v.browser.isEmpty()) "" else ", " + v.browser
    return listOf(place(v), SiteWords.source(v.source), device, if (v.isNew) "new" else "returning").joinToString(" · ")
}

private fun stay(v: SiteLiveVisit): String {
    val pages = SiteWords.pages(v.pages)
    return if (v.forMs > 0) pages + " · " + SiteWords.duration(v.forMs) else pages
}

@Composable
private fun VisitRow(v: SiteLiveVisit) {
    AdsRow(Modifier.semantics(mergeDescendants = true) {}) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Text(SiteWords.flag(v.cc), Modifier.clearAndSetSemantics {}, style = MaterialTheme.typography.titleMedium)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(SiteWords.page(v.path), style = MaterialTheme.typography.bodyLarge)
                Text(detail(v), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stay(v), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(SiteWords.ago(v.ago), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
