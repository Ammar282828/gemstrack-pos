package erp.app.screens.design

import erp.app.ui.icons.Symbols
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.SitePhotoPicker
import erp.app.screens.neworder.hasCamera
import erp.app.screens.neworder.rememberCameraCapture
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.ShopDate
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The start screen's choices (src/app/design/start.tsx): the kind, the sizes it starts with, the photograph and the words found. */
class DesignStartModel {
    var kind by mutableStateOf("piece")
    var sizes by mutableStateOf(DesignKinds.card("piece").sizes)
    var customW by mutableStateOf(4)
    var customH by mutableStateOf(5)

    /** Words found (kicker, headline, weight, details) and the price, by the smart input. */
    var fields by mutableStateOf<Map<String, String>>(emptyMap())
    var price by mutableStateOf("")
    var photo by mutableStateOf<DesignStartPhoto?>(null)
    var sheet by mutableStateOf<DesignSheet?>(null)

    /** Pieces the smart input found beyond the one in use: they wait on the start screen for their own turn. */
    var waiting by mutableStateOf<List<DesignFound>>(emptyList())

    /** Ads → Plan's "Make this" (?play=): the Ad starts at the play's shape(s), layout and goal (start.tsx `play`). */
    var play by mutableStateOf<MarketingValue?>(null)

    /** Owner and marketing: the Ad kind is theirs, so a suggestion of it is taken only by them. */
    var adsAllowed = false
    var speak: ((Note) -> Unit)? = null

    /** Starts a design from a request built elsewhere (a flat picture rebuilt as layers); the screen sets it. */
    var launch: ((DesignStartRequest) -> Unit)? = null

    fun say(title: String, detail: String = "", failed: Boolean = false) { speak?.invoke(Note(title, detail, failed)) }

    fun choose(k: String) {
        kind = k
        sizes = DesignKinds.card(k).sizes
        if (k != "ad") play = null
    }

    /** start.tsx playSizes: the play's format, and the 9:16 beside it when it goes out as a pair. */
    fun usePlay(p: MarketingValue) {
        play = p
        kind = "ad"
        val ids = listOf(p.s("format")) + (if (p["pair"].bool && p.s("format") != "story") listOf("story") else emptyList())
        val valid = ids.filter { it != "custom" && DesignSizes.size(it) != null }
        sizes = valid.ifEmpty { DesignKinds.card("ad").sizes }
    }

    fun toggle(id: String) {
        sizes = if (id in sizes) { if (sizes.size > 1) sizes - id else sizes } else sizes + id
    }

    val choices: List<DesignSizeChoice> get() = sizes.map { DesignSizeChoice(it, customW.coerceIn(1, 100), customH.coerceIn(1, 100)) }
    val summary: String get() = choices.joinToString(" + ") { it.size.ratio }

    val request: DesignStartRequest
        get() {
            val copy = LinkedHashMap<String, String>()
            if (price.trim().isNotEmpty()) copy["price"] = price
            val playing = if (kind == "ad") play else null
            if (playing != null && playing.s("goal").isNotEmpty()) copy["goal"] = playing.s("goal")
            return DesignStartRequest(kind, choices, photo, fields, copy, playing?.s("template", "headline") ?: "headline")
        }

    /**
     * What the smart input found fills the form, as start.tsx `use` does: its words, its main photograph, its price, and the kind it
     * suggests (an Ad only for owner and marketing: the caller checks).
     */
    fun apply(found: Map<String, String>, foundPrice: String = "", photo: DesignStartPhoto? = null, suggested: String? = null) {
        fields = found.filterValues { it.isNotEmpty() }
        price = foundPrice
        if (photo != null) this.photo = photo
        if (suggested != null && suggested in DesignKinds.valid && (adsAllowed || suggested != "ad")) choose(suggested)
    }

    /** One found piece becomes the form (start.tsx `use`). */
    fun use(f: DesignFound) { apply(f.fields, f.price, f.photo, f.kind) }
}

