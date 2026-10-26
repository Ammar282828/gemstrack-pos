package erp.app.screens.design

import erp.app.ui.SearchBarField
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.MarketingPhoto
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay

/**
 * Photos (src/app/design/photos-section.tsx): where a design's photograph comes from. The website's own pieces for everyone who may
 * design; the Ad studio's library ("Best for ads", "Every photo") for owner and marketing. Choosing a photograph hands it back
 * (`onPick`); nothing is made here.
 */
@Composable
fun DesignPhotosView(access: DesignAccess, part: DesignPhotoPart, onPart: (DesignPhotoPart) -> Unit, onPick: (DesignStartPhoto) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        if (DesignPhotoPart.offered(access).size > 1) {
            ChipRow { for (p in DesignPhotoPart.offered(access)) FilterChip(p.title, chosen = part == p, onClick = { onPart(p) }) }
        }
        when (part) {
            DesignPhotoPart.Site -> DesignSitePieces(onPick)
            DesignPhotoPart.Picks, DesignPhotoPart.Library -> DesignLibraryPhotos(all = part == DesignPhotoPart.Library, onPick = onPick)
        }
    }
}

// MARK: The website's pieces

@Composable
fun DesignSitePieces(onPick: (DesignStartPhoto) -> Unit) {
    var pieces by remember { mutableStateOf<List<MarketingValue>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var q by remember { mutableStateOf("") }
    var collection by remember { mutableStateOf("__new__") }
    var shown by remember { mutableStateOf(60) }

    suspend fun load() {
        if (House.isDemo) { pieces = DesignDemo.sitePieces(); loaded = true; return }
        try {
            val all = MarketingRequest.get("/api/website/site-pieces?lean=1")["pieces"].array.filter { !it["hidden"].bool }
            // New arrivals first (lib/website/new-arrivals.ts byNewest): the later `added`, then the name.
            pieces = all.sortedWith { a, b -> if (a.n("added") != b.n("added")) b.n("added").compareTo(a.n("added")) else a.s("name").compareTo(b.s("name")) }
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
        loaded = true
    }
    LaunchedEffect(Unit) { load() }

    val hasNew = pieces.any { it["newArrival"].bool }
    val showing = if (collection == "__new__" && !hasNew) "" else collection
    val collections = pieces.map { it.s("collection") }.filter { it.isNotEmpty() }.toSet().sorted()
    val words = q.lowercase().split(' ').filter { it.isNotEmpty() }
    val filtered = pieces.filter { p ->
        val inCollection = if (showing == "__new__") p["newArrival"].bool else (showing.isEmpty() || p.s("collection") == showing)
        val hay = (listOf(p.s("name"), p.s("collection")) + p["facts"].array.map { it.string }).joinToString(" ").lowercase()
        inCollection && words.all { hay.contains(it) }
    }

    Column(Modifier.fillMaxSize()) {
        ChipRow {
            if (hasNew) FilterChip("New arrivals", showing == "__new__", { collection = "__new__"; shown = 60 })
            FilterChip("Everything", showing.isEmpty(), { collection = ""; shown = 60 })
            for (c in collections) FilterChip(c, showing == c, { collection = c; shown = 60 })
        }
        SearchBarField(
            q, { q = it; shown = 60 }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), singleLine = true,
            placeholder = { Text("Ruby, kara, jhumka") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
        )
        when {
            error != null -> NotAvailableState("Couldn’t read the website", why = error, icon = Icons.Filled.Language)
            !loaded -> SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the website")
            filtered.isEmpty() -> NotAvailableState("No pieces", why = "Nothing on the website matches.", icon = Icons.Filled.Language)
            else -> LazyVerticalGrid(
                GridCells.Adaptive(minSize = 104.dp), Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text("${filtered.size} of ${pieces.size} pieces. Tap one to design it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(filtered.take(shown), key = { it.s("id") }) { p ->
                    PieceCell(p.s("name"), p.s("collection"), p.s("thumb", p.s("image"))) { onPick(DesignPhotoSources.site(p)) }
                }
                if (filtered.size > shown) item(span = { GridItemSpan(maxLineSpan) }) {
                    TextButton(onClick = { shown += 60 }, Modifier.fillMaxWidth()) { Text("Show more (${filtered.size - shown} left)") }
                }
            }
        }
    }
}

@Composable
private fun PieceCell(name: String, sub: String, thumb: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.tileShape).background(ErpColors.ground), contentAlignment = Alignment.Center) {
            if (thumb.isNotEmpty()) MarketingPhoto(thumb, Modifier.fillMaxSize(), ContentScale.Crop)
            else Icon(Icons.Filled.PhotoLibrary, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(name, maxLines = 2, style = MaterialTheme.typography.labelLarge)
        if (sub.isNotEmpty()) Text(sub, maxLines = 1, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: The ad studio's library (owner and marketing)

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DesignLibraryPhotos(all: Boolean, onPick: (DesignStartPhoto) -> Unit) {
    var rows by remember { mutableStateOf<List<MarketingValue>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var q by remember { mutableStateOf("") }
    var placement by remember { mutableStateOf("portrait") }

    /** The Studio's own call (StudioLibrary.load): the same route and parameters. */
    suspend fun load(more: Boolean) {
        if (House.isDemo) { loaded = true; return }
        val params = mapOf(
            "view" to (if (all) "all" else "picks"), "placement" to placement, "source" to "all", "filter" to "all", "collection" to "", "q" to q,
            "sort" to "newest", "offset" to (if (more) rows.size.toString() else "0"), "limit" to "60", "fresh" to "0",
        )
        val path = "/api/ads/studio/library?" + params.toSortedMap().entries.joinToString("&") { it.key + "=" + MarketingKit.escape(it.value) }
        try {
            val r = MarketingRequest.get(path)
            rows = if (more) rows + r["items"].array else r["items"].array
            total = r.n("total").toInt()
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
        loaded = true
    }
    LaunchedEffect(all, q, placement) { delay(250); load(false) }

    Column(Modifier.fillMaxSize()) {
        SearchBarField(
            q, { q = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), singleLine = true,
            placeholder = { Text("Name, subject or collection") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
        )
        val options = listOf("portrait" to "Feed 4:5", "square" to "Feed 1:1", "story" to "Stories 9:16")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            options.forEachIndexed { i, (id, title) ->
                SegmentedButton(selected = placement == id, onClick = { placement = id }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(title) }
            }
        }
        when {
            error != null -> NotAvailableState("Couldn’t read the library", why = error, icon = Icons.Filled.PhotoLibrary)
            !loaded -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading the photos")
            rows.isEmpty() -> NotAvailableState("No photos", why = "No photos match.", icon = Icons.Filled.PhotoLibrary)
            else -> LazyVerticalGrid(
                GridCells.Adaptive(minSize = 104.dp), Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(rows, key = { it.s("id") }) { item ->
                    PieceCell(item.s("name"), if (item["adScore"].isNull) item.s("collection") else "Ad score ${item.n("adScore").toInt()}", item.s("thumb")) { onPick(DesignPhotoSources.library(item)) }
                }
                if (rows.size < total) item(span = { GridItemSpan(maxLineSpan) }) {
                    var more by remember { mutableStateOf(false) }
                    LaunchedEffect(more) { if (more) { load(true); more = false } }
                    TextButton(onClick = { more = true }, Modifier.fillMaxWidth()) { Text("Show more") }
                }
            }
        }
    }
}
