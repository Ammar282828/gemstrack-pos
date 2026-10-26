package erp.app.screens.marketing

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import erp.app.ui.ActionRow
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.launch

/**
 * The photo's controls on Edit a piece: the shape, what goes on it, the designer and the AI (edit/page.tsx's photo card),
 * as rows of the card they sit in (WebsitePhotoEditRows). The page it is drawn on is [WebsitePhotoEdit]'s.
 */
@Composable
fun WebsitePhotoEditRows(
    edit: WebsitePhotoEdit,
    engine: DesignEngine,
    fields: Map<String, String>,
    busy: Boolean,
    /** The tray's design is always square (WhatsApp only gets 1:1): no shape to choose. */
    shapes: Boolean = true,
    onAI: (op: String, params: Map<String, Any?>, label: String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var designing by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var askText by remember { mutableStateOf("") }
    var aiMenu by remember { mutableStateOf(false) }

    val image = edit.preview
    if (image != null) {
        Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Image(image, contentDescription = "The photo as it will go up", Modifier.widthIn(max = 520.dp).fillMaxWidth().clip(Radius.chipShape), contentScale = ContentScale.FillWidth)
        }
    } else {
        Box(Modifier.fillMaxWidth().padding(8.dp).aspectRatio(1f)) { SkeletonLoading(Modifier.fillMaxWidth()) }
    }
    edit.problem?.let { Text(it, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
    if (shapes) {
        val options = listOf("own" to "Its own shape", "square" to "Square")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            options.forEachIndexed { i, (key, label) ->
                SegmentedButton(
                    selected = edit.shape == key, onClick = { scope.launch { edit.chooseShape(key, fields) } }, enabled = !busy,
                    shape = SegmentedButtonDefaults.itemShape(i, options.size),
                    colors = SegmentedButtonDefaults.colors(activeContainerColor = ErpColors.accent, activeContentColor = ErpColors.onAccent),
                ) { Text(label) }
            }
        }
    }
    PickerRow("On the photo", edit.layout, edit.layouts.map { it.s("id") to it.s("label") }) { id -> if (!busy) scope.launch { edit.chooseLayout(id, fields) } }
    if (edit.layoutShowsWeight && (fields["weight"] ?: "").isEmpty()) {
        Text("Type the weight (below) to put it on.", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
    }
    ActionRow("Crop and design", { designing = true }, Icons.Filled.Crop, enabled = !busy)
    Box {
        ActionRow("AI", { aiMenu = true }, Icons.Filled.AutoAwesome, enabled = !busy)
        DropdownMenu(expanded = aiMenu, onDismissRequest = { aiMenu = false }) {
            Text("On this photo (about a minute)", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            DropdownMenuItem(text = { Text("Enhance: light, sparkle, dust") }, leadingIcon = { Icon(Icons.Filled.AutoFixHigh, null) }, onClick = { aiMenu = false; onAI("enhance", mapOf("tidy" to false), "Enhanced") })
            DropdownMenuItem(text = { Text("Enhance and clear old labels") }, leadingIcon = { Icon(Icons.Filled.AutoFixHigh, null) }, onClick = { aiMenu = false; onAI("enhance", mapOf("tidy" to true), "Enhanced, labels cleared") })
            DropdownMenuItem(text = { Text("Ask AI…") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Chat, null) }, onClick = { aiMenu = false; askText = ""; asking = true })
            if (edit.photos.size > 1) {
                Text("Use", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (p in edit.photos) {
                    DropdownMenuItem(
                        text = { Text(p.label) }, leadingIcon = { if (edit.current?.id == p.id) Icon(Icons.Filled.Check, null, tint = ErpColors.accent) },
                        onClick = { aiMenu = false; edit.use(p.id) },
                    )
                }
            }
        }
    }
    edit.current?.takeIf { it.id != WebsitePhotoEdit.SITE_PHOTO }?.let {
        Text("Using: ${it.label}.", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    // The preview follows the design, the words drawn on it and the photos held; one draw begun for an older design is dropped.
    val renderKey = edit.doc.text + fields.toSortedMap().toString() + "${edit.photos.size}"
    LaunchedEffect(renderKey) { edit.render(fields) }

    if (designing) {
        ArtworkEditor(
            design = edit.doc, onDoc = { edit.doc = it }, photos = edit.photoData, fields = fields, onClose = { designing = false },
            engine = engine, layoutGroup = "siteSquares",
        )
    }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text("Ask AI to change the photo") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Say what to change: the piece itself stays as it is, and the result is checked against it.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(askText, { askText = it }, Modifier.fillMaxWidth(), placeholder = { Text("Make the background plain white") })
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val text = askText.trim()
                    asking = false
                    if (text.isNotEmpty()) onAI("custom", mapOf("instruction" to text), "Changed with AI")
                }) { Text("Make it") }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("Cancel") } },
        )
    }
}
