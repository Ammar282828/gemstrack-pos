package erp.app.screens.design

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.NativeArtwork
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Resize (DesignResize.swift; src/app/design/resize-sheet.tsx, lib/design/{resize,resize-ai}.ts, POST /api/design/resize). The deterministic
// part is the web's own code, bundled into the artwork engine (scripts/design-engine.ts, actions "resize" and "resizeMerge"): the three
// layouts scored, the best kept, "needs extend" when the piece can't fill the shape. "Smart" then asks the route ONCE for all sizes and an
// AI plan is used only where it scores at least as well (mergePlan). "Extend the photo" is the existing reframe op, run only when pressed
// and kept only if the same-piece check agrees. One model call per user action; nothing is added until the person says "Add".

class DesignResizeModel(val model: DesignWorkspaceModel) {
    class Entry(val id: String, val label: String, val ratio: String, val w: Double, val h: Double, val format: String)

    /** A photograph the AI extended for one shape and the check agreed with. */
    class Extra(val photoId: String, val data: ByteArray)

    var picked by mutableStateOf<List<String>>(emptyList())
    var customs by mutableStateOf<List<Entry>>(emptyList())
    var customW by mutableStateOf("")
    var customH by mutableStateOf("")
    var smart by mutableStateOf(false)

    /** "Laying out…" / "Asking the AI…" while it works. */
    var busy by mutableStateOf<String?>(null)
    var note by mutableStateOf("")
    var results by mutableStateOf<Map<String, MarketingValue>>(emptyMap())
        private set
    var images by mutableStateOf<Map<String, Bitmap>>(emptyMap())
        private set
    var kept by mutableStateOf<Set<String>>(emptySet())
    var extras by mutableStateOf<Map<String, Extra>>(emptyMap())
        private set
    var extending by mutableStateOf<String?>(null)
    var safe by mutableStateOf(false)
    var added by mutableIntStateOf(0)
    var problem by mutableStateOf<String?>(null)
    private var run = 0

    private fun entry(id: String): Entry? {
        customs.firstOrNull { it.id == id }?.let { return it }
        val s = DesignSizes.size(id) ?: return null
        return Entry(s.id, s.label, s.ratio, s.w, s.h, s.format)
    }

    fun entryFor(id: String): Entry? = entry(id)

    fun toggle(id: String) { picked = if (id in picked) picked - id else picked + id }

    /** The person's own W:H (resize-sheet.tsx addCustom). */
    fun addCustom() {
        val w = erp.core.logic.ShopNumber.parse(customW)
        val h = erp.core.logic.ShopNumber.parse(customH)
        if (w == null || h == null || w <= 0 || h <= 0 || w > 10_000 || h > 10_000) {
            problem = "Give a width and a height. For example 7 and 3, or 1200 and 628."
            return
        }
        val size = DesignSizes.custom(Math.round(w).toInt(), Math.round(h).toInt())
        val id = "custom-" + size.ratio
        if (customs.none { it.id == id }) customs = customs + Entry(id, size.label, size.ratio, size.w, size.h, "custom")
        if (id !in picked) picked = picked + id
        customW = ""; customH = ""
    }

