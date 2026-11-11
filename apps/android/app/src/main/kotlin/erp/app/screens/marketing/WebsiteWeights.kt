package erp.app.screens.marketing

import erp.app.ui.SkeletonShape
import erp.app.ui.Loading
import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
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
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
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
import erp.app.data.Outbox
import erp.app.data.OutboxEngine
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
import erp.app.ui.Tone
import erp.app.ui.color
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
import erp.core.logic.PhotoLabel
import androidx.compose.ui.platform.LocalContext

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
    // The diamonds' carats (a diamond piece only): the main stone and the smaller ones beside it.
    var carats by remember { mutableStateOf("") }
    var side by remember { mutableStateOf("") }
    // White or dark, by the photo behind the label (PhotoLabel.inkFor, the website's own rule).
    var ink by remember { mutableStateOf(PhotoLabel.WHITE_INK) }
    val context = LocalContext.current
    var savedCount by remember { mutableStateOf(0) }
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

    fun prefill(p: WebsiteWeightPiece?) {
        value = WebsiteWeightsLogic.prefill(p)
        carats = p?.diamondCarats?.let { WebsiteNumber.grams(it) } ?: ""
        side = p?.sideCarats?.let { WebsiteNumber.grams(it) } ?: ""
    }

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
    LaunchedEffect(current?.thumb) {
        ink = PhotoLabel.WHITE_INK
        val url = current?.thumb ?: return@LaunchedEffect
        if (url.isNotEmpty()) ink = WebsiteLabelInk.of(context, url)
    }

    fun advance(by: Int = 1) { index = (index + by).coerceIn(0, maxOf(0, queue.size - 1)) }

    /**
     * Instant: the piece is changed here and the counter moves on; the site's PUT goes through the Outbox (a failure comes back
     * with Retry, and the same PUT is safe to repeat).
     */
    fun save(p: WebsiteWeightsLogic.Pending) {
        val body = WebsiteWeightsLogic.body(p)
        val was = queue
        val list = WebsiteWeightsLogic.saved(pieces ?: emptyList(), p.key, p.grams, AppClock.now(), p.sendCarats, p.carats, p.side)
        pieces = list
        Outbox.post(WEIGHT_PREFIX + p.file) {
            if (House.isDemo) throw ErpApi.Failure(0, "Not connected to the ERP in the demo.")
            ErpApi.shared.send("/api/website/pieces", "PUT", body)
            savedCount++
            ""
        }
        // With "only missing" on, the piece leaves the list and the next slides into its place; otherwise step on.
        val next = if (p.advance && !onlyMissing) minOf(index + 1, maxOf(0, was.size - 1)) else index
        index = next
        prefill(WebsiteWeightsLogic.queue(list, collection, onlyMissing, search).getOrNull(next))
        runCatching { typing.requestFocus() }
        haptics.success()
    }

    fun ask(advance: Boolean) {
        val p = current ?: return
        val typed = value.trim()
        val grams: Double? = if (typed.isEmpty()) null else (WebsiteNumber.parse(typed) ?: run { failure = "Enter a weight in grams."; return })
        val ct = PhotoLabel.parseCarats(carats)
        val sideCt = PhotoLabel.parseCarats(side)
        if (!PhotoLabel.caratsValid(ct) || !PhotoLabel.caratsValid(sideCt)) { failure = "Enter the diamonds in carats."; return }
        // Carats only travel for a diamond piece, or one that already has some (so clearing them works).
        val sendCarats = WebsiteWeightsLogic.showsCarats(p)
        // Nothing to change here: on to the next photo.
        val recorded = if (p.source == "pos") p.weightGrams else null
        if (grams == recorded && (!sendCarats || (ct == p.diamondCarats && sideCt == p.sideCarats))) {
            if (advance) advance()
            return
        }
        val pending = WebsiteWeightsLogic.Pending(p.key, p.file, grams, p.labelWeightGrams, advance, sendCarats, ct, sideCt)
        if (trusted) save(pending) else confirming = pending
    }

    val off = site.settings?.let { !it.weights } ?: false
    when {
        off -> NotAvailableState("This shop's website prices pieces without weights", icon = Symbols.Scale)
        pieces != null -> MarketingPinned(bar = if (current != null) ({
            MarketingActionBar("Save & next", Symbols.Check, { ask(true) }, busy = false)
        }) else null) {
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
                WeightsPage(
                    all, queue, current, index, collection, onlyMissing, search, value, carats, side, ink, savedCount, typing, site.siteName,
                    setCollection = { collection = it }, setOnlyMissing = { onlyMissing = it }, setSearch = { search = it }, setValue = { value = it },
                    setCarats = { carats = it }, setSide = { side = it },
                    goTo = { index = it }, save = { ask(true) }, skip = { advance() },
                )
            }
        }
        problem != null -> MarketingErrorState(problem ?: "") { scope.launch { problem = null; load() } }
        else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading the catalogue…", shape = SkeletonShape.Rows)
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
    carats: String,
    side: String,
    ink: Int,
    savedCount: Int,
    typing: FocusRequester,
    siteName: String,
    setCollection: (String) -> Unit,
    setOnlyMissing: (Boolean) -> Unit,
    setSearch: (String) -> Unit,
    setValue: (String) -> Unit,
    setCarats: (String) -> Unit,
    setSide: (String) -> Unit,
    goTo: (Int) -> Unit,
    save: () -> Unit,
    skip: () -> Unit,
) {
    val progress: @Composable () -> Unit = { ProgressCard(all, collection, onlyMissing, search, siteName, savedCount, setCollection, setOnlyMissing, setSearch) }
    val photo: @Composable () -> Unit = { if (current != null) PhotoSection(current, queue.size, index, value, carats, side, ink, goTo) }
    val work: @Composable () -> Unit = {
        if (current != null) {
            WeightSection(current, value, carats, side, false, typing, setValue, setCarats, setSide, save, skip, index >= queue.size - 1)
            val upcoming = WebsiteWeightsLogic.upcoming(queue, index)
            if (upcoming.isNotEmpty()) UpcomingStrip(upcoming, goTo)
        } else {
            Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Symbols.CheckCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
    all: List<WebsiteWeightPiece>, collection: String, onlyMissing: Boolean, search: String, siteName: String, savedCount: Int,
    setCollection: (String) -> Unit, setOnlyMissing: (Boolean) -> Unit, setSearch: (String) -> Unit,
) {
    val (total, withWeight) = WebsiteWeightsLogic.counts(all, collection)
    WebsiteCard(
        footer = { Text("$siteName shows it in the corner and prices from it.") },
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
            WeightsSavingRow(savedCount)
        }
        PickerRow("Collection", collection, listOf("" to "All collections") + WebsiteWeightsLogic.collections(all).map { it to it }, setCollection)
        ToggleRow("Only photos without a weight", onlyMissing, setOnlyMissing)
        SearchBarField(
            value = search, onValueChange = setSearch, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = { Text("Find a photo…") }, leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
        )
    }
}

@Composable
private fun PhotoSection(p: WebsiteWeightPiece, total: Int, index: Int, value: String, carats: String, side: String, ink: Int, goTo: (Int) -> Unit) {
    LedgerSection(p.collection.ifEmpty { "Photo" }, footer = { Text(p.file) }) {
        Box(Modifier.fillMaxWidth().padding(8.dp)) {
            WebsiteWeightPhoto(p, value, Modifier.fillMaxWidth(), carats, side, ink)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { goTo(maxOf(index - 1, 0)) }, enabled = index > 0) { Icon(Symbols.KeyboardArrowLeft, "Previous") }
            Text("${index + 1} of $total", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = { goTo(minOf(index + 1, total - 1)) }, enabled = index < total - 1) { Icon(Symbols.KeyboardArrowRight, "Next") }
        }
    }
}

