package erp.app.screens.design

import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import erp.app.data.Outbox
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.screens.marketing.DesignEngine
import erp.app.screens.marketing.DesignProtocol
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.PostDraft
import erp.app.screens.marketing.PostDraftDisk
import erp.app.ui.Note
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A photograph to start from, fetched when the design opens so choosing it costs nothing (use-design.ts StartPhoto). */
class DesignStartPhoto(
    val label: String,
    val load: suspend () -> ByteArray,
    /** The photograph already carries the house's marks (taheri.shop's wordmark and weight). */
    val marked: Boolean = false,
    val fields: Map<String, String> = emptyMap(),
    /** siteId / assetId */
    val source: Map<String, String> = emptyMap(),
)

/** A layout the engine offers (AD_TEMPLATES). */
class DesignLayout(val id: String, val label: String)

/** What the start screen hands the workspace (use-design.ts StartRequest). */
class DesignStartRequest(
    val kind: String,
    val sizes: List<DesignSizeChoice>,
    val photo: DesignStartPhoto? = null,
    val fields: Map<String, String> = emptyMap(),
    val copy: Map<String, String> = emptyMap(),
    val template: String = "headline",
    /** A page's document built by the caller rather than laid out by a template (a flat picture rebuilt as layers). */
    val compose: ((DesignPageState) -> MarketingValue)? = null,
)

/** The photograph before an AI one, for "Back to the photo before". */
class DesignPhotoStep(val data: ByteArray, val marked: Boolean, val check: MarketingValue?)

/** An AI picture waiting for a look: the check doubted it. */
class DesignCandidate(val data: ByteArray, val label: String, /** It carries none of the website's marks. */ val clean: Boolean, val check: MarketingValue?) {
    val id: String = java.util.UUID.randomUUID().toString()
}

/** A sheet a hook asks the screen to show (DesignSheet): [content] is given a way to close itself. */
class DesignSheet(val title: String, val compact: Boolean = false, val content: @Composable (dismiss: () -> Unit) -> Unit) {
    val id: String = java.util.UUID.randomUUID().toString()
}

/**
 * The design being made (DesignWorkspaceModel.swift): the work (DesignWork), its photographs, what is drawn from them, and the three
 * places it lives: the device draft (autosaved 1.5 s after a change, as the web's), the shop's `designs` (Save), and the layer
 * editor's own undo.
 */