    /** The photographs the sheet draws from: small copies (the layouts only need their shape), plus any the AI extended. */
    private suspend fun drawPhotos(): Map<String, ByteArray> {
        val all = LinkedHashMap(model.smallPhotos())
        for (ex in extras.values) all[ex.photoId] = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(ex.data, 1200) ?: ex.data }
        return all
    }

    private fun subject(doc: MarketingValue): Any? = doc["meta"]["subject"].takeUnless { it.isNull }?.any

    suspend fun resizeAll() {
        val w = model.work ?: return
        val chosen = picked.mapNotNull { entry(it) }
        if (chosen.isEmpty()) { model.say("Pick a size first"); return }
        run += 1
        val mine = run
        busy = "Laying out…"; note = ""; extras = emptyMap()
        val master = w.masterPage.doc
        val options = linkedMapOf<String, Any?>("action" to "resize", "targets" to chosen.map { mapOf("w" to it.w, "h" to it.h) }, "photoMarked" to model.marked)
        subject(master)?.let { options["subject"] = it }
        val answer: MarketingValue
        try {
            answer = model.engine.run(master, drawPhotos(), w.fields, options)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            busy = null
            problem = "That didn’t resize. " + (e.message ?: "")
            return
        }
        if (mine != run) return
        val next = LinkedHashMap<String, MarketingValue>()
        chosen.forEachIndexed { i, e -> next[e.id] = answer["results"].array.getOrNull(i) ?: MarketingValue.NULL }
        results = next
        kept = chosen.map { it.id }.toSet()
        draw(chosen.map { it.id })
        if (!smart) { busy = null; return }

        busy = "Asking the AI…"
        try {
            val source = answer["source"]
            val src = linkedMapOf<String, Any?>("frame" to source["frame"].any, "layers" to source["layers"].any)
            if (source.s("thumb").isNotEmpty()) src["thumb"] = source.s("thumb")
            val targets = chosen.map { e ->
                val r = next[e.id] ?: MarketingValue.NULL
                val t = linkedMapOf<String, Any?>(
                    "frame" to r["frame"].any, "score" to r["score"].number, "problems" to r["penalties"].array.map { it.s("why") },
                    "layers" to r["ai"]["layers"].any, "plan" to r["ai"]["plan"].any,
                )
                if (r["ai"].s("thumb").isNotEmpty()) t["thumb"] = r["ai"].s("thumb")
                t
            }
            val reply = MarketingValue.of(ErpApi.shared.send("/api/design/resize", "POST", mapOf("source" to src, "targets" to targets), 70_000))
            if (mine != run) return
            val plans = reply["plans"].array
            if (plans.isEmpty()) throw ErpApi.Failure(0, "no answer")
            val items = chosen.mapIndexed { i, e ->
                val det = (next[e.id] ?: MarketingValue.NULL).with("ai", MarketingValue.NULL)
                mapOf("det" to det.any, "plan" to (plans.getOrNull(i) ?: MarketingValue.NULL).any)
            }
            val mergeOptions = linkedMapOf<String, Any?>("action" to "resizeMerge", "items" to items)
            subject(master)?.let { mergeOptions["subject"] = it }
            val merged = model.engine.run(master, drawPhotos(), w.fields, mergeOptions)
            if (mine != run) return
            val out = LinkedHashMap<String, MarketingValue>()
            chosen.forEachIndexed { i, e -> out[e.id] = merged["results"].array.getOrNull(i) ?: next[e.id] ?: MarketingValue.NULL }
            // The AI's layouts keep what the plain pass found about the photo extending, and its thumbs are no longer needed.
            results = out
            draw(chosen.map { it.id })
            val used = chosen.count { out[it.id]?.s("strategy") == "ai" }
            note = if (reply["ai"].bool) {
                if (used > 0) "The AI refined $used of ${chosen.size}; the rest keep the plain layout." else "The AI had nothing better, so the plain layouts stay."
            } else "Smart layouts weren’t available just now; these are the plain ones."
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (mine == run) note = "Smart layouts weren’t available just now; these are the plain ones."
        } finally {
            if (mine == run) busy = null
        }
    }

    /** Each result drawn small by the engine (the web's Thumb). */
    private suspend fun draw(ids: List<String>) {
        val w = model.work ?: return
        val photos = drawPhotos()
        for (id in ids) {
            val r = results[id] ?: continue
            if (r["doc"].isNull) continue
            try {
                val answer = model.engine.run(r["doc"], photos, w.fields, mapOf("px" to 360, "quality" to 0.7))
                withContext(Dispatchers.Default) { NativeArtwork.image(answer) }?.let { images = images + (id to it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A result without its small picture still shows its score.
            }
        }
    }

    private fun photoIdOf(doc: MarketingValue): String {
        val bg = doc["bg"].s("photoId")
        if (bg.isNotEmpty()) return bg
        return doc["layers"].array.firstOrNull { it.s("kind") == "image" && it["src"].isNull && it.s("photoId").isNotEmpty() }?.s("photoId") ?: "photo"
    }

    /** The existing reframe op on the photograph, for one shape: pressed, never silent, and kept only if it is the same piece. */
    suspend fun extend(id: String) {
        val w = model.work ?: return
        val e = entry(id) ?: return
        val source = model.photos["photo"] ?: return
        extending = id
        try {
            val ai = MarketingRequest.ai("reframe", listOf(withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(source, 2048) } ?: source), mapOf("aspect" to DesignAspect.nearest(e.w, e.h), "tidy" to false))
            val check = ai["check"]
            if (!check.isNull && !check["samePiece"].bool) {
                val why = check["differences"].array.take(2).joinToString("; ") { it.string }
                model.say("Kept your photo", "The AI changed the piece: " + why.ifEmpty { "the check says it is not the same" } + ".", failed = true)
                return
            }
            val data = try { java.util.Base64.getMimeDecoder().decode(ai["image"].s("data")) } catch (ex: IllegalArgumentException) { null }
            if (data == null || withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) } == null) throw ErpApi.Failure(0, "The AI sent no image back.")
            val master = w.masterPage.doc
            val from = photoIdOf(master)
            val photoId = from.take(20) + "-x" + java.lang.Long.toString(System.currentTimeMillis(), 36)
            extras = extras + (id to Extra(photoId, data))
            val options = linkedMapOf<String, Any?>(
                "action" to "resize", "targets" to listOf(mapOf("w" to e.w, "h" to e.h)), "photoMarked" to model.marked, "swap" to mapOf("from" to from, "to" to photoId),
            )
            subject(master)?.let { options["subject"] = it }
            val again = model.engine.run(master, drawPhotos(), w.fields, options)
            var r = again["results"].array.firstOrNull() ?: MarketingValue.NULL
            if (r.isNull) throw ErpApi.Failure(0, "That didn’t resize.")
            r = r.with("notes", MarketingValue.array(listOf(MarketingValue.string("The photo extended to fill this shape, and checked as the same piece.")) + r["notes"].array))
            results = results + (id to r)
            draw(listOf(id))
        } catch (ex: CancellationException) {
            throw ex
        } catch (ex: Exception) {
            extras = extras - id
            model.say("The photo couldn’t be extended", ex.message ?: "", failed = true)
        } finally {
            extending = null
        }
    }

    val shown: List<String> get() = picked.filter { results[it] != null }
    val accepted: List<String> get() = shown.filter { it in kept }

    /** Add what was kept: pages of origin resized, tied to the master, with any extended photograph in the design's library. */
    suspend fun accept() {
        val pages = accepted.mapNotNull { id ->
            val e = entry(id) ?: return@mapNotNull null
            val r = results[id] ?: return@mapNotNull null
            NewDesignPage(null, e.label, e.format, r["frame"].n("w", e.w), r["frame"].n("h", e.h), r["doc"], "resized", null)
        }
        if (pages.isEmpty()) return
        for (id in accepted) extras[id]?.let { model.addPhoto(it.photoId, it.data) }
        model.addPages(pages)
        added += 1
        model.say("Added ${pages.size} size" + (if (pages.size == 1) "" else "s"), "Each follows the master until you edit it.")
    }
}

