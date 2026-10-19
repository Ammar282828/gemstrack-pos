package erp.app.screens.marketing

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.device.openAddress
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.ads.AdsFormat
import erp.app.screens.ads.AdsLink
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsResults
import erp.app.screens.ads.AdsRow
import erp.app.screens.ads.AdsSection
import erp.app.screens.ads.AdsTonalButton
import erp.app.screens.ads.AdsTwoPane
import erp.app.screens.ads.AdsUnavailable
import erp.app.screens.ads.adsClock
import erp.app.screens.ads.adsWords
import erp.app.screens.stock.StockImage
import erp.app.ui.AppClock
import erp.app.ui.ChipRow
import erp.app.ui.ErpPullToRefreshBox
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.StatusBadge
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Insights (Insights.swift; src/app/insights): Instagram and Facebook, organic beside paid, read from /api/insights.
// Three screens on the web's own paths: Overview, Posts, Audience. Owners and marketing accounts only.

/** The range, remembered on the phone and shared by the three screens (Instagram stops at 30 days, so it isn't Ads' range). */
object InsightsRangeStore {
    private const val KEY = "insights.range"
    var key by mutableStateOf(Prefs.string(KEY) ?: "last_28d")
        private set

    fun set(k: String) {
        key = k
        Prefs.putString(KEY, k)
    }
}

/** The range as a menu in the bar. */
@Composable
fun InsightRangeMenu() {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(
            onClick = { open = true },
            modifier = Modifier.defaultMinSize(minHeight = 48.dp).semantics { contentDescription = "Range: ${InsightRange.label(InsightsRangeStore.key)}" },
        ) {
            Icon(Icons.Filled.CalendarMonth, contentDescription = null, Modifier.size(18.dp))
            Text(InsightRange.label(InsightsRangeStore.key), Modifier.padding(start = 6.dp), maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (r in InsightRange.all) {
                DropdownMenuItem(
                    text = { Text(r.label, fontWeight = if (r.key == InsightsRangeStore.key) FontWeight.SemiBold else FontWeight.Normal) },
                    trailingIcon = { if (r.key == InsightsRangeStore.key) Icon(Icons.Filled.Check, null, tint = ErpColors.accent) },
                    onClick = { open = false; InsightsRangeStore.set(r.key) },
                )
            }
        }
    }
}

/** The kit's ErrorState (Surface.swift): the words, and a way to try again unless the demo has no ERP to ask. */
@Composable
fun MarketingErrorState(message: String, retry: (() -> Unit)?) {
    AdsUnavailable("Couldn't load this", message, icon = Icons.Filled.Warning) {
        if (retry != null) AdsTonalButton("Try again", retry)
    }
}

@Composable
private fun InsightsLocked() {
    NotAvailableState("Insights are for owners", why = "Sign in with an owner or marketing account to see the shop's Instagram and Facebook numbers.", icon = Icons.Filled.Lock)
}

/** Asks `/api/insights` for a part; the demo answers from made-up numbers. */
private suspend fun <T> insights(part: String, fresh: Boolean, demo: () -> T, read: (Any?) -> T?): T {
    if (House.isDemo) return demo()
    val answer = ErpApi.shared.get(InsightRange.path(part, InsightsRangeStore.key, fresh))
    return read(answer) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
}

private fun today() = java.time.LocalDate.parse(erp.core.ERPDate.karachiDay(AppClock.now()))

// MARK: Overview

@Composable
fun InsightsOverviewScreen() {
    val mayRead = InsightsLogic.mayRead(LocalSession.current.role)
    val rangeKey = InsightsRangeStore.key
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<InsightsOverview?>(null) }
    var found by remember { mutableStateOf<List<InsightFinding>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Insights")
    if (mayRead) ScreenActions { InsightRangeMenu() }

    suspend fun load(fresh: Boolean) {
        try {
            data = insights("overview", fresh, { InsightsDemo.overview(today()) }, { InsightsOverview.from(it) })
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
        // The findings read all three parts on the server; a failure there only hides them.
        found = try {
            insights("findings", false, { InsightsDemo.findings() }, { InsightFinding.list(it) })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            emptyList()
        }
    }
    LaunchedEffect(rangeKey, mayRead) { if (mayRead) load(false) }

    val d = data
    when {
        !mayRead -> InsightsLocked()
        d != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(true); refreshing = false } }, Modifier.fillMaxSize()) {
            InsightsOverviewContent(d, found, rangeKey)
        }
        problem != null -> MarketingErrorState(problem ?: "", if (House.isDemo) null else ({ scope.launch { load(true) } }))
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Reading Insights") }
    }
}

