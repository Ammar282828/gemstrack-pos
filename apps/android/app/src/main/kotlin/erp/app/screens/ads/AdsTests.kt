package erp.app.screens.ads

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.device.openAddress
import erp.app.nav.ScreenTitle
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.Container
import erp.core.Decodable
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Ads → A/B tests (AdsTests.swift, src/app/ads/tests/page.tsx): Meta's split test. Two to five ad sets run against each
// other with their audiences kept apart, so the difference in cost per result is the ad sets' own. Made here on the
// web's route (/api/ads/tests, which checks the test with study.ts and says what stops it); each side's spend, results,
// cost per result and ROAS so far read here; Meta's verdict, with how sure it is, stays in Ads Manager.

// MARK: The answers

data class AdsTestAdset(val id: String, val name: String, val campaign: String, val status: String) {
    companion object : Decodable<AdsTestAdset> {
        override fun fromMap(m: Map<String, Any?>): AdsTestAdset {
            val c = Container(m)
            return AdsTestAdset(c.string("id", ""), c.string("name", ""), c.string("campaign", ""), c.string("status", ""))
        }
    }
}

data class AdsTestCell(
    val name: String,
    val adsets: List<String>,
    val spend: Double,
    val result: Double,
    val resultLabel: String,
    val costPerResult: Double?,
    val roas: Double?,
) {
    companion object : Decodable<AdsTestCell> {
        override fun fromMap(m: Map<String, Any?>): AdsTestCell {
            val c = Container(m)
            val named = (m["adsets"] as? List<*>).orEmpty().map { (it as? Map<*, *>)?.get("name") as? String ?: "" }
            return AdsTestCell(
                c.string("name", ""), named, c.double("spend", 0.0), c.double("result", 0.0), c.string("resultLabel", "Results"),
                c.double("costPerResult"), c.double("roas"),
            )
        }
    }
}

data class AdsTest(
    val id: String,
    val name: String,
    val start: String?,
    val end: String?,
    val running: Boolean,
    val cells: List<AdsTestCell>,
    /** The side ahead on cost per result so far. */
    val ahead: String?,
) {
    companion object : Decodable<AdsTest> {
        override fun fromMap(m: Map<String, Any?>): AdsTest {
            val c = Container(m)
            return AdsTest(
                c.string("id", ""), c.string("name", ""), c.string("start"), c.string("end"), c.bool("running", false),
                c.list("cells", AdsTestCell), c.string("ahead"),
            )
        }
    }
}

data class AdsTestsAnswer(val currency: String, val tests: List<AdsTest>, val adsets: List<AdsTestAdset>) {
    companion object : Decodable<AdsTestsAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsTestsAnswer {
            val c = Container(m)
            return AdsTestsAnswer(
                c.string("currency", "PKR"), c.list("tests", AdsTest).filter { it.id.isNotEmpty() }, c.list("adsets", AdsTestAdset).filter { it.id.isNotEmpty() },
            )
        }
    }
}

// MARK: The rules the page keeps

object AdsTestsLogic {
    /** Two to five ad sets, lettered A to E in the order they were chosen. */
    const val MOST = 5
    val letters = listOf("A", "B", "C", "D", "E")

    /** A tap picks or drops an ad set; a sixth is not taken. */
    fun toggle(picked: List<String>, id: String): List<String> =
        if (id in picked) picked - id else if (picked.size < MOST) picked + id else picked

    /** Every word typed, anywhere in an ad set's or its campaign's name. */
    fun shown(adsets: List<AdsTestAdset>, search: String): List<AdsTestAdset> {
        val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
        return adsets.filter { a -> words.all { "${a.name} ${a.campaign}".lowercase().contains(it) } }
    }

    fun mayStart(name: String, picked: List<String>, making: Boolean): Boolean = !making && picked.size >= 2 && name.trim().isNotEmpty()

