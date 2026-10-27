package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
import erp.app.ui.zoomDestination
import erp.app.ui.zoomSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.device.openAddress
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ChipRow
import erp.app.ui.ActionRow
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.ValueRow
import erp.app.ui.FormSection
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import java.time.Instant
import kotlinx.coroutines.launch

/** The pieces screen's filter, as the web hub's grid has it (pure, so it is tested). */
object PostPiecesLogic {
    /** The "new arrivals" chip; "" is everything. */
    const val NEW_KEY = "__new"

    /** Pieces posted within this many days are hidden by default (page.tsx FRESH_DAYS). */
    const val FRESH_DAYS = 30
    const val PAGE_SIZE = 60

    fun hasNew(pieces: List<PostPiece>) = pieces.any { it.newArrival }

    /** A site that gives no dates has no new arrivals: the grid shows everything instead. */
    fun showing(collection: String, pieces: List<PostPiece>): String = if (collection == NEW_KEY && !hasNew(pieces)) "" else collection

    fun collections(pieces: List<PostPiece>): List<String> = pieces.map { it.collection }.filter { it.isNotEmpty() }.toSet().sorted()

    fun recent(p: PostPiece, posted: Map<String, String>, now: Instant): Boolean {
        val days = MarketingTime.daysAgo(posted[p.id], now) ?: return false
        return days < FRESH_DAYS
    }

    fun filtered(pieces: List<PostPiece>, posted: Map<String, String>, search: String, collection: String, freshOnly: Boolean, now: Instant): List<PostPiece> {
        val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
        val chosen = showing(collection, pieces)
        return pieces.filter { p ->
            if (chosen == NEW_KEY) { if (!p.newArrival) return@filter false }
            else if (chosen.isNotEmpty() && p.collection != chosen) return@filter false
            if (freshOnly && recent(p, posted, now)) return@filter false
            if (words.isEmpty()) return@filter true
            val text = "${p.name} ${p.collection} ${p.facts.joinToString(" ")}".lowercase()
            words.all { text.contains(it) }
        }
    }

    /** 3.84, 12 (no trailing zeros). */
    fun trimmed(v: Double): String {
        var s = String.format(java.util.Locale.ROOT, "%.2f", v)
        while (s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return s
    }

    fun lastPosted(posted: String?, now: Instant): String {
        val words = MarketingTime.postedAgo(posted, now) ?: return "Never from here"
        return words.replace("posted ", "").replaceFirstChar { it.uppercase() }
    }

    fun editPath(p: PostPiece) = "/website/edit?id=${MarketingKit.escape(p.id)}"
}

/**
 * The website's pieces as a photo grid (the hub's "From the website" grid): search, a collection chip row that opens on
 * the new arrivals, and the web's default of hiding what went out in the last 30 days. Tapping one opens the piece; given the
 * tray (PostTrayScreen's Add pieces), a tap picks it or takes it out.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostPiecesScreen(tray: PostTrayModel? = null) {
    if (tray == null) ScreenTitle("Pieces")
    var refused by remember { mutableStateOf<String?>(null) }
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { PostsStore.load() }
    var search by rememberSaveable { mutableStateOf("") }
    var collection by rememberSaveable { mutableStateOf(PostPiecesLogic.NEW_KEY) }
    var freshOnly by rememberSaveable { mutableStateOf(true) }
    var shown by remember { mutableIntStateOf(PostPiecesLogic.PAGE_SIZE) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(search, collection, freshOnly) { shown = PostPiecesLogic.PAGE_SIZE }

    when (val phase = state.piecesPhase) {
        PostsPhase.Off -> NotAvailableState("This shop doesn't post its website's pieces", why = "Its website has no pieces for the ERP to post from, so there is nothing to choose here.", icon = Symbols.Public)
        is PostsPhase.Failed -> MarketingErrorState(phase.message) { scope.launch { PostsStore.load() } }
        PostsPhase.Idle, PostsPhase.Loading -> SkeletonLoading(Modifier.fillMaxSize())
        PostsPhase.Loaded -> {
            val items = PostPiecesLogic.filtered(state.pieces, state.posted, search, collection, freshOnly, erp.app.ui.AppClock.now())
            val showing = PostPiecesLogic.showing(collection, state.pieces)
            val navigator = LocalNavigator.current
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; PostsStore.load(); refreshing = false } }) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(150.dp),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        SearchBarField(
                            value = search, onValueChange = { search = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("Search: ruby, kara, jhumka…") },
                            leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        // The grid already has its 16 dp gutter: the chips scroll inside it, not in a second one.
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (PostPiecesLogic.hasNew(state.pieces)) MarketingChip("New arrivals", showing == PostPiecesLogic.NEW_KEY, { collection = PostPiecesLogic.NEW_KEY })
                            MarketingChip("Everything", showing.isEmpty(), { collection = "" })
                            for (c in PostPiecesLogic.collections(state.pieces)) MarketingChip(c, showing == c, { collection = c })
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(Modifier.fillMaxWidth().ledgerCard(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Hide pieces posted in the last ${PostPiecesLogic.FRESH_DAYS} days", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            Switch(checked = freshOnly, onCheckedChange = { freshOnly = it })
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text("${items.size} of ${state.pieces.size} pieces", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (items.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            NotAvailableState("Nothing matches", why = "Clear the search, pick another collection, or show what went out lately.", icon = Symbols.GridView)
                        }
                    } else {
                        items(items.take(shown), key = { it.id }) { p ->
                            if (tray != null) {
                                Box(Modifier.clickable { refused = tray.pick(p) }.ledgerCard(10.dp)) {
                                    PostPieceTile(p, state.posted[p.id])
                                    PickMark(tray, p, Modifier.align(Alignment.TopEnd))
                                }
                            } else {
                                Box(Modifier.zoomSource(MarketingKit.piecePath(p.id)).clickable { navigator.open(MarketingKit.piecePath(p.id)) }.ledgerCard(10.dp)) { PostPieceTile(p, state.posted[p.id]) }
                            }
                        }
                        if (items.size > shown) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                    androidx.compose.material3.OutlinedButton(onClick = { shown += PostPiecesLogic.PAGE_SIZE }) { Text("Show more (${items.size - shown} left)") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    erp.app.ui.FailureAlert(refused, { refused = null }, "Not now")
}

/** Its place in the tray, the order they go in (a ring where it isn't picked). */
@Composable
private fun PickMark(tray: PostTrayModel, p: PostPiece, modifier: Modifier = Modifier) {
    val i = tray.cards.indexOfFirst { it.id == p.id }
    if (i >= 0) {
        Text(
            "${i + 1}", modifier.padding(14.dp).size(24.dp).clip(CircleShape).background(ErpColors.accent).semantics { contentDescription = "Picked, number ${i + 1}" },
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TabularDigits, fontWeight = FontWeight.SemiBold), color = ErpColors.onAccent, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    } else {
        Box(modifier.padding(14.dp).size(24.dp).clip(CircleShape).background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.2f)).border(2.dp, androidx.compose.ui.graphics.Color.White.copy(alpha = 0.85f), CircleShape))
    }
}