// MARK: The sheet

@Composable
fun DesignResizeSheet(model: DesignWorkspaceModel, dismiss: () -> Unit) {
    val r = remember { DesignResizeModel(model) }
    val scope = rememberCoroutineScope()
    val note = designSpeech({ model.speak }, { model.speak = it })
    val own = model.work?.masterPage.let { (it?.w ?: 1080.0) to (it?.h ?: 1080.0) }

    Column(Modifier.fillMaxSize()) {
        note?.let { erp.app.ui.NoteBanner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 840.dp
            val left: @Composable () -> Unit = {
                Text("Make this design in other sizes. The words and the photo stay; the layout follows the new shape.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                SectionCard("Sizes") {
                    for (g in DesignSizes.groups) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(g.title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (s in g.sizes) FilterChip(s.ratio + (if (s.w == own.first && s.h == own.second) " (this)" else ""), chosen = s.id in r.picked, onClick = { r.toggle(s.id) })
                            }
                        }
                    }
                }
                SectionCard("Your own shape") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            r.customW, { r.customW = it }, Modifier.width(80.dp).semantics { contentDescription = "Width" }, singleLine = true,
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal), placeholder = { Text("W") },
                        )
                        Text(":")
                        OutlinedTextField(
                            r.customH, { r.customH = it }, Modifier.width(80.dp).semantics { contentDescription = "Height" }, singleLine = true,
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal), placeholder = { Text("H") },
                        )
                        OutlinedButton(onClick = r::addCustom) { Icon(Symbols.Add, null, Modifier.size(18.dp)); Text("Add", Modifier.padding(start = 4.dp)) }
                    }
                    if (r.customs.isNotEmpty()) {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (c in r.customs) FilterChip(c.ratio, chosen = c.id in r.picked, onClick = { r.toggle(c.id) })
                        }
                    }
                }
                Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Symbols.AutoAwesome, null, Modifier.size(18.dp)); Text("Smart", style = MaterialTheme.typography.titleSmall) }
                            Text(if (r.smart) "Asks the AI once for all sizes; used only where it does better." else "Instant, no AI.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(r.smart, { r.smart = it }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
                    }
                    if (r.note.isNotEmpty()) Text(r.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val right: @Composable () -> Unit = { if (r.shown.isNotEmpty()) Candidates(r) }
            if (wide) {
                Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left() }
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { right() }
                }
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left(); right() }
            }
        }
        // One primary, whichever step: "Resize 3 sizes", then "Add 2 sizes" once the results are in.
        if (r.shown.isEmpty()) {
            val n = r.picked.size
            DesignActionBar(
                DesignAction(r.busy ?: (if (n == 0) "Resize" else "Resize $n size${if (n == 1) "" else "s"}"), Symbols.OpenInFull, busy = r.busy != null, disabled = r.picked.isEmpty()) { scope.launch { r.resizeAll() } },
            )
        } else {
            val n = r.accepted.size
            DesignActionBar(DesignAction("Add $n size${if (n == 1) "" else "s"}", Symbols.Check, disabled = r.accepted.isEmpty() || r.busy != null) { scope.launch { r.accept(); dismiss() } })
        }
    }
    erp.app.ui.FailureAlert(r.problem, onDismiss = { r.problem = null }, title = "Could not finish")
}