/** The three places a photograph comes from, as start photographs (start.tsx startPhotoFromSite, photos-section.tsx startPhotoFromWork). */
object DesignPhotoSources {
    /** A website piece. [data] when the picker already brought the photograph. */
    fun site(p: MarketingValue, data: ByteArray? = null): DesignStartPhoto {
        val original = truthy(p["photoSource"])
        val id = p.s("id")
        val fields = linkedMapOf("headline" to headline(p.s("name")))
        val collection = p.s("collection")
        fields["kicker"] = if (collection.isNotEmpty() && collection != "Website") collection else ""
        val facts = p["facts"].array.map { it.string }.filter { it.isNotEmpty() }
        if (facts.isNotEmpty()) fields["weight"] = facts.joinToString(" · ")
        return DesignStartPhoto(
            label = p.s("name"),
            load = { data ?: ErpApi.shared.bytes("/api/website/site-pieces/image?id=${MarketingKit.escape(id)}&size=3000" + (if (original) "&original=1" else "")) },
            // `siteFrom`: a piece with a separate source photograph says whether it carries the marks; one without carries them.
            marked = if (original) p["sourceMarked"].bool else true,
            fields = fields,
            source = mapOf("siteId" to id),
        )
    }

    /** A library photograph (owner and marketing). */
    fun library(a: MarketingValue): DesignStartPhoto {
        val original = if (!a["original"].isNull) a["original"].s("id") else ""
        val id = a.s("id")
        val fields = LinkedHashMap<String, String>()
        val assessed = a["assessment"].s("headline")
        fields["headline"] = assessed.ifEmpty { a.s("name") }
        fields["kicker"] = if (a.s("source") == "site" && a.s("collection") != "Website") a.s("collection") else ""
        if (a.s("specs").isNotEmpty()) fields["weight"] = a.s("specs")
        return DesignStartPhoto(
            label = a.s("name", "Photo"),
            load = {
                val clean = if (original.isNotEmpty()) runCatching { ErpApi.shared.bytes("/api/ads/studio/image?id=${MarketingKit.escape(original)}&size=2048") }.getOrNull() else null
                clean ?: ErpApi.shared.bytes("/api/ads/studio/image?id=${MarketingKit.escape(id)}&size=2048")
            },
            // A clean Drive original carries no mark; the site's own photo, or one with burned-in lettering, does.
            marked = original.isEmpty() && (a.s("source") == "site" || a["assessment"]["burnedText"].bool),
            fields = fields,
            source = mapOf("assetId" to id),
        )
    }

    fun device(data: ByteArray, name: String) = DesignStartPhoto(name, { data })

    private val camera = Regex("^(dsc|img|pxl|photo|image|mvimg|whatsapp image)[\\s_-]*[\\d_ -]*$", RegexOption.IGNORE_CASE)
    private val digits = Regex("^[\\d\\s_-]+$")

    /** lib/website/site-photo.ts headlineOf: a camera file name is no headline. */
    fun headline(name: String): String {
        val n = name.trim()
        if (n.isEmpty()) return ""
        if (camera.matches(n)) return ""
        if (digits.matches(n)) return ""
        return n
    }

    private fun truthy(v: MarketingValue): Boolean {
        val j = v.json
        if (v.isNull) return false
        if (j is kotlinx.serialization.json.JsonPrimitive) {
            if (j.isString) return j.content.isNotEmpty()
            j.content.toBooleanStrictOrNull()?.let { return it }
            j.content.toDoubleOrNull()?.let { return it != 0.0 }
        }
        return true
    }
}

// MARK: The start screen

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DesignStartView(
    start: DesignStartModel,
    access: DesignAccess,
    role: String,
    shelf: DesignShelf,
    starting: Boolean,
    /** To the Photos section, which hands a photograph back. */
    onBrowse: () -> Unit,
    onBegin: () -> Unit,
    onOpenDraft: (DesignDraftRow) -> Unit,
    onOpenSaved: (DesignRecord) -> Unit,
    onSeeAll: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sitePicker by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val cards = DesignKinds.cards.filter { access.ads || !it.ads }

    LaunchedEffect(Unit) { shelf.load(); shelf.loadDrafts(context) }
    LaunchedEffect(access) { start.adsAllowed = access.ads }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val data = readUri(context, uri)
            if (data == null || withContext(Dispatchers.Default) { erp.app.screens.marketing.MarketingPhotos.jpegCopy(data) } == null) problem = "Choose a readable photo, or save it to Photos first."
            else start.photo = DesignPhotoSources.device(data, "Photo from this phone")
        }
    }
    val camera = rememberCameraCapture(onProblem = { problem = it }) { bitmap ->
        if (bitmap != null) scope.launch {
            val bytes = withContext(Dispatchers.Default) { erp.app.screens.marketing.MarketingPhotos.jpeg(bitmap) }
            if (bytes != null) start.photo = DesignPhotoSources.device(bytes, "Camera photo")
        }
    }

    Column(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 840.dp
            val left: @Composable () -> Unit = {
                Anything(start)
                Making(start, cards)
            }
            val right: @Composable () -> Unit = {
                Photograph(start, onBrowse, { sitePicker = true }, { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, if (hasCamera(context)) camera else null)
                Investments(role)
                LeftOff(shelf, onOpenDraft, onOpenSaved, onSeeAll)
            }
            if (wide) {
                Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left() }
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { right() }
                }
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    left(); right()
                }
            }
        }
        // The one primary action stays at the foot, below the choices that decide it (rule 16).
        DesignActionBar(DesignAction("Continue", busy = starting, onClick = onBegin))
    }

    start.sheet?.let { sheet -> DesignSheetHost(sheet, start.speak) { start.sheet = null } }
    if (sitePicker) {
        SitePhotoPicker(onClose = { sitePicker = false }, picked = { piece, data ->
            sitePicker = false
            start.photo = DesignPhotoSources.site(piece, data)
        })
    }
    erp.app.ui.FailureAlert(problem, onDismiss = { problem = null }, title = "Could not use that photograph")
}