class DesignWorkspaceModel(
    private val scope: CoroutineScope,
    val engine: DesignEngine,
    private val disk: DesignDraftDisk?,
    private val olderDisk: PostDraftDisk?,
) {
    var work by mutableStateOf<DesignWork?>(null)

    /** The main photograph is "photo"; others (an inset, an extended copy) by their own id. All JPEG. */
    var photos by mutableStateOf<Map<String, ByteArray>>(emptyMap())
        private set
    var starting by mutableStateOf(false)
    var saving by mutableStateOf(false)

    /** A save is on its way through the Outbox. */
    var uploading by mutableStateOf(false)
        private set
    var draftSaved by mutableStateOf<Long?>(null)
    var error by mutableStateOf<String?>(null)
    var sheet by mutableStateOf<DesignSheet?>(null)

    /** Pages drawn small (the strip) and at reading size (the active page), by page id. */
    val thumbs = mutableStateMapOf<String, Bitmap>()
    val previews = mutableStateMapOf<String, Bitmap>()

    /** Bumped when what a page is drawn from changes without its document (the words, the photographs). */
    var tick by mutableIntStateOf(0)
        private set

    /** The engine's catalogue (layouts, palettes), read once. */
    var catalogue by mutableStateOf(MarketingValue.NULL)
        private set
    var marked by mutableStateOf(false)

    /** An address a sheet asks the screen to open (the Meta ad's New ad). */
    var route by mutableStateOf<String?>(null)

    /** The one AI tool running, an AI picture waiting for a look, and the photographs before the AI ones ("Back to the photo before"). */
    var aiBusy by mutableStateOf<String?>(null)
    var candidate by mutableStateOf<DesignCandidate?>(null)
    var photoUndo by mutableStateOf<List<DesignPhotoStep>>(emptyList())
        private set

    /** The same-piece check that came with the photograph in use, when the AI made it. */
    var photoCheck by mutableStateOf<MarketingValue?>(null)
        private set

    /** "Also remove tags and strings": whether Enhance and Retouch take the website's marks off too (per device). */
    var tidy by mutableStateOf(Prefs.bool("design.tidy") ?: false)
        private set

    fun useTidy(on: Boolean) { tidy = on; Prefs.putBool("design.tidy", on) }

    var speak: ((Note) -> Unit)? = null
    private var composeNow: ((DesignPageState) -> MarketingValue)? = null
    /** The photographs at 1200 px, for drawing the strip and the page: made once, when first asked for, off the main thread. */
    private var small: Pair<Map<String, ByteArray>, Map<String, ByteArray>>? = null
    private var photosChanged = true
    private var draftID: String? = null
    private var createdAt = System.currentTimeMillis()
    private var autosave: Job? = null
    private var pendingOld: String? = null
    private var token = java.util.UUID.randomUUID().toString()
    private var serial = 0
    private var editSnapshot: Pair<String, DesignWork>? = null

    private val currentKey: String get() = "design.draft.current.${House.id}"

    val isOpen: Boolean get() = work != null

    /** Runs [block] on the screen's scope (a hook's button has no coroutine of its own). */
    fun go(block: suspend () -> Unit): Job = scope.launch { block() }

    fun say(title: String, detail: String = "", failed: Boolean = false) { speak?.invoke(Note(title, detail, failed)) }

    // MARK: The engine

    suspend fun loadCatalogue() {
        if (!catalogue.isNull) return
        try {
            val r = engine.run(DesignWork.blankDoc(1080.0, 1080.0), emptyMap(), DesignWork.emptyFields())
            catalogue = r["catalogue"]
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    /** The layouts the engine offers (lib/ads/studio/templates.ts AD_TEMPLATES for this house). */
    val templates: List<DesignLayout> get() = catalogue["templates"].array.map { DesignLayout(it.s("id"), it.s("label")) }

    private fun smallCopy(data: ByteArray): ByteArray = MarketingPhotos.jpegCopy(data, 1200) ?: data

    /** The photographs small enough to draw the strip and the page from (cached while they are the same). */
    suspend fun smallPhotos(): Map<String, ByteArray> {
        val current = photos
        small?.let { if (it.first === current) return it.second }
        val made = withContext(Dispatchers.Default) { current.mapValues { smallCopy(it.value) } }
        small = current to made
        return made
    }

    private fun putPhotos(new: Map<String, ByteArray>) {
        photos = new
        small = null
        photosChanged = true
        tick += 1
    }

    /** A photograph as a JPEG (upright, at most 3000 px), off the main thread: null when it cannot be read. */
    private suspend fun jpegOf(data: ByteArray): ByteArray? = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) }

    /**
     * A page laid out by a template (or, for the website's own page, the catalogue's photograph); anything added by hand stays.
     * Make it with AI (DesignAI) lays every size out with the layout the art director chose.
     */
    suspend fun layOut(p: DesignPageState, template: String, fields: Map<String, String>): MarketingValue {
        val options: Map<String, Any?> =
            if (DesignSizes.isCatalogue(p.label)) mapOf("action" to "square", "value" to "catalogue")
            else mapOf("action" to "ad", "value" to template, "photoMarked" to marked)
        val r = engine.run(p.doc, photos, fields, options)
        var doc = r["doc"]
        if (!DesignSizes.isCatalogue(p.label)) doc = doc.withPath(listOf("meta", "template"), MarketingValue.string(template))
        return doc
    }

    /** A page as JPEG data at this width (the same call Save and Publish use). */
    suspend fun render(pageId: String, px: Int, quality: Double = 0.92): ByteArray {
        val w = work
        val p = w?.page(pageId) ?: throw ErpApi.Failure(0, "That page is gone.")
        val r = engine.run(p.doc, photos, w.fields, mapOf("px" to px, "quality" to quality))
        return DesignProtocol.imageBytes(r) ?: throw ErpApi.Failure(0, "The design could not be drawn.")
    }

    /** A page drawn over another of the design's photographs (a further angle), for Publish's "more photos". */
    suspend fun renderWith(pageId: String, photoId: String, px: Int, quality: Double = 0.92): ByteArray {
        val w = work
        var doc = w?.page(pageId)?.doc ?: throw ErpApi.Failure(0, "That page is gone.")
        doc = doc.withPath(listOf("bg", "photoId"), MarketingValue.string(photoId))
            .withPath(listOf("bg", "placement"), MarketingValue.of(mapOf("mode" to "fill", "zoom" to 1, "focusX" to 0.5, "focusY" to 0.5)))
        val r = engine.run(doc, photos, w.fields, mapOf("px" to px, "quality" to quality))
        return DesignProtocol.imageBytes(r) ?: throw ErpApi.Failure(0, "The design could not be drawn.")
    }

    private suspend fun decodeSmall(r: MarketingValue): Bitmap? = withContext(Dispatchers.Default) { erp.app.screens.marketing.NativeArtwork.image(r) }

    /** The strip's small picture of a page, a moment after it stopped changing. */
    suspend fun refreshThumb(pageId: String) {
        val w = work ?: return
        val p = w.page(pageId)
        if (w.fresh || p == null) return
        try {
            delay(450)
            val r = engine.run(p.doc, smallPhotos(), w.fields, mapOf("px" to 220, "quality" to 0.7))
            decodeSmall(r)?.let { thumbs[pageId] = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The strip keeps its last picture.
        }
    }

    /** The active page at reading size. */
    suspend fun refreshPreview(pageId: String) {
        val w = work ?: return
        val p = w.page(pageId)
        if (w.fresh || p == null) return
        try {
            delay(250)
            val r = engine.run(p.doc, smallPhotos(), w.fields, mapOf("px" to 760, "quality" to 0.85))
            decodeSmall(r)?.let { previews[pageId] = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The page keeps its last picture.
        }
    }

    // MARK: Starting, opening, closing

    private fun begin(w: DesignWork, draft: String?, map: Map<String, ByteArray>) {
        token = java.util.UUID.randomUUID().toString()
        draftID = draft ?: ("design-" + java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString(Random.nextLong(0, 46_656), 36))
        createdAt = System.currentTimeMillis()
        Prefs.putString(currentKey, draftID)
        thumbs.clear(); previews.clear()
        photoUndo = emptyList(); photoCheck = null; candidate = null; aiBusy = null
        putPhotos(map)
        work = w
        serial += 1
        scheduleDraft()
    }

    /** A new design: the first size is the master. It is laid out once, here, with the photograph in. */
    suspend fun start(req: DesignStartRequest): Boolean {
        starting = true
        try {
            val map = LinkedHashMap<String, ByteArray>()
            req.photo?.let { p ->
                val raw = p.load()
                val jpeg = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(raw) } ?: throw ErpApi.Failure(0, "That photograph could not be read.")
                map["photo"] = jpeg
            }
            val fields = LinkedHashMap(req.photo?.fields ?: emptyMap())
            for ((k, v) in req.fields) if (v.isNotEmpty()) fields[k] = v
            marked = req.photo?.marked ?: false
            composeNow = req.compose
            val w = DesignWork.new(req.kind, req.sizes, fields = fields, source = req.photo?.source ?: emptyMap(), copy = req.copy, template = req.template)
            begin(w, null, map)
            layOutFresh()
            return work != null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t start. " + (e.message ?: "")
            return false
        } finally {
            starting = false
        }
    }

    /** The first layout of a fresh design, on every page. */
    private suspend fun layOutFresh() {
        val w = work ?: return
        if (!w.fresh) return
        val mine = token
        try {
            val docs = LinkedHashMap<String, MarketingValue>()
            for (p in w.pages) {
                val compose = composeNow
                docs[p.id] = if (compose != null) compose(p) else layOut(p, w.template, w.fields)
            }
            composeNow = null
            var cur = work ?: return
            if (mine != token || !cur.fresh) return
            cur = cur.copy(pages = cur.pages.map { p -> docs[p.id]?.let { p.copy(doc = it) } ?: p }, fresh = false)
            work = cur
            tick += 1
            changed()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (mine != token) return
            // A design that cannot be laid out would wait forever: back to the start screen, with the reason.
            work = null
            token = java.util.UUID.randomUUID().toString()
            error = "Couldn’t lay the design out. " + (e.message ?: "")
        }
    }

    /** A saved design (or a legacy saved ad), with each page's layout and its photographs. */
    suspend fun open(record: DesignRecord): Boolean {
        starting = true
        try {
            val o = DesignRecords.open(record)
            marked = false
            begin(o.work, null, o.photos)
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t open it. " + (e.message ?: "")
            return false
        } finally {
            starting = false
        }
    }

    /** A draft of this screen's own. */
    suspend fun openDraft(id: String): Boolean {
        starting = true
        try {
            val d = withContext(Dispatchers.IO) { disk?.draft(id) }
            if (d == null) { error = "That draft isn’t here any more."; return false }
            val map = withContext(Dispatchers.IO) { disk?.photos(id) ?: emptyMap() }
            marked = false
            begin(d.work, id, map)
            createdAt = d.created
            photosChanged = false
            return true
        } finally {
            starting = false
        }
    }

    /** An earlier Post a piece draft, opened as a design. The old draft goes once this one is kept in its place. */
    fun openOld(old: PostDraft): Boolean {
        val c = DesignOldDraft.convert(old)
        if (c == null) {
            error = "That Post a piece draft has no story or square to open. Open it in Post a piece."
            return false
        }
        marked = false
        begin(c.work, null, c.photos)
        pendingOld = old.id
        say("Opened as a design", "Your words, photographs and both pictures came with it.")
        return true
    }

    /** The design left open on this phone comes back (never over one already open). */
    suspend fun resume() {
        if (work != null) return
        val id = Prefs.string(currentKey) ?: return
        if (withContext(Dispatchers.IO) { disk?.draft(id) } != null) openDraft(id)
    }

    /** Back to the start screen. The draft stays on the phone ("Where you left off"). */
    suspend fun close() {
        flush()
        autosave?.cancel()
        token = java.util.UUID.randomUUID().toString()
        work = null; putPhotos(emptyMap()); thumbs.clear(); previews.clear()
        draftID = null
        Prefs.remove(currentKey)
    }

    /** The draft goes once the design is sent on (as the web's `finish`). */
    fun finish() {
        draftID?.let { id -> scope.launch(Dispatchers.IO) { disk?.remove(id) } }
        Prefs.remove(currentKey)
    }

    // MARK: The device draft

    /** Called on every change: the draft is written 1.5 s after the last one. */
    private fun changed() {
        serial += 1
        scheduleDraft()
    }

    private fun scheduleDraft() {
        autosave?.cancel()
        autosave = scope.launch {
            delay(1500)
            flush()
        }
    }

    /** Write the draft now. */
    suspend fun flush() {
        val w = work ?: return
        val id = draftID ?: return
        if (w.fresh) return
        val store = disk ?: return
        val thumbSource = photos["photo"]
        val withPhotos = if (photosChanged) photos else null
        try {
            withContext(Dispatchers.IO) {
                val thumb = thumbSource?.let { d -> MarketingPhotos.decode(d, 160)?.let { MarketingPhotos.jpeg(it, 160, 60) } }
                store.save(DesignDraft(id, createdAt, System.currentTimeMillis(), w.displayName, thumb, w), withPhotos)
                pendingOld?.let { old -> pendingOld = null; olderDisk?.remove(old) }
            }
            photosChanged = false
            draftSaved = System.currentTimeMillis()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Storage full or protected: the design is still on screen.
        }
    }

    // MARK: Changes

    private fun mutate(change: (DesignWork) -> DesignWork) {
        val w = work ?: return
        work = change(w)
        changed()
    }

    fun editDoc(pageId: String, doc: MarketingValue) = mutate { it.editDoc(pageId, doc) }
    fun setDoc(pageId: String, doc: MarketingValue) = mutate { it.setDoc(pageId, doc) }
    fun redoFromMaster(pageId: String, doc: MarketingValue) = mutate { it.redoFromMaster(pageId, doc) }
    fun addPages(pages: List<NewDesignPage>) = mutate { it.addPages(pages) }
    fun removePage(id: String) { mutate { it.removePage(id) }; thumbs.remove(id); previews.remove(id) }
    fun setMaster(id: String) = mutate { it.setMaster(id) }
    fun setActive(id: String) { work?.let { work = it.setActive(id) } }
    fun rename(name: String) = mutate { it.copy(name = name.take(120), dirty = true) }
    fun setField(key: String, value: String) { mutate { it.copy(fields = it.fields + (key to value), dirty = true) }; tick += 1 }
    fun setCopy(key: String, value: String) = mutate { it.copy(copy = it.copy + (key to value), dirty = true) }
    fun refile(folder: String?) = mutate { it.copy(folder = folder, dirty = true) }

    /** Lay the active page out again with a template (the web's Layout list); it becomes the person's own if it is not the master. */
    suspend fun applyTemplate(id: String) {
        val w = work ?: return
        if (w.fresh) return
        val page = w.activePage
        try {
            editDoc(page.id, layOut(page, id, w.fields))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t change the layout. " + (e.message ?: "")
        }
    }

    /** The layer editor opened on a page: if it is closed without a change (Cancel), the page is as it was. */
    fun beginEditing(pageId: String) { work?.let { editSnapshot = pageId to it } }

    fun endEditing() {
        val snap = editSnapshot
        editSnapshot = null
        val w = work
        if (snap == null || w == null) return
        val i = w.pages.indexOfFirst { it.id == snap.first }
        val j = snap.second.pages.indexOfFirst { it.id == snap.first }
        if (i < 0 || j < 0 || w.pages[i].doc != snap.second.pages[j].doc) return
        val pages = w.pages.toMutableList()
        pages[i] = pages[i].copy(origin = snap.second.pages[j].origin, rev = snap.second.pages[j].rev)
        work = w.copy(pages = pages, stale = snap.second.stale, dirty = snap.second.dirty)
    }

    /** A photograph the person chose in place of the picture. The pages keep their layouts and show the new one. */
    suspend fun replacePhoto(data: ByteArray, label: String? = null, fields: Map<String, String> = emptyMap(), source: Map<String, String> = emptyMap(), isMarked: Boolean = false) {
        val jpeg = jpegOf(data)
        if (jpeg == null) { error = "That photograph could not be read."; return }
        putPhotos(photos + ("photo" to jpeg))
        marked = isMarked
        mutate { w ->
            val f = LinkedHashMap(w.fields)
            for ((k, v) in fields) if (v.isNotEmpty() && (f[k] ?: "").isEmpty()) f[k] = v
            w.copy(fields = f, source = w.source + source, dirty = true)
        }
    }

    // MARK: Pictures (the AI tools, further photographs)

    /** A further photograph under its own id (an extended copy a resized page uses, another angle of the piece). */
    suspend fun addPhoto(id: String, data: ByteArray) {
        if (!DesignRecords.idOK(id)) return
        val jpeg = jpegOf(data) ?: return
        putPhotos(photos + (id to jpeg))
        mutate { it.copy(dirty = true) }
    }

    fun removePhoto(id: String) {
        if (id == "photo") return
        putPhotos(photos - id)
        mutate { it.copy(dirty = true) }
    }

    /** Other angles of the piece ("More photos of this piece"): they go out as squares of their own. */
    val moreIds: List<String> get() = photos.keys.filter { it.startsWith("more-") }.sorted()

    suspend fun addMore(data: ByteArray) {
        if (moreIds.size >= 8) { error = "A piece takes up to 8 more photographs."; return }
        addPhoto("more-" + java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString(Random.nextLong(0, 1296), 36), data)
    }

    /** An AI picture in the photograph's place. The one before it is kept, one step back at a time. */
    suspend fun takeAIPhoto(data: ByteArray, check: MarketingValue?, clean: Boolean) {
        val jpeg = jpegOf(data)
        if (jpeg == null) { error = "The AI’s picture could not be read."; return }
        photos["photo"]?.let { old -> photoUndo = (photoUndo + DesignPhotoStep(old, marked, photoCheck)).takeLast(5) }
        putPhotos(photos + ("photo" to jpeg))
        if (clean) marked = false
        photoCheck = check
        mutate { it.copy(dirty = true) }
    }

    val canUndoPhoto: Boolean get() = photoUndo.isNotEmpty()

    fun undoPhoto() {
        val last = photoUndo.lastOrNull() ?: return
        photoUndo = photoUndo.dropLast(1)
        putPhotos(photos + ("photo" to last.data))
        marked = last.marked
        photoCheck = last.check
        mutate { it.copy(dirty = true) }
    }

    // MARK: Pages made for a shape (the resize engine, for Publish's "Make 1:1 from this" and "Re-do from the master")

    /** The master's design on another shape (workspace.tsx `resizedTo`): one engine call, no AI. */
    suspend fun resizedDoc(w: Double, h: Double): MarketingValue {
        val cur = work ?: throw ErpApi.Failure(0, "No design is open.")
        val options = LinkedHashMap<String, Any?>()
        options["action"] = "resize"
        options["targets"] = listOf(mapOf("w" to w, "h" to h))
        options["photoMarked"] = marked
        val subject = cur.masterPage.doc["meta"]["subject"]
        if (!subject.isNull) options["subject"] = subject.any
        val r = engine.run(cur.masterPage.doc, smallPhotos(), cur.fields, options)
        val doc = r["results"].array.firstOrNull()?.get("doc") ?: MarketingValue.NULL
        if (doc.isNull) throw ErpApi.Failure(0, "That didn’t resize.")
        return doc
    }

    /** The website's own page is the catalogue's photograph (the weight stamped, the mark), not a poster. */
    suspend fun catalogueDoc(w: Double, h: Double): MarketingValue {
        val cur = work ?: throw ErpApi.Failure(0, "No design is open.")
        val r = engine.run(DesignWork.blankDoc(w, h), photos, cur.fields, mapOf("action" to "square", "value" to "catalogue"))
        return r["doc"]
    }

    /**
     * A page of a destination's shape that the design hasn't got ("Make 1:1 from this"). WhatsApp's square and the website's are the
     * same shape but not the same picture: each has a page of its own.
     */
    suspend fun makeSize(presetId: String) {
        val cur = work ?: return
        val p = DesignSizes.size(presetId) ?: return
        val same: (DesignPageState) -> Boolean = { x ->
            if (presetId == "website" || presetId == "whatsapp") x.label == p.label else x.w == p.w && x.h == p.h && x.format == p.format
        }
        if (cur.pages.any(same)) return
        try {
            val doc = if (presetId == "website") catalogueDoc(p.w, p.h) else resizedDoc(p.w, p.h)
            val latest = work ?: return
            if (latest.pages.any(same)) return
            addPages(listOf(NewDesignPage(null, p.label, p.format, p.w, p.h, doc, if (presetId == "website") "manual" else "resized", null)))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t make that size. " + (e.message ?: "")
        }
    }

    /** "Re-do from the master" on a resized page that is behind it. */
    suspend fun redoPage(pageId: String) {
        val cur = work ?: return
        val page = cur.page(pageId) ?: return
        try {
            val doc = if (DesignSizes.isCatalogue(page.label)) catalogueDoc(page.w, page.h) else resizedDoc(page.w, page.h)
            redoFromMaster(pageId, doc)
            say("Done again from the master", page.label)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t do it again. " + (e.message ?: "")
        }
    }

    // MARK: Save to the shop

    /** What a save posts: the design drawn and packed, the upload not yet made. */
    private class SaveParts(val meta: MarketingValue, val id: String?, val docs: Map<String, ByteArray>, val images: Map<String, ByteArray>, val files: Map<String, ByteArray>)

    private suspend fun drawSave(w: DesignWork): SaveParts {
        val tiny = engine.run(w.masterPage.doc, smallPhotos(), w.fields, mapOf("px" to 200, "quality" to 0.7))
        val thumb = "data:image/jpeg;base64," + tiny.s("image")
        val docs = LinkedHashMap<String, ByteArray>()
        val images = LinkedHashMap<String, ByteArray>()
        for (p in w.pages) {
            docs[p.id] = p.doc.text.toByteArray(Charsets.UTF_8)
            images[p.id] = render(p.id, minOf(2160.0, maxOf(p.w, 1080.0)).toInt())
        }
        // The photograph it is drawn on, at most 2048 px; the others only when a page uses them.
        val files = LinkedHashMap<String, ByteArray>()
        withContext(Dispatchers.Default) {
            for ((id, data) in photos) {
                if (id == "photo" || w.pages.any { DesignRecords.docUses(it.doc, id) }) {
                    val bitmap = MarketingPhotos.decode(data, 2048) ?: continue
                    MarketingPhotos.jpeg(bitmap, 2048, 90)?.let { files[id] = it }
                }
            }
        }
        return SaveParts(w.meta(thumb), w.id, docs, images, files)
    }

    private fun kept(record: DesignRecord, before: Int) {
        work?.let { cur ->
            work = cur.copy(id = record.id, folder = record.folder, dirty = serial != before)
            changed()
        }
    }

    /** Save and wait: the same parts the web posts (DesignRecords.save). Returns the record, or null with `error` set. Publish needs the record. */
    suspend fun saveToShop(): DesignRecord? {
        val w = work ?: return null
        if (w.fresh) return null
        saving = true
        val before = serial
        try {
            val p = drawSave(w)
            val record = DesignRecords.save(p.meta, p.id, p.docs, p.images, p.files)
            kept(record, before)
            say("Saved", "On the Saved shelf.")
            return record
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Couldn’t save it. " + (e.message ?: "")
            return null
        } finally {
            saving = false
        }
    }

    /**
     * The Save button: the design is drawn here, the upload goes through the Outbox and the editor is free at once. A second Save
     * while one is on its way waits for it (a first save would otherwise make two records).
     */
    suspend fun saveInBackground() {
        val w = work ?: return
        if (w.fresh || uploading) return
        saving = true
        val before = serial
        val parts = try {
            drawSave(w)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            saving = false
            error = "Couldn’t save it. " + (e.message ?: "")
            return
        }
        saving = false
        uploading = true
        say("Saving…", "It goes on in the background.")
        Outbox.post("Save “${w.displayName}”") {
            uploading = true
            try {
                val record = DesignRecords.save(parts.meta, parts.id ?: work?.id, parts.docs, parts.images, parts.files)
                kept(record, before)
                "Saved to the Saved shelf"
            } finally {
                uploading = false
            }
        }
    }

    /** Note a send on the saved design (PATCH { published }), as the web's Publish sheet does. */
    suspend fun recordPublish(dest: String, ok: Boolean = true, ref: String? = null) {
        val id = work?.id ?: return
        val published = linkedMapOf<String, Any?>("dest" to dest, "ok" to ok)
        if (ref != null) published["ref"] = ref
        runCatching { ErpApi.shared.send(DesignRecords.base(id), "PATCH", mapOf("published" to published)) }
    }
}