@Composable
private fun Candidates(r: DesignResizeModel) {
    SectionCard("Results", count = r.shown.size) {
        val anyZone = r.shown.any { id -> r.entryFor(id)?.let { DesignSizes.safeZone(it.h).first > 0 } ?: false }
        if (anyZone) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Show safe zones", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(r.safe, { r.safe = it }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
            }
        }
        for (row in r.shown.chunked(2)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (id in row) Box(Modifier.weight(1f)) { ResultCard(r, id) }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }
        Text("${r.accepted.size} of ${r.shown.size} kept", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ResultCard(r: DesignResizeModel, id: String) {
    val e = r.entryFor(id) ?: return
    val res = r.results[id] ?: return
    val scope = rememberCoroutineScope()
    val on = id in r.kept
    val score = res.n("score")
    val zone = DesignSizes.safeZone(e.h)
    Column(
        Modifier.clip(Radius.chipShape).background(ErpColors.card)
            .border(BorderStroke(if (on) 1.5.dp else 1.dp, if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f)), Radius.chipShape)
            .alpha(if (on) 1f else 0.7f).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val image = r.images[id]
        Box(
            Modifier.fillMaxWidth().clip(Radius.thumbShape).clickable(onClickLabel = if (on) "Skip ${e.label}" else "Keep ${e.label}") { r.kept = if (on) r.kept - id else r.kept + id },
            contentAlignment = Alignment.Center,
        ) {
            if (image != null) {
                Box {
                    DesignPicture(image, Modifier.fillMaxWidth(), ContentScale.FillWidth, e.label)
                    if (r.safe && zone.first > 0) Box(Modifier.matchParentSize()) { SafeZones(zone.first / e.h, zone.second / e.h) }
                }
            } else SkeletonLoading(Modifier.fillMaxWidth().padding(vertical = 30.dp), compact = true)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(e.label, Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.labelLarge)
            Pill("${Math.round(score)}", tone = if (score >= 85) Tone.settled else if (score >= 70) Tone.owed else Tone.problem)
        }
        Text(res["notes"].array.firstOrNull()?.string ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (res["needsExtend"].bool && r.extras[id] == null) {
            Text("The piece doesn’t fill this shape; the photo is shown whole.", style = MaterialTheme.typography.labelSmall, color = Tone.owed.color())
            OutlinedButton(onClick = { scope.launch { r.extend(id) } }, enabled = r.extending == null && r.busy == null) {
                if (r.extending == id) Loading(Modifier.size(22.dp)) else Icon(Symbols.AutoAwesome, null, Modifier.size(16.dp))
                Text("Extend the photo", Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}