/** The page from an answer in hand (the screenshot tests draw it from made-up numbers). */
@Composable
fun InsightsOverviewContent(d: InsightsOverview, found: List<InsightFinding>, rangeKey: String) {
    AdsPage {
        AdsTwoPane(
            left = {
                Findings(found)
                d.instagram?.let { ig ->
                    InstagramFigures(ig)
                    ReachChart(ig)
                    FollowersSection(d)
                    SplitSection(ig)
                }
            },
            right = {
                PaidSection(d, rangeKey)
                d.facebook?.let { FacebookSection(it) }
                PlacesSection(d)
            },
        )
    }
}

@Composable
private fun Findings(found: List<InsightFinding>) {
    if (found.isEmpty()) return
    AdsSection("What the numbers say") {
        for (f in found) {
            AdsRow {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    Icon(
                        when (f.tone) { "good" -> Icons.Filled.CheckCircle; "warn" -> Icons.Filled.Warning; else -> Icons.Filled.Info },
                        contentDescription = when (f.tone) { "good" -> "Good"; "warn" -> "Warning"; else -> "Note" },
                        Modifier.size(20.dp).padding(top = 2.dp),
                        tint = when (f.tone) { "good" -> Tone.settled.color(); "warn" -> Tone.owed.color(); else -> MaterialTheme.colorScheme.onSurfaceVariant },
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(f.title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                        Text(f.why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun InstagramFigures(ig: InstagramInsight) {
    val t = ig.totals
    val p = ig.previous
    fun v(k: String) = t[k] ?: 0.0
    val follows = ig.follows?.let { InsightsLogic.followsLine(it) }
    val newPeople = ig.nonFollowerReach?.let { "${InsightsLogic.percentOf(it)}% not following" }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LedgerHeading("Instagram", Modifier.padding(horizontal = 4.dp), trailing = "@${ig.username}")
        FigureRow(spacing = 10.dp) {
            FigureTile("Followers", AdsFormat.count(ig.followers), Modifier.share(), detail = follows, number = ig.followers)
            FigureTile("Accounts reached", AdsFormat.compact(v("reach")), Modifier.share(), detail = AdsFormat.change(v("reach"), p["reach"]) ?: newPeople, number = v("reach"))
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("Views", AdsFormat.compact(v("views")), Modifier.share(), detail = AdsFormat.change(v("views"), p["views"]), number = v("views"))
            FigureTile("Accounts engaged", AdsFormat.compact(v("accounts_engaged")), Modifier.share(), detail = AdsFormat.change(v("accounts_engaged"), p["accounts_engaged"]), number = v("accounts_engaged"))
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("Interactions", AdsFormat.compact(v("total_interactions")), Modifier.share(), detail = "${AdsFormat.compact(v("likes"))} likes · ${AdsFormat.compact(v("comments"))} comments", number = v("total_interactions"))
            FigureTile("Shares · saves", "${AdsFormat.compact(v("shares"))} · ${AdsFormat.compact(v("saves"))}", Modifier.share(), detail = "${AdsFormat.compact(v("replies"))} story replies")
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("Profile visits", AdsFormat.compact(v("profile_views")), Modifier.share(), detail = AdsFormat.change(v("profile_views"), p["profile_views"]), number = v("profile_views"))
            FigureTile("Link taps", AdsFormat.compact(v("website_clicks")), Modifier.share(), detail = InsightsLogic.linkShare(t), number = v("website_clicks"))
        }
    }
}

@Composable
private fun SplitSection(ig: InstagramInsight) {
    AdsSection(
        "Ads or own posts?",
        footer = { Text("Counted per surface (posts, carousels, reels, stories, ads), so the parts can add up to more than the account's reach.") },
    ) {
        SplitRow("Accounts reached", ig.reach)
        SplitRow("Views", ig.views)
        SplitRow("Interactions", ig.interactions)
    }
}

@Composable
private fun SplitRow(title: String, s: InsightSplit?) {
    if (s == null || s.ads + s.organic <= 0) return
    val share = s.adsShare ?: 0.0
    val pct = InsightsLogic.percentOf(share)
    val parts = listOf("From ads $pct%") + s.bySurface.filter { it.value > 0 }.map { "${InsightWords.surface[it.key] ?: it.key} ${AdsFormat.compact(it.value)}" }
    AdsRow {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text("ads ${AdsFormat.compact(s.ads)} · own ${AdsFormat.compact(s.organic)}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        // The ads part in the accent, the rest quiet, a hair apart (HStack of two capsules).
        Row(Modifier.fillMaxWidth().height(8.dp).semantics { contentDescription = "$pct% from ads" }, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (share > 0) Box(Modifier.weight(share.toFloat().coerceIn(0.001f, 1f)).fillMaxSize().clip(CircleShape).background(ErpColors.accent))
            if (share < 1) Box(Modifier.weight((1 - share).toFloat().coerceIn(0.001f, 1f)).fillMaxSize().clip(CircleShape).background(ErpColors.accent.copy(alpha = 0.35f)))
        }
        Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ReachChart(ig: InstagramInsight) {
    if (ig.daily.size <= 1) return
    AdsSection("Reached, day by day") {
        AdsRow {
            InsightBars(insightDayPoints(ig.daily), "Reached", "Accounts reached each day, ads included")
        }
    }
}

@Composable
private fun FollowersSection(d: InsightsOverview) {
    AdsSection("Followers over time") {
        AdsRow {
            if (d.followerDays.size > 1) {
                InsightLine(insightDayPoints(d.followerDays), "Followers", "Followers each day")
            } else {
                Text(
                    "Meta keeps no follower history, so the ERP writes the count down every day. The line fills in from there.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PaidSection(d: InsightsOverview, rangeKey: String) {
    val shown = d.paid.filter { it.metrics.spend > 0 || it.metrics.impressions > 0 }
    val before = d.paidBefore.associate { it.platform to it.metrics.spend }
    AdsSection("Ads by platform") {
        if (shown.isEmpty()) {
            AdsRow { Text("No ad ran in ${InsightRange.label(rangeKey).lowercase()}.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            for (p in shown) {
                AdsRow {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(InsightWords.platform[p.platform] ?: p.platform, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                        Text(AdsFormat.money(p.metrics.spend, d.currency), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
                    }
                    Text(
                        listOfNotNull(
                            AdsFormat.change(p.metrics.spend, before[p.platform]), "${AdsFormat.compact(p.metrics.reach)} reached",
                            "${AdsFormat.compact(p.metrics.impressions)} views", "${AdsFormat.count(p.metrics.linkClicks)} link clicks",
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val results = AdsResults.headlineActions(p.metrics, limit = 4)
                    if (results.isNotEmpty()) {
                        Text(results.joinToString(" · ") { "${AdsFormat.count(it.value)} ${it.label.lowercase()}" }, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        AdsLink("Ads overview", Icons.Filled.Campaign, "/ads")
    }
}

@Composable
private fun FacebookSection(fb: FacebookInsight) {
    val t = fb.totals
    val p = fb.previous
    fun v(k: String) = t[k] ?: 0.0
    val points = insightDayPoints(fb.daily)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LedgerHeading("Facebook", Modifier.padding(horizontal = 4.dp), trailing = fb.name)
        FigureRow(spacing = 10.dp) {
            FigureTile("Followers", AdsFormat.count(fb.followers), Modifier.share(), detail = "+${AdsFormat.count(v("page_daily_follows_unique"))} · −${AdsFormat.count(v("page_daily_unfollows_unique"))}", number = fb.followers)
            FigureTile("Views", AdsFormat.compact(v("page_media_view")), Modifier.share(), detail = AdsFormat.change(v("page_media_view"), p["page_media_view"]) ?: "${AdsFormat.compact(v("page_total_media_view_unique"))} people", number = v("page_media_view"))
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("Engagement", AdsFormat.compact(v("page_post_engagements")), Modifier.share(), detail = AdsFormat.change(v("page_post_engagements"), p["page_post_engagements"]), number = v("page_post_engagements"))
            FigureTile("Page visits", AdsFormat.compact(v("page_views_total")), Modifier.share(), detail = AdsFormat.change(v("page_views_total"), p["page_views_total"]), number = v("page_views_total"))
        }
        if (points.size > 1 && points.any { it.value > 0 }) {
            InsightBars(points, "Views", "Page views each day", height = 140.dp)
        }
    }
}

@Composable
private fun PlacesSection(d: InsightsOverview) {
    AdsSection(
        null,
        footer = {
            if (d.at.isNotEmpty()) {
                Text("${ShopDate.say(d.since)} to ${ShopDate.say(d.until)}, compared with ${ShopDate.say(d.beforeSince)} to ${ShopDate.say(d.beforeUntil)}. From Meta, ${MarketingTime.clock(d.at)}. Instagram's numbers include its ads; the split takes them apart.")
            }
        },
    ) {
        AdsLink("Posts", Icons.Filled.GridView, "/insights/posts", "Every post, reel and story, with its numbers")
        AdsLink("Audience", Icons.Filled.People, "/insights/audience", "Who follows, who was reached, when they're online")
    }
}

// MARK: Posts

@Composable
fun InsightsPostsScreen() {
    val mayRead = InsightsLogic.mayRead(LocalSession.current.role)
    val rangeKey = InsightsRangeStore.key
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<InsightsPosts?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("all") }
    var sort by rememberSaveable { mutableStateOf("at") }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Posts")
    if (mayRead) ScreenActions { PostsSortMenu(sort) { sort = it } }

    suspend fun load(fresh: Boolean) {
        try {
            data = insights("posts", fresh, { InsightsDemo.posts(today()) }, { InsightsPosts.from(it) })
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }
    LaunchedEffect(rangeKey, mayRead) { if (mayRead) load(false) }

    val d = data
    when {
        !mayRead -> InsightsLocked()
        d != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(true); refreshing = false } }, Modifier.fillMaxSize()) {
            InsightsPostsContent(d, rangeKey, filter, { filter = it }, sort)
        }
        problem != null -> AdsUnavailable("Couldn't read the posts", problem ?: "", icon = Icons.Filled.GridView) {
            if (!House.isDemo) AdsTonalButton("Try again", { scope.launch { load(true) } })
        }
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the posts") }
    }
}

/** Sort and Range as one menu (the toolbar's Menu with two pickers). */
@Composable
private fun PostsSortMenu(sort: String, onSort: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, Modifier.semantics { contentDescription = "Sort" }) { Icon(Icons.Filled.SwapVert, contentDescription = null) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((k, label) in InsightsLogic.sorts) {
                DropdownMenuItem(
                    text = { Text(label, fontWeight = if (k == sort) FontWeight.SemiBold else FontWeight.Normal) },
                    trailingIcon = { if (k == sort) Icon(Icons.Filled.Check, null, tint = ErpColors.accent) },
                    onClick = { open = false; onSort(k) },
                )
            }
            for (r in InsightRange.all) {
                DropdownMenuItem(
                    text = { Text(r.label, fontWeight = if (r.key == InsightsRangeStore.key) FontWeight.SemiBold else FontWeight.Normal) },
                    trailingIcon = { if (r.key == InsightsRangeStore.key) Icon(Icons.Filled.Check, null, tint = ErpColors.accent) },
                    onClick = { open = false; InsightsRangeStore.set(r.key) },
                )
            }
        }
    }
}

@Composable
fun InsightsPostsContent(d: InsightsPosts, rangeKey: String, filter: String, onFilter: (String) -> Unit, sort: String) {
    val shown = InsightsLogic.shown(d, filter, sort)
    AdsPage {
        ChipRow(Modifier.padding(horizontal = 0.dp)) {
            for ((k, label) in InsightsLogic.filters) FilterChip(label, filter == k, { onFilter(k) })
        }
        d.lastPostAt?.let { last ->
            AdsSection(null) {
                AdsRow {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Last Instagram post", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        Text(ShopDate.say(last), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        AdsSection(
            "Posts", count = shown.size,
            footer = { Text("A post's numbers are its lifetime so far. A story's exist only while it's up, so the ERP reads every live story each hour and keeps the last count. Engagement rate is interactions over reach.") },
        ) {
            if (shown.isEmpty()) {
                AdsRow { Text("Nothing here for ${InsightRange.label(rangeKey).lowercase()}.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                for (p in shown) PostRow(p, live = p.id in d.live)
            }
        }
    }
}

@Composable
private fun PostRow(p: InsightPost, live: Boolean) {
    val tall = p.kind == "story" || p.kind == "reel"
    val context = LocalContext.current
    AdsRow {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            StockImage(
                imageUrl = p.thumb, name = p.caption, key = p.id,
                modifier = Modifier.width(if (tall) 54.dp else 72.dp).height(if (tall) 96.dp else 72.dp).clip(RoundedCornerShape(Radius.thumb)),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(InsightWords.kind[p.kind] ?: p.kind, style = MaterialTheme.typography.labelLarge)
                    Text(ShopDate.say(p.at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (live) StatusBadge("Up now", Tone.settled)
                    if (p.older) Text("before this range", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(Modifier.weight(1f))
                    p.link?.takeIf { it.startsWith("http") }?.let { link ->
                        IconButton(onClick = { openAddress(context, Intent.ACTION_VIEW, link) }, Modifier.size(32.dp)) {
                            Icon(Icons.Filled.OpenInNew, contentDescription = "Open the post", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (p.caption.isNotEmpty()) Text(p.caption, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                // Three to a line, as the iPhone's grid.
                for (line in InsightsLogic.stats(p).chunked(3)) {
                    Row(Modifier.fillMaxWidth()) {
                        for ((k, v) in line) {
                            Column(Modifier.weight(1f)) {
                                Text(k, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(v, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
                            }
                        }
                        repeat(3 - line.size) { Box(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

// MARK: Audience

@Composable
fun InsightsAudienceScreen() {
    val mayRead = InsightsLogic.mayRead(LocalSession.current.role)
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<InsightsAudience?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var group by rememberSaveable { mutableStateOf("followers") }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Audience")

    suspend fun load(fresh: Boolean) {
        try {
            data = insights("audience", fresh, { InsightsDemo.audience() }, { InsightsAudience.from(it) })
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }
    LaunchedEffect(mayRead) { if (mayRead) load(false) }

    val d = data
    when {
        !mayRead -> InsightsLocked()
        d != null -> ErpPullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(true); refreshing = false } }, Modifier.fillMaxSize()) {
            InsightsAudienceContent(d, group) { group = it }
        }
        problem != null -> AdsUnavailable("Couldn't read the audience", problem ?: "", icon = Icons.Filled.People) {
            if (!House.isDemo) AdsTonalButton("Try again", { scope.launch { load(true) } })
        }
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the audience") }
    }
}

@Composable
fun InsightsAudienceContent(a: InsightsAudience, group: String, onGroup: (String) -> Unit) {
    val dims = when (group) { "reached" -> a.reached; "engaged" -> a.engaged; else -> a.followers }
    val groups = listOf("followers" to "Followers", "reached" to "Reached", "engaged" to "Engaged")
    AdsPage {
        AdsTwoPane(
            left = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        groups.forEachIndexed { i, (k, label) ->
                            SegmentedButton(
                                selected = group == k, onClick = { onGroup(k) }, shape = SegmentedButtonDefaults.itemShape(i, groups.size),
                                colors = SegmentedButtonDefaults.colors(activeContainerColor = ErpColors.accent, activeContentColor = ErpColors.onAccent),
                            ) { Text(label) }
                        }
                    }
                    Text(
                        if (group == "followers") "Everyone following now. Meta gives these only as they are now, with no history." else "This month. Meta gives these only as they are now, with no history.",
                        Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (dims != null) {
                    Shares("Age", dims.age) { it }
                    Shares("Gender", dims.gender) { InsightWords.gender[it] ?: it }
                }
            },
            right = {
                if (dims != null) {
                    Shares("Cities", dims.city) { it }
                    Shares("Countries", dims.country) { InsightWords.country[it] ?: it }
                }
                OnlineSection(a.online)
            },
        )
    }
}

@Composable
private fun Shares(title: String, parts: List<InsightPart>, label: (String) -> String) {
    val (top, biggest) = InsightsLogic.topShares(parts)
    AdsSection(title) {
        if (top.isEmpty()) {
            AdsRow { Text("Meta has nothing for this yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            for (s in top) {
                AdsRow {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(label(s.key), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${s.percent}%", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    erp.app.screens.ads.AdsMeter(s.value, biggest, "${label(s.key)}, ${s.percent}%")
                }
            }
        }
    }
}

@Composable
private fun OnlineSection(hours: List<Double>?) {
    AdsSection(null, header = { LedgerHeading("When followers are online", trailing = "Karachi time") }) {
        AdsRow {
            if (hours != null && hours.size == 24 && hours.any { it > 0 }) {
                InsightBars(
                    hours.mapIndexed { h, v -> InsightPoint(InsightWords.hour(h), v) }, "Online", "Followers online each hour, Karachi time",
                    hint = "Touch the chart to read an hour. Karachi time.",
                )
            } else {
                Text("Meta isn't sharing this for the account yet (it holds it back for smaller accounts).", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