/**
 * One website piece (the hub's piece card without its tray): the photograph, the words the site has for it, when it
 * went out, and the ERP pages that act on it.
 */
@Composable
fun PostPieceScreen(id: String) {
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val piece = state.piece(id)
    ScreenTitle(piece?.name ?: "Piece")
    LaunchedEffect(id) { if (PostsStore.state.value.piece(id) == null) PostsStore.load() }
    Box(Modifier.fillMaxSize().zoomDestination(MarketingKit.piecePath(id))) {
        when {
            piece != null -> Box(Modifier.fillMaxSize().readableColumn(720.dp)) { PieceDetail(piece, state) }
            state.piecesPhase == PostsPhase.Loaded -> NotAvailableState("That piece is not on the website any more", icon = Symbols.GridView)
            else -> SkeletonLoading(Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun PieceDetail(p: PostPiece, state: PostsState) {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            StockImage(p.image, p.name, p.id, Modifier.heightIn(max = 360.dp).fillMaxWidth().aspectRatio(1f, matchHeightConstraintsFirst = true).clip(Radius.chipShape))
        }
        FormSection("About this piece") {
            ValueRow("Collection") { Text(p.collection.ifEmpty { "None" }, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if ((p.weightGrams ?: 0.0) > 0) ValueRow("Weight") { Text("${PostPiecesLogic.trimmed(p.weightGrams!!)} g", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if ((p.added ?: 0.0) > 0) ValueRow("On the site since") { Text(erp.app.ui.ShopDate.say(erp.core.ERPDate.iso(Instant.ofEpochMilli(p.added!!.toLong()))), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ValueRow("Last posted") { Text(PostPiecesLogic.lastPosted(state.posted[p.id], erp.app.ui.AppClock.now()), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (p.newArrival) ValueRow("New arrival") { Text("Yes", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (p.facts.isNotEmpty()) {
            FormSection("Details") { for (f in p.facts) Text(f, Modifier.fillMaxWidth().padding(16.dp)) }
        }
        if (p.about.isNotEmpty()) {
            FormSection("About") { Text(p.about, Modifier.fillMaxWidth().padding(16.dp)) }
        }
        FormSection("Act on it") {
            MarketingLink("Send or queue it", Symbols.Send, MarketingKit.trayPath(p.id))
            if (MarketingKit.has("/website/edit", role)) MarketingLink("Edit this piece", Symbols.Edit, PostPiecesLogic.editPath(p))
            if (p.url.startsWith("http")) {
                ActionRow("Open on ${state.siteName}", { openAddress(context, android.content.Intent.ACTION_VIEW, p.url) }, Symbols.OpenInNew)
            }
        }
    }
}
