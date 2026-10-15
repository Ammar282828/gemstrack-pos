package erp.app.screens.ads

import erp.app.ui.zoomSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.MinTouchTarget
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A campaign or ad set a switch acts on. */
data class AdsTarget(val level: String, val id: String, val name: String)

/**
 * Ads → Campaigns (src/app/ads/campaigns/page.tsx): every campaign with its ad sets and their ads, each with its status
 * and the range's numbers against the time before, and the web's run / pause switch (turning one on asks first, since it
 * spends), and the budget and end date (AdsBudgetSheet, which shows the money before and after and asks). Audience,
 * rename, duplicate, archive and delete, and an ad's previews, are on the object's own page.
 */
@Composable
fun AdsCampaignsScreen(path: String = "/ads/campaigns") {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val mayRead = adsMayUse(session.role)
    val rangeKey = AdsRangeStore.key
    val changes by AdsChanges.count.collectAsStateWithLifecycle()

    var data by remember { mutableStateOf<AdCampaigns?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf(AdsFilter.all) }
    var search by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) }
    var gallery by rememberSaveable { mutableStateOf(false) }
    var sort by rememberSaveable { mutableStateOf(AdsSort.spend) }
    var allExpanded by rememberSaveable { mutableStateOf(false) }
    val expanded = remember { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<AdsTarget?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var budgeting by remember { mutableStateOf<AdsBudgetTarget?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var openedAd by rememberSaveable(path) { mutableStateOf(false) }

    ScreenTitle("Campaigns")
    if (mayRead) {
        ScreenActions {
            AdsRangeMenu()
            var more by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { more = true }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                    DropdownMenuItem(
                        text = { Text("Show archived") }, leadingIcon = { Checkbox(archived, null) },
                        onClick = { archived = !archived },
                    )
                    DropdownMenuItem(
                        text = { Text("Expand all campaigns") }, leadingIcon = { Checkbox(allExpanded, null) },
                        onClick = { allExpanded = !allExpanded },
                    )
                    DropdownMenuItem(
                        text = { Text("New ad") }, leadingIcon = { Icon(Icons.Filled.Add, null) },
                        onClick = { more = false; navigator.open("/ads/new") },
                    )
                }
            }
        }
    }

    suspend fun load() {
        try {
            data = backend.campaigns(AdsRangeStore.key, archived)
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    // Back from a campaign, ad set or ad: what was paused, renamed or deleted there shows here.
    LaunchedEffect(rangeKey, archived, changes, mayRead) { if (mayRead) load() }
    // `?ad=` (from the Overview's top ads) opens that ad's page, once.
    LaunchedEffect(path) {
        val id = AdsQuery.value("ad", path)
        if (id != null && !openedAd) {
            openedAd = true
            navigator.open(AdsCampaignsLogic.objectPath("ad", id))
        }
    }

    suspend fun setRunning(t: AdsTarget, running: Boolean) {
        busy = t.id
        try {
            backend.setRunning(t.level, t.id, running)
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        } finally {
            busy = null
        }
    }

    if (!mayRead) {
        AdsOwnersOnly()
        return
    }
    val d = data
    when {
        d != null -> PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            AdsCampaignsContent(
                d = d, problem = problem, filter = filter, onFilter = { filter = it }, search = search, onSearch = { search = it },
                gallery = gallery, onGallery = { gallery = it }, sort = sort, onSort = { sort = it },
                allExpanded = allExpanded, expanded = expanded, onExpand = { id, on ->
                    allExpanded = false
                    if (on) { if (id !in expanded) expanded.add(id) } else expanded.remove(id)
                },
                busy = busy,
                onSwitch = { t, running -> if (running) asking = t else scope.launch { setRunning(t, false) } },
                onBudget = { budgeting = it },
                onDetails = { level, id -> navigator.open(AdsCampaignsLogic.objectPath(level, id)) },
            )
        }
        problem != null -> AdsUnavailable("Campaigns aren't ready", problem ?: "") {
            // The demo has no ERP to ask again: no button that can only fail.
            if (!House.isDemo) AdsTonalButton("Try again", { scope.launch { load() } })
            AdsTonalButton("Open Setup", { navigator.open("/ads/setup") })
        }
        else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the campaigns")
    }

    asking?.let { t ->
        AdsConfirm(
            title = "Run it?", message = "${t.name} will start spending its budget.", confirm = "Run",
            onDismiss = { asking = null },
            onConfirm = { scope.launch { setRunning(t, true) } },
        )
    }
    budgeting?.let { t -> AdsBudgetSheet(t, onDismiss = { budgeting = null }, saved = { load() }) }
    FailureAlert(failure, { failure = null }, "Meta didn't take that")
}

