package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
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
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.ui.FieldRow
import erp.app.ui.FullScreenSheet
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.RowAction
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** The drafts kept on this device (the Drafts sheet): open one to carry on, swipe one away (it asks first: it holds photos). */
@Composable
fun PostDraftsSheet(model: PostComposerModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var deleting by remember { mutableStateOf<PostDraft?>(null) }
    FullScreenSheet(title = "Drafts", onCancel = onClose, cancelText = "Done") {
        Box(Modifier.fillMaxSize().readableColumn(720.dp)) {
            if (model.drafts.isEmpty()) {
                NotAvailableState("No drafts", why = "A piece you start is kept here, on this device, until it goes out.", icon = Symbols.Description)
            } else {
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(model.drafts, key = { it.id }) { saved ->
                        SwipeActions(
                            Modifier.clip(Radius.cardShape),
                            end = RowAction("Delete", Symbols.Delete, Tone.problem) { deleting = saved },
                            onClick = { scope.launch { model.open(saved); onClose() } },
                        ) {
                            Column(Modifier.fillMaxWidth().background(ErpColors.card).ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(saved.title, style = MaterialTheme.typography.bodyLarge)
                                Text(ShopDate.stamp(Instant.ofEpochMilli(saved.updated)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${saved.photos.size} photo${if (saved.photos.size == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
    // A draft holds its photos: deleting it asks first (decision "Delete code": every delete asks).
    deleting?.let { saved ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete “${saved.title}” and its photos?") },
            confirmButton = { TextButton(onClick = { deleting = null; scope.launch { model.remove(saved) } }) { Text("Delete draft", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

/** An AI tool (NativePostAISheet): a brief, a shape, a setting, the full prompt; the new version is kept beside the original. */
@Composable
fun PostAISheet(request: PostAIRequest, model: PostComposerModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var instruction by remember { mutableStateOf("") }
    var rawPrompt by remember { mutableStateOf("") }
    var aspect by remember { mutableStateOf("9:16") }
    var scene by remember { mutableStateOf("") }
    var tidy by remember { mutableStateOf(true) }
    var running by remember { mutableStateOf(false) }

    fun run() {
        scope.launch {
            running = true
            try {
                val params = PostAIParams.build(request, PostAIParams.Form(instruction, rawPrompt, aspect, scene, tidy), model.draft, model.config)
                model.error = null
                model.runAI(if (request.op == "whole") "caption" else request.op, request.photoID, request.target, params)
                if (request.op == "whole" && model.error == null) {
                    val c = model.aiAnswer["caption"]
                    if (model.draft.words.s("kicker").isEmpty()) model.word("kicker", c["kicker"])
                    try {
                        val r = model.artwork.run(model.draft.story, model.assets, model.fields, PostAIParams.wholeStoryLayout(c))
                        model.update { it.copy(story = r["doc"]) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        model.error = e.message
                    }
                    if (model.error == null) model.runAI("restage", request.photoID, "story", PostAIParams.wholeStoryScene(c))
                }
                if (model.error == null) onClose()
            } finally {
                running = false
            }
        }
    }

    FullScreenSheet(title = request.target.replaceFirstChar { it.uppercase() }, onCancel = { if (!running) onClose() }, cancelText = "Cancel") {
        Column(Modifier.fillMaxSize().readableColumn(720.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            model.error?.let { Text(it, color = Tone.problem.color()) }
            FieldRow(if (request.op == "letter") "Lettering style" else "Your brief", instruction, { instruction = it }, singleLine = false, minLines = 3, maxLines = 8)
            if (request.op in listOf("reframe", "restage", "custom")) PickerRow("Shape", aspect, PostAIParams.shapes.map { it to it }) { aspect = it }
            if (request.op == "restage") {
                val scenes = listOf("" to "Use my brief") + model.storyPreview["catalogue"]["scenes"].array.map { it.s("id") to it.s("label") }
                PickerRow("Setting", scene, scenes) { scene = it }
            }
            if (request.op in listOf("enhance", "reframe")) ToggleRow("Tidy labels and background", tidy, onChange = { tidy = it })
            MarketingDisclosure("Edit the full prompt") { FieldRow("Full prompt (optional)", rawPrompt, { rawPrompt = it }, singleLine = false, minLines = 4, maxLines = 14) }
            Button(onClick = ::run, enabled = !running, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent)) { Text("Make ${request.target}") }
            Text("A new version is kept beside the original. Check the piece and words before it goes out.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (running) SkeletonLoading(label = model.busy ?: "Working…")
        }
    }
}

/** A website piece to bring in as a photo (NativeSitePhotoPicker): searched by name or collection, its original photograph fetched at 3000 px. */
@Composable
fun SitePhotoPicker(picked: suspend (MarketingValue, ByteArray) -> Unit, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var pieces by remember { mutableStateOf<List<MarketingValue>>(emptyList()) }
    var q by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try {
            pieces = MarketingRequest.get("/api/website/site-pieces?lean=1")["pieces"].array.filter { !it["hidden"].bool }
            loaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }
    val shown = pieces.filter { q.isEmpty() || (it.s("name") + " " + it.s("collection")).contains(q, ignoreCase = true) }

    fun take(p: MarketingValue) {
        scope.launch {
            busy = "Bringing the photo…"
            try {
                val data = ErpApi.shared.bytes("/api/website/site-pieces/image?id=${MarketingKit.escape(p.s("id"))}&size=3000" + (if (p["photoSource"].isNull) "" else "&original=1"))
                picked(p, data)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = null
            }
        }
    }

    FullScreenSheet(title = "From the website", onCancel = onClose, cancelText = "Done") {
        Box(Modifier.fillMaxSize().readableColumn(720.dp)) {
            Column(Modifier.fillMaxSize()) {
                SearchBarField(
                    q, { q = it }, Modifier.fillMaxWidth().padding(16.dp), singleLine = true, placeholder = { Text("Search") },
                    leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
                )
                error?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = Tone.problem.color()) }
                when {
                    !loaded && error == null -> SkeletonLoading(Modifier.fillMaxSize(), label = "Loading the website’s pieces")
                    loaded && shown.isEmpty() -> NotAvailableState(if (q.isEmpty()) "No pieces on the website" else "Nothing matches “$q”", icon = Symbols.Public)
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(shown, key = { it.s("id") }) { p ->
                            Row(Modifier.fillMaxWidth().clickable(enabled = busy == null) { take(p) }.ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                MarketingPhoto(p.s("thumb", p.s("image")), Modifier.size(64.dp))
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(p.s("name"), style = MaterialTheme.typography.bodyLarge)
                                    Text(p.s("collection"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
            busy?.let { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading(label = it) } }
        }
    }
}
