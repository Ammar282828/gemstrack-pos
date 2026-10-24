package erp.app.screens.marketing

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.google.firebase.auth.FirebaseAuth
import erp.app.ErpApp
import erp.app.config.House
import erp.app.device.openAddress
import erp.app.device.shareBytes
import erp.app.device.shareText
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.neworder.hasCamera
import erp.app.screens.neworder.rememberCameraCapture
import erp.app.ui.ActionRow
import erp.app.ui.FieldRow
import erp.app.ui.FormSection
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.SmallPrint
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.TextRow
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import java.io.File
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** This person's drafts folder on the device: per house and per account, so two accounts never open each other's pieces. */
private fun draftsFolder(context: Context): File {
    val scope = when {
        House.isDemo -> "demo"
        ErpApp.firebaseReady -> erp.app.config.Businesses.auth?.currentUser?.uid ?: "signed-out"
        else -> "signed-out"
    }
    return File(context.filesDir, "PostDrafts-${House.id}-$scope")
}

/**
 * Post a piece (PostComposer.swift): the photographs, a headline and its words, the story and the square the engine
 * draws, the caption, where it goes, and the finish: add to the queue or publish. A draft is kept on the device as
 * it is made, photos included, and resumes. `?new=1` starts a new piece; `?studio=<key>` opens one the Studio handed over.
 */
