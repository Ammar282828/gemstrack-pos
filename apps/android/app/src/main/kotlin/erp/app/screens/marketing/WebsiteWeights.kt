package erp.app.screens.marketing

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.LedgerSection
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.ToggleRow
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpFonts
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House

/**
 * Website → Photo weights (src/app/website/weights/page.tsx): the weight of each catalogue photograph that doesn't carry it
 * in its corner, one photo at a time, for a person at the counter with a scale. Save & next records it and shows the next
 * one that needs a weight; a strip shows what is coming. The same route as the web (/api/website/pieces, PUT { key,
 * weightGrams }).
 *
 * The site draws a weight recorded here on the photograph and prices the piece from it, for every visitor, so the first save
 * of a visit says so and asks; "don't ask again here" lasts until the screen is left.
 */
@Composable
fun WebsiteWeightsScreen() {
    ScreenTitle("Photo weights")
    val site by WebsiteStore.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var pieces by remember { mutableStateOf<List<WebsiteWeightPiece>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var collection by remember { mutableStateOf("") }
    var onlyMissing by remember { mutableStateOf(true) }
    var search by remember { mutableStateOf("") }
    var index by remember { mutableIntStateOf(0) }
    var value by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf<WebsiteWeightsLogic.Pending?>(null) }
    // The counter said not to ask again until the screen is left.
    var trusted by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val typing = remember { FocusRequester() }
    val haptics = erp.app.ui.rememberHaptics()

    val all = pieces ?: emptyList()
    val queue = WebsiteWeightsLogic.queue(all, collection, onlyMissing, search)
    val current = queue.getOrNull(index)

    fun prefill(p: WebsiteWeightPiece?) { value = WebsiteWeightsLogic.prefill(p) }

    suspend fun load() {
        if (House.isDemo) {
            if (pieces == null) pieces = WebsiteDemo.weights()
            prefill(WebsiteWeightsLogic.queue(pieces ?: emptyList(), collection, onlyMissing, search).getOrNull(index))
            return
        }
        try {
            val a = WebsiteApi.get("/api/website/pieces", WebsiteWeightsAnswer)
            pieces = a.pieces
            problem = null
            prefill(WebsiteWeightsLogic.queue(a.pieces, collection, onlyMissing, search).getOrNull(index))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (pieces == null) problem = e.message ?: "Something went wrong." else failure = e.message ?: "Something went wrong."
        }
    }

    LaunchedEffect(Unit) {
        WebsiteStore.loadSettings()
        if (pieces == null) load()
    }
    // Choosing another list starts it again; a shorter list never leaves the index past its end.
    LaunchedEffect(collection, onlyMissing, search) { index = 0 }
    LaunchedEffect(queue.size) { index = minOf(index, maxOf(0, queue.size - 1)) }
    LaunchedEffect(current?.key) { prefill(current) }

    fun advance(by: Int = 1) { index = (index + by).coerceIn(0, maxOf(0, queue.size - 1)) }

    fun save(p: WebsiteWeightsLogic.Pending) {
        scope.launch {
            saving = true
            try {
                val body = LinkedHashMap<String, Any?>().apply { put("key", p.key); put("weightGrams", p.grams) }
                if (House.isDemo) throw ErpApi.Failure(0, "Not connected to the ERP in the demo.")
                ErpApi.shared.send("/api/website/pieces", "PUT", body)
                val was = queue
                val list = WebsiteWeightsLogic.saved(pieces ?: emptyList(), p.key, p.grams, AppClock.now())
                pieces = list
                // With "only missing" on, the piece leaves the list and the next slides into its place; otherwise step on.
                val next = if (p.advance && !onlyMissing) minOf(index + 1, maxOf(0, was.size - 1)) else index
                index = next
                prefill(WebsiteWeightsLogic.queue(list, collection, onlyMissing, search).getOrNull(next))
                runCatching { typing.requestFocus() }
                haptics.success()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong."
            } finally {
                saving = false
            }
        }
    }

    fun ask(advance: Boolean) {
        val p = current ?: return
        if (saving) return
        val typed = value.trim()
        val grams: Double? = if (typed.isEmpty()) null else (WebsiteNumber.parse(typed) ?: run { failure = "Enter a weight in grams."; return })
        // Nothing to change here: on to the next photo.
        val recorded = if (p.source == "pos") p.weightGrams else null
        if (grams == recorded) {
            if (advance) advance()
            return
        }
        val pending = WebsiteWeightsLogic.Pending(p.key, p.file, grams, p.labelWeightGrams, advance)
        if (trusted) save(pending) else confirming = pending
    }

    val off = site.settings?.let { !it.weights } ?: false
    when {
        off -> NotAvailableState("This shop's website prices pieces without weights", icon = Icons.Filled.Scale)
        pieces != null -> MarketingPinned(bar = if (current != null) ({
            MarketingActionBar(if (saving) "Saving…" else "Save & next", Icons.Filled.Check, { ask(true) }, busy = saving)
        }) else null) {
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
                WeightsPage(
                    all, queue, current, index, collection, onlyMissing, search, value, saving, typing, site.siteName,
                    setCollection = { collection = it }, setOnlyMissing = { onlyMissing = it }, setSearch = { search = it }, setValue = { value = it },
                    goTo = { index = it }, save = { ask(true) }, skip = { advance() },
                )
            }
        }
        problem != null -> MarketingErrorState(problem ?: "") { scope.launch { problem = null; load() } }
        else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading the catalogue…")
    }

    confirming?.let { p ->
        WebsiteConfirm(
            "Put this on ${site.siteName}?", WebsiteWeightsLogic.words(p, site.siteName),
            listOf(WebsiteChoice("Save") { save(p) }, WebsiteChoice("Save, and don't ask again here") { trusted = true; save(p) }),
            onDismiss = { confirming = null },
        )
    }
    FailureAlert(failure, { failure = null }, title = "Not saved")
}