/** "Start with anything": the smart input (DesignSmart) behind one button, and what it found. */
@Composable
private fun Anything(start: DesignStartModel) {
    SectionCard("Start with anything") {
        Text("Paste a caption, a forwarded WhatsApp message, a link or a SKU, or drop photos.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = { DesignHooks.startWithAnything(start) }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
            Icon(Symbols.AutoAwesome, null, Modifier.size(18.dp))
            Text("Paste or describe a piece…", Modifier.padding(start = 8.dp))
        }
        val found = start.fields.filterValues { it.isNotEmpty() }
        if (found.isNotEmpty() || start.price.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(foundLine(start), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { start.fields = emptyMap(); start.price = "" }) { Text("Clear") }
            }
        }
        if (start.waiting.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Also found", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (f in start.waiting) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.name.ifEmpty { "A piece" }, Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                        OutlinedButton(onClick = { start.use(f); start.waiting = start.waiting.filter { it.id != f.id } }) { Text("Use") }
                        IconButton(onClick = { start.waiting = start.waiting.filter { it.id != f.id } }) { Icon(Symbols.Cancel, "Put it aside", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

private fun foundLine(start: DesignStartModel): String {
    val parts = ArrayList<String>()
    for ((key, value) in start.fields.toSortedMap()) if (value.isNotEmpty()) parts.add((if (key == "weight") "specs" else key) + " “" + value.take(40) + "”")
    if (start.price.isNotEmpty()) parts.add("price “" + start.price + "”")
    return "Found: " + parts.joinToString(" · ")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Making(start: DesignStartModel, cards: List<DesignKindCard>) {
    SectionCard("What are you making?") {
        val play = start.play
        if (play != null && start.kind == "ad") {
            Row(
                Modifier.fillMaxWidth().clip(Radius.tileShape).background(ErpColors.accent.copy(alpha = 0.12f)).padding(10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        append("Making ")
                        pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append(play.s("title")); pop()
                        append(" — “${play.s("cta")}” · ${play.s("where")}")
                    },
                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                )
                TextButton(onClick = { start.play = null }) { Text("Not this play") }
            }
        }
        // Two to a row, as the iPhone's grid.
        for (row in cards.chunked(2)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (c in row) {
                    val on = start.kind == c.kind
                    Column(
                        Modifier.weight(1f).clip(Radius.chipShape).background(if (on) ErpColors.accent else ErpColors.ground)
                            .clickable(role = Role.RadioButton) { start.choose(c.kind) }.semantics { selected = on }.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Text(c.title, style = MaterialTheme.typography.titleMedium, color = if (on) ErpColors.onAccent else MaterialTheme.colorScheme.onSurface)
                        Text(c.note, style = MaterialTheme.typography.bodySmall, color = (if (on) ErpColors.onAccent else MaterialTheme.colorScheme.onSurface).copy(alpha = 0.8f))
                    }
                }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Sizes", style = MaterialTheme.typography.titleSmall)
                Text(start.summary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for (g in DesignSizes.groups) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(g.title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (s in g.sizes) FilterChip(s.ratio, chosen = s.id in start.sizes, onClick = { start.toggle(s.id) })
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Your own", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilterChip("W:H", chosen = "custom" in start.sizes, onClick = { start.toggle("custom") })
                    if ("custom" in start.sizes) {
                        SizeBox("Width", start.customW) { start.customW = it }
                        Text(":")
                        SizeBox("Height", start.customH) { start.customH = it }
                    }
                }
            }
        }
    }
}

@Composable
private fun SizeBox(label: String, value: Int, onChange: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    OutlinedTextField(
        value = text, onValueChange = { t -> text = t.filter { it.isDigit() }.take(3); text.toIntOrNull()?.let(onChange) },
        modifier = Modifier.width(72.dp).semantics { contentDescription = label }, singleLine = true,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
        textStyle = MaterialTheme.typography.bodyMedium.copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center),
    )
}

@Composable
private fun Photograph(start: DesignStartModel, onBrowse: () -> Unit, onSite: () -> Unit, onDevice: () -> Unit, onCamera: (() -> Unit)?) {
    SectionCard("The photograph") {
        val photo = start.photo
        if (photo != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Symbols.PhotoLibrary, null, tint = ErpColors.accent)
                Text(photo.label, Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.titleSmall)
                IconButton(onClick = { start.photo = null }) { Icon(Symbols.Cancel, "Choose another photograph", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        } else {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SourceChip("Browse photos", Symbols.PhotoLibrary, onBrowse)
                SourceChip("From the website", Symbols.Language, onSite)
                SourceChip("This phone", Symbols.Phone, onDevice)
                if (onCamera != null) SourceChip("Camera", Symbols.CameraAlt, onCamera)
            }
            Text("A photograph is optional: without one the design starts on the house’s ground.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SourceChip(title: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.defaultMinSize(minHeight = 48.dp).clip(CircleShape).background(ErpColors.ground)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f)), CircleShape)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 13.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, Modifier.size(18.dp))
        Text(title, style = MaterialTheme.typography.labelLarge)
    }
}

/** The Investments link of start.tsx, only where the person's map has it (Taheri). */
@Composable
private fun Investments(role: String) {
    if (!MarketingKit.has("/website/investments", role)) return
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { navigator.open("/website/investments") }.padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Symbols.ShowChart, null, tint = ErpColors.accent)
        Text("Gold investment posts: Investments", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Icon(Symbols.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

@Composable
private fun LeftOff(shelf: DesignShelf, onOpenDraft: (DesignDraftRow) -> Unit, onOpenSaved: (DesignRecord) -> Unit, onSeeAll: () -> Unit) {
    val drafts = shelf.draftRows.take(3)
    val recent = shelf.items.take(4)
    if (drafts.isEmpty() && recent.isEmpty()) return
    SectionCard("Where you left off") {
        for (d in drafts) Box(Modifier.clickable(role = Role.Button) { onOpenDraft(d) }) { DesignDraftLine(d) }
        for (r in recent) Box(Modifier.clickable(role = Role.Button) { onOpenSaved(r) }) { DesignRecordLine(r) }
        TextButton(onClick = onSeeAll) { Text("See all saved") }
    }
}

/** A device draft as a line. */
@Composable
fun DesignDraftLine(row: DesignDraftRow) {
    val thumb = rememberBitmap(row.thumb, 120)
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).clip(Radius.thumbShape).background(ErpColors.ground), contentAlignment = Alignment.Center) {
            if (thumb != null) DesignPicture(thumb, Modifier.fillMaxSize()) else Icon(Symbols.Phone, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.title, maxLines = 1, style = MaterialTheme.typography.titleSmall)
            Text(
                (if (row.old == null) "Draft on this phone" else "Earlier Post a piece draft") + " · " + ShopDate.stamp(java.time.Instant.ofEpochMilli(row.updated), withTime = false),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(Symbols.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

/** A saved design as a line. */
@Composable
fun DesignRecordLine(record: DesignRecord) {
    val thumb = rememberBitmap(remember(record.thumb) { DesignThumb.bytes(record.thumb) }, 120)
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).clip(Radius.thumbShape).background(ErpColors.ground), contentAlignment = Alignment.Center) {
            if (thumb != null) DesignPicture(thumb, Modifier.fillMaxSize()) else Icon(Symbols.PhotoLibrary, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(record.name, maxLines = 1, style = MaterialTheme.typography.titleSmall)
            Text(
                DesignKinds.label(record.kind) + " · ${record.pages.size} size" + (if (record.pages.size == 1) "" else "s") + " · " + ShopDate.say(record.updated),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(Symbols.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}
