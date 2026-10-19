package erp.app.screens.design

import erp.app.data.ErpApi
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue

/**
 * The Saved API, exactly as the web client calls it (src/app/design/{use-design,saved-shelf}.ts, src/app/api/design/designs)
 * and as DesignRecords.swift does:
 *
 *   GET    /api/design/designs                       → { folders: [{id,name,at}], items: [DesignRecord] }; the owner's and marketing's
 *                                                      list adds ads-scope designs and the legacy `ad_saved` rows (id `saved:<id>`)
 *   GET    /api/design/designs/<id>?key=doc:<page>   → that page's layout JSON ('image:<page>' the finished JPEG, 'photo:<id>' a photograph)
 *   POST   /api/design/designs  (multipart)          → `meta` (JSON), [`id`], and the files 'doc:<page>', 'image:<page>', 'photo:<id>'
 *   PATCH  /api/design/designs/<id>  { folder?, name? }  (and { published } after a send)
 *   DELETE /api/design/designs/<id>                  (the web asks "Delete “name”?" and sends no code; the phone asks the same)
 *   POST   /api/design/designs/folders { name } · PATCH { id, name } · DELETE ?id=
 *
 * An id with a colon (`saved:abc`) travels escaped, as `encodeURIComponent` does.
 */
object DesignRecords {
    class Opened(val work: DesignWork, val photos: Map<String, ByteArray>)

    /** lib/design/model.ts ID_OK: `^[\w-]{1,40}$`. */
    fun idOK(s: String): Boolean =
        s.length in 1..40 && s.all { it in '0'..'9' || it in 'A'..'Z' || it in 'a'..'z' || it == '_' || it == '-' }

    fun base(id: String): String = "/api/design/designs/" + MarketingKit.escape(id)

    class Listing(val folders: List<DesignFolder>, val items: List<DesignRecord>)

    suspend fun list(): Listing {
        val answer = MarketingRequest.get("/api/design/designs")
        return Listing(answer["folders"].array.map { DesignFolder(it) }, answer["items"].array.map { DesignRecord(it) })
    }

    /** One file of a design: a page's layout, its finished picture, or a photograph. */
    suspend fun file(id: String, key: String): ByteArray = ErpApi.shared.bytes(base(id) + "?key=" + MarketingKit.escape(key))

    /** use-design.ts openRecord: each page's layout, the photograph ('photo:photo'; a legacy ad's is 'photo:main'), and the further photographs the layouts use. */
    suspend fun open(r: DesignRecord): Opened {
        val docs = LinkedHashMap<String, MarketingValue>()
        for (p in r.pages) {
            val data = try {
                file(r.id, "doc:" + p.id)
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                throw e
            } catch (e: Exception) {
                throw ErpApi.Failure(0, "This design has no layout saved to open again.")
            }
            docs[p.id] = MarketingValue.parse(String(data, Charsets.UTF_8))
        }
        val photos = LinkedHashMap<String, ByteArray>()
        runCatching { file(r.id, "photo:photo") }.getOrNull()?.let { photos["photo"] = it }
            ?: runCatching { file(r.id, "photo:main") }.getOrNull()?.let { photos["photo"] = it }
        for (id in otherPhotoIds(docs.values.toList())) runCatching { file(r.id, "photo:$id") }.getOrNull()?.let { photos[id] = it }
        val work = DesignWork.from(r, docs) ?: throw ErpApi.Failure(0, "This design can’t be opened.")
        return Opened(work, photos)
    }

    /** The photographs these documents use besides the main one (use-design.ts otherPhotoIds). */
    fun otherPhotoIds(docs: List<MarketingValue>): List<String> {
        val ids = HashSet<String>()
        for (d in docs) {
            val bg = d["bg"].s("photoId")
            if (bg.isNotEmpty()) ids.add(bg)
            for (l in d["layers"].array) if (l.s("kind") == "image" && l["src"].isNull) ids.add(l.s("photoId"))
        }
        ids.remove("photo")
        return ids.filter { idOK(it) }.sorted()
    }

    /** Whether a document draws the photograph with this id (use-design.ts docUses). */
    fun docUses(d: MarketingValue, id: String): Boolean =
        d["bg"].s("photoId") == id || d["layers"].array.any { it.s("kind") == "image" && it["src"].isNull && it.s("photoId") == id }

    /** A save: the same parts the web posts. `images` and `docs` are keyed by page id, `photos` by photograph id. */
    suspend fun save(meta: MarketingValue, id: String?, docs: Map<String, ByteArray>, images: Map<String, ByteArray>, photos: Map<String, ByteArray>): DesignRecord {
        val fields = ArrayList<Pair<String, String>>()
        fields.add("meta" to meta.text)
        if (!id.isNullOrEmpty()) fields.add("id" to id)
        val files = ArrayList<ErpApi.FormFile>()
        for (key in docs.keys.sorted()) files.add(ErpApi.FormFile("doc:$key", "doc.json", "application/json", docs.getValue(key)))
        for (key in images.keys.sorted()) files.add(ErpApi.FormFile("image:$key", "page.jpg", "image/jpeg", images.getValue(key)))
        for (key in photos.keys.sorted()) files.add(ErpApi.FormFile("photo:$key", "photo.jpg", "image/jpeg", photos.getValue(key)))
        val answer = MarketingValue.parse(ErpApi.shared.upload("/api/design/designs", fields, files, timeoutMs = 240_000))
        if (answer["item"].s("id").isEmpty()) throw ErpApi.Failure(0, "The ERP kept nothing. Try Save again.")
        return DesignRecord(answer["item"])
    }

    /** File it, rename it. [folder] is set only when [moveFolder] says so (null is "unfiled"). */
    suspend fun patch(id: String, moveFolder: Boolean = false, folder: String? = null, name: String? = null) {
        val body = LinkedHashMap<String, Any?>()
        if (moveFolder) body["folder"] = folder
        if (name != null) body["name"] = name
        ErpApi.shared.send(base(id), "PATCH", body)
    }

    suspend fun delete(id: String) { ErpApi.shared.send(base(id), "DELETE") }

    suspend fun createFolder(name: String): DesignFolder = DesignFolder(MarketingRequest.send("/api/design/designs/folders", mapOf("name" to name))["folder"])

    suspend fun renameFolder(id: String, name: String) { ErpApi.shared.send("/api/design/designs/folders", "PATCH", mapOf("id" to id, "name" to name)) }

    suspend fun deleteFolder(id: String) { ErpApi.shared.data("/api/design/designs/folders?id=" + MarketingKit.escape(id), "DELETE") }
}
