package erp.app.screens.design

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import erp.app.ErpApp
import erp.app.config.House
import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.PostDraft
import erp.app.screens.marketing.PostDraftDisk
import java.io.File

/**
 * A design in progress, kept on this phone (the web keeps it in IndexedDB `taheri-post-drafts`; DesignDrafts.swift). Same way as the
 * Post a piece drafts (PostDraftDisk): atomic files in the app's private folder, one folder per house and signed-in person, 30 days.
 * The photographs go in files beside the JSON, written only when they changed, so the 1.5-second autosave of a design's words
 * never rewrites megabytes.
 */
class DesignDraft(
    val id: String,
    val created: Long,
    val updated: Long,
    val title: String,
    val thumb: ByteArray?,
    val work: DesignWork,
)

class DesignDraftDisk(private val folder: File, private val now: () -> Long = System::currentTimeMillis) {
    private fun photosDir(id: String) = File(folder, "$id.photos")

    private fun write(file: File, bytes: ByteArray) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    fun list(): List<DesignDraft> {
        folder.mkdirs()
        val out = ArrayList<DesignDraft>()
        for (f in folder.listFiles { x -> x.extension == "json" }.orEmpty()) {
            val d = read(f) ?: continue
            if (now() - d.updated > KEEP_DAYS * DAY) remove(d.id) else out.add(d)
        }
        return out.sortedByDescending { it.updated }
    }

    /** [photos] null leaves the photographs on the disk as they were. */
    fun save(draft: DesignDraft, photos: Map<String, ByteArray>?) {
        folder.mkdirs()
        if (photos != null) {
            val keep = HashSet<String>()
            for ((k, v) in photos) { write(File(photosDir(draft.id), "$k.jpg"), v); keep += "$k.jpg" }
            photosDir(draft.id).listFiles()?.forEach { if (it.name !in keep) it.delete() }
        }
        draft.thumb?.let { write(File(folder, draft.id + ".thumb"), it) }
        val meta = MarketingValue.of(mapOf("id" to draft.id, "created" to draft.created, "updated" to draft.updated, "title" to draft.title, "work" to draft.work.toValue()))
        write(File(folder, draft.id + ".json"), meta.text.toByteArray(Charsets.UTF_8))
    }

    fun photos(id: String): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        for (f in photosDir(id).listFiles().orEmpty()) if (f.extension == "jpg") out[f.nameWithoutExtension] = f.readBytes()
        return out
    }

    fun draft(id: String): DesignDraft? = read(File(folder, "$id.json"))

    private fun read(file: File): DesignDraft? = try {
        if (!file.exists()) null
        else {
            val m = MarketingValue.parse(file.readText(Charsets.UTF_8))
            val work = DesignWork.fromValue(m["work"])
            val id = m.s("id")
            if (work == null || id.isEmpty()) null
            else DesignDraft(id, m.n("created").toLong(), m.n("updated").toLong(), m.s("title"), File(folder, "$id.thumb").takeIf { it.exists() }?.readBytes(), work)
        }
    } catch (e: Exception) {
        null
    }

    fun remove(id: String) {
        File(folder, "$id.json").delete()
        File(folder, "$id.thumb").delete()
        photosDir(id).deleteRecursively()
    }

    companion object {
        const val KEEP_DAYS = 30L
        private const val DAY = 86_400_000L

        /** The same scope the Post a piece drafts use (PostComposer's draftsFolder): per house and per account. */
        fun scope(): String = when {
            House.isDemo -> "demo"
            ErpApp.firebaseReady -> FirebaseAuth.getInstance().currentUser?.uid ?: "signed-out"
            else -> "signed-out"
        }

        fun folder(context: Context): File = File(context.filesDir, "DesignDrafts-${House.id}-${scope()}")

        /** Where the earlier Post a piece drafts of this person are. */
        fun oldFolder(context: Context): File = File(context.filesDir, "PostDrafts-${House.id}-${scope()}")

        fun current(context: Context) = DesignDraftDisk(folder(context))

        fun older(context: Context) = PostDraftDisk(oldFolder(context))
    }
}

