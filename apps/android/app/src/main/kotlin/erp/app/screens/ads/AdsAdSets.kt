package erp.app.screens.ads

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.nav.ScreenTitle
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.screens.stock.StockImage
import erp.core.ERPDate
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** An ad of the account with where it sits, for the "copies of ads" list. */
class AdsAdRow(val ad: AdItem, val place: String)

object AdsAdSetsLogic {
    /** Every ad in the account (the last 30 days' tree), the chosen ones first, the search words all in its name or place. */
    fun shownAds(tree: AdCampaigns?, adIds: List<String>, q: String): List<AdsAdRow> {
        val rows = ArrayList<AdsAdRow>()
        for (c in tree?.campaigns ?: emptyList()) for (s in c.adsets) for (a in s.ads) rows.add(AdsAdRow(a, "${c.name} › ${s.name}"))
        val words = q.lowercase().split(' ').filter { it.isNotEmpty() }
        val hits = rows.filter { r ->
            val hay = "${r.ad.name} ${r.place}".lowercase()
            words.all { hay.contains(it) }
        }
        val chosen = hits.filter { it.ad.id in adIds }
        val rest = hits.filter { it.ad.id !in adIds }
        return (chosen + rest).take(60)
    }

    /** `?ads=1,2,x`: the ids that are numbers. */
    fun adIdsFromQuery(ads: String): List<String> = ads.split(',').filter { it.isNotEmpty() && it.all { c -> c.isDigit() } }
}

/**
 * Ads → Ad sets (src/app/ads/adset/page.tsx): one or several ad sets, each its own audience, places, budget, dates and
 * goal, into a campaign the account has or a new one, filled with copies of ads already made or an Instagram post
 * boosted. The usual use is a test: the same ad to two or three audiences side by side. `?campaign=` and `?ads=` start
 * in a campaign with chosen ads (after a new ad), `?from=<ad set>` from a copy of one ("Copy and change"). The server
 * checks the design and says what it will make and cost (/api/ads/plan) before the counter agrees; only then
 * /api/ads/adsets makes it, deleting anything half-made on a failure.
 */
