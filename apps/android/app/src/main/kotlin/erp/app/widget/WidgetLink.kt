package erp.app.widget

import androidx.compose.ui.graphics.Color
import erp.app.config.Business
import erp.app.config.parseHexColor
import erp.app.data.JsonText
import erp.core.Json

/**
 * The widget's way into one business's ERP: its address and a key of its own (/api/widget/key), with the look the widget wears
 * for it, so the widget needs nothing of the app's screens to draw Taheri in gold and House of Mina in maroon (ERPWidgetLink.Link).
 * The key reads the widget summary only (/api/widget/summary), and the ERP can forget it. One entry per business.
 */
class WidgetLinkData(
    /** The business id ("taheri", "mina", or an added business's slug). */
    val id: String,
    /** What the widget calls it ("Taheri ERP"). */
    val name: String,
    val url: String,
    val key: String,
    /** The business's colours (hex, light and dark): the look of every business, and the only one of an added business. */
    val palette: Business.Palette?,
    /** The id of the art that ships in the app ("taheri", "mina"): its wordmark. Null for an added business, which is drawn from its palette and its name. */
    val brand: String?,
) {
    /** The house's name as the faces say it. */
    val house: String get() = name

    fun encode(): String = JsonText.of(toMap()) ?: "{}"

    fun toMap(): Map<String, Any?> = buildMap {
        put("id", id)
        put("name", name)
        put("url", url)
        put("key", key)
        palette?.let { put("palette", it.toMap()) }
        brand?.let { put("brand", it) }
    }

    override fun equals(other: Any?) = other is WidgetLinkData && encode() == other.encode()
    override fun hashCode() = encode().hashCode()

    /** The look this link draws in. */
    val look: WidgetLook get() = WidgetLook(id, name, url, brand, palette)

    companion object {
        fun of(b: Business, key: String) = WidgetLinkData(b.id, b.displayName, b.serverURL, key, b.palette, b.art)

        fun from(value: Any?): WidgetLinkData? {
            val m = value as? Map<*, *> ?: return null
            val url = m["url"] as? String ?: return null
            val key = m["key"] as? String ?: return null
            val name = m["name"] as? String ?: m["house"] as? String ?: ""
            val brand = m["brand"] as? String ?: brandOfHost(url)
            val id = m["id"] as? String ?: brand ?: idOfHost(url)
            val palette = (m["palette"] as? Map<*, *>)?.let { p ->
                fun side(v: Any?): Business.Side? {
                    val s = v as? Map<*, *> ?: return null
                    return Business.Side(s["accent"] as? String ?: return null, s["ground"] as? String ?: return null, s["card"] as? String ?: return null, s["onAccent"] as? String ?: return null)
                }
                Business.Palette(side(p["light"]) ?: return@let null, side(p["dark"]) ?: return@let null)
            }
            return WidgetLinkData(id, name, url, key, palette, brand)
        }

        fun decode(text: String?): WidgetLinkData? = from(text?.let { runCatching { Json.parse(it) }.getOrNull() })

        /** A link kept by the one-house build had no id: the house's address says which of the built-ins it was. */
        fun brandOfHost(url: String): String? {
            val host = Business.hostOf(url)
            return if (host.contains("houseofmina")) "mina" else if (host.contains("taheri")) "taheri" else null
        }

        fun idOfHost(url: String) = Business.hostOf(url).replace('.', '-')

        /** `Authorization: Widget <key>` (the route reads nothing else). */
        fun authorization(key: String) = "Widget $key"

        /** POST /api/widget/key's body. */
        fun keyBody(): Map<String, Any?> = mapOf("label" to "Android widget")
    }
}

/** How the widget looks for one business: the palette's hex, light and dark; a tap opens the app on that business, never the browser. */
class WidgetLook(
    val id: String,
    val name: String,
    val baseURL: String,
    val brand: String?,
    val palette: Business.Palette?,
) {
    /** What names the business where the room is small ("House of Mina", not "House of Mina ERP"). */
    val tag: String get() = name.removeSuffix(" ERP").trim().ifEmpty { name }

    private fun pick(dark: Boolean, f: (Business.Side) -> String, fallback: Long): Color {
        val side = palette?.let { if (dark) it.dark else it.light }
        return Color(parseHexColor(side?.let(f)) ?: fallback)
    }

    fun accent(dark: Boolean): Color = pick(dark, { it.accent }, if (dark) 0xFFBE9F76 else 0xFF8A6B42)
    fun ground(dark: Boolean): Color = pick(dark, { it.ground }, if (dark) 0xFF0A1111 else 0xFFF2F3F6)

    /** The app on this business's Home ("/") or on one of its screens: `shoperp://open?b=<business>&p=<path>` (AppRouter reads it). */
    fun url(path: String = "/"): String = "shoperp://open?b=" + java.net.URLEncoder.encode(id, "UTF-8") + "&p=" + java.net.URLEncoder.encode(path, "UTF-8")
}