/** The page from the tree in hand (the screenshot tests draw it from made-up campaigns). */
@Composable
fun AdsCampaignsContent(
    d: AdCampaigns,
    problem: String?,
    filter: AdsFilter,
    onFilter: (AdsFilter) -> Unit,
    search: String,
    onSearch: (String) -> Unit,
    gallery: Boolean,
    onGallery: (Boolean) -> Unit,
    sort: AdsSort,
    onSort: (AdsSort) -> Unit,
    allExpanded: Boolean,
    expanded: List<String>,
    onExpand: (String, Boolean) -> Unit,
    busy: String?,
    onSwitch: (AdsTarget, Boolean) -> Unit,
    onBudget: (AdsBudgetTarget) -> Unit,
    onDetails: (String, String) -> Unit,
) {
    val cur = d.account.currency
    val list = AdsCampaignsLogic.shown(d.campaigns, filter, search)
    val spent = list.sumOf { it.metrics.spend }
    val views = list.sumOf { it.metrics.impressions }
    // One column on a phone, as many cards across as the window has room for on a tablet.
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 400.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AdsSearchField("Search campaigns, ad sets, ads", search, onSearch)
                AdsChips {
                    for (f in AdsFilter.entries) FilterChip(f.label, filter == f, { onFilter(f) })
                }
                Text(
                    AdsCampaignsLogic.summary(list.size, d.campaigns.size, spent, views, cur),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AdsChips {
                    FilterChip("Campaigns", !gallery, { onGallery(false) })
                    FilterChip("Ads and pictures", gallery, { onGallery(true) })
                }
                if (gallery) {
                    PickerRow("Sort", sort.key, AdsSort.entries.map { it.key to it.label }) { k -> onSort(AdsSort.entries.first { it.key == k }) }
                }
            }
        }
        if (problem != null) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                AdsSection("Couldn't refresh") { AdsWarningRow(problem, Tone.quiet, Icons.Filled.WifiOff) }
            }
        }
        if (list.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                AdsUnavailable(
                    if (d.campaigns.isEmpty()) "No campaigns yet" else "Nothing matches",
                    if (d.campaigns.isEmpty()) "Make the first ad from New ad." else "Try another filter or search.",
                    Modifier.fillMaxWidth(),
                )
            }
        }
        if (gallery) {
            items(AdsCampaignsLogic.gallery(list, filter, sort), key = { "ad-" + it.id }) { ad -> AdCard(ad, cur, busy, onSwitch, onDetails) }
        } else {
            items(list, key = { it.id }) { c ->
                CampaignCard(c, cur, busy, allExpanded || c.id in expanded, { onExpand(c.id, it) }, onSwitch, onBudget, onDetails)
            }
        }
    }
}

@Composable
private fun CampaignCard(
    c: AdCampaign,
    cur: String,
    busy: String?,
    open: Boolean,
    onOpen: (Boolean) -> Unit,
    onSwitch: (AdsTarget, Boolean) -> Unit,
    onBudget: (AdsBudgetTarget) -> Unit,
    onDetails: (String, String) -> Unit,
) {
    val goal = if (c.adsets.size == 1) c.adsets[0].optimizationGoal else null
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(c.name, style = MaterialTheme.typography.titleMedium)
                AdsStatusBadge(c.effectiveStatus)
                Text(AdsCampaignsLogic.campaignBits(c), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val b = AdsCampaignsLogic.budget(c.dailyBudget, c.lifetimeBudget, cur)
                if (b.isNotEmpty()) BudgetButton(b) { onBudget(AdsBudgetTarget("campaign", c.id, c.name, c.dailyBudget, c.lifetimeBudget, c.stopTime, cur)) }
                Numbers(c.metrics, goal, c.previous, cur)
                Issues(c.issues)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                RunSwitch(AdsTarget("campaign", c.id, c.name), c.status, busy, onSwitch)
                DetailsButton(c.name) { onDetails("campaign", c.id) }
            }
        }
        // The ad sets fold under the campaign (every one unfolded with "Expand all campaigns").
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button) { onOpen(!open) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${c.adsets.size} ad set${if (c.adsets.size == 1) "" else "s"}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Icon(Icons.Filled.ExpandMore, contentDescription = if (open) "Fold" else "Unfold", Modifier.rotate(if (open) 0f else -90f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) {
            for (s in c.adsets) AdSetRow(s, cur, busy, onSwitch, onBudget, onDetails)
        }
    }
}

