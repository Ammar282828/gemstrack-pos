package erp.app.screens.marketing

import java.io.File
import java.util.UUID

/** One photograph of a piece, with where it goes and where it came from (NativePostPhoto). */
class PostPhoto(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val data: ByteArray,
    val toSite: Boolean = true,
    val toWhatsApp: Boolean = true,
    /** The photo an AI version was made from. */
    val parent: String? = null,
    /** The AI's same-piece check, kept raw. */
    val check: MarketingValue? = null,
    /** The website piece it came from: id, name, url, marked. */
    val source: MarketingValue? = null,
) {
    fun copy(
        name: String = this.name, data: ByteArray = this.data, toSite: Boolean = this.toSite, toWhatsApp: Boolean = this.toWhatsApp,
        parent: String? = this.parent, check: MarketingValue? = this.check, source: MarketingValue? = this.source,
    ) = PostPhoto(id, name, data, toSite, toWhatsApp, parent, check, source)

    // The bytes are compared by identity (they are never changed in place), so a draft compares in a blink.
    override fun equals(other: Any?): Boolean =
        other is PostPhoto && id == other.id && name == other.name && data === other.data && toSite == other.toSite && toWhatsApp == other.toWhatsApp &&
            parent == other.parent && check == other.check && source == other.source

    override fun hashCode(): Int = id.hashCode()
}

/** A piece being made: photos, words, the two designs and what the AI painted (NativePostDraft). */
class PostDraft(
    val id: String = UUID.randomUUID().toString(),
    val updated: Long = System.currentTimeMillis(),
    val photos: List<PostPhoto> = emptyList(),
    val words: MarketingValue = defaultWords,
    val story: MarketingValue = NativeArtwork.blank(),
    val square: MarketingValue = NativeArtwork.blank(height = 1080.0),
    val paintedStory: ByteArray? = null,
    val paintedSquare: ByteArray? = null,
    val paintedStoryFor: String? = null,
    val paintedSquareFor: String? = null,
    val letteringCheck: MarketingValue? = null,
    val queuedID: String? = null,
    val queueReady: Boolean? = null,
) {
    val title: String get() = words.s("headline").ifEmpty { "Untitled piece" }

    fun copy(
        updated: Long = this.updated, photos: List<PostPhoto> = this.photos, words: MarketingValue = this.words, story: MarketingValue = this.story,
        square: MarketingValue = this.square, paintedStory: ByteArray? = this.paintedStory, paintedSquare: ByteArray? = this.paintedSquare,
        paintedStoryFor: String? = this.paintedStoryFor, paintedSquareFor: String? = this.paintedSquareFor, letteringCheck: MarketingValue? = this.letteringCheck,
        queuedID: String? = this.queuedID, queueReady: Boolean? = this.queueReady,
    ) = PostDraft(id, updated, photos, words, story, square, paintedStory, paintedSquare, paintedStoryFor, paintedSquareFor, letteringCheck, queuedID, queueReady)

    /** A word set, as `draft.words[key] = value` does. */
    fun word(key: String, value: Any?) = copy(words = words.with(key, value))

    override fun equals(other: Any?): Boolean =
        other is PostDraft && id == other.id && updated == other.updated && photos == other.photos && words == other.words && story == other.story &&
            square == other.square && paintedStory === other.paintedStory && paintedSquare === other.paintedSquare && paintedStoryFor == other.paintedStoryFor &&
            paintedSquareFor == other.paintedSquareFor && letteringCheck == other.letteringCheck && queuedID == other.queuedID && queueReady == other.queueReady

    override fun hashCode(): Int = id.hashCode() * 31 + updated.hashCode()

    companion object {
        /** The words of a new piece, key for key. */
        val defaultWords: MarketingValue = MarketingValue.of(
            mapOf(
                "headline" to "", "kicker" to "", "weight" to "", "weightEach" to false, "metal" to "", "stones" to "", "hook" to "", "caption" to "",
                "captionEdited" to false, "formats" to "both", "folder" to "", "siteName" to "", "maisonHouse" to "", "toWebsite" to false,
                "toWhatsApp" to false, "toInstagram" to false, "waTargets" to emptyList<Any>(), "feature" to false, "storyOut" to false,
            ),
        )
    }
}

/**
 * Drafts kept on the device: one JSON file per draft with its photos, and the painted pictures, beside it in a folder of
 * its own, each written whole and moved into place (a draft is never half there). A draft untouched for 30 days is
 * dropped. Photos are in files, not in the JSON, so a draft of twelve photos opens without reading them all into text.
 */