@Composable
fun AdsAdSetsScreen(path: String) {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val mayUse = adsMayUse(session.role)

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var lists by remember { mutableStateOf<AdsNewAdLists?>(null) }
    var info by remember { mutableStateOf<AdsAdsetsInfo?>(null) }
    var tree by remember { mutableStateOf<AdCampaigns?>(null) }
    var treeError by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var started by remember { mutableStateOf(false) }

    var target by remember { mutableStateOf("new") }
    var campaign by remember { mutableStateOf<AdsAdsetsInfo.Campaign?>(null) }
    var campaignName by remember { mutableStateOf("") }
    var sets by remember { mutableStateOf(listOf(AdsSetDraft(UUID.randomUUID().toString(), "Ad set 1", "whatsapp", AdsAudience()))) }
    var editing by remember { mutableStateOf<String?>(null) }
    var adsKind by remember { mutableStateOf("copy") }
    var adIds by remember { mutableStateOf(listOf<String>()) }
    var adQ by remember { mutableStateOf("") }
    var media by remember { mutableStateOf<List<AdsMedia>?>(null) }
    var post by remember { mutableStateOf("") }
    var link by remember { mutableStateOf("") }
    var launch by remember { mutableStateOf("paused") }

    var checking by remember { mutableStateOf(false) }
    var check by remember { mutableStateOf<AdsDesignCheck?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf<AdsDesignMade?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    ScreenTitle("Ad sets")

    val design = AdsDesign(target, campaignName, campaign, sets, adsKind, adIds, post, link, launch)
    val allowed = design.allowed(lists)
    val allowedKeys = allowed.map { it.key }
    val currency = info?.currency ?: status?.currency ?: "PKR"

    fun fitGoals() {
        val first = allowed.firstOrNull() ?: return
        sets = sets.map { if (it.goal in allowedKeys) it else it.copy(goal = first.key) }
    }

    /** Once: the campaign, the ad set to start from and the chosen ads from the path; then every ad to copy from. */
    suspend fun begin() {
        val from = AdsQuery.value("from", path)
        val inCampaign = AdsQuery.value("campaign", path)
        AdsQuery.value("ads", path)?.let { adIds = AdsAdSetsLogic.adIdsFromQuery(it) }
        if (inCampaign != null) target = inCampaign
        val i = backend.adsetsInfo(inCampaign, from)
        info = i
        started = true
        val dr = i.draft
        if (from != null && dr != null) {
            sets = listOf(
                AdsSetDraft(
                    UUID.randomUUID().toString(), dr.name, dr.goal, dr.audience, dr.budget.kind, AdsAmount.field(dr.budget.amount),
                    start = null, end = ERPDate.parse(dr.budget.end),
                ),
            )
            if (i.ads.isNotEmpty()) adIds = i.ads
        }
        i.campaign?.let { target = it.id; campaign = it }
        try {
            tree = backend.campaigns("last_30d", false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            treeError = adsWords(e)
        }
        fitGoals()
    }

    suspend fun load(fresh: Boolean = false) {
        try {
            val s = backend.status(fresh)
            status = s
            problem = null
            if (!s.ready) return
            if (lists == null) lists = backend.newAdLists()
            if (!started) begin()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    LaunchedEffect(mayUse) { if (mayUse && status == null) load() }
    LaunchedEffect(adsKind, lists != null) {
        if (adsKind == "post" && media == null && lists != null) {
            media = try { backend.media(null).media.filter { it.boostable != false } } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
        }
    }
    LaunchedEffect(allowedKeys) { fitGoals() }

    fun pickCampaign(id: String) {
        target = id
        if (id == "new") { campaign = null; return }
        tree?.campaigns?.firstOrNull { it.id == id }?.let { c ->
            campaign = AdsAdsetsInfo.Campaign(c.id, c.name, c.objective, (c.dailyBudget ?: 0.0) > 0 || (c.lifetimeBudget ?: 0.0) > 0)
        }
    }

    fun review() {
        scope.launch {
            checking = true
            try {
                val c = backend.checkDesign(design.json())
                check = c
                if (c.problems.isEmpty()) confirming = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = adsWords(e)
            } finally {
                checking = false
            }
        }
    }

    fun send() {
        scope.launch {
            sending = true
            try {
                made = backend.makeAdsets(design.json())
                AdsChanges.bump()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Nothing was made. ${adsWords(e)}"
            } finally {
                sending = false
            }
        }
    }

    val s0 = status
    val l0 = lists
    val m0 = made
    when {
        !mayUse -> AdsOwnersOnly()
        m0 != null -> AdSetsMade(m0)
        s0 != null && s0.ready && l0 != null && info != null -> AdPage(
            s = s0, d = design, allowed = allowed, currency = currency, lists = l0, tree = tree, treeError = treeError,
            onTarget = ::pickCampaign, onCampaignName = { campaignName = it },
            onSets = { sets = it }, onEdit = { editing = it },
            onAdsKind = { adsKind = it }, onAdIds = { adIds = it }, adQ = adQ, onAdQ = { adQ = it },
            media = media, onPost = { post = it }, onLink = { link = it }, onLaunch = { launch = it },
            check = check, checking = checking, sending = sending, onReview = ::review,
        )
        else -> AdsNotReady(status, problem) { scope.launch { load(fresh = true) } }
    }

    editing?.let { key ->
        sets.firstOrNull { it.key == key }?.let { s ->
            AdsAudienceSheet(
                title = s.name.ifEmpty { "Who sees it" }, draft = s.audience, goal = l0?.goal(s.goal)?.optimization ?: "REACH",
                positions = l0?.igPositions ?: emptyList(), onDismiss = { editing = null },
            ) { a -> sets = sets.map { if (it.key == key) it.copy(audience = a) else it } }
        }
    }
    if (confirming) {
        AdsConfirm(
            title = if (launch == "live") "Make them and run them?" else "Make these ad sets?",
            message = (check?.summary ?: emptyList()).joinToString("\n"),
            confirm = if (launch == "live") "Make them and run them" else "Make them, paused",
            cancel = "Not yet", onDismiss = { confirming = false }, onConfirm = { send() },
        )
    }
    FailureAlert(failure, { failure = null }, "That didn't work")
}

@Composable
private fun AdPage(
    s: AdsStatusAnswer,
    d: AdsDesign,
    allowed: List<AdsGoal>,
    currency: String,
    lists: AdsNewAdLists,
    tree: AdCampaigns?,
    treeError: String?,
    onTarget: (String) -> Unit,
    onCampaignName: (String) -> Unit,
    onSets: (List<AdsSetDraft>) -> Unit,
    onEdit: (String) -> Unit,
    onAdsKind: (String) -> Unit,
    onAdIds: (List<String>) -> Unit,
    adQ: String,
    onAdQ: (String) -> Unit,
    media: List<AdsMedia>?,
    onPost: (String) -> Unit,
    onLink: (String) -> Unit,
    onLaunch: (String) -> Unit,
    check: AdsDesignCheck?,
    checking: Boolean,
    sending: Boolean,
    onReview: () -> Unit,
) {
    AdsPage {
        AdsAlertsSection(s)
        AdsTwoPane(
            left = {
                CampaignSection(d, tree, treeError, onTarget, onCampaignName)
                d.sets.forEachIndexed { i, set ->
                    SetCard(
                        set, i + 1, allowed, d.budgeted, currency, removable = d.sets.size > 1,
                        change = { n -> onSets(d.sets.map { if (it.key == set.key) n else it }) },
                        audience = { onEdit(set.key) },
                        remove = { onSets(d.sets.filter { it.key != set.key }) },
                    )
                }
                AdsSection(null, footer = { Text("It starts as a copy of the last, so a test changes one thing. Six at most.") }) {
                    AdsActionRow("Another ad set", {
                        d.sets.lastOrNull()?.let { last -> onSets(d.sets + last.next(d.sets.size + 1, UUID.randomUUID().toString())) }
                    }, icon = Symbols.Add, enabled = d.sets.size < 6)
                }
            },
            right = {
                AdsInThem(d, tree, treeError, onAdsKind, onAdIds, adQ, onAdQ, media, onPost, onLink, lists)
                AdsSection(
                    null,
                    footer = { Text(if (d.launch == "paused") "Nothing is spent until they are switched on in Campaigns." else "They start once Meta approves them and spend their budgets from then.") },
                ) {
                    AdsRow {
                        AdsChips {
                            FilterChip("Make them paused", d.launch == "paused", { onLaunch("paused") })
                            FilterChip("Run them once approved", d.launch == "live", { onLaunch("live") })
                        }
                    }
                }
                AdsProblemsSection(check?.problems ?: emptyList())
                AdsProminentButton(
                    "Review: ${d.sets.size} ad set${if (d.sets.size == 1) "" else "s"} · ${d.adCount} ad${if (d.adCount == 1) "" else "s"}", onReview,
                    Modifier.fillMaxWidth(), enabled = !(checking || sending), busy = checking || sending,
                )
            },
        )
    }
}

@Composable
private fun CampaignSection(d: AdsDesign, tree: AdCampaigns?, treeError: String?, onTarget: (String) -> Unit, onName: (String) -> Unit) {
    val options = ArrayList<Pair<String, String>>()
    options.add("new" to "A new campaign")
    val live = (tree?.campaigns ?: emptyList()).filter { it.status != "ARCHIVED" }
    for (c in live) options.add(c.id to "${c.name} · ${AdsObjective.label(c.objective)}")
    d.campaign?.let { c -> if ((tree?.campaigns ?: emptyList()).none { it.id == c.id }) options.add(c.id to c.name) }
    AdsSection("Campaign", footer = { if (d.budgeted) Text("This campaign holds the budget; its ad sets share it.") }) {
        PickerRow("Campaign", d.target, options, onTarget)
        if (d.target == "new") {
            AdsRow { TextField(d.campaignName, onName, Modifier.fillMaxWidth(), placeholder = { Text("Campaign name") }, singleLine = true) }
        }
        if (treeError != null) AdsRow { Text("The account's campaigns didn't come: $treeError", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
    }
}

/** One ad set's card: its name, goal, budget (unless the campaign holds it), dates and audience. */
@Composable
private fun SetCard(
    set: AdsSetDraft,
    number: Int,
    goals: List<AdsGoal>,
    budgeted: Boolean,
    currency: String,
    removable: Boolean,
    change: (AdsSetDraft) -> Unit,
    audience: () -> Unit,
    remove: () -> Unit,
) {
    val now = AppClock.now()
    AdsSection("Ad set $number") {
        AdsRow { TextField(set.name, { change(set.copy(name = it)) }, Modifier.fillMaxWidth(), label = { Text("Ad set name") }, singleLine = true) }
        PickerRow("Goal", set.goal, goals.map { it.key to it.label }) { change(set.copy(goal = it)) }
        if (!budgeted) {
            AdsRow {
                AdsChips {
                    FilterChip("A day", set.budgetKind == "daily", { change(set.copy(budgetKind = "daily")) })
                    FilterChip("In total", set.budgetKind == "total", { change(set.copy(budgetKind = "total")) })
                }
            }
            ValueRow(if (set.budgetKind == "daily") "A day ($currency)" else "In total ($currency)") {
                ValueInput(set.amount, { change(set.copy(amount = it)) }, prompt = "Amount", label = "Amount", keyboard = KeyboardType.Decimal)
            }
        }
        ToggleRow("Starts on a day", set.start != null, { on -> change(set.copy(start = if (on) AdsDays.startOfDay(now) else null)) })
        set.start?.let { s -> AdsDayRow("From", s, min = AdsDays.startOfDay(now)) { change(set.copy(start = AdsDays.startOfDay(it))) } }
        ToggleRow("Ends on a day", set.end != null, { on -> change(set.copy(end = if (on) AdsDays.endOfDay(now.plusSeconds(7 * 86_400)) else null)) })
        // Never before the day it starts: an ad set can't end before it begins.
        set.end?.let { e ->
            val floor = listOfNotNull(now, set.start).maxOrNull()
            AdsDayRow("To", e, min = floor) { change(set.copy(end = AdsDays.endOfDay(it))) }
        }
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = audience).ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Who sees it", style = MaterialTheme.typography.bodyLarge)
                Text(set.audience.words, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Symbols.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (removable) AdsActionRow("Remove this ad set", remove, icon = Symbols.Delete, tone = Tone.problem)
    }
}

@Composable
private fun AdsInThem(
    d: AdsDesign,
    tree: AdCampaigns?,
    treeError: String?,
    onAdsKind: (String) -> Unit,
    onAdIds: (List<String>) -> Unit,
    adQ: String,
    onAdQ: (String) -> Unit,
    media: List<AdsMedia>?,
    onPost: (String) -> Unit,
    onLink: (String) -> Unit,
    lists: AdsNewAdLists,
) {
    AdsSection(
        "Ads in them",
        footer = { Text(if (d.adsKind == "copy") "${d.adIds.size} chosen: a copy of each goes into every ad set." else "The post runs as it is in every ad set.") },
    ) {
        AdsRow {
            AdsChips {
                FilterChip("Copies of ads", d.adsKind == "copy", { onAdsKind("copy") })
                FilterChip("An Instagram post", d.adsKind == "post", { onAdsKind("post") })
            }
        }
        if (d.adsKind == "copy") {
            if (tree == null && treeError == null) {
                AdsReading("Reading the account's ads…")
            } else {
                AdsRow { TextField(adQ, onAdQ, Modifier.fillMaxWidth(), placeholder = { Text("Find an ad") }, singleLine = true, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false)) }
                val shown = AdsAdSetsLogic.shownAds(tree, d.adIds, adQ)
                if (shown.isEmpty()) AdsRow { Text(if (adQ.isEmpty()) "No ads in the last 30 days." else "No ad matches “$adQ”.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                for (r in shown) {
                    val on = r.ad.id in d.adIds
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Checkbox) {
                            onAdIds(if (on) d.adIds.filter { it != r.ad.id } else d.adIds + r.ad.id)
                        }.ledgerRow(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StockImage(r.ad.image, r.ad.name, r.ad.id, Modifier.size(44.dp).clip(Radius.thumbShape))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(r.ad.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(r.place, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(if (on) Symbols.CheckCircle else Symbols.RadioButtonUnchecked, if (on) "Chosen" else "Not chosen", tint = if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            if (media != null) {
                AdsRow { AdsMediaGrid(media, d.post.ifEmpty { null }) { m -> onPost(if (d.post == m.id) "" else m.id) } }
                if (d.sets.any { lists.goal(it.goal)?.toSite == true || it.goal == "channel" }) {
                    AdsRow {
                        TextField(
                            d.link, onLink, Modifier.fillMaxWidth(), placeholder = { Text("https://… where the button goes") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        )
                    }
                }
            } else {
                AdsReading("Reading Instagram…")
            }
        }
    }
}

@Composable
private fun AdSetsMade(m: AdsDesignMade) {
    AdsPage {
        AdsSection(null) {
            Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Symbols.CheckCircle, null, Modifier.size(40.dp), tint = Tone.settled.color())
                Text("${m.adsets.size} ad set${if (m.adsets.size == 1) "" else "s"} made${if (m.live) "" else ", paused"}", style = MaterialTheme.typography.titleMedium)
                for (w in m.warnings) Text(w, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            }
        }
        AdsSection(null) {
            for (s in m.adsets) ValueRow(s.name) { Text("${s.ads.size} ad${if (s.ads.size == 1) "" else "s"}") }
        }
        AdsSection(null) { AdsLink("See them in Campaigns", Symbols.Checklist, "/ads/campaigns") }
    }
}