@Composable
fun PostComposerScreen(path: String) {
    ScreenTitle("Post a piece")
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = rememberDesignEngine()
    val model = remember { PostComposerModel(scope, engine) { draftsFolder(context) } }
    val navigator = LocalNavigator.current
    val note = erp.app.ui.LocalNoteState.current
    val d = model.draft
    var draftsOpen by remember { mutableStateOf(false) }
    var sitePicker by remember { mutableStateOf(false) }
    var design by remember { mutableStateOf<String?>(null) }
    var ai by remember { mutableStateOf<PostAIRequest?>(null) }
    var confirmation by remember { mutableStateOf<String?>(null) }
    var sharedStory by remember { mutableStateOf(false) }
    var leftApp by remember { mutableStateOf(false) }
    var askStory by remember { mutableStateOf(false) }

    // Not left mid-send: the answer (or the error) is shown here.
    androidx.activity.compose.BackHandler(enabled = model.busy != null) {}

    LaunchedEffect(Unit) {
        model.load()
        MarketingKit.query("studio", path)?.let { key -> PostHandoffs.posts.remove(key)?.let { model.draft = it; model.saveNow() } }
        if (MarketingKit.query("new", path) == "1" && model.draft.photos.isNotEmpty()) model.startOver()
    }
    // The pictures are drawn again when anything they show changes (not the caption, which they only produce).
    val renderKey = remember(d) {
        d.story.text + d.square.text + MarketingValue(kotlinx.serialization.json.JsonObject(d.words.obj.filterKeys { it !in listOf("caption", "captionEdited", "storyOut") }.mapValues { it.value.json })).text +
            d.photos.joinToString("") { it.id + it.name } + (d.paintedStory?.size ?: 0) + (d.paintedSquare?.size ?: 0)
    }
    LaunchedEffect(renderKey, model.loaded) { if (model.loaded) { delay(150); model.preview() } }
    // The phone's own save of what is being made, even if the screen is left mid-sentence.
    DisposableEffect(model) { onDispose { ErpApp.scope.launch { model.saveNow() } } }

    // Sharing the story by hand: the system's sheet cannot say whether it was used, so when the person comes back, ask.
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { if (sharedStory) leftApp = true }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (sharedStory && leftApp) { sharedStory = false; leftApp = false; askStory = true } }

    val pickMany = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(12)) { uris -> takeUris(scope, context, model, uris) }
    val pickOne = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) takeUris(scope, context, model, listOf(uri)) }
    val camera = rememberCameraCapture(onProblem = { model.error = it }) { bitmap ->
        if (bitmap != null) scope.launch {
            val bytes = withContext(Dispatchers.Default) { MarketingPhotos.jpeg(bitmap) }
            if (bytes != null) model.add(bytes, "Camera photo")
        }
    }

    ScreenActions {
        var menu by remember { mutableStateOf(false) }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Drafts") }, onClick = { menu = false; draftsOpen = true })
                DropdownMenuItem(text = { Text("New piece") }, onClick = { menu = false; scope.launch { model.startOver() } })
                DropdownMenuItem(text = { Text("Check connections") }, onClick = { menu = false; scope.launch { model.refreshConnections() } })
            }
        }
    }

    fun shareDesign(kind: String) {
        scope.launch {
            try {
                val bytes = model.designBytes(kind)
                if (bytes == null) { model.error = "The design could not be drawn."; return@launch }
                sharedStory = kind == "story"
                leftApp = false
                shareBytes(context, bytes, "piece-$kind-${UUID.randomUUID()}.jpg", "image/jpeg", if (kind == "story") "Story" else "Post")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.error = e.message
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val top: @Composable () -> Unit = {
                Banners(model)
                PhotoSection(model, onAdd = { room -> if (room > 1) pickMany.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) else pickOne.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onCamera = camera, onSite = { sitePicker = true }, onTool = { ai = it }, onCrop = { id -> model.draft = model.draft.copy(square = model.draft.square.withPath(listOf("bg", "photoId"), MarketingValue.string(id))); design = "square" },
                    canCamera = hasCamera(context), shareOriginal = { p -> shareBytes(context, p.data, "${p.name.replace(' ', '-')}.jpg", "image/jpeg", p.name) })
                DesignSection(model, onEdit = { design = it }, onShare = ::shareDesign, onAI = { ai = it })
            }
            val bottom: @Composable () -> Unit = {
                if (model.makeSquare) CaptionSection(model, onAI = { ai = it }, onShare = { shareText(context, "Caption", it) }, onCopy = {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Caption", it))
                })
                PublishSection(
                    model, onOpenQueued = { navigator.open("/marketing/queue?id=$it") }, onConfirm = { confirmation = it },
                    onShareStory = { shareDesign("story") }, onConnectInstagram = {
                        scope.launch {
                            try {
                                val r = MarketingRequest.send("/api/instagram/connect")
                                if (r.s("url").startsWith("http")) openAddress(context, Intent.ACTION_VIEW, r.s("url"))
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                model.error = e.message
                            }
                        }
                    }, openLink = { openAddress(context, Intent.ACTION_VIEW, it) },
                )
                HealthSection(model)
            }
            if (maxWidth >= 840.dp) {
                Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { top() }
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { bottom() }
                }
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { top(); bottom() }
            }
        }
        // The busy veil, and nothing is touched until the drafts have been read.
        val veil = model.busy ?: if (!model.loaded) "Opening…" else null
        if (veil != null) Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Box(Modifier.clip(Radius.cardShape).background(ErpColors.card).padding(20.dp)) { SkeletonLoading(label = veil) }
        }
    }

    if (draftsOpen) PostDraftsSheet(model) { draftsOpen = false }
    if (sitePicker) {
        SitePhotoPicker(onClose = { sitePicker = false }, picked = { piece, data ->
            if (model.draft.words.s("headline").isEmpty()) model.word("headline", piece["name"])
            if (model.draft.words.s("weight").isEmpty() && piece.n("weightGrams") > 0) model.word("weight", grams(piece.n("weightGrams")))
            model.add(data, piece.s("name"), MarketingValue.of(mapOf("id" to piece.s("id"), "name" to piece.s("name"), "url" to piece.s("url"), "marked" to (piece["photoSource"].isNull || piece["sourceMarked"].bool))))
            sitePicker = false
        })
    }
    design?.let { kind ->
        ArtworkEditor(
            design = if (kind == "story") model.draft.story else model.draft.square,
            onDoc = { v -> if (kind == "story") model.update { it.copy(story = v) } else model.update { it.copy(square = v) } },
            photos = model.assets, fields = model.fields, onClose = { design = null }, engine = engine,
        )
    }
    ai?.let { PostAISheet(it, model) { ai = null } }
    confirmation?.let { which ->
        AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text(if (which == "queue") "Keep this post in the queue?" else "Publish this post?") },
            text = {
                Text(PostComposerRules.publishWords(model.draft, model.config.s("siteName", "Website"), model.instagram.s("username"), model.instagramConnected, model.health["checks"].array, which != "queue"))
            },
            confirmButton = { TextButton(onClick = { confirmation = null; model.finish(queueOnly = which == "queue") }) { Text(if (which == "queue") "Add to queue" else "Publish") } },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancel") } },
        )
    }
    if (askStory) {
        AlertDialog(
            onDismissRequest = { askStory = false },
            title = { Text("Did the story go out?") },
            text = { Text("Share or save the story first. Say yes once it has, and the post can be published.") },
            confirmButton = { TextButton(onClick = { askStory = false; model.word("storyOut", true); scope.launch { model.saveNow() } }) { Text("Yes, it went") } },
            dismissButton = { TextButton(onClick = { askStory = false }) { Text("Not yet") } },
        )
    }
}

