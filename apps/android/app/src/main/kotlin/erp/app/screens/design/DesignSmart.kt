package erp.app.screens.design

import erp.app.ui.icons.Symbols
import android.graphics.Bitmap
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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import java.text.NumberFormat
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Start with anything (DesignSmart.swift; src/app/design/smart-input.tsx; POST /api/design/{parse,analyze,layers}, GET /api/design/fetch).
// Paste a caption, a forwarded WhatsApp message, a link or a SKU, or choose photos: the server reads them and this shows what it
// understood BEFORE anything is used, each field with a tick (and editable). The server holds every field against the input ("no figure
// that isn't in the input": inventedFigures / breaksHouseRule); its warnings are shown as it sent them. A photograph is analysed once,
// resized to 1600 px first (the 2026-10-01 out-of-memory lesson). Nothing here writes a figure of its own.

/** One piece the smart input found, ready to become the start screen's form (use-design.ts startPhotoOf, start.tsx `use`). */
class DesignFound(val name: String, val fields: Map<String, String>, val price: String, val photo: DesignStartPhoto?, val kind: String?) {
    val id: String = java.util.UUID.randomUUID().toString()
}

class DesignSmartModel(val start: DesignStartModel, val allowLayers: Boolean) {
    class Photo(
        val name: String,
        val data: ByteArray,
        /** `site:<id>` for a website piece's photograph, `url:<address>` for one fetched. */
        val ref: String?,
        val fromSite: Boolean,
        val image: Bitmap?,
    ) { val id: String = java.util.UUID.randomUUID().toString() }

    data class Item(
        val parsed: MarketingValue,
        val fields: Map<String, String>,
        val accept: Map<String, Boolean>,
        val photos: List<Photo>,
        val main: Int = 0,
        val analysis: MarketingValue? = null,
        val id: String = java.util.UUID.randomUUID().toString(),
    )

    /** A flat picture split into layers, waiting for a look (flat-ad.ts PlanReview). */
    class LayerReview(val plan: MarketingValue, val photo: Photo, val keep: Set<String>)

    var text by mutableStateOf("")
    var busy by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var notes by mutableStateOf<List<String>>(emptyList())
    var items by mutableStateOf<List<Item>>(emptyList())
    var review by mutableStateOf<LayerReview?>(null)
    var used by mutableStateOf(0)

    // MARK: Reading

    private fun prepared(data: ByteArray): ByteArray? = MarketingPhotos.jpegCopy(data, 1600)

    private suspend fun thumbnail(data: ByteArray): Bitmap? = withContext(Dispatchers.Default) { MarketingPhotos.decode(data, 400) }

    /** A photograph the parse found, fetched through the ERP (a website piece's own, or an outside address). */
    private suspend fun fetchPhoto(ref: String, name: String): Photo? {
        val path: String
        var site = false
        if (ref.startsWith("site:")) {
            path = "/api/website/site-pieces/image?id=${MarketingKit.escape(ref.drop(5))}&size=3000&original=1"
            site = true
        } else if (ref.startsWith("url:")) {
            path = "/api/design/fetch?url=${MarketingKit.escape(ref.drop(4))}"
        } else return null
        val data = runCatching { ErpApi.shared.bytes(path, timeoutMs = 60_000) }.getOrNull() ?: return null
        val image = thumbnail(data) ?: return null
        return Photo(name, data, ref, site, image)
    }