@Composable
private fun WeightsPage(
    all: List<WebsiteWeightPiece>,
    queue: List<WebsiteWeightPiece>,
    current: WebsiteWeightPiece?,
    index: Int,
    collection: String,
    onlyMissing: Boolean,
    search: String,
    value: String,
    saving: Boolean,
    typing: FocusRequester,
    siteName: String,
    setCollection: (String) -> Unit,
    setOnlyMissing: (Boolean) -> Unit,
    setSearch: (String) -> Unit,
    setValue: (String) -> Unit,
    goTo: (Int) -> Unit,
    save: () -> Unit,
    skip: () -> Unit,
) {
    val progress: @Composable () -> Unit = { ProgressCard(all, collection, onlyMissing, search, siteName, setCollection, setOnlyMissing, setSearch) }
    val photo: @Composable () -> Unit = { if (current != null) PhotoSection(current, queue.size, index, value, goTo) }
    val work: @Composable () -> Unit = {
        if (current != null) {
            WeightSection(current, value, saving, typing, setValue, save, skip, index >= queue.size - 1)
            val upcoming = WebsiteWeightsLogic.upcoming(queue, index)
            if (upcoming.isNotEmpty()) UpcomingStrip(upcoming, goTo)
        } else {
            Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.CheckCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    if (onlyMissing) "Every photo here has a weight. Switch off “Only photos without a weight” to review or correct any of them."
                    else "Nothing matches. Clear the search or choose another collection.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 840.dp) {
            Row(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(0.5f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) { photo() }
                Column(Modifier.weight(0.5f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) { progress(); WebsiteSetOfTheDay(withNote = true); work() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                progress()
                WebsiteSetOfTheDay(withNote = true)
                photo()
                work()
            }
        }
    }
}

@Composable
private fun ProgressCard(
    all: List<WebsiteWeightPiece>, collection: String, onlyMissing: Boolean, search: String, siteName: String,
    setCollection: (String) -> Unit, setOnlyMissing: (Boolean) -> Unit, setSearch: (String) -> Unit,
) {
    val (total, withWeight) = WebsiteWeightsLogic.counts(all, collection)
    WebsiteCard(
        footer = { Text("Type the weight of the piece in the photograph. $siteName shows it in the corner, as on the photos that already carry one, and prices from it.") },
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("$withWeight", style = ErpType.tileValue)
                Text("of $total weighed", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    if (total - withWeight > 0) "${total - withWeight} to go" else "all weighed",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            LinearProgressIndicator(progress = { withWeight.toFloat() / maxOf(1, total) }, Modifier.fillMaxWidth(), color = ErpColors.accent)
        }
        PickerRow("Collection", collection, listOf("" to "All collections") + WebsiteWeightsLogic.collections(all).map { it to it }, setCollection)
        ToggleRow("Only photos without a weight", onlyMissing, setOnlyMissing)
        OutlinedTextField(
            value = search, onValueChange = setSearch, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = { Text("Find a photo…") }, leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
        )
    }
}

@Composable
private fun PhotoSection(p: WebsiteWeightPiece, total: Int, index: Int, value: String, goTo: (Int) -> Unit) {
    LedgerSection(p.collection.ifEmpty { "Photo" }, footer = { Text(p.file) }) {
        Box(Modifier.fillMaxWidth().padding(8.dp)) {
            WebsiteWeightPhoto(p, value, Modifier.fillMaxWidth())
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { goTo(maxOf(index - 1, 0)) }, enabled = index > 0) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous") }
            Text("${index + 1} of $total", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = { goTo(minOf(index + 1, total - 1)) }, enabled = index < total - 1) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next") }
        }
    }
}

/** The photograph with the weight drawn on it as the site would, or the weight its own label already shows. */
@Composable
fun WebsiteWeightPhoto(p: WebsiteWeightPiece, value: String, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(1f).clip(Radius.chipShape)) {
        StockImage(p.thumb, p.file, p.key, Modifier.fillMaxSize())
        if (p.source != "label") WeightLabel(WebsiteWeightsLogic.preview(p, value))
        if (p.source == "label" && p.labelWeightGrams != null) {
            Text(
                "Weight on the photo: ${WebsiteNumber.grams(p.labelWeightGrams)}g",
                Modifier.align(Alignment.TopEnd).padding(8.dp).clip(CircleShape).background(ErpColors.card).padding(horizontal = 8.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * As the site draws it (WeightLabel.jsx): Futura LT Light (bundled) at 143/3000 of the photo's width, 120/3000 in, its
 * baseline at (100 + 143 × 1.1)/3000, tracking 2/3000: what is typed shows where it lands, at its size, in its face.
 */
@Composable
private fun WeightLabel(shown: String?) {
    if (shown == null) return
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val density = LocalDensity.current
        Text(
            "${shown}g",
            Modifier.offset { IntOffset((w * 120 / 3000).roundToInt(), (w * 114 / 3000).roundToInt()) },
            color = Color.White,
            style = TextStyle(
                fontFamily = ErpFonts.futuraLight, fontWeight = FontWeight.Normal,
                fontSize = with(density) { (w * 143 / 3000).toSp() },
                letterSpacing = with(density) { (w * 2 / 3000).toSp() },
            ),
            maxLines = 1, softWrap = false,
        )
    }
}

@Composable
private fun WeightSection(
    p: WebsiteWeightPiece, value: String, saving: Boolean, typing: FocusRequester, setValue: (String) -> Unit,
    save: () -> Unit, skip: () -> Unit, last: Boolean,
) {
    FormSection(
        "Weight",
        footer = {
            if (p.source == "label" && p.labelWeightGrams != null) {
                Text("The photo already shows ${WebsiteNumber.grams(p.labelWeightGrams)}g. A weight typed here is used for pricing instead; the photo keeps its own label.")
            } else if (p.source == "pos" && p.enteredAt != null) {
                val who = if ((p.enteredBy ?: "").isEmpty() || p.enteredBy == "counter") "" else " by ${p.enteredBy}"
                Text("Recorded ${ShopDate.say(p.enteredAt, withTime = true)}$who. Clear the field and save to remove it.")
            }
        },
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = value, onValueChange = setValue, singleLine = true, modifier = Modifier.weight(1f).focusRequester(typing),
                placeholder = { Text("0.00", style = ErpType.heroNumber, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)) },
                textStyle = ErpType.heroNumber,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            Text("g", Modifier.padding(bottom = 14.dp), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = skip, enabled = !last, modifier = Modifier.fillMaxWidth()) { Text("Skip") }
        }
        WebsiteFeatureButton(p.key, p.file, Modifier.padding(horizontal = 8.dp))
    }
}

@Composable
private fun UpcomingStrip(upcoming: List<Pair<Int, WebsiteWeightPiece>>, goTo: (Int) -> Unit) {
    LedgerSection("Coming up") {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((at, piece) in upcoming) {
                Box(Modifier.size(64.dp).clip(Radius.thumbShape).clickable { goTo(at) }) {
                    StockImage(piece.thumb, piece.file, piece.key, Modifier.fillMaxSize())
                    piece.weightGrams?.let { g ->
                        Text(
                            "${WebsiteNumber.grams(g)}g", Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(ErpColors.card.copy(alpha = 0.85f)),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }
        }
    }
}