@Composable
private fun AdSetRow(
    s: AdSet,
    cur: String,
    busy: String?,
    onSwitch: (AdsTarget, Boolean) -> Unit,
    onBudget: (AdsBudgetTarget) -> Unit,
    onDetails: (String, String) -> Unit,
) {
    Column(Modifier.padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(s.name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    AdsStatusBadge(s.effectiveStatus)
                    if (s.learning != null) Text(s.learning, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
                }
                val b = AdsCampaignsLogic.budget(s.dailyBudget, s.lifetimeBudget, cur)
                if (b.isNotEmpty()) BudgetButton(b) { onBudget(AdsBudgetTarget("adset", s.id, s.name, s.dailyBudget, s.lifetimeBudget, s.endTime, cur)) }
                Numbers(s.metrics, s.optimizationGoal, null, cur)
                Issues(s.issues)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                RunSwitch(AdsTarget("adset", s.id, s.name), s.status, busy, onSwitch)
                DetailsButton(s.name) { onDetails("adset", s.id) }
            }
        }
        if (s.ads.isNotEmpty()) AdStrip(s.ads, cur, onDetails)
    }
}

/** The ads of an ad set as pictures; each opens its own page (previews and Meta's review notes). */
@Composable
private fun AdStrip(ads: List<AdItem>, cur: String, onDetails: (String, String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        for (a in ads) {
            Column(
                Modifier.width(84.dp).clickable(role = Role.Button, onClickLabel = "Open ${a.name}") { onDetails("ad", a.id) },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                AdsPicture(a.image, a.name, a.id, Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.thumbShape))
                Text(a.name, style = MaterialTheme.typography.labelSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(AdsFormat.money(a.metrics.spend, cur), style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The "Ads and pictures" view: an ad as a card with its picture. */
@Composable
private fun AdCard(ad: AdItem, cur: String, busy: String?, onSwitch: (AdsTarget, Boolean) -> Unit, onDetails: (String, String) -> Unit) {
    Column(Modifier.zoomSource(AdsCampaignsLogic.objectPath("ad", ad.id)).ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.clickable(role = Role.Button, onClickLabel = "Open ${ad.name}") { onDetails("ad", ad.id) }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            AdsPicture(ad.image, ad.name, ad.id, Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.cardShape))
            Text(ad.name, style = MaterialTheme.typography.titleMedium)
        }
        AdsStatusBadge(ad.effectiveStatus)
        Numbers(ad.metrics, null, null, cur)
        Issues(ad.issues)
        Row(verticalAlignment = Alignment.CenterVertically) {
            DetailsButton(ad.name) { onDetails("ad", ad.id) }
            Box(Modifier.weight(1f))
            RunSwitch(AdsTarget("ad", ad.id, ad.name), ad.status, busy, onSwitch)
        }
    }
}

/** Run or pause. Pausing is at once, as the web's switch; running asks first. */
@Composable
private fun RunSwitch(t: AdsTarget, status: String, busy: String?, onSwitch: (AdsTarget, Boolean) -> Unit) {
    if (busy == t.id) {
        Box(Modifier.size(width = 52.dp, height = MinTouchTarget), contentAlignment = Alignment.Center) { SkeletonLoading(compact = true, label = "Working") }
        return
    }
    Switch(
        checked = status == "ACTIVE",
        onCheckedChange = { onSwitch(t, it) },
        // One change at a time: a second switch mid-send would have its busy mark cleared by the first.
        enabled = busy == null && status != "ARCHIVED" && status != "DELETED",
        modifier = Modifier.semantics { contentDescription = "Running: ${t.name}" },
        colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent),
    )
}

/** The budget in words, as a button: it opens the budget and end date to change. */
@Composable
private fun BudgetButton(words: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 0.dp), modifier = Modifier.defaultMinSize(minHeight = 32.dp)) {
        Icon(Icons.Filled.Edit, contentDescription = null, Modifier.size(16.dp))
        Text(words, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium))
    }
}

@Composable
private fun DetailsButton(name: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = "Details and actions: $name" }) {
        Icon(Icons.Filled.MoreVert, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** "PKR 12,000 · up 18% on before · 45 chats started · PKR 266 each · 12.3k reached". */
@Composable
private fun Numbers(m: AdMetrics, goal: String?, before: AdMetrics?, cur: String) {
    Text(
        AdsCampaignsLogic.numbers(m, goal, before, cur),
        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun Issues(list: List<String>) {
    for (issue in list) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(14.dp).padding(top = 2.dp), tint = Tone.owed.color())
            Text(issue, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
        }
    }
}