    /** One picture, read once: the subject box, lettering burned into it, its category and a headline. */
    private suspend fun analyse(photo: Photo): MarketingValue? {
        val small = withContext(Dispatchers.Default) { prepared(photo.data) } ?: return null
        val text = runCatching {
            ErpApi.shared.upload("/api/design/analyze", emptyList(), listOf(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", small)), timeoutMs = 90_000)
        }.getOrNull() ?: return null
        return MarketingValue.parse(text)["analysis"].takeUnless { it.isNull }
    }

    private fun item(parsed: MarketingValue, photos: List<Photo>, analysis: MarketingValue?): Item {
        val fields = LinkedHashMap<String, String>()
        for (k in fieldOrder) { val v = parsed["fields"].s(k); if (v.isNotEmpty()) fields[k] = v }
        if ((fields["headline"] ?: "").isEmpty()) analysis?.s("headline")?.takeIf { it.isNotEmpty() }?.let { fields["headline"] = it }
        val accept = LinkedHashMap<String, Boolean>()
        for (k in fieldOrder) accept[k] = (fields[k] ?: "").isNotEmpty()
        accept["price"] = !parsed["price"].isNull
        return Item(parsed, fields, accept, photos, 0, analysis)
    }

    /** Words and/or photographs → what was understood. Photos typed with words describe that piece; alone, each is its own. */
    suspend fun read(picked: List<Pair<String, ByteArray>> = emptyList()) {
        val t = text.trim()
        if (t.isEmpty() && picked.isEmpty()) { error = "Type, paste or choose something first."; return }
        error = null; notes = emptyList()
        var out = ArrayList<Item>()
        try {
            if (t.isNotEmpty()) {
                busy = "Reading…"
                val answer = MarketingRequest.send("/api/design/parse", mapOf("input" to t))
                if (!answer["drive"].isNull) notes = listOf("That is a Drive folder; it goes to the library.")
                for (p in answer["pieces"].array) {
                    busy = "Getting the photo…"
                    val photos = ArrayList<Photo>()
                    for (ph in p["photos"].array.take(3)) fetchPhoto(ph.s("ref"), p.s("name", "photo"))?.let { photos.add(it) }
                    out.add(item(p, photos, null))
                }
                val found = answer["pieces"].array
                notes = if (found.isEmpty()) answer["warnings"].array.map { it.string } else found.flatMap { f -> f["warnings"].array.map { it.string } }
            }
            if (picked.isNotEmpty()) {
                val photos = ArrayList<Photo>()
                picked.forEachIndexed { i, p -> photos.add(Photo(p.first.ifEmpty { "Photo ${i + 1}" }, p.second, null, false, thumbnail(p.second))) }
                if (t.isNotEmpty() && out.size == 1) {
                    busy = "Looking at the photo…"
                    val analysis = analyse(photos[0])
                    var first = out[0].copy(photos = photos + out[0].photos, analysis = analysis)
                    val head = analysis?.s("headline") ?: ""
                    if ((first.fields["headline"] ?: "").isEmpty() && head.isNotEmpty()) first = first.copy(fields = first.fields + ("headline" to head), accept = first.accept + ("headline" to true))
                    out[0] = first
                } else {
                    // One picture at a time, and only the main one: the server holds one image in memory per request.
                    for (p in photos) {
                        busy = "Looking at ${p.name}…"
                        val analysis = analyse(p)
                        var warnings = emptyList<String>()
                        if (analysis == null) warnings = listOf("The picture was not read (no AI just now); add the words yourself.")
                        else if (analysis["burnedText"].bool) warnings = listOf("There is lettering on this photo.")
                        val parsed = MarketingValue.of(
                            mapOf(
                                "name" to (analysis?.s("headline") ?: ""), "fields" to emptyMap<String, Any>(), "specs" to emptyMap<String, Any>(), "photos" to emptyList<Any>(),
                                "confidence" to (if (analysis == null) 0.3 else 0.6), "warnings" to warnings,
                            ),
                        )
                        out.add(item(parsed, listOf(p), analysis))
                    }
                }
            }
            items = (out + items).take(12)
            text = ""
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
        busy = null
    }

    // MARK: Using

    fun found(i: Item): DesignFound {
        val fields = LinkedHashMap<String, String>()
        for (k in fieldOrder) if (i.accept[k] == true) {
            val v = (i.fields[k] ?: "").trim()
            if (v.isNotEmpty()) fields[k] = v
        }
        var price = ""
        if (i.accept["price"] == true && !i.parsed["price"].isNull) {
            val p = i.parsed["price"]
            price = if (p.s("text").isEmpty()) "PKR " + grouped(p.n("amount")) else p.s("text")
        }
        var photo: DesignStartPhoto? = null
        if (i.photos.indices.contains(i.main)) {
            val main = i.photos[i.main]
            val data = main.data
            val source = LinkedHashMap<String, String>()
            main.ref?.takeIf { it.startsWith("site:") }?.let { source["siteId"] = it.drop(5) }
            photo = DesignStartPhoto(if (main.fromSite) "From the website" else main.name.ifEmpty { "Photo" }, { data }, source = source)
        }
        val kind = i.parsed.s("suggestedKind")
        return DesignFound(fields["headline"] ?: i.parsed.s("name"), fields, price, photo, kind.ifEmpty { null })
    }

    /** One piece is used at once; the rest wait on the start screen for their own turn. */
    fun use(list: List<Item>) {
        if (list.isEmpty()) return
        val all = list.map { found(it) }
        start.use(all[0])
        start.waiting = all.drop(1) + start.waiting
        val ids = list.map { it.id }.toSet()
        items = items.filter { it.id !in ids }
        used += 1
    }

    // MARK: Flat picture → layers (owner and marketing)

    suspend fun split(photo: Photo) {
        val small = withContext(Dispatchers.Default) { prepared(photo.data) } ?: return
        error = null; busy = "Splitting into layers…"
        try {
            val text = ErpApi.shared.upload("/api/design/layers", emptyList(), listOf(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", small)), timeoutMs = 100_000)
            val plan = MarketingValue.parse(text)
            notes = plan["notes"].array.map { it.string }
            review = LayerReview(plan, photo, plan["layers"].array.map { it.s("id") }.toSet())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        } finally {
            busy = null
        }
    }

    /** Start a design from the reviewed plan (DesignLayerPlan, flat-ad.ts flatAdRequest). */
    fun startFromReview() {
        val rev = review ?: return
        val req = DesignLayerPlan.request(rev.plan, rev.photo.data, rev.photo.name, rev.keep)
        review = null
        start.launch?.invoke(req)
    }

    companion object {
        val fieldOrder = listOf("headline", "weight", "kicker", "details")
        val fieldLabel = mapOf("kicker" to "Small line", "headline" to "Headline", "weight" to "Specs line", "details" to "Button line")

        private fun grouped(n: Double): String {
            val f = NumberFormat.getNumberInstance(Locale("en", "PK"))
            f.maximumFractionDigits = 0
            return f.format(n)
        }

        /** The average colour round the picture's edge as #RRGGBB: the ground the cut-out piece stands on (flat-ad.ts edgeColour). */
        fun edgeColour(data: ByteArray): String {
            val image = MarketingPhotos.decode(data, 256) ?: return "#1B1B1B"
            val n = 48
            val small = Bitmap.createScaledBitmap(image, n, n, true)
            var r = 0L
            var g = 0L
            var b = 0L
            var count = 0
            for (y in 0 until n) for (x in 0 until n) {
                if (x <= 1 || y <= 1 || x >= n - 2 || y >= n - 2) {
                    val p = small.getPixel(x, y)
                    r += (p shr 16) and 255; g += (p shr 8) and 255; b += p and 255; count += 1
                }
            }
            if (count == 0) return "#1B1B1B"
            return String.format(Locale.ROOT, "#%02X%02X%02X", r / count, g / count, b / count)
        }
    }
}

// MARK: The sheet

@Composable
fun DesignSmartSheet(start: DesignStartModel, allowLayers: Boolean, dismiss: () -> Unit) {
    val m = remember { DesignSmartModel(start, allowLayers) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = designSpeech({ start.speak }, { start.speak = it })
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(8)) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            val out = ArrayList<Pair<String, ByteArray>>()
            uris.forEachIndexed { i, uri -> readUri(context, uri)?.takeIf { withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(it) } != null }?.let { out.add("Photo ${i + 1}" to it) } }
            if (out.isEmpty()) m.error = "Choose readable photos, or save them to Photos first." else m.read(out)
        }
    }
    DesignSheetBody(note) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            SectionCard("Paste anything") {
                OutlinedTextField(
                    m.text, { m.text = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 8, enabled = m.busy == null,
                    placeholder = { Text("A caption, a WhatsApp message, a link or a SKU. Or type it: “ruby ring 21k 12.35g”.") },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Reading again, once there are pieces: before that, "Read it" is the bar's.
                    if (m.items.isNotEmpty()) {
                        OutlinedButton(onClick = { scope.launch { m.read() } }, Modifier.weight(1f).defaultMinSize(minHeight = 48.dp), enabled = m.busy == null && m.text.isNotBlank()) {
                            Icon(Symbols.AutoAwesome, null, Modifier.size(18.dp)); Text("Read it again", Modifier.padding(start = 6.dp))
                        }
                    }
                    OutlinedButton(
                        onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        Modifier.weight(1f).defaultMinSize(minHeight = 48.dp), enabled = m.busy == null,
                    ) { Icon(Symbols.PhotoLibrary, null, Modifier.size(18.dp)); Text("Photos", Modifier.padding(start = 6.dp)) }
                }
                Text("Nothing is used until you tick it. No figure appears that is not in what you gave.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (m.notes.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { for (n in m.notes) Text(n, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            m.review?.let { rev ->
                DesignLayerReviewCard(rev.plan, rev.keep, { m.review = DesignSmartModel.LayerReview(rev.plan, rev.photo, it) }, { m.review = null }, { m.startFromReview(); dismiss() }, showsActions = false)
            }
            for (item in m.items) ItemCard(m, item, dismiss)
        }
        val review = m.review
        if (review != null) {
            DesignActionBar(
                DesignAction("Start a design from this", Symbols.Layers, disabled = m.busy != null) { m.startFromReview(); dismiss() },
                secondary = listOf(DesignAction("Back") { m.review = null }),
            )
        } else if (m.items.isEmpty()) {
            DesignActionBar(DesignAction(m.busy ?: "Read it", Symbols.AutoAwesome, busy = m.busy != null, disabled = m.text.isBlank()) { scope.launch { m.read() } })
        } else {
            DesignActionBar(DesignAction(if (m.items.size > 1) "Use all ${m.items.size} pieces" else "Use this piece", Symbols.Check, disabled = m.busy != null) { m.use(m.items); dismiss() })
        }
    }
    erp.app.ui.FailureAlert(m.error, onDismiss = { m.error = null }, title = "Could not read that")
}

@Composable
private fun ItemCard(m: DesignSmartModel, item: DesignSmartModel.Item, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sure = item.parsed.n("confidence") >= 0.6
    fun set(change: (DesignSmartModel.Item) -> DesignSmartModel.Item) { m.items = m.items.map { if (it.id == item.id) change(it) else it } }
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Sure is the expected state: only a doubtful reading is marked (rule 15), without the percentage.
            if (!sure) Pill("Check this", tone = Tone.owed)
            if (item.parsed.s("suggestedKind").isNotEmpty()) Text("suggests: " + item.parsed.s("suggestedKind"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.weight(1f))
            IconButton(onClick = { m.items = m.items.filter { it.id != item.id } }) { Icon(Symbols.Cancel, "Remove", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (item.photos.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item.photos.forEachIndexed { n, p ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Box(
                            Modifier.size(76.dp).clip(Radius.thumbShape).background(ErpColors.ground)
                                .border(BorderStroke(if (n == item.main) 2.dp else 0.dp, if (n == item.main) ErpColors.accent else androidx.compose.ui.graphics.Color.Transparent), Radius.thumbShape)
                                .clickable(onClickLabel = if (n == item.main) "Main photo" else "Use as the main photo") { set { it.copy(main = n) } },
                        ) { p.image?.let { DesignPicture(it, Modifier.fillMaxSize()) } }
                        if (m.allowLayers && n == item.main) {
                            OutlinedButton(onClick = { scope.launch { m.split(p) } }, enabled = m.busy == null) { Icon(Symbols.Layers, null, Modifier.size(14.dp)); Text("Layers", Modifier.padding(start = 4.dp), style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                }
            }
        }
        for (k in DesignSmartModel.fieldOrder) {
            if (item.fields[k] != null || item.accept[k] == true) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Switch(item.accept[k] == true, { on -> set { it.copy(accept = it.accept + (k to on)) } }, Modifier.semantics { contentDescription = DesignSmartModel.fieldLabel[k] ?: k }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(DesignSmartModel.fieldLabel[k] ?: k, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedTextField(item.fields[k] ?: "", { v -> set { it.copy(fields = it.fields + (k to v), accept = it.accept + (k to true)) } }, Modifier.fillMaxWidth(), minLines = 1, maxLines = 3)
                    }
                }
            }
        }
        if (!item.parsed["price"].isNull) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Switch(item.accept["price"] == true, { on -> set { it.copy(accept = it.accept + ("price" to on)) } }, Modifier.semantics { contentDescription = "Price" }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Price", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(item.parsed["price"].s("text", "PKR " + item.parsed["price"].n("amount").toLong()), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (item.parsed["specs"].n("weightG") > 0 && (item.fields["weight"] ?: "").isEmpty()) {
            Text(
                "Weight ${grams(item.parsed["specs"].n("weightG"))} g was read but left off the design: check it, then type the specs line.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (w in item.parsed["warnings"].array.map { it.string }) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                Icon(Symbols.Warning, null, Modifier.size(16.dp), tint = Tone.owed.color())
                Text(w, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            }
        }
        // One piece: the bar's "Use this piece" is its button; with several, each can be used on its own turn.
        if (m.items.size > 1) {
            OutlinedButton(onClick = { m.use(listOf(item)); dismiss() }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), enabled = m.busy == null) {
                Icon(Symbols.Check, null, Modifier.size(18.dp)); Text("Use this", Modifier.padding(start = 6.dp))
            }
        }
    }
}

private fun grams(v: Double): String {
    var s = String.format(Locale.ROOT, "%.3f", v)
    while (s.endsWith("0")) s = s.dropLast(1)
    if (s.endsWith(".")) s = s.dropLast(1)
    return s
}