/** The photograph with the weight drawn on it as the site would, or the weight its own label already shows. */
@Composable
fun WebsiteWeightPhoto(
    p: WebsiteWeightPiece, value: String, modifier: Modifier = Modifier,
    carats: String = p.diamondCarats?.let { WebsiteNumber.grams(it) } ?: "", side: String = p.sideCarats?.let { WebsiteNumber.grams(it) } ?: "",
    ink: Int = PhotoLabel.WHITE_INK,
) {
    Box(modifier.aspectRatio(1f).clip(Radius.chipShape)) {
        StockImage(p.thumb, p.file, p.key, Modifier.fillMaxSize())
        // The carats line shows under a weight burned into the photo too.
        val line = PhotoLabel.caratsLine(PhotoLabel.parseCarats(carats)?.takeIf { it > 0 } ?: 0.0, PhotoLabel.parseCarats(side)?.takeIf { it > 0 } ?: 0.0)
        WeightLabel(if (p.source != "label") WebsiteWeightsLogic.preview(p, value) else null, line, Color(0xFF000000.toInt() or ink))
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
 * baseline at (100 + 143 × 1.1)/3000, tracking 2/3000: what is typed shows where it lands, at its size, in its face. A
 * diamond piece's carats ("0.50ct + 0.24ct") go under it in the same face at 90/3000, baseline 1.3 of its size lower, and both
 * are white or dark by the photo behind them (`ink`).
 */
@Composable
private fun WeightLabel(shown: String?, carats: String, ink: Color) {
    if (shown == null && carats.isEmpty()) return
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val density = LocalDensity.current
        val k = w / PhotoLabel.REFERENCE.toFloat()
        // A line is placed by its baseline: Compose offsets the text box, so the baseline it reports is subtracted.
        @Composable
        fun Line(text: String, size: Double, baseline: Double) {
            var ascent by remember { mutableStateOf(0f) }
            Text(
                text,
                Modifier.offset { IntOffset((PhotoLabel.LEFT * k).roundToInt(), ((baseline * k) - ascent).roundToInt()) },
                color = ink,
                onTextLayout = { ascent = it.firstBaseline },
                style = TextStyle(
                    fontFamily = ErpFonts.futuraLight, fontWeight = FontWeight.Normal,
                    fontSize = with(density) { (size * k).toFloat().toSp() },
                    letterSpacing = with(density) { (PhotoLabel.TRACKING * k).toFloat().toSp() },
                ),
                maxLines = 1, softWrap = false,
            )
        }
        if (shown != null) Line("${shown}g", PhotoLabel.WEIGHT_SIZE, PhotoLabel.WEIGHT_BASELINE)
        if (carats.isNotEmpty()) Line(carats, PhotoLabel.CT_SIZE, PhotoLabel.CT_BASELINE)
    }
}

@Composable
private fun WeightSection(
    p: WebsiteWeightPiece, value: String, carats: String, side: String, saving: Boolean, typing: FocusRequester, setValue: (String) -> Unit,
    setCarats: (String) -> Unit, setSide: (String) -> Unit, save: () -> Unit, skip: () -> Unit, last: Boolean,
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
            TextField(
                value = value, onValueChange = setValue, singleLine = true, modifier = Modifier.weight(1f).focusRequester(typing),
                placeholder = { Text("0.00", style = ErpType.heroNumber, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)) },
                textStyle = ErpType.heroNumber,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            Text("g", Modifier.padding(bottom = 14.dp), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (WebsiteWeightsLogic.showsCarats(p)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CaratsField("Main diamond", carats, setCarats, Modifier.weight(1f))
                CaratsField("Small diamonds", side, setSide, Modifier.weight(1f))
            }
            Text(
                "Shown under the weight on the photo, smaller: the solitaire, then the small diamonds after a +. Leave either empty.",
                Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = skip, enabled = !last, modifier = Modifier.fillMaxWidth()) { Text("Skip") }
        }
        WebsiteFeatureButton(p.key, p.file, Modifier.padding(horizontal = 8.dp))
    }
}

/** One carats field: the label above, "ct" beside the number. */
@Composable
private fun CaratsField(label: String, value: String, set: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextField(
            value = value, onValueChange = set, singleLine = true, modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("0.00", color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)) },
            suffix = { Text("ct") },
            textStyle = MaterialTheme.typography.titleLarge,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
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

/** The label an Outbox weight carries: "Weight: <file>". */
private const val WEIGHT_PREFIX = "Weight: "

/** "Saving…" while weights go, a warning if one failed (the banner has Retry), then a tick. */
@Composable
private fun WeightsSavingRow(savedCount: Int) {
    val items = Outbox.items.collectAsStateWithLifecycle().value.filter { it.label.startsWith(WEIGHT_PREFIX) }
    val bad = items.firstOrNull { it.status == OutboxEngine.Status.Failed }
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    when {
        bad != null -> Text("Not saved: ${bad.label.removePrefix(WEIGHT_PREFIX)}", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
        items.isNotEmpty() -> Text("Saving ${items.size}…", style = MaterialTheme.typography.bodySmall, color = quiet)
        savedCount > 0 -> Text("$savedCount saved", style = MaterialTheme.typography.bodySmall, color = quiet)
    }
}
