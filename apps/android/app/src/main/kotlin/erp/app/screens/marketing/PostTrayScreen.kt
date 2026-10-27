package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import erp.core.logic.ShopNumber
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.device.openAddress
import erp.app.device.shareBytes
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Album
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Posts → the tray (src/app/posts/page.tsx's tray and ./piece-card.tsx; PostTrayScreen.swift): website pieces picked one or a
 * few, each with its own weight, caption and story, sent together to the chosen groups and the channel, or queued for later.
 * Where it goes is said in full before it goes, because a post to the groups cannot be taken back. `?id=` starts the tray on one
 * piece (a piece's own screen, Send or queue it).
 */
@Composable
fun PostTrayScreen(path: String) {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: session.role
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val engine = rememberDesignEngine()
    val model = remember { PostTrayModel(engine, scope) }
    val note = LocalNoteState.current
    var picking by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf<String?>(null) }
    var story by remember { mutableStateOf<TrayStory?>(null) }

    ScreenTitle(PostTrayLogic.title(model.cards.size))
    ScreenActions {
        IconButton(onClick = { picking = true }, enabled = model.busy == null) { Icon(Symbols.Add, contentDescription = "Add pieces") }
    }

    LaunchedEffect(Unit) {
        model.setUp()
        val id = MarketingKit.pieceId(path)
        if (!id.isNullOrEmpty() && !model.has(id)) PostsStore.state.value.piece(id)?.let { model.pick(it) }
    }

    fun say(notes: List<Note>) {
        PostTrayLogic.merge(notes)?.let { note.show(it) }
    }

    val access = TrayAccess(
        design = MarketingKit.has("/design", role), edit = MarketingKit.has("/website/edit", role), promote = MarketingKit.has("/ads/new", role),
    )

    val bar: (@Composable () -> Unit)? = if (model.cards.isEmpty()) null else ({
        val n = model.cards.size
        TrayBar(
            primary = if (n > 1) "Send all $n" else "Send it", primaryBusy = model.busy == "send", enabled = model.canSend,
            onPrimary = { confirming = true }, secondaryBusy = model.busy == "queue", onSecondary = { scope.launch { say(model.queue().notes) } },
            summary = PostTrayLogic.summary(n, model.placeNames) { it },
        )
    })

    // The card in view: its photo, weight, caption and what else can be done (one definition for the phone's column and the tablet's).
    val cardContent: @Composable (PostTrayCard) -> Unit = { card ->
        CardSections(
            card, model, state, access, role, locked = model.busy != null,
            onStory = {
                scope.launch {
                    working = "Making the story…"
                    try { story = makeStory(model, card) } catch (e: CancellationException) { throw e } catch (e: Exception) { failure = "Couldn't make the story. " + (e.message ?: "") } finally { working = null }
                }
            },
            onAI = {
                scope.launch {
                    working = "Writing the caption…"
                    try {
                        model.writeWithAI(card)
                        say(listOf(Note("Caption written", "Read it over before sending: the link and the closing lines are the house's own.")))
                    } catch (e: CancellationException) { throw e } catch (e: Exception) { failure = e.message } finally { working = null }
                }
            },
            onSay = ::say,
            onDesign = { scope.launch { model.startDesign(card)?.let { failure = "Couldn't start the design. $it" } } },
            onDesignAI = { edit, op, params, label ->
                scope.launch {
                    working = "The AI is working on the photo (about a minute)…"
                    try {
                        edit.runAI(op, params, label)?.let { say(listOf(Note("Check this one closely", it, failed = true))) }
                    } catch (e: CancellationException) { throw e } catch (e: Exception) { failure = "Couldn't change the photo. " + (e.message ?: "") } finally { working = null }
                }
            },
        )
    }

    MarketingPinned(bar) {
        Box(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 840.dp
                val card = model.activeCard
                val top: @Composable () -> Unit = {
                    if (state.piecesPhase == PostsPhase.Loaded && !model.audience.canSend && !model.toInstagram) {
                        Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Symbols.Warning, null, tint = Tone.owed.color())
                            Text(
                                "No WhatsApp community is set up for this shop yet (WHATSAPP_COMMUNITY_CHAT_ID), so nothing can be sent from here.",
                                color = Tone.owed.color(),
                            )
                        }
                    }
                    if (model.cards.isEmpty()) {
                        EmptyTray(model, state.pieces.isEmpty(), { picking = true }) { failure = it }
                    } else {
                        TrayStrip(model) { clearing = true }
                        WhereSection(model)
                        Blockers(model)
                    }
                }
                if (model.cards.isEmpty() || card == null) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) { top() }
                } else if (wide) {
                    // A tablet: the picked pieces and where they go beside the card in view.
                    Row(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        Column(Modifier.weight(0.42f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) { top() }
                        Column(Modifier.weight(0.58f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            cardContent(card)
                        }
                    }
                } else {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        top()
                        cardContent(card)
                    }
                }
            }
            WebsiteBusy(working)
        }
    }

    if (picking) {
        FullScreenSheet(title = PostTrayLogic.pickTitle(model.cards.size), onCancel = { picking = false }, cancelText = "Done", confirmText = "Done", onConfirm = { picking = false }) {
            PostPiecesScreen(tray = model)
        }
    }
    if (clearing) {
        AlertDialog(
            onDismissRequest = { clearing = false },
            title = { Text("Clear all ${model.cards.size}?") },
            text = { Text("They come off the tray. The pieces themselves are untouched.") },
            confirmButton = { TextButton(onClick = { clearing = false; model.clear() }) { Text("Clear all", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { clearing = false }) { Text("Cancel") } },
        )
    }
    if (confirming) {
        val lines = model.cards.map { PostTrayLogic.Line(it.piece.name, it.going, MarketingTime.postedAgo(state.posted[it.id])) }
        val places = model.whatsappPlaces.map { k -> PostTrayLogic.placeLine(k, model.label(k), model.audience.channelName, model.reach(k)) } +
            (if (model.toInstagram) {
                val most = model.cards.maxOfOrNull { it.album.size } ?: 1
                listOf("Instagram: one post" + if (most > Album.igCarouselMax) ", the first ${Album.igCarouselMax} photos of a piece (its limit)" else "")
            } else emptyList())
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(PostTrayLogic.confirmTitle(model.cards.size, model.placeNames) { it }) },
            text = { Column(Modifier.verticalScroll(rememberScrollState())) { Text(PostTrayLogic.confirmWords(lines, places, model.cards.size, model.blockers)) } },
            confirmButton = { TextButton(onClick = { confirming = false; scope.launch { say(model.send().notes) } }) { Text(if (model.blockers.isEmpty()) "Send" else "Send anyway") } },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Not yet") } },
        )
    }
    story?.let { s ->
        TrayStorySheet(
            s, model, working,
            onClose = { story = null },
            onPost = { user ->
                scope.launch {
                    working = "Posting the story…"
                    try {
                        ErpApi.shared.upload("/api/instagram/story", emptyList(), listOf(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", s.data)), timeoutMs = 180_000)
                        story = null
                        say(listOf(Note(if (user.isEmpty()) "Story posted" else "Story posted to @$user", s.name)))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = e.message ?: "Something went wrong."
                    } finally {
                        working = null
                    }
                }
            },
        )
    }
    FailureAlert(failure, { failure = null }, "Not now")
}

/** What this person's map offers beside the tray (the card's "more" rows). */
class TrayAccess(val design: Boolean, val edit: Boolean, val promote: Boolean)

class TrayStory(val data: ByteArray, val name: String, val slug: String)

private suspend fun makeStory(model: PostTrayModel, card: PostTrayCard): TrayStory =
    TrayStory(model.story(card), card.piece.name, PostTrayLogic.slug(card.piece))

// MARK: Nothing picked

@Composable
private fun EmptyTray(model: PostTrayModel, noPieces: Boolean, choose: () -> Unit, refuse: (String) -> Unit) {
    WebsiteCard {
        Text(
            "Tap pieces: one, or a few to send together. Each gets its own caption.",
            Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
            OutlinedButton(onClick = choose) {
                Icon(Symbols.GridView, null, Modifier.size(18.dp))
                Text("Choose pieces", Modifier.padding(start = 8.dp))
            }
        }
        ActionRow("Shuffle a piece", { model.shuffle()?.let(refuse) }, Symbols.Shuffle, enabled = !noPieces)
    }
}

// MARK: The picked pieces

@Composable
private fun TrayStrip(model: PostTrayModel, clearAll: () -> Unit) {
    WebsiteCard {
        LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(model.cards.toList(), key = { it.id }) { c ->
                val number = model.cards.indexOfFirst { it.id == c.id } + 1
                val on = c.id == model.activeCard?.id
                Box(
                    Modifier.size(56.dp).clip(Radius.thumbShape).alpha(if (on) 1f else 0.8f)
                        .border(BorderStroke(2.dp, if (on) ErpColors.accent else androidx.compose.ui.graphics.Color.Transparent), Radius.thumbShape)
                        .clickable { model.active = c.id }
                        .semantics { contentDescription = "$number: ${c.piece.name}" },
                ) {
                    StockImage(c.piece.thumb, c.piece.name, c.id, Modifier.fillMaxSize())
                    Text(
                        "$number", Modifier.padding(3.dp).clip(CircleShape).background(ErpColors.accent).padding(horizontal = 5.dp, vertical = 1.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits), color = ErpColors.onAccent,
                    )
                    if (c.sending) Box(Modifier.fillMaxSize().background(ErpColors.card.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) { Loading(Modifier.size(26.dp)) }
                    if (c.failed != null) Icon(Symbols.Error, "Didn't go", Modifier.align(Alignment.BottomCenter).padding(3.dp).size(18.dp), tint = Tone.problem.color())
                }
            }
        }
        if (model.cards.size > 1) ActionRow("Clear all ${model.cards.size}", clearAll, tone = Tone.problem, enabled = model.busy == null)
    }
}

// MARK: Where they go, and the one press that sends them

@Composable
private fun WhereSection(model: PostTrayModel) {
    val a = model.audience
    val igConnected = model.instagram["connected"].bool
    if (a.groups.isEmpty() && a.channelName == null && !igConnected) return
    FormSection("Where they go") {
        for (g in a.groups) PlaceToggle(model, g.key, g.label, g.size, "members")
        if (a.channelName != null) PlaceToggle(model, "channel", "Channel", a.channelFollowers, "followers")
        // The photos as one Instagram carousel, the first ten, the caption once (album.ts).
        if (igConnected) {
            val user = model.instagram.s("username")
            ToggleRow("Instagram post", model.instagramPost, { if (model.busy == null) model.chooseInstagram() }, sub = if (user.isEmpty()) null else "@$user")
        }
    }
}

@Composable
private fun PlaceToggle(model: PostTrayModel, key: String, title: String, reach: Int?, noun: String) {
    ToggleRow(title, key in model.targets, { if (model.busy == null) model.toggle(key) }, sub = reach?.let { "${erp.core.logic.Money.grouped(it.toDouble())} $noun" })
}

/** What would fail, said where the choice is made (the bar below says where it goes). */
@Composable
private fun Blockers(model: PostTrayModel) {
    val b = model.blockers
    if (b.isEmpty()) return
    Text(b.joinToString(" · ") { "${it.label}: ${it.fix ?: it.detail}" }, Modifier.fillMaxWidth().ledgerCard(), color = Tone.problem.color())
}

/** The page's one action, pinned: send now, or put it in the queue for later. */
@Composable
private fun TrayBar(
    primary: String, primaryBusy: Boolean, enabled: Boolean, onPrimary: () -> Unit,
    secondaryBusy: Boolean, onSecondary: () -> Unit, summary: String,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onSecondary, enabled = enabled && !secondaryBusy, modifier = Modifier.heightIn(min = 52.dp)) {
            if (secondaryBusy) Loading(Modifier.size(24.dp)) else Icon(Symbols.Schedule, null, Modifier.size(18.dp))
            Text("Later", Modifier.padding(start = 8.dp))
        }
        Button(
            onClick = onPrimary, enabled = enabled && !primaryBusy, modifier = Modifier.weight(1f).heightIn(min = 52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
        ) {
            if (primaryBusy) Loading(Modifier.size(26.dp), color = ErpColors.onAccent) else Icon(Symbols.Send, null, Modifier.size(18.dp))
            Text(primary, Modifier.padding(start = 8.dp))
        }
    }
    Text(summary, Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

// MARK: The card in view

/**
 * The piece in view, as the web's card: its photo as it goes, the weight on it, its words and caption, and what else can be done
 * with it. The other cards keep their words while this one is shown (PostTrayCardSections).
 */
@Composable
private fun CardSections(
    card: PostTrayCard, model: PostTrayModel, state: PostsState, access: TrayAccess, role: String, locked: Boolean,
    onStory: () -> Unit, onAI: () -> Unit, onSay: (List<Note>) -> Unit, onDesign: () -> Unit,
    onDesignAI: (WebsitePhotoEdit, String, Map<String, Any?>, String) -> Unit,
) {
    // A weight or its colour changed: the caption (while untouched) and the stamped photo follow, as the web's do.
    LaunchedEffect(card.id, card.weight, card.overlay, card.ink) {
        delay(250)
        model.refresh(card)
    }
    val posted = state.posted[card.id]
    val edit = card.design
    if (edit != null && edit.ready) DesignSection(card, edit, model, state, posted, locked, onDesignAI)
    else PlainPhotoSection(card, state, posted, locked, onDesign)
    PostAlbumStrip(card, model, state.siteName, locked, onSay)
    WeightSection(card, state.siteName, locked)
    CaptionSection(card, model, locked, onAI)
    MoreSection(card, model, state.siteName, access, locked, onStory, onSay)
}

@Composable
private fun PieceRows(card: PostTrayCard, siteName: String, posted: String?) {
    val context = LocalContext.current
    val p = card.piece
    card.failed?.let {
        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Symbols.Warning, null, tint = Tone.problem.color())
            Text("Didn't go: $it", color = Tone.problem.color())
        }
    }
    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(p.name, style = MaterialTheme.typography.titleMedium)
        Text(
            listOf(p.collection, p.weightGrams?.let { WebsiteNumber.grams(it) + "g" } ?: "").filter { it.isNotEmpty() }.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    MarketingTime.postedAgo(posted)?.let { Text("Already went out: $it.", Modifier.fillMaxWidth().ledgerRow(), color = Tone.owed.color()) }
    if (p.url.startsWith("http")) ActionRow("Open on $siteName", { openAddress(context, android.content.Intent.ACTION_VIEW, p.url) }, Symbols.OpenInNew)
}

@Composable
private fun PlainPhotoSection(card: PostTrayCard, state: PostsState, posted: String?, locked: Boolean, onDesign: () -> Unit) {
    val p = card.piece
    WebsiteCard {
        Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
            val preview = card.preview
            val shape = Radius.chipShape
            if (preview != null) {
                Image(preview, card.going, Modifier.widthIn(max = 380.dp).fillMaxWidth().clip(shape), contentScale = ContentScale.Fit)
            } else {
                StockImage(p.image, p.name, p.id, Modifier.widthIn(max = 380.dp).fillMaxWidth().aspectRatio(1f).clip(shape))
            }
        }
        ActionRow(if (card.design != null) "Fetching the photo…" else "Crop and design", onDesign, Symbols.Crop, enabled = !locked && card.design == null)
        PieceRows(card, state.siteName, posted)
    }
}