class PostDraftDisk(private val folder: File, private val now: () -> Long = System::currentTimeMillis) {
    companion object {
        const val KEEP_DAYS = 30L
        private const val DAY = 86_400_000L
    }

    private fun dir(id: String) = File(folder, id)

    private fun write(file: File, bytes: ByteArray) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    fun save(draft: PostDraft) {
        folder.mkdirs()
        val photoFiles = HashSet<String>()
        for (p in draft.photos) { write(File(dir(draft.id), "${p.id}.photo"), p.data); photoFiles += "${p.id}.photo" }
        draft.paintedStory?.let { write(File(dir(draft.id), "painted-story.jpg"), it); photoFiles += "painted-story.jpg" }
        draft.paintedSquare?.let { write(File(dir(draft.id), "painted-square.jpg"), it); photoFiles += "painted-square.jpg" }
        // What the draft no longer holds (a removed photo, a painted picture given up) goes from the disk too.
        dir(draft.id).listFiles()?.forEach { if (it.name !in photoFiles) it.delete() }
        val meta = MarketingValue.of(
            mapOf(
                "id" to draft.id, "updated" to draft.updated, "words" to draft.words, "story" to draft.story, "square" to draft.square,
                "photos" to draft.photos.map { p ->
                    mapOf("id" to p.id, "name" to p.name, "toSite" to p.toSite, "toWhatsApp" to p.toWhatsApp, "parent" to p.parent, "check" to p.check, "source" to p.source)
                },
                "paintedStoryFor" to draft.paintedStoryFor, "paintedSquareFor" to draft.paintedSquareFor, "letteringCheck" to draft.letteringCheck,
                "queuedID" to draft.queuedID, "queueReady" to draft.queueReady,
            ),
        )
        write(File(folder, draft.id + ".json"), meta.text.toByteArray(Charsets.UTF_8))
    }

    fun list(): List<PostDraft> {
        folder.mkdirs()
        val out = ArrayList<PostDraft>()
        for (f in folder.listFiles { x -> x.extension == "json" }.orEmpty()) {
            val draft = read(f) ?: continue
            if (now() - draft.updated > KEEP_DAYS * DAY) remove(draft.id) else out.add(draft)
        }
        return out.sortedByDescending { it.updated }
    }

    private fun read(file: File): PostDraft? = try {
        val m = MarketingValue.parse(file.readText(Charsets.UTF_8))
        val id = m.s("id")
        if (id.isEmpty()) null
        else {
            val photos = m["photos"].array.mapNotNull { p ->
                val bytes = File(dir(id), "${p.s("id")}.photo").takeIf { it.exists() }?.readBytes() ?: return@mapNotNull null
                PostPhoto(
                    id = p.s("id"), name = p.s("name"), data = bytes, toSite = if (p["toSite"].isNull) true else p["toSite"].bool,
                    toWhatsApp = if (p["toWhatsApp"].isNull) true else p["toWhatsApp"].bool, parent = p.s("parent").ifEmpty { null },
                    check = p["check"].takeUnless { it.isNull }, source = p["source"].takeUnless { it.isNull },
                )
            }
            PostDraft(
                id = id, updated = m.n("updated").toLong(), photos = photos,
                words = if (m["words"].isNull) PostDraft.defaultWords else m["words"],
                story = if (m["story"].isNull) NativeArtwork.blank() else m["story"],
                square = if (m["square"].isNull) NativeArtwork.blank(height = 1080.0) else m["square"],
                paintedStory = File(dir(id), "painted-story.jpg").takeIf { it.exists() }?.readBytes(),
                paintedSquare = File(dir(id), "painted-square.jpg").takeIf { it.exists() }?.readBytes(),
                paintedStoryFor = m.s("paintedStoryFor").ifEmpty { null }, paintedSquareFor = m.s("paintedSquareFor").ifEmpty { null },
                letteringCheck = m["letteringCheck"].takeUnless { it.isNull }, queuedID = m.s("queuedID").ifEmpty { null },
                queueReady = if (m["queueReady"].isNull) null else m["queueReady"].bool,
            )
        }
    } catch (e: Exception) {
        null
    }

    fun remove(id: String) {
        File(folder, "$id.json").delete()
        dir(id).deleteRecursively()
    }
}
