package erp.app.screens.neworder

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import erp.app.data.ErpApi
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.Loading
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SearchBarField
import erp.app.ui.TextButton
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.core.entry.NewOrderWords
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

// A reference photo printed on the bill (owner, 2026-11-03: "print the reference image onto the bill next to the icon and allow me
// to pick reference image from my catalogue (only show that category's photos) and make it super easy to filter and search"). The
// piece's rows (a switch, a preview, "Pick from catalogue") and the sheet that picks. `referenceImage` is an https address from the
// catalogue; `printReference` says to print one (a piece on an order with no pick prints its own first reference photo).
// (ReferenceKit.swift.)

/**
 * The switch, the picked picture, and the way to pick one. Sits in a card on the piece or line editor. [fallbackNote] is what prints
 * when nothing is picked ("The piece's own first reference photo is printed"), or empty for nothing.
 */
@Composable
internal fun ReferencePrintRows(
    image: String?, printIt: Boolean, category: String, onChange: (image: String?, printIt: Boolean) -> Unit, fallbackNote: String = "",
) {
    var picking by remember { mutableStateOf(false) }
    val picked = (image ?: "").trim()
    ToggleRow("Print reference photo on the bill", printIt) { on -> onChange(image, on) }
    if (picked.startsWith("http")) {
        Row(
            Modifier.fillMaxWidth().formRow(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AsyncImage(
                model = picked, contentDescription = "The picked reference photo", contentScale = ContentScale.Crop,
                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(Radius.thumb)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
            )
            Column(Modifier.weight(1f)) {
                Text("From the catalogue", style = MaterialTheme.typography.bodyLarge)
                if (printIt) Text("Printed beside the piece", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { onChange(null, printIt) }) { Text("Remove", color = Tone.problem.color()) }
        }
    } else if (printIt && fallbackNote.isNotEmpty()) {
        Text(
            fallbackNote, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    ActionRow(if (picked.isEmpty()) "Pick from catalogue" else "Change from catalogue", onClick = { picking = true }, icon = Symbols.PhotoLibrary)
    if (picking) {
        ReferencePickerSheet(category, picked, onPick = { chosen -> onChange(chosen, true) }, onDismiss = { picking = false })
    }
}

/** The catalogue as a grid of pictures: this piece's category first, a chip row to widen it, a search, one tap to pick. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReferencePickerSheet(category: String, current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var scope by remember { mutableStateOf(category) }
    var query by remember { mutableStateOf("") }
    var pieces by remember { mutableStateOf<List<CataloguePiece>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    // This piece's category leads, then the others in the shop's order.
    val chips = remember(category) {
        val all = NewOrderWords.categories
        all.firstOrNull { it.id == category }?.let { mine -> listOf(mine) + all.filter { it.id != category } } ?: all
    }
    LaunchedEffect(scope, query, attempt) {
        val q = query.trim()
        // A pause after the last letter, so typing is one request; a chip is at once.
        if (q.isNotEmpty()) delay(300)
        val hit = CatalogueStore.cached(scope, q)
        if (hit != null) { pieces = hit; failure = null; loading = false; return@LaunchedEffect }
        loading = true
        try {
            pieces = CatalogueStore.fetch(scope, q)
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = "The catalogue could not be read."
        }
        loading = false
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Reference photo", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleLarge)
            SearchBarField(
                value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                placeholder = { Text("Search the catalogue") }, leadingIcon = { Icon(Symbols.Search, null) }, singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            )
            ChipRow {
                FilterChip("All pieces", chosen = scope.isEmpty(), onClick = { scope = "" })
                for (c in chips) FilterChip(c.label, chosen = scope == c.id, onClick = { scope = c.id })
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 280.dp, max = 620.dp)) {
                when {
                    failure != null && pieces.isEmpty() -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        NotAvailableState(failure.orEmpty(), icon = Symbols.CloudOff)
                        TextButton(onClick = { attempt += 1 }) { Text("Try again") }
                    }
                    loading && pieces.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading(Modifier.size(48.dp)) }
                    pieces.isEmpty() -> NotAvailableState(
                        if (query.isEmpty()) "No pictures here" else "No results",
                        why = if (query.isEmpty()) (if (scope.isEmpty()) "The catalogue has no pieces yet." else "Try All pieces.") else "Nothing matches “${query.trim()}”.",
                        icon = Symbols.PhotoLibrary,
                    )
                    else -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(104.dp), modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        items(pieces, key = { it.id }) { piece ->
                            val chosen = current.isNotEmpty() && piece.image == current
                            Column(
                                Modifier.clickable(role = Role.Button) { onPick(piece.image); onDismiss() }
                                    .semantics { contentDescription = piece.title.ifEmpty { "Catalogue piece" } },
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                AsyncImage(
                                    model = piece.thumb, contentDescription = null, contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(Radius.thumb))
                                        .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                                        .then(if (chosen) Modifier.border(3.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(Radius.thumb)) else Modifier),
                                )
                                if (piece.title.isNotEmpty()) {
                                    Text(piece.title, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
