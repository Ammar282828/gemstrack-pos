package erp.app.screens.marketing

import erp.app.ui.SearchBarField
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VisibilityOff
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import java.net.URI
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Every piece on the house's website with the counter's changes, as a save leaves them. */
data class WebsiteEditsState(
    val phase: PostsPhase = PostsPhase.Idle,
    val site: String = "",
    val pieces: List<WebsiteEditPiece> = emptyList(),
    val recent: List<WebsiteEditRecent> = emptyList(),
) {
    fun piece(id: String): WebsiteEditPiece? = pieces.firstOrNull { it.id == id }

    val siteName: String
        get() {
            val host = try { URI(site).host } catch (e: Exception) { null } ?: return WebsiteStore.state.value.siteName
            return host.removePrefix("www.")
        }
}

/**
 * Every piece on the house's website with the counter's changes (/api/website/edits), read once for the grid and its
 * pieces, and kept as each save comes back (WebsiteEdits).
 */
object WebsiteEdits {
    private val _state = MutableStateFlow(WebsiteEditsState())
    val state: StateFlow<WebsiteEditsState> = _state.asStateFlow()

    @Volatile private var loading = false
    private var loadedAt: Instant? = null

    /** The list, unless it was read in the last minute; [fresh] asks the site again past the ERP's cache. */
    suspend fun load(fresh: Boolean = false) {
        if (House.isDemo) {
            if (_state.value.phase != PostsPhase.Loaded) {
                val a = WebsiteDemo.edits(House.id, AppClock.now())
                _state.value = WebsiteEditsState(PostsPhase.Loaded, a.site, a.pieces, a.recent)
            }
            return
        }
        if (loading) return
        val at = loadedAt
        if (!fresh && _state.value.phase == PostsPhase.Loaded && at != null && Instant.now().epochSecond - at.epochSecond < 60) return
        loading = true
        try {
            if (_state.value.phase != PostsPhase.Loaded) _state.update { it.copy(phase = PostsPhase.Loading) }
            val a = WebsiteApi.get(if (fresh) "/api/website/edits?fresh=1" else "/api/website/edits", WebsiteEditsAnswer)
            _state.value = WebsiteEditsState(PostsPhase.Loaded, a.site, a.pieces, a.recent)
            loadedAt = Instant.now()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 404) _state.update { it.copy(phase = PostsPhase.Off) }
            else if (_state.value.pieces.isEmpty()) _state.update { it.copy(phase = PostsPhase.Failed(e.message)) }
        } catch (e: Exception) {
            if (_state.value.pieces.isEmpty()) _state.update { it.copy(phase = PostsPhase.Failed(e.message ?: "Something went wrong.")) }
        } finally {
            loading = false
        }
    }

    /** A piece as a save left it; the change log is read again behind it. */
    suspend fun replace(p: WebsiteEditPiece) {
        _state.update { s ->
            val k = s.pieces.indexOfFirst { it.id == p.id }
            s.copy(pieces = if (k >= 0) s.pieces.toMutableList().also { it[k] = p } else s.pieces + p)
        }
        loadedAt = null
        load()
    }
}