    /** What /api/ads/tests takes: `{ name, adsetIds, start, end, purchases }`, the times in ISO. */
    fun body(name: String, picked: List<String>, start: Instant, end: Instant, purchases: Boolean): Map<String, Any?> =
        linkedMapOf("name" to name.trim(), "adsetIds" to picked, "start" to AdsTime.iso(start), "end" to AdsTime.iso(end), "purchases" to purchases)

    fun confirmMessage(count: Int, start: Instant, end: Instant): String =
        "$count ad sets, an even split, ${ShopDate.stamp(start, withTime = true)} to ${ShopDate.stamp(end, withTime = true)}. " +
            "Meta keeps the people who see each one apart; the ad sets spend their own budgets as before."

    fun status(s: String): String = s.lowercase().replace("_", " ")

    /** Meta's own page for experiments, for the verdict (and how sure Meta is). */
    fun verdictUrl(adAccountId: String): String = "https://adsmanager.facebook.com/adsmanager/manage/experiments?act=${adAccountId.replace("act_", "")}"

    fun aheadLine(ahead: String): String =
        "$ahead is ahead on cost per result so far. Give it the full run before deciding; Meta's verdict says how sure it is."
}

// MARK: The screen

@Composable
fun AdsTestsScreen() {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val mayUse = adsMayUse(session.role)

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var data by remember { mutableStateOf<AdsTestsAnswer?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var loadProblem by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(emptyList<String>()) }
    var search by remember { mutableStateOf("") }
    val now0 = remember { AppClock.now() }
    var start by remember { mutableStateOf(now0.plusSeconds(15 * 60)) }
    var end by remember { mutableStateOf(now0.plusSeconds(7 * 86_400L)) }
    var purchases by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var making by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("A/B tests")

    suspend fun loadTests() {
        try {
            data = backend.tests()
            loadProblem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadProblem = adsWords(e)
        }
    }

    suspend fun load(fresh: Boolean = false) {
        try {
            val s = backend.status(fresh)
            status = s
            problem = null
            if (s.ready) loadTests()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    suspend fun make() {
        making = true
        try {
            backend.makeTest(AdsTestsLogic.body(name, picked, start, end, purchases))
            name = ""
            picked = emptyList()
            note.show(Note("Test started"))
            loadTests()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        } finally {
            making = false
        }
    }

    LaunchedEffect(mayUse) { if (mayUse && status == null) load() }

    val s0 = status
    when {
        !mayUse -> AdsOwnersOnly()
        s0 != null && s0.ready -> PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; loadTests(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            AdsTestsContent(
                s0, data, loadProblem, name, { name = it }, picked, { picked = AdsTestsLogic.toggle(picked, it) }, search, { search = it },
                start, { start = it; if (end <= it) end = it.plusSeconds(86_400L) }, end, { end = it }, purchases, { purchases = it },
                making, onRetry = { scope.launch { loadTests() } }, onMake = { asking = true },
            )
        }
        else -> AdsNotReady(status, problem) { scope.launch { load(fresh = true) } }
    }

    if (asking) {
        AdsConfirm(
            title = "Start “${name.trim()}”?", message = AdsTestsLogic.confirmMessage(picked.size, start, end),
            confirm = "Start the test", cancel = "Not now", onDismiss = { asking = false },
            onConfirm = { scope.launch { make() } },
        )
    }
    FailureAlert(failure, { failure = null }, "Meta didn't take that")
}

/** The page from the answers in hand (the screenshot tests draw it from made-up tests). */
@Composable
fun AdsTestsContent(
    s: AdsStatusAnswer,
    data: AdsTestsAnswer?,
    loadProblem: String?,
    name: String,
    onName: (String) -> Unit,
    picked: List<String>,
    onToggle: (String) -> Unit,
    search: String,
    onSearch: (String) -> Unit,
    start: Instant,
    onStartAt: (Instant) -> Unit,
    end: Instant,
    onEndAt: (Instant) -> Unit,
    purchases: Boolean,
    onPurchases: (Boolean) -> Unit,
    making: Boolean,
    onRetry: () -> Unit,
    onMake: () -> Unit,
) {
    val context = LocalContext.current
    AdsPage {
        AdsAlertsSection(s)
        if (loadProblem != null) {
            AdsSection(null) {
                AdsWarningRow(loadProblem, Tone.problem)
                AdsActionRow("Try again", onRetry)
            }
        }
        AdsTwoPane(
            left = {
                AdsSection(
                    "A new test",
                    footer = { Text("Make the versions in Ad sets first (copy one, change one thing), then choose two to five. Off: each ad set is judged on its own result.") },
                ) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        TextField(name, onName, Modifier.fillMaxWidth(), placeholder = { Text("Name, like “Packshot vs on-hand”") }, singleLine = true)
                        AdsSearchField("Find an ad set", search, onSearch)
                    }
                    if (data != null) {
                        val shown = AdsTestsLogic.shown(data.adsets, search)
                        for (a in shown.take(40)) AdsetPickRow(a, picked.indexOf(a.id), onToggle)
                        if (data.adsets.isEmpty()) AdsRow { Text("No ad sets to compare yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else if (loadProblem == null) {
                        AdsReading("Reading the ad sets…")
                    }
                    AdsDayTimeRow("Starts", start, min = AppClock.now(), onPick = onStartAt)
                    AdsDayTimeRow("Ends", end, min = start, onPick = onEndAt)
                    ToggleRow("Judge on website purchases", purchases, onPurchases)
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        AdsProminentButton("Start the test", onMake, Modifier.fillMaxWidth(), enabled = AdsTestsLogic.mayStart(name, picked, making), busy = making)
                    }
                }
            },
            right = {
                val cur = data?.currency ?: "PKR"
                AdsSection("Tests") {
                    if (data != null) {
                        if (data.tests.isEmpty()) AdsRow { Text("None yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        for (t in data.tests) TestCard(t, cur)
                    }
                    val act = s.settings?.adAccountId
                    if (act != null) {
                        AdsActionRow(
                            "Meta's verdict, in Ads Manager", { openAddress(context, android.content.Intent.ACTION_VIEW, AdsTestsLogic.verdictUrl(act)) },
                            icon = Symbols.OpenInNew,
                        )
                    }
                }
            },
        )
    }
}

/** An ad set to choose for a test: a ring that shows its letter once chosen. */
@Composable
private fun AdsetPickRow(a: AdsTestAdset, index: Int, onToggle: (String) -> Unit) {
    val chosen = index >= 0
    val letter = AdsTestsLogic.letters[minOf(maxOf(index, 0), 4)]
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { onToggle(a.id) }.ledgerRow()
            .semantics { contentDescription = if (chosen) "${a.name}, side $letter" else a.name },
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(26.dp).border(BorderStroke(1.5.dp, if (chosen) ErpColors.accent else MaterialTheme.colorScheme.outline), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (chosen) Text(letter, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold), color = ErpColors.accent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(a.name, style = MaterialTheme.typography.bodyLarge)
            Text("${a.campaign} · ${AdsTestsLogic.status(a.status)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun TestCard(t: AdsTest, cur: String) {
    AdsRow(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(t.name, style = MaterialTheme.typography.titleMedium)
        // Running is the expected state: only the dates.
        Text("${ShopDate.say(t.start ?: "")} to ${ShopDate.say(t.end ?: "")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        for (c in t.cells) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(c.name, style = MaterialTheme.typography.titleSmall)
                    if (t.ahead == c.name) Icon(Symbols.EmojiEvents, "Ahead", Modifier.size(16.dp), tint = Tone.owed.color())
                    Text(c.adsets.joinToString(", "), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                FigureRow(spacing = 8.dp) {
                    FigureTile("Spent", AdsFormat.money(c.spend, cur), Modifier.share(), number = c.spend)
                    FigureTile(c.resultLabel, AdsFormat.count(c.result), Modifier.share(), number = c.result)
                    FigureTile("Each", c.costPerResult?.let { AdsFormat.money(it, cur) } ?: "—", Modifier.share())
                    FigureTile("ROAS", AdsResults.roasText(c.roas), Modifier.share())
                }
            }
        }
        t.ahead?.let { Text(AdsTestsLogic.aheadLine(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