/** The design in place of the photo (piece-card.tsx: PieceDesignPanel), always square. */
@Composable
private fun DesignSection(
    card: PostTrayCard, edit: WebsitePhotoEdit, model: PostTrayModel, state: PostsState, posted: String?, locked: Boolean,
    onAI: (WebsitePhotoEdit, String, Map<String, Any?>, String) -> Unit,
) {
    FormSection("Crop and design") {
        WebsitePhotoEditRows(edit, model.engine, card.designFields(model.metal), locked, shapes = false) { op, params, label -> onAI(edit, op, params, label) }
        OutlinedTextField(
            card.designName, { card.designName = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            singleLine = true, label = { Text("Name on the photo") },
        )
        PostTrayLogic.designNote(House.id, card.piece)?.let { Text(it, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        ActionRow("Use the photo as it is", { model.dropDesign(card) }, Symbols.Undo, enabled = !locked)
        PieceRows(card, state.siteName, posted)
    }
}

@Composable
private fun WeightSection(card: PostTrayCard, siteName: String, locked: Boolean) {
    val p = card.piece
    val inks = listOf("auto" to "Auto colour", "white" to "White", "dark" to "Dark")
    FormSection(
        "Weight",
        footer = {
            Text(
                PostTrayLogic.weightNote(card.designed, card.designShowsWeight, p.weightOnPhoto, card.overlay, card.weightOK, card.newWeight, p.weightGrams, card.postOnly, siteName),
            )
        },
    ) {
        if (card.design == null) ToggleRow("Weight on the photo", card.overlay, { if (!locked) card.overlay = it })
        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Weight", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                card.weight, { v -> if (!locked) card.weight = ShopNumber.ascii(v).replace(",", ".").filter { it in '0'..'9' || it == '.' } }, Modifier.width(120.dp), singleLine = true,
                placeholder = { Text("0.00") }, textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End, fontFeatureSettings = TabularDigits),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = !locked,
            )
            Text("g", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (card.overlay && card.design == null) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                inks.forEachIndexed { i, (key, label) ->
                    SegmentedButton(
                        selected = card.ink == key, onClick = { if (!locked) card.ink = key }, enabled = !locked, shape = SegmentedButtonDefaults.itemShape(i, inks.size),
                        colors = SegmentedButtonDefaults.colors(activeContainerColor = ErpColors.accent, activeContentColor = ErpColors.onAccent),
                    ) { Text(label, maxLines = 1) }
                }
            }
        }
        val site = p.weightGrams
        if (site != null && card.postOnly) {
            TextButton(onClick = { if (!locked) card.weight = WebsiteNumber.grams(site) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("Use ${WebsiteNumber.grams(site)}g, as $siteName has it") }
        }
    }
}

@Composable
private fun CaptionSection(card: PostTrayCard, model: PostTrayModel, locked: Boolean, onAI: () -> Unit) {
    val scope = rememberCoroutineScope()
    FormSection("Caption") {
        OutlinedTextField(
            card.caption, { card.caption = it; card.edited = true }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            minLines = 6, maxLines = 16, enabled = !locked, placeholder = { Text("Caption") },
            textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        )
        ActionRow("Write with AI", onAI, Symbols.AutoAwesome, enabled = !locked)
        if (card.edited || card.aiLine != null) ActionRow("The house's caption", { scope.launch { model.houseWords(card) } }, Symbols.Undo, enabled = !locked)
    }
}

@Composable
private fun MoreSection(card: PostTrayCard, model: PostTrayModel, siteName: String, access: TrayAccess, locked: Boolean, onStory: () -> Unit, onSay: (List<Note>) -> Unit) {
    val p = card.piece
    val ig = model.instagram
    val user = ig.s("username")
    WebsiteCard(footer = { Text("${card.going}.") }) {
        ActionRow(
            if (ig["connected"].bool && user.isNotEmpty()) "Instagram story · @$user" else "Instagram story", onStory, Symbols.CameraAlt, enabled = !locked,
        )
        if (access.design) MarketingLink("Design", Symbols.AutoFixHigh, WebsiteEditLogic.designPath(p.id))
        if (access.edit) MarketingLink("Edit on $siteName", Symbols.Edit, "/website/edit?id=" + MarketingKit.escape(p.id))
        if (access.promote) MarketingLink("Promote", Symbols.Campaign, "/ads/new?piece=" + MarketingKit.escape(p.id))
        ActionRow("Another piece", { model.another(card)?.let { onSay(listOf(Note(it, failed = true))) } }, Symbols.Shuffle, enabled = !locked)
        ActionRow("Take it out", { model.take(card.id) }, Symbols.Close, tone = Tone.problem, enabled = !locked)
    }
}

// MARK: The story

@Composable
private fun TrayStorySheet(s: TrayStory, model: PostTrayModel, working: String?, onClose: () -> Unit, onPost: (String) -> Unit) {
    val context = LocalContext.current
    val connected = model.instagram["connected"].bool
    val user = model.instagram.s("username")
    val bitmap = remember(s) { MarketingPhotos.decode(s.data, 1200) }
    FullScreenSheet(
        title = "The story", onCancel = { if (working == null) onClose() }, cancelText = "Not now",
        confirmText = if (connected) (if (user.isEmpty()) "Post story" else "Post to @$user") else null, confirmEnabled = working == null, onConfirm = { onPost(user) },
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                WebsiteCard(
                    footer = {
                        Text(
                            if (connected) "It goes up on Instagram at once and can't be taken down from here. Instagram's API can't add a link sticker: add one by hand in the app if you want it."
                            else if (model.instagram["configured"].bool) "Instagram isn't connected on this ERP (Design → Publish → Instagram connects it), so save it and post it from the Instagram app."
                            else "This ERP doesn't post to Instagram by itself: save it and post it from the Instagram app.",
                        )
                    },
                ) {
                    Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                        if (bitmap != null) Image(bitmap.asImageBitmap(), "The story", Modifier.heightIn(max = 460.dp).clip(Radius.chipShape), contentScale = ContentScale.Fit)
                    }
                }
                WebsiteCard {
                    ActionRow("Save or share", { shareBytes(context, s.data, s.slug + "-story.jpg", "image/jpeg", s.name) }, Symbols.Share)
                }
            }
            WebsiteBusy(working)
        }
    }
}
