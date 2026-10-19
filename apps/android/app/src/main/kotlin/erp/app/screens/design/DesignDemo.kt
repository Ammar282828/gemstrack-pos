package erp.app.screens.design

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import erp.app.config.House
import erp.app.screens.marketing.DesignEngine
import erp.app.screens.marketing.MarketingValue
import java.io.ByteArrayOutputStream

/**
 * What Design shows in the demo (made-up names and pieces, no server): a shelf of saved designs in two folders, the website's pieces,
 * the Publish sheet's destinations, and one design open in the workspace. Every picture is drawn here, with no file behind it.
 */
object DesignDemo {
    class Shelf(val items: List<DesignRecord>, val folders: List<DesignFolder>)

    /** A made-up photograph of a piece: a deep ground, a soft light and a jewel. [hue] picks the stone. */
    fun photo(width: Int = 900, height: Int = 900, hue: Int = 0): ByteArray {
        val stones = listOf(0xFFB3123A.toInt(), 0xFF1E7A5A.toInt(), 0xFF2A4FA0.toInt(), 0xFFB07A1C.toInt())
        val stone = stones[hue.mod(stones.size)]
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, 0f, height.toFloat(), 0xFF2B2420.toInt(), 0xFF0F0C0A.toInt(), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = RadialGradient(width * 0.5f, height * 0.42f, width * 0.55f, 0x66FFE9B0, 0x00FFE9B0, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
        // The ring: a gold band and a stone.
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = width * 0.045f
        paint.color = 0xFFD9AE4B.toInt()
        canvas.drawCircle(width * 0.5f, height * 0.55f, width * 0.2f, paint)
        paint.style = Paint.Style.FILL
        paint.shader = RadialGradient(width * 0.46f, height * 0.31f, width * 0.1f, 0xFFFFFFFF.toInt(), stone, Shader.TileMode.CLAMP)
        canvas.drawCircle(width * 0.5f, height * 0.33f, width * 0.085f, paint)
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
            out.toByteArray()
        }
    }

    private fun dataUrl(hue: Int): String {
        val small = photo(120, 120, hue)
        return "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(small)
    }

    private fun record(id: String, name: String, kind: String, folder: String?, pages: List<Pair<String, String>>, hue: Int, updated: String): DesignRecord {
        val files = LinkedHashMap<String, Any?>()
        for ((pid, _) in pages) files["doc:$pid"] = 1
        return DesignRecord(
            MarketingValue.of(
                mapOf(
                    "id" to id, "name" to name, "folder" to folder, "kind" to kind, "scope" to (if (kind == "ad") "ads" else "shop"), "source" to emptyMap<String, Any>(),
                    "fields" to mapOf("headline" to name), "copy" to emptyMap<String, Any>(),
                    "pages" to pages.mapIndexed { i, (pid, label) -> mapOf("id" to pid, "label" to label, "format" to "square", "frame" to mapOf("w" to 1080, "h" to 1080), "origin" to (if (i == 0) "master" else "resized"), "rev" to 1) },
                    "master" to pages[0].first, "files" to files, "thumb" to dataUrl(hue), "updated" to updated, "by" to "Demo",
                ),
            ),
        )
    }

    fun shelf(): Shelf = Shelf(
        listOf(
            record("d1", "Ruby Rani Set", "piece", "f1", listOf("p1" to "Stories & reels 9:16", "p2" to "WhatsApp 1:1"), 0, "2026-10-11T09:30:00Z"),
            record("d2", "Eid gift sets", "ad", "f2", listOf("p1" to "Feed 4:5", "p2" to "Stories & reels 9:16"), 3, "2026-10-10T15:10:00Z"),
            record("d3", "Emerald pendant", "post", null, listOf("p1" to "Feed 1:1"), 1, "2026-10-08T12:00:00Z"),
            record("d4", "Sapphire studs", "site", "f1", listOf("p1" to "Website 1:1"), 2, "2026-10-02T08:45:00Z"),
        ),
        listOf(DesignFolder("f1", "Everyday"), DesignFolder("f2", "Eid")),
    )