/**
 * An earlier Post a piece draft as a design (old-draft.ts, for the phone's `PostDraft`): the story becomes the master page and the
 * square the WhatsApp page, the lead photograph the design's own and the others its further photographs, the words and the caption
 * carry. A painted or lettered picture is not carried: the layout is.
 */
object DesignOldDraft {
    class Converted(val work: DesignWork, val photos: Map<String, ByteArray>)

    /** The draft's lead photograph: the story's background, else the first. */
    fun hero(d: PostDraft) = d.photos.firstOrNull { it.id == d.story["bg"].s("photoId") } ?: d.photos.firstOrNull()

    fun convert(d: PostDraft): Converted? {
        val formats = d.words.s("formats")
        val story = formats != "square"
        val square = formats != "story"
        val storyHas = d.story["layers"].array.isNotEmpty()
        val squareHas = d.square["layers"].array.isNotEmpty()
        if (!((story && storyHas) || (square && squareHas))) return null
        val lead = hero(d)

        // The lead photograph is the design's "photo"; a document that named it by its own id now names it by that.
        fun remap(doc: MarketingValue): MarketingValue {
            if (lead == null) return doc
            var out = doc
            if (out["bg"].s("photoId") == lead.id) out = out.withPath(listOf("bg", "photoId"), MarketingValue.string("photo"))
            out = out.with(
                "layers",
                MarketingValue.array(
                    out["layers"].array.map { l ->
                        if (l.s("kind") == "image" && l["src"].isNull && l.s("photoId") == lead.id) l.with("photoId", MarketingValue.string("photo")) else l
                    },
                ),
            )
            if (!out["placements"].isNull && !out["placements"][lead.id].isNull) {
                val p = LinkedHashMap(out["placements"].obj)
                p["photo"] = p.remove(lead.id)!!
                out = out.with("placements", MarketingValue.of(p))
            }
            return out
        }

        val pages = ArrayList<DesignPageState>()
        if (story) {
            val z = DesignSizes.size("story")!!
            pages.add(DesignPageState("p1", z.label, z.format, z.w, d.story["frame"].n("h", z.h), "master", null, 0, remap(d.story)))
        }
        if (square) {
            val z = DesignSizes.whatsapp
            pages.add(DesignPageState(DesignWork.nextPageId(pages), z.label, z.format, z.w, z.h, if (pages.isEmpty()) "master" else "manual", null, 0, remap(d.square)))
        }
        if (pages.isEmpty()) return null

        val weightText = d.words.s("weight").trim().replace("g", "", ignoreCase = true)
        val weight = if ((weightText.toDoubleOrNull() ?: 0.0) > 0) weightText + "g" + (if (d.words["weightEach"].bool) " each" else "") else ""
        val fields = LinkedHashMap(DesignWork.emptyFields())
        fields["headline"] = d.words.s("headline")
        fields["kicker"] = d.words.s("kicker")
        fields["weight"] = weight
        fields["details"] = listOf(d.words.s("metal"), d.words.s("stones")).filter { it.isNotEmpty() }.joinToString(" | ")
        val copy = LinkedHashMap<String, String>()
        if (d.words.s("caption").isNotEmpty()) copy["wa"] = d.words.s("caption")

        val photos = LinkedHashMap<String, ByteArray>()
        for (p in d.photos) {
            if (p.id == lead?.id) photos["photo"] = p.data
            else if (DesignRecords.idOK(p.id)) photos[p.id] = p.data
        }
        var work = DesignWork(
            id = null, name = d.words.s("headline"), folder = null, kind = "piece", scope = "shop", source = emptyMap(), fields = fields, copy = copy,
            pages = pages, master = pages[0].id, active = pages[0].id, stale = emptyList(), fresh = false, dirty = true, template = "headline",
        )
        lead?.source?.s("id")?.takeIf { it.isNotEmpty() }?.let { work = work.copy(source = work.source + ("siteId" to it)) }
        return Converted(work, photos)
    }
}