private fun grams(v: Double): String {
    var s = String.format(java.util.Locale.ROOT, "%.3f", v)
    while (s.endsWith("0")) s = s.dropLast(1)
    if (s.endsWith(".")) s = s.dropLast(1)
    return s
}

/** The photos chosen from the phone, read off the main thread and added one by one. */
private fun takeUris(scope: kotlinx.coroutines.CoroutineScope, context: Context, model: PostComposerModel, uris: List<android.net.Uri>) {
    scope.launch {
        uris.forEachIndexed { i, uri ->
            try {
                val data = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                if (data != null) model.add(data, "Photo ${i + 1}")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.error = e.message
            }
        }
    }
}

@Composable
private fun Banners(model: PostComposerModel) {
    model.error?.let { err ->
        Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(err, color = Tone.problem.color())
            TextButton(onClick = { model.error = null }) { Text("Dismiss") }
        }
    }
    model.said?.let { Text(it, Modifier.fillMaxWidth().ledgerCard()) }
}

// MARK: Photos and words

@Composable
private fun PhotoSection(
    model: PostComposerModel,
    onAdd: (Int) -> Unit,
    onCamera: () -> Unit,
    onSite: () -> Unit,
    onTool: (PostAIRequest) -> Unit,
    onCrop: (String) -> Unit,
    canCamera: Boolean,
    shareOriginal: (PostPhoto) -> Unit,
) {
    val d = model.draft
    RowsCard {
        FieldRow("Headline", d.words.s("headline"), { model.word("headline", it) }, singleLine = false, minLines = 1, maxLines = 4, enabled = !model.frozen)
        if (d.photos.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.PhotoLibrary, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Start with a photo", style = MaterialTheme.typography.titleMedium)
                Text("Choose photos, take one, or bring in a website piece.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            PhotoStrip(model, onTool, onCrop, shareOriginal)
        }
        if (!model.frozen) {
            // Twelve photos is the most a piece takes: past that the picker would only fail.
            if (d.photos.size < 12) ActionRow("Add photos", { onAdd(12 - d.photos.size) }, Icons.Filled.PhotoLibrary)
            else Text("Twelve photos is the most a piece takes.", Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (canCamera) ActionRow("Camera", onCamera, Icons.Filled.CameraAlt)
            ActionRow("From the website", onSite, Icons.Filled.Public)
        }
        MarketingDisclosure("Piece details") {
            Column {
                TextRow("Small line above the headline", d.words.s("kicker"), { model.word("kicker", it) }, "")
                TextRow("Weight in grams", d.words.s("weight"), { model.word("weight", it) }, "", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
                ToggleRow("Weight per piece", d.words["weightEach"].bool, onChange = { model.word("weightEach", it) })
                TextRow("Metal", d.words.s("metal"), { model.word("metal", it) }, "")
                TextRow("Stones", d.words.s("stones"), { model.word("stones", it) }, "")
                FieldRow("Caption’s extra line", d.words.s("hook"), { model.word("hook", it) }, singleLine = false, minLines = 1, maxLines = 5)
            }
        }
    }
}

@Composable
private fun PhotoStrip(model: PostComposerModel, onTool: (PostAIRequest) -> Unit, onCrop: (String) -> Unit, shareOriginal: (PostPhoto) -> Unit) {
    val d = model.draft
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
        for (p in d.photos) {
            Column(Modifier.width(150.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val bitmap by produceState<android.graphics.Bitmap?>(null, p.id, p.data) { value = withContext(Dispatchers.Default) { MarketingPhotos.decode(p.data, 350) } }
                Box(Modifier.size(150.dp).clip(Radius.tileShape).background(ErpColors.ground), contentAlignment = Alignment.Center) {
                    bitmap?.let { Image(it.asImageBitmap(), contentDescription = p.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
                }
                TextButton(onClick = { model.update { it.copy(story = it.story.withPath(listOf("bg", "photoId"), MarketingValue.string(p.id))) } }) {
                    Text(if (model.hero?.id == p.id) "Lead photo ✓" else "Make lead photo")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Website", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Switch(p.toSite, { on -> model.update { d2 -> d2.copy(photos = d2.photos.map { if (it.id == p.id) it.copy(toSite = on) else it }) } }, enabled = !model.frozen, modifier = Modifier.semantics { contentDescription = "Website" })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("WhatsApp", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Switch(p.toWhatsApp, { on -> model.update { d2 -> d2.copy(photos = d2.photos.map { if (it.id == p.id) it.copy(toWhatsApp = on) else it }) } }, enabled = !model.frozen, modifier = Modifier.semantics { contentDescription = "WhatsApp" })
                }
                p.check?.takeUnless { it.isNull }?.let { check ->
                    MarketingDisclosure(if (check["samePiece"].bool && check.n("confidence") >= 0.8) "Piece checked" else "Compare with original") { MarketingDetails(check.obj) }
                }
                MenuTextButton(
                    "Photo tools", enabled = !model.frozen,
                    items = listOf("enhance" to "Enhance", "retouch" to "Retouch", "reframe" to "Extend / change shape", "restage" to "New setting", "custom" to "Ask AI").map { (op, label) ->
                        MenuNode.Action(label) { onTool(PostAIRequest(op, label, p.id)) } as MenuNode
                    } + listOf(
                        MenuNode.Action("Edit crop") { onCrop(p.id) },
                        MenuNode.Action("Share original") { shareOriginal(p) },
                        MenuNode.Action("Remove photo", destructive = true) {
                            model.update { d2 ->
                                val rest = d2.photos.filter { it.id != p.id }
                                fun fix(doc: MarketingValue) = if (doc["bg"].s("photoId") == p.id) doc.withPath(listOf("bg", "photoId"), MarketingValue.string(rest.firstOrNull()?.id ?: "")) else doc
                                d2.copy(photos = rest, story = fix(d2.story), square = fix(d2.square))
                            }
                        },
                    ),
                )
            }
        }
    }
}

// MARK: The designs

@Composable
private fun DesignSection(model: PostComposerModel, onEdit: (String) -> Unit, onShare: (String) -> Unit, onAI: (PostAIRequest) -> Unit) {
    val d = model.draft
    RowsCard {
        PickerRow("Make", d.words.s("formats"), listOf("both" to "Post + story", "square" to "Post only", "story" to "Story only")) { if (!model.frozen) model.word("formats", it) }
        if (model.makeStory) DesignPreview(model, "story", model.storyPreview, onEdit, onShare)
        if (model.makeSquare) DesignPreview(model, "square", model.squarePreview, onEdit, onShare)
        if (model.hero != null && !model.frozen) {
            ArtworkMenuRow(
                "AI tools",
                listOf(
                    MenuNode.Action("Write captions") { onAI(PostAIRequest("caption", "captions", null)) },
                    MenuNode.Action("Make the whole story") { onAI(PostAIRequest("whole", "story", null)) },
                    MenuNode.Action("Letter the story") { onAI(PostAIRequest("letter", "story", null)) },
                    MenuNode.Action("Paint the story") { onAI(PostAIRequest("paint", "story", null)) },
                    MenuNode.Action("Paint the post") { onAI(PostAIRequest("paint", "post", null)) },
                ),
            )
        }
    }
}

@Composable
private fun DesignPreview(model: PostComposerModel, kind: String, response: MarketingValue, onEdit: (String) -> Unit, onShare: (String) -> Unit) {
    val d = model.draft
    val picture by produceState<android.graphics.Bitmap?>(null, response) { value = withContext(Dispatchers.Default) { NativeArtwork.image(response) } ?: value }
    MarketingDisclosure(if (kind == "story") "Story · 9:16" else "Post · 1:1", initiallyOpen = model.hero != null) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                picture?.let { Image(it.asImageBitmap(), contentDescription = if (kind == "story") "The story" else "The post", Modifier.heightIn(max = 420.dp).clip(Radius.tileShape), contentScale = ContentScale.Fit) }
                    ?: if (model.hero != null) SkeletonLoading(Modifier.heightIn(min = 120.dp)) else Text("Add a photo to see it.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!model.frozen) TextButton(onClick = { onEdit(kind) }) { Text("Edit design") }
                TextButton(onClick = { onShare(kind) }) { Text("Share or save") }
            }
            if ((if (kind == "story") d.paintedStory else d.paintedSquare) != null) {
                TextButton(enabled = !model.frozen, onClick = {
                    model.update { if (kind == "story") it.copy(paintedStory = null, paintedStoryFor = null) else it.copy(paintedSquare = null, paintedSquareFor = null) }
                }) { Text("Use our design") }
                d.letteringCheck?.let { checked -> MarketingDisclosure("Check the AI version") { MarketingDetails(checked.obj.filterKeys { it != "image" }) } }
            }
        }
    }
}

// MARK: The caption

@Composable
private fun CaptionSection(model: PostComposerModel, onAI: (PostAIRequest) -> Unit, onShare: (String) -> Unit, onCopy: (String) -> Unit) {
    val d = model.draft
    val scope = rememberCoroutineScope()
    FormSection("Caption") {
        FieldRow("Caption", d.words.s("caption"), { model.update { x -> x.word("caption", it).word("captionEdited", true) } }, singleLine = false, minLines = 4, maxLines = 12, enabled = !model.frozen)
        ArtworkMenuRow(
            "Caption tools", enabled = !model.frozen,
            items = listOf(
                MenuNode.Action("Write with AI") { onAI(PostAIRequest("caption", "captions", null)) },
                MenuNode.Action("Use the shop’s caption") { model.word("captionEdited", false); scope.launch { model.preview() } },
                MenuNode.Action("Copy") { onCopy(d.words.s("caption")) },
                MenuNode.Action("Share caption") { onShare(d.words.s("caption")) },
            ),
        )
        if (!model.aiAnswer["caption"].isNull) {
            val c = model.aiAnswer["caption"]
            MarketingDisclosure("AI alternatives") {
                Column {
                    for (item in c["headlines"].array) TextButton(onClick = { model.word("headline", item) }, enabled = !model.frozen) { Text(item.string) }
                    MarketingDetails(c.obj.filterKeys { it !in listOf("headlines", "whatsappCaption") })
                }
            }
        }
    }
}

// MARK: Where it goes

@Composable
private fun PublishSection(
    model: PostComposerModel,
    onOpenQueued: (String) -> Unit,
    onConfirm: (String) -> Unit,
    onShareStory: () -> Unit,
    onConnectInstagram: () -> Unit,
    openLink: (String) -> Unit,
) {
    val d = model.draft
    val scope = rememberCoroutineScope()
    val note = erp.app.ui.LocalNoteState.current
    RowsCard {
        MarketingDisclosure("Where it goes", initiallyOpen = true) { Destinations(model, onConnectInstagram, openLink) }
        val queued = d.queuedID
        if (model.frozen && queued != null) {
            ActionRow("Open queued piece", { onOpenQueued(queued) })
            if (d.queueReady != true) ActionRow("Finish uploading", { model.finish(queueOnly = true) })
            else ActionRow("Send what remains", { onConfirm("send") })
            ActionRow("Next piece", { scope.launch { model.startOver() } })
        } else {
            val problems = model.problems
            if (problems.isNotEmpty()) Text(problems.joinToString(" "), Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ActionRow("Add to queue", { onConfirm("queue") }, enabled = problems.isEmpty())
            Button(
                onClick = { onConfirm("send") }, enabled = problems.isEmpty(), modifier = Modifier.fillMaxWidth().padding(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
            ) { Text("Publish") }
            if (model.manualStory) ActionRow("Share or save story", onShareStory)
        }
    }
}

@Composable
private fun Destinations(model: PostComposerModel, onConnectInstagram: () -> Unit, openLink: (String) -> Unit) {
    val d = model.draft
    val locked = model.frozen
    Column {
        if (model.makeSquare) {
            if (model.config.s("site").isNotEmpty()) {
                ToggleRow(model.config.s("siteName", "Website"), d.words["toWebsite"].bool, { if (!locked) model.word("toWebsite", it) })
                if (d.words["toWebsite"].bool) {
                    PickerRow("Collection", d.words.s("folder"), listOf("" to "Choose…") + model.folders.map { it.s("folder") to it.s("collection") }) { if (!locked) model.word("folder", it) }
                    TextRow("Name on the website", d.words.s("siteName"), { model.word("siteName", it) }, "")
                    if (d.words.s("folder").endsWith("The Maisons")) TextRow("House", d.words.s("maisonHouse"), { model.word("maisonHouse", it) }, "")
                    if (model.config["featured"].bool) ToggleRow("Set of the day", d.words["feature"].bool, { if (!locked) model.word("feature", it) })
                }
            }
            ToggleRow("WhatsApp", d.words["toWhatsApp"].bool, { if (!locked) model.word("toWhatsApp", it) })
            if (d.words["toWhatsApp"].bool) {
                fun target(key: String) = d.words["waTargets"].array.any { it.string == key }
                fun setTarget(key: String, on: Boolean) {
                    if (locked) return
                    val keys = d.words["waTargets"].array.filter { it.string != key } + if (on) listOf(MarketingValue.string(key)) else emptyList()
                    model.word("waTargets", MarketingValue.array(keys))
                }
                for (g in model.audience["groups"].array) ToggleRow(g.s("label", g.s("name")), target(g.s("key")), { setTarget(g.s("key"), it) })
                if (!model.audience["channel"].isNull) ToggleRow(model.audience["channel"].s("name", "Channel"), target("channel"), { setTarget("channel", it) })
                if (model.audience["community"].isNull) Text("WhatsApp is not connected. Check connections below.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            }
        }
        if (model.makeStory) {
            ToggleRow("Post story to Instagram", d.words["toInstagram"].bool, { if (!locked && model.instagramConnected) model.word("toInstagram", it) })
            if (model.instagramConnected) Text("@" + model.instagram.s("username"), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else ActionRow("Connect Instagram", onConnectInstagram)
            if (model.manualStory) Text("Share the story from your phone to add music or stickers.", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val link = model.config["posting"]["links"].s("waChannel")
        if (link.startsWith("https://")) ActionRow("Open WhatsApp channel for manual sharing", { openLink(link) })
    }
}

// MARK: Connections

@Composable
private fun HealthSection(model: PostComposerModel) {
    val scope = rememberCoroutineScope()
    RowsCard {
        MarketingDisclosure("Connections and recent problems") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { scope.launch { model.checkHealth() } }) { Text("Check again") }
                for (check in model.health["checks"].array) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                if (check.s("status") == "ok") Icons.Filled.CheckCircle else Icons.Filled.Warning, null,
                                Modifier.size(18.dp), tint = if (check.s("status") == "ok") Tone.settled.color() else Tone.owed.color(),
                            )
                            Text(check.s("label"), style = MaterialTheme.typography.bodyLarge)
                        }
                        Text(check.s("detail"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (check.s("fix").isNotEmpty()) Text(check.s("fix"), style = MaterialTheme.typography.bodySmall)
                    }
                }
                MarketingDetails(mapOf("Recent problems" to model.health["errors"]))
            }
        }
    }
}
