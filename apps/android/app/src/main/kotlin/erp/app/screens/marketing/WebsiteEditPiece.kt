package erp.app.screens.marketing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.device.openAddress
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/**
 * One piece of Edit a piece (edit/page.tsx `PieceEditor`): what the website says about it, changed from the counter, through
 * the same route as the web (POST /api/website/edits, a form with `id` and `words`). The name, the description, taheri.shop's
 * tags (stone, metal, karat, cut, style) or the catalogue's facts, the weight, and hiding it; each field shows the site's own
 * and goes back to it. "Put the original photo back" and "Undo every change" are the route's own reverts.
 *
 * The photograph is re-made here as the web's square editor re-makes it (WebsitePhotoEdit): its own shape or square, the layouts
 * that stamp the weight and the house's mark, the designer (crop, filters, anything else), AI Enhance and Ask AI, drawn by the web's
 * own engine and sent with the words in the web's form. Open in Design takes the photograph to the designer, as the web's button
 * does. Every save changes the public site, so it lists exactly what changes and where before it is sent.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun WebsiteEditPieceScreen(id: String) {
    val edits by WebsiteEdits.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var piece by remember { mutableStateOf<WebsiteEditPiece?>(null) }
    var original by remember { mutableStateOf<String?>(null) }
    var lastAI by remember { mutableStateOf<List<String>>(emptyList()) }
    var missing by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var form by remember { mutableStateOf(WebsiteEditLogic.Form()) }
    var confirm by remember { mutableStateOf<WebsiteEditLogic.Confirm?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var said by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    // The photo being re-made; null until "Re-make the photo", and again after a photo is put back.
    val engine = rememberDesignEngine()
    var photo by remember { mutableStateOf<WebsitePhotoEdit?>(null) }
    var photoWarning by remember { mutableStateOf<String?>(null) }
    val role = erp.app.auth.LocalSession.current.role
    val siteName = edits.siteName
    ScreenTitle(piece?.words?.name?.ifEmpty { null } ?: "Edit a piece")
    // Undoing everything is the rarer thing, so it waits in the bar's menu (only once something has been changed here).
    ScreenActions { if (piece?.changed == true) MoreMenu { confirm = WebsiteEditLogic.Confirm.All } }
    val haptics = erp.app.ui.rememberHaptics()
    LaunchedEffect(said) { if (said != null) haptics.success() }

    fun take(p: WebsiteEditPiece) {
        piece = p
        form = WebsiteEditLogic.formOf(p)
    }

    suspend fun load() {
        if (House.isDemo) {
            WebsiteEdits.load()
            val known = WebsiteEdits.state.value.piece(id)
            if (known == null) missing = true else if (piece == null) take(known)
            return
        }
        try {
            val a = WebsiteApi.get("/api/website/edits?id=${WebsiteNumber.query(id)}", WebsiteEditOne)
            val p = a.piece
            if (p == null) { missing = true; return }
            // What the counter is typing is kept over a refresh; a first read fills the form.
            val now = piece
            if (now == null || !WebsiteEditLogic.dirty(now, form)) take(p) else piece = p
            original = a.original
            lastAI = a.lastAI
            problem = null
            missing = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 404) {
                missing = piece == null
                if (!missing) failure = e.message
            } else if (piece == null) problem = e.message else failure = e.message
        } catch (e: Exception) {
            if (piece == null) problem = e.message ?: "Something went wrong." else failure = e.message ?: "Something went wrong."
        }
    }

    LaunchedEffect(id) {
        WebsiteStore.loadSettings()
        if (piece == null) WebsiteEdits.state.value.piece(id)?.let { take(it) }
        load()
    }

    suspend fun beginPhoto(p: WebsiteEditPiece) {
        val edit = photo ?: WebsitePhotoEdit(p.id, engine)
        photo = edit
        edit.begin(p, WebsiteEditLogic.photoFields(p, form))
        if (edit.lastAI.isNotEmpty()) lastAI = edit.lastAI
    }

    fun runAI(edit: WebsitePhotoEdit, op: String, params: Map<String, Any?>, label: String) {
        scope.launch {
            busy = "The AI is working on the photo (about a minute)…"
            photoWarning = null
            try {
                photoWarning = edit.runAI(op, params, label)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Couldn't change the photo. " + (e.message ?: "")
            } finally {
                busy = null
            }
        }
    }

    fun post(fields: List<Pair<String, String>>, work: suspend (WebsiteEditSaved) -> Unit, doing: String, files: List<ErpApi.FormFile> = emptyList()) {
        scope.launch {
            busy = doing
            said = null
            try {
                val d = WebsiteApi.form("/api/website/edits", fields, WebsiteEditSaved, files, timeoutMs = 130_000)
                work(d)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong."
            } finally {
                busy = null
            }
        }
    }

    val p = piece
    Box(Modifier.fillMaxSize()) {
        when {
            p != null -> {
                // The words or the photo differ from what the site shows.
                val dirty = WebsiteEditLogic.dirty(p, form) || (photo?.changed(WebsiteEditLogic.photoFields(p, form)) ?: false)
                MarketingPinned(bar = {
                    MarketingActionBar(
                        "Save to $siteName", Icons.Filled.Save, { confirm = WebsiteEditLogic.Confirm.Save }, busy = busy != null,
                        enabled = dirty && form.name.trim().isNotEmpty(),
                        summary = if (dirty) "It shows on $siteName within a minute." else "Nothing changed yet.",
                    )
                }) {
                    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
                        PiecePage(
                            p, form, { form = it }, original, lastAI, siteName, said, ask = { confirm = it },
                            edit = photo, engine = engine, warning = photoWarning, role = role, busy = busy != null,
                            beginPhoto = { scope.launch { beginPhoto(p) } }, runAI = { op, params, label -> photo?.let { runAI(it, op, params, label) } },
                        )
                    }
                }
            }
            missing -> NotAvailableState("That piece isn't on the website's list", why = "It may have been taken off the site, or renamed there.", icon = Icons.Filled.Image)
            problem != null -> MarketingErrorState(problem ?: "") { scope.launch { problem = null; load() } }
            else -> SkeletonLoading(Modifier.fillMaxSize())
        }
        WebsiteBusy(busy)
    }

    val c = confirm
    if (c != null && p != null) {
        val choice = when (c) {
            WebsiteEditLogic.Confirm.Save -> WebsiteChoice("Save") {
                // The photo with the words: the web's form exactly (file, stamped, design, shape, ai).
                val ph = photo
                val drawn = WebsiteEditLogic.photoFields(p, form)
                val photoChanged = ph?.changed(drawn) ?: false
                scope.launch {
                    busy = "Saving on $siteName…"
                    said = null
                    try {
                        val fields = arrayListOf("id" to p.id, "words" to WebsiteApi.text(WebsiteEditLogic.wordsNow(p, form)))
                        val files = ArrayList<ErpApi.FormFile>()
                        if (ph != null && photoChanged) {
                            busy = "Drawing the photo…"
                            val jpeg = ph.jpeg(drawn)
                            busy = "Saving on $siteName…"
                            files.add(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", jpeg))
                            fields.add("stamped" to if (ph.stamped(drawn)) "1" else "0")
                            fields.add("design" to ph.keptDoc.text)
                            fields.add("shape" to ph.shape)
                            fields.add("ai" to MarketingValue.of(ph.ai).text)
                        }
                        val d = WebsiteApi.form("/api/website/edits", fields, WebsiteEditSaved, files, timeoutMs = 130_000)
                        if (photoChanged) ph?.saved(drawn)
                        d.piece?.let { take(it); WebsiteEdits.replace(it) }
                        val hiddenNow = d.piece?.hidden ?: form.hidden
                        said = d.note ?: if (photoChanged) "Saved on $siteName. The new photo shows within a minute; the original is kept to put back any time."
                        else if (hiddenNow) "Saved. The piece leaves $siteName within a minute." else "Saved on $siteName. It shows within a minute."
                        load()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = e.message ?: "Something went wrong."
                    } finally {
                        busy = null
                    }
                }
            }
            WebsiteEditLogic.Confirm.Photo -> WebsiteChoice("Put the original back", destructive = true) {
                post(listOf("id" to p.id, "photo" to "revert"), { d ->
                    d.piece?.let { take(it); WebsiteEdits.replace(it) }
                    // The editor starts again from what the site now has, as the web's does.
                    photo = null
                    photoWarning = null
                    said = "The original photo is back on $siteName within a minute."
                    load()
                }, "Putting it back…")
            }
            WebsiteEditLogic.Confirm.All -> WebsiteChoice("Undo every change", destructive = true) {
                post(listOf("id" to p.id, "action" to "revert"), { d ->
                    d.piece?.let { take(it); WebsiteEdits.replace(it) }
                    photo = null
                    photoWarning = null
                    said = "Everything put back: $siteName shows the piece as it was built, within a minute."
                    load()
                }, "Putting it back…")
            }
        }
        val drawn = WebsiteEditLogic.photoFields(p, form)
        val change = photo?.takeIf { it.changed(drawn) }?.let { WebsiteEditLogic.PhotoChange(it.stamped(drawn), WebsiteEditLogic.weightLabel(form.weight), it.ai) }
        WebsiteConfirm(WebsiteEditLogic.confirmTitle(c, siteName), WebsiteEditLogic.confirmWords(c, p, form, siteName, change), listOf(choice), onDismiss = { confirm = null })
    }
    FailureAlert(failure, { failure = null })
}

@Composable
private fun PiecePage(
    p: WebsiteEditPiece,
    form: WebsiteEditLogic.Form,
    setForm: (WebsiteEditLogic.Form) -> Unit,
    original: String?,
    lastAI: List<String>,
    siteName: String,
    said: String?,
    ask: (WebsiteEditLogic.Confirm) -> Unit,
    edit: WebsitePhotoEdit?,
    engine: DesignEngine,
    warning: String?,
    role: String,
    busy: Boolean,
    beginPhoto: () -> Unit,
    runAI: (String, Map<String, Any?>, String) -> Unit,
) {
    val photo: @Composable () -> Unit = { PhotoSection(p, form, original, lastAI, siteName, ask, edit, engine, warning, role, busy, beginPhoto, runAI) }
    val rest: @Composable () -> Unit = {
        if (said != null) {
            Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.CheckCircle, null, tint = Tone.settled.color())
                Text(said, color = Tone.settled.color())
            }
        }
        WordsSection(p, form, setForm)
        FormSection("Weight", footer = { Text(if (p.hasTags) "Prices follow it; the site shows it on photos without one." else "For the photo and captions; the catalogue doesn't print weights.") }) {
            ValueRow("Weight") {
                ValueInput(form.weight, { setForm(form.copy(weight = it)) }, "0.00", "Weight in grams", keyboard = KeyboardType.Decimal)
                Text("g", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        WebsiteCard {
            ToggleRow("Hide from the website", form.hidden, { setForm(form.copy(hidden = it)) }, sub = "Off every page; its links go to the collection. Show it again any time.")
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 840.dp) {
            // A tablet: the photograph and what can be done to it beside the words (the iPad's form beside its summary).
            Row(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(0.42f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) { photo() }
                Column(Modifier.weight(0.58f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) { rest() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                photo()
                rest()
            }
        }
    }
}

@Composable
private fun PhotoSection(
    p: WebsiteEditPiece, form: WebsiteEditLogic.Form, original: String?, lastAI: List<String>, siteName: String, ask: (WebsiteEditLogic.Confirm) -> Unit,
    edit: WebsitePhotoEdit?, engine: DesignEngine, warning: String?, role: String, busy: Boolean, beginPhoto: () -> Unit, runAI: (String, Map<String, Any?>, String) -> Unit,
) {
    val context = LocalContext.current
    val header = WebsiteEditLogic.headerWords(p).ifEmpty { "Photo" }
    val note = WebsiteEditLogic.photoNote(p, lastAI, House.id)
    FormSection(header, footer = if (note.isEmpty()) null else ({ Text(note) })) {
        if (edit != null && edit.ready) {
            val drawn = WebsiteEditLogic.photoFields(p, form)
            WebsitePhotoEditRows(edit, engine, drawn, busy, onAI = runAI)
            if (warning != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.Warning, null, tint = Tone.owed.color())
                    Text(warning, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
                }
            }
            val changed = edit.changed(drawn)
            Text(
                if (changed) "The photo will be replaced when you save." else if (p.photoEdited) "The website shows a photo made here." else "The website's photo, unchanged.",
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), style = MaterialTheme.typography.bodyMedium,
                color = if (changed) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Box(Modifier.fillMaxWidth().padding(8.dp)) {
                StockImage(p.image, p.words.name, p.id + (p.change?.at ?: ""), Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.chipShape).alpha(if (p.hidden) 0.5f else 1f))
            }
            Text(
                if (p.photoEdited) "The website shows a photo made here. The original is kept." else "The website's photo, unchanged.",
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            edit?.problem?.let { Text(it, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
            ActionRow(
                if (edit?.loading == true) "Fetching the photo…" else "Re-make the photo", beginPhoto, Icons.Filled.Crop,
                enabled = edit?.loading != true && !busy,
            )
        }
        if (original != null || p.photoEdited) ActionRow("Put the original photo back", { ask(WebsiteEditLogic.Confirm.Photo) }, Icons.Filled.Replay, tone = Tone.problem)
        if (p.url.isNotEmpty()) ActionRow("Open on $siteName", { openAddress(context, android.content.Intent.ACTION_VIEW, p.url) }, Icons.AutoMirrored.Filled.OpenInNew)
        if (MarketingKit.has("/design", role)) MarketingLink("Open in Design", Icons.Filled.AutoFixHigh, WebsiteEditLogic.designPath(p.id))
    }
}

@Composable
private fun WordsSection(p: WebsiteEditPiece, form: WebsiteEditLogic.Form, setForm: (WebsiteEditLogic.Form) -> Unit) {
    FormSection("What the website says") {
        WordsField("Name", p.own.name, form.name, reset = { setForm(form.copy(name = p.own.name)) }) {
            Field(form.name, { setForm(form.copy(name = it.take(160))) }, "Name")
        }
        WordsField("Description", p.own.about, form.about, reset = { setForm(form.copy(about = p.own.about)) }) {
            Field(
                form.about, { setForm(form.copy(about = it.take(4000))) },
                if (p.hasTags) "A few lines about the piece, shown on its page." else "The piece in the house's words. A blank line starts a new paragraph.",
                minLines = 3, maxLines = 10,
            )
        }
        if (p.hasTags) {
            for (t in WebsiteWords.tags) {
                WordsField(t.label, p.own.tag(t.key), form.tags.tag(t.key), reset = { setForm(form.copy(tags = form.tags.withTag(t.key, p.own.tag(t.key)))) }) {
                    Field(form.tags.tag(t.key), { setForm(form.copy(tags = form.tags.withTag(t.key, it.take(if (t.key == "karat") 8 else 80)))) }, t.label)
                }
            }
        } else {
            WordsField("Details, one per line", p.own.facts.joinToString("\n"), form.factsLines.joinToString("\n"), reset = { setForm(form.copy(factsText = p.own.facts.joinToString("\n"))) }) {
                Field(form.factsText, { setForm(form.copy(factsText = it)) }, "Stone: Emerald\nSetting: Prong", minLines = 2, maxLines = 8)
            }
        }
    }
}

/** A field with its label, and "The site's own" when the counter's words differ from what the site was built with. */
@Composable
private fun WordsField(label: String, own: String, now: String, reset: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (own.trim() != now.trim()) {
                TextButton(onClick = reset) {
                    Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = null, Modifier.padding(end = 4.dp))
                    Text("The site's own", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        content()
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, minLines: Int = 1, maxLines: Int = 1) {
    OutlinedTextField(
        value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth(), placeholder = { Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)) },
        singleLine = maxLines == 1, minLines = minLines, maxLines = maxLines,
    )
}

/** The bar's "More": the one thing that undoes the whole piece. */
@Composable
private fun MoreMenu(undoAll: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        androidx.compose.material3.IconButton(onClick = { open = true }, Modifier.semantics { contentDescription = "More" }) { Icon(Icons.Filled.MoreVert, contentDescription = null) }
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            androidx.compose.material3.DropdownMenuItem(
                text = { Text("Undo every change to this piece", color = Tone.problem.color()) },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Undo, null, tint = Tone.problem.color()) },
                onClick = { open = false; undoAll() },
            )
        }
    }
}