/**
 * Website → Edit a piece (src/app/website/edit/page.tsx): every piece on the house's website (taheri.shop, or the House of
 * Mina catalogue), hidden ones too, with what the counter changed. Search, "Changed here", "Hidden" and the collections; a
 * piece opens natively (WebsiteEditPieceScreen) for its words, its weight, hiding it and putting things back. Re-making its
 * photograph (crop, the weight and the mark stamped on, the designer, the AI) is the ERP's square editor, opened in the app
 * from the piece.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebsiteEditScreen() {
    ScreenTitle("Edit a piece")
    val state by WebsiteEdits.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { WebsiteEdits.load() }
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(WebsiteEditLogic.Filter.All) }
    var collection by rememberSaveable { mutableStateOf("") }
    var shown by remember { mutableIntStateOf(WebsiteEditLogic.PAGE_SIZE) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(search, filter, collection) { shown = WebsiteEditLogic.PAGE_SIZE }

    when (val phase = state.phase) {
        PostsPhase.Off -> NotAvailableState("This shop doesn't edit its website from here", icon = Icons.Filled.Language)
        is PostsPhase.Failed -> MarketingErrorState(phase.message) { scope.launch { WebsiteEdits.load(fresh = true) } }
        PostsPhase.Idle, PostsPhase.Loading -> SkeletonLoading(Modifier.fillMaxSize(), label = "Reading ${state.siteName}…")
        PostsPhase.Loaded -> {
            val items = WebsiteEditLogic.filtered(state.pieces, search, filter, collection)
            val changedCount = state.pieces.count { it.changed }
            val hiddenCount = state.pieces.count { it.hidden }
            val navigator = LocalNavigator.current
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; WebsiteEdits.load(fresh = true); refreshing = false } }) {
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
                            placeholder = { Text("Name, collection, ruby, Ring 12…") },
                            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                        )
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            MarketingChip("Everything", filter == WebsiteEditLogic.Filter.All, { filter = WebsiteEditLogic.Filter.All })
                            MarketingChip("Changed here", filter == WebsiteEditLogic.Filter.Changed, { filter = WebsiteEditLogic.Filter.Changed }, count = changedCount.takeIf { it > 0 })
                            MarketingChip("Hidden", filter == WebsiteEditLogic.Filter.Hidden, { filter = WebsiteEditLogic.Filter.Hidden }, count = hiddenCount.takeIf { it > 0 })
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            MarketingChip("Every collection", collection.isEmpty(), { collection = "" })
                            for (c in WebsiteEditLogic.collections(state.pieces)) MarketingChip(c, collection == c, { collection = c })
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text(
                            "${items.size} of ${state.pieces.size} pieces · it shows on ${state.siteName} within a minute; the original photo is kept to put back",
                            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (items.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            NotAvailableState("Nothing matches", why = "Clear the search, or pick another collection.", icon = Icons.Filled.GridView)
                        }
                    } else {
                        items(items.take(shown), key = { it.id }) { p ->
                            Box(Modifier.animateItem().clickable { navigator.open(WebsiteEditLogic.piecePath(p.id)) }.ledgerCard(10.dp)) { WebsiteEditTile(p) }
                        }
                        if (items.size > shown) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                    androidx.compose.material3.OutlinedButton(onClick = { shown += WebsiteEditLogic.PAGE_SIZE }) { Text("Show more (${items.size - shown} left)") }
                                }
                            }
                        }
                    }
                    if (state.recent.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) { RecentCard(state.recent) { navigator.open(WebsiteEditLogic.piecePath(it)) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentCard(recent: List<WebsiteEditRecent>, open: (String) -> Unit) {
    erp.app.ui.SectionCard("Recent changes") {
        for (r in recent.take(15)) {
            Column(Modifier.fillMaxWidth().clickable { open(r.key) }.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(r.name.ifEmpty { "A piece" }, color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
                Text(WebsiteEditLogic.recentWords(r), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** A piece in the grid: its photo as the site shows it, what was changed here, its name and weight. */
@Composable
fun WebsiteEditTile(piece: WebsiteEditPiece) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box {
            StockImage(piece.thumb, piece.words.name, piece.id, Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.tileShape).alpha(if (piece.hidden) 0.45f else 1f))
            Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (piece.hidden) Badge("Hidden", Icons.Filled.VisibilityOff)
                if (piece.photoEdited) Badge("New photo", Icons.Filled.Image)
                if (piece.wordsChanged) Badge("Words changed", Icons.Filled.EditNote)
            }
        }
        Text(piece.words.name.ifEmpty { "A piece" }, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), maxLines = 2, overflow = TextOverflow.Ellipsis)
        val detail = WebsiteEditLogic.detail(piece)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Badge(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(
        Modifier.clip(CircleShape).background(ErpColors.card).padding(horizontal = 6.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.onSurface)
        Text(text, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
    }
}
