package erp.app.config

import erp.app.data.JsonText
import erp.core.Json
import erp.core.logic.MarginSettings

/**
 * One business the app can open: a house with its own ERP address, Firebase project, look and margin (Business.swift).
 * The JSON is exactly the ERP's `GET /api/app/business` (src/app/api/app/business/route.ts), so a business is added by
 * typing its address, and the built-ins (assets/businesses.json, written by apps/iphone/scripts/businesses.mjs) are the
 * same shape. Lenient, as the models are: a missing or odd field is a default; [problem] then judges whether what is
 * left can be used. Plain Kotlin, so the checks run on the JVM.
 */
data class Business(
    val version: Int,
    /** The brand id ("taheri", "mina") or a slug for an added business: keys its Firebase app, its files and its settings. */
    val id: String,
    /** The shop's own name ("TAHERI"): for what a customer or a karigar reads. */
    val name: String,
    /** The ERP's name on the home screen ("Taheri ERP"). */
    val shortName: String,
    /** Only the built-ins carry one ("House of Mina ERP"); an added business is "<name> ERP". */
    val storeName: String?,
    /** The ERP's origin, `https://erp.example.shop`, no path. */
    val serverURL: String,
    val metal: String,
    val margin: Margin,
    val palette: Palette,
    val logo: Logo,
    val icon: String?,
    /** The Android sign-in; null while this business has not registered the app in its Firebase project. */
    val android: AndroidApp?,
    val flags: Flags?,
    /** The oldest build (versionCode) the ERP still takes (APP_MIN_BUILD); 0 or absent: any. */
    val minBuild: Int?,
) {
    /** lib/margin.ts: Taheri costs a sale at 24K less so many ratti; a house with no costing has a percent. */
    sealed interface Margin {
        data class RattiLess(val ratti: Double) : Margin
        data class Percent(val percent: Double) : Margin

        /** ERPCore's settings: the 10% beside a ratti figure is the code's default; a percent is the estimate itself (Mina: 40). */
        val settings: MarginSettings
            get() = when (this) {
                is RattiLess -> MarginSettings(rattiLess = ratti, assumedMargin = 0.10)
                is Percent -> MarginSettings(rattiLess = null, assumedMargin = percent / 100)
            }

        fun toMap(): Map<String, Any?> = when (this) {
            is RattiLess -> mapOf("kind" to "rattiLess", "ratti" to ratti)
            is Percent -> mapOf("kind" to "percent", "percent" to percent)
        }
    }

    data class Side(val accent: String, val ground: String, val card: String, val onAccent: String) {
        fun toMap() = mapOf("accent" to accent, "ground" to ground, "card" to card, "onAccent" to onAccent)
    }

    data class Palette(val light: Side, val dark: Side) {
        fun toMap() = mapOf("light" to light.toMap(), "dark" to dark.toMap())
    }

    data class Logo(val light: String?, val dark: String?, val aspect: Double) {
        fun toMap(): Map<String, Any?> = buildMap {
            light?.let { put("light", it) }
            dark?.let { put("dark", it) }
            put("aspect", aspect)
        }
    }

    data class Firebase(val apiKey: String, val appId: String, val projectId: String, val senderId: String, val storageBucket: String)

    data class AndroidApp(val googleWebClientId: String, val firebase: Firebase)

    /** The house's switches (lib/app-shop.ts shopFlags): stand in before /api/app/me has answered. */
    data class Flags(
        val partnership: Boolean?,
        val websiteSelling: Boolean?,
        val invoiceByCustomer: Boolean?,
        val invoiceWhatsappPdf: Boolean?,
        val sizeToProfile: Boolean?,
        val workshopStart: String?,
    )

    // MARK: Derived

    /** The id of the bundled art this business wears, null for an added business (drawn from its palette and logo URLs). */
    val art: String? get() = if (id in bundledIds) id else if (id == DEMO_ID) "taheri" else null

    val host: String get() = hostOf(serverURL)
    val isDemo: Boolean get() = id == DEMO_ID

    /** The first letter, for a badge where the logo is not at hand. */
    val initial: String get() = name.trim().take(1).uppercase()

    /** What the app calls this business where it says "<Name> ERP". */
    val displayName: String get() = storeName ?: if (name.lowercase().endsWith("erp")) name else "$name ERP"

    /** Whether this business can sign in on Android: its app is registered in its Firebase project. */
    val androidReady: Boolean get() = android != null && android.firebase.appId.contains(":android:")

    /** This app is older than the ERP allows: money screens stay shut and the page says to update. */
    fun needsUpdate(build: Int): Boolean = (minBuild ?: 0).let { it > 0 && build < it }

    /**
     * Why this descriptor cannot be used, or null. Adding refuses on it: the checks are what the app would otherwise
     * fail on later (a colour that is not a hex, an address that is not https, an Android app that is not one).
     */
    val problem: String?
        get() {
            if (!ID_SHAPE.matches(id)) return "That ERP's id isn't one this app can use."
            if (name.isBlank()) return "That ERP has no name."
            if (!secure(serverURL)) return "That ERP's address isn't a secure one."
            val a = android
            if (a != null) {
                val f = a.firebase
                if (!a.googleWebClientId.endsWith(".apps.googleusercontent.com") || !f.appId.contains(":android:") || f.apiKey.isEmpty() || f.projectId.isEmpty()) {
                    return "$name has set up its Android sign-in incorrectly. Ask the shop to check it."
                }
            }
            for (s in listOf(palette.light, palette.dark)) {
                for (hex in listOf(s.accent, s.ground, s.card, s.onAccent)) if (!HEX.matches(hex.trim())) return "That ERP's colours aren't readable."
            }
            return null
        }

    fun toMap(): Map<String, Any?> = buildMap {
        put("version", version)
        put("id", id)
        put("name", name)
        put("shortName", shortName)
        storeName?.let { put("storeName", it) }
        put("serverURL", serverURL)
        put("metal", metal)
        put("margin", margin.toMap())
        put("palette", palette.toMap())
        put("logo", logo.toMap())
        icon?.let { put("icon", it) }
        put(
            "android",
            android?.let { a ->
                val f = a.firebase
                mapOf(
                    "googleWebClientId" to a.googleWebClientId,
                    "firebase" to mapOf("apiKey" to f.apiKey, "appId" to f.appId, "projectId" to f.projectId, "senderId" to f.senderId, "storageBucket" to f.storageBucket),
                )
            },
        )
        flags?.let { f ->
            put(
                "flags",
                buildMap<String, Any?> {
                    f.partnership?.let { put("partnership", it) }
                    f.websiteSelling?.let { put("websiteSelling", it) }
                    f.invoiceByCustomer?.let { put("invoiceByCustomer", it) }
                    f.invoiceWhatsappPdf?.let { put("invoiceWhatsappPdf", it) }
                    f.sizeToProfile?.let { put("sizeToProfile", it) }
                    f.workshopStart?.let { put("workshopStart", it) }
                },
            )
        }
        minBuild?.let { put("minBuild", it) }
    }

    fun toJson(): String = JsonText.of(toMap(), sorted = true) ?: "{}"

    companion object {
        /** The built-ins with art in the app (colours, logo and badge in res, nav-<id>.json, design-<id>.js); the demo wears Taheri's. */
        val bundledIds: Set<String> = setOf("taheri", "mina")
        const val DEMO_ID = "demo"

        private val ID_SHAPE = Regex("^[a-z0-9][a-z0-9-]{0,40}$")
        private val HEX = Regex("^#?[0-9a-fA-F]{6}$")

        fun hostOf(url: String): String = runCatching { java.net.URI(url).host }.getOrNull().orEmpty().lowercase()

        private fun secure(url: String): Boolean = runCatching { java.net.URI(url) }.getOrNull()?.let { it.scheme == "https" && !it.host.isNullOrEmpty() } == true

        /** The descriptor's JSON text; null when it is not an object with an id, a name, an address and a palette. */
        fun decode(text: String): Business? = runCatching { Json.parse(text) }.getOrNull()?.let { from(it) }

        fun decodeList(text: String): List<Business> =
            (runCatching { Json.parse(text) }.getOrNull() as? List<*>)?.mapNotNull { from(it) }.orEmpty()

        fun from(value: Any?): Business? {
            val m = value as? Map<*, *> ?: return null
            val id = m["id"] as? String ?: return null
            val name = m["name"] as? String ?: return null
            val url = m["serverURL"] as? String ?: return null
            val palette = palette(m["palette"]) ?: return null
            val logo = (m["logo"] as? Map<*, *>)?.let { l ->
                Logo(l["light"] as? String, l["dark"] as? String, (l["aspect"] as? Number)?.toDouble() ?: 4.0)
            } ?: Logo(null, null, 4.0)
            return Business(
                version = (m["version"] as? Number)?.toInt() ?: 1,
                id = id,
                name = name,
                shortName = m["shortName"] as? String ?: name,
                storeName = m["storeName"] as? String,
                serverURL = url,
                metal = if (m["metal"] == "silver") "silver" else "gold",
                margin = margin(m["margin"]),
                palette = palette,
                logo = logo,
                icon = m["icon"] as? String,
                android = android(m["android"]),
                flags = (m["flags"] as? Map<*, *>)?.let { f ->
                    Flags(
                        f["partnership"] as? Boolean, f["websiteSelling"] as? Boolean, f["invoiceByCustomer"] as? Boolean,
                        f["invoiceWhatsappPdf"] as? Boolean, f["sizeToProfile"] as? Boolean, f["workshopStart"] as? String,
                    )
                },
                minBuild = (m["minBuild"] as? Number)?.toInt(),
            )
        }

        private fun margin(v: Any?): Margin {
            val m = v as? Map<*, *> ?: return Margin.RattiLess(6.0)
            return if (m["kind"] == "percent") Margin.Percent((m["percent"] as? Number)?.toDouble() ?: 10.0)
            else Margin.RattiLess((m["ratti"] as? Number)?.toDouble() ?: 6.0)
        }

        private fun side(v: Any?): Side? {
            val m = v as? Map<*, *> ?: return null
            return Side(m["accent"] as? String ?: return null, m["ground"] as? String ?: return null, m["card"] as? String ?: return null, m["onAccent"] as? String ?: return null)
        }

        private fun palette(v: Any?): Palette? {
            val m = v as? Map<*, *> ?: return null
            return Palette(side(m["light"]) ?: return null, side(m["dark"]) ?: return null)
        }

        /** Absent or null (an older ERP, or a house without the app registered) is "not set up", never an error. */
        private fun android(v: Any?): AndroidApp? {
            val m = v as? Map<*, *> ?: return null
            val f = m["firebase"] as? Map<*, *> ?: return null
            return AndroidApp(
                googleWebClientId = m["googleWebClientId"] as? String ?: return null,
                firebase = Firebase(
                    apiKey = f["apiKey"] as? String ?: "", appId = f["appId"] as? String ?: return null,
                    projectId = f["projectId"] as? String ?: "", senderId = f["senderId"] as? String ?: "",
                    storageBucket = f["storageBucket"] as? String ?: "",
                ),
            )
        }
    }
}

/** "#BE9F76" (the # optional) as 0xAARRGGBB, or null for anything else. */
fun parseHexColor(hex: String?): Long? {
    val s = hex?.trim()?.removePrefix("#") ?: return null
    if (s.length != 6) return null
    val v = s.toLongOrNull(16) ?: return null
    return 0xFF000000L or v
}