    fun sitePieces(): List<MarketingValue> = listOf(
        piece("Rings/R-102.webp", "Ruby Rani Ring", "Rings", 2),
        piece("Rings/R-118.webp", "Emerald Cut Ring", "Rings", 1),
        piece("Sets/S-040.webp", "Pearl Haar Set", "Sets", 0),
        piece("Earrings/E-210.webp", "Jhumka, small", "Earrings", 3),
    )

    private fun piece(id: String, name: String, collection: String, added: Int) = MarketingValue.of(
        mapOf("id" to id, "name" to name, "collection" to collection, "added" to added, "newArrival" to (added >= 2), "facts" to listOf("21K Gold")),
    )

    /** What GET /api/design/destinations answers (the Publish sheet's rows, the house's collections). */
    fun destinations(): MarketingValue {
        val mina = House.id == "mina"
        return MarketingValue.of(
            mapOf(
                "rows" to listOf(
                    mapOf("id" to "website", "label" to "Website", "available" to true),
                    mapOf("id" to "featured", "label" to "Set of the day", "available" to !mina),
                    mapOf("id" to "whatsapp", "label" to "WhatsApp groups", "available" to true, "targets" to listOf(mapOf("key" to "g1", "label" to "Customers"), mapOf("key" to "g2", "label" to "Family circle"))),
                    mapOf<String, Any?>("id" to "channel", "label" to "WhatsApp channel", "available" to !mina, "reason" to (if (mina) "This shop has no WhatsApp channel." else null), "targets" to (if (mina) emptyList() else listOf(mapOf("key" to "channel", "label" to "Channel")))),
                    mapOf("id" to "instagram-story", "label" to "Instagram story", "available" to true, "mode" to (if (mina) "share" else "api")),
                    mapOf("id" to "instagram-post", "label" to "Instagram post", "available" to true, "mode" to (if (mina) "share" else "api")),
                    mapOf("id" to "meta-ad", "label" to "Meta ad", "available" to true),
                ),
                "collections" to listOf(
                    mapOf("folder" to "Rings/Gold Rings", "category" to "Rings", "collection" to "Gold Rings"),
                    mapOf("folder" to "Sets/Bridal", "category" to "Sets", "collection" to "Bridal"),
                ),
            ),
        )
    }

    fun config(): MarketingValue = MarketingValue.of(
        mapOf("site" to (if (House.id == "mina") "https://houseofmina.store" else "https://taheri.shop"), "featured" to false, "posting" to mapOf("whatsappNumbers" to emptyList<Any>(), "links" to mapOf("waChannel" to ""))),
    )

    fun checks(): List<MarketingValue> =
        if (House.id == "mina") {
            listOf(
                MarketingValue.of(mapOf("label" to "WhatsApp", "status" to "ok", "group" to "WhatsApp", "detail" to "Connected")),
                MarketingValue.of(mapOf("label" to "Instagram share", "status" to "fail", "group" to "Instagram", "detail" to "Not connected", "fix" to "The story and post go to the phone’s share sheet.")),
            )
        } else {
            listOf(
                MarketingValue.of(mapOf("label" to "WhatsApp", "status" to "ok", "group" to "WhatsApp", "detail" to "Connected")),
                MarketingValue.of(mapOf("label" to "Instagram", "status" to "ok", "group" to "Instagram", "detail" to "Connected")),
            )
        }

    /** One design open in the workspace: a piece (story and WhatsApp square) laid out by the engine from a made-up photograph. */
    suspend fun open(workspace: DesignWorkspaceModel, @Suppress("UNUSED_PARAMETER") engine: DesignEngine) {
        val data = photo()
        val request = DesignStartRequest(
            kind = "piece", sizes = listOf(DesignSizeChoice("story"), DesignSizeChoice("whatsapp")),
            photo = DesignStartPhoto("Demo photograph", { data }),
            fields = mapOf("kicker" to "The Ruby Edit", "headline" to "Ruby Rani Set", "weight" to "21K Yellow Gold · Ruby · 45.35g", "details" to "Ask us on WhatsApp"),
        )
        workspace.loadCatalogue()
        workspace.start(request)
    }
}
