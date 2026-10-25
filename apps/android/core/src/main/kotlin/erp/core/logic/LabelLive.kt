package erp.core.logic

import erp.core.Container
import erp.core.Decodable
import erp.core.ERPDate
import erp.core.models.Product
import erp.core.models.Settings
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant

// Ported from ERPCore's LabelLive.swift = src/lib/label-live.ts (tests: LabelLiveTests) and src/lib/label-live-values.ts
// (a piece's values, `LabelLive.valuesFor`). The tag CSV's own columns it fills from are LabelCSV.kt.
//
// Label LIVE (label.live, the Mac app the shop prints its tags with) takes a print from a link:
// `labellive://print?design=...&variables=<JSON>&printer=...&copies=...&window=...`. The design's variable names live in its
// .lsc file on the Mac, so the ERP never guesses them: the owner pastes the link Label LIVE's Integrate button copies, and
// `parseIntegrateURL` reads the design, the printer and every variable name out of it. A design can hold several tags
// (House of Mina's two-tag "minalabel": every variable twice as `SKU_1` / `SKU_2`); a variable ending `_<n>` belongs to tag
// n, each print fills as many pieces as the design has tags, and a tag left over is printed blank.
//
// JavaScript's text habits the link depends on are written out here, not borrowed from Kotlin: `encodeURIComponent` /
// `decodeURIComponent` (what the TS builds and reads the link with) and `JSON.stringify` (the variables), so a link is the
// same characters as the web ERP's, to the last "%".

/** The values one piece gives a label, by field key: worked out by the caller (it has the rates). */
typealias LabelValues = Map<String, String>

/**
 * One design variable and the piece's field that fills it (`LabelLive.fieldKeys`), or "" to leave it as the design has it.
 * The settings keep the pairings as a list (`StoredLabelLive.vars`) because the settings document is written with a merge,
 * which would keep a removed variable in a map.
 */
data class LabelLiveVar(val name: String, val field: String) {
    companion object : Decodable<LabelLiveVar> {
        override fun fromMap(m: Map<String, Any?>): LabelLiveVar {
            val c = Container(m)
            return LabelLiveVar(name = c.string("name", ""), field = c.string("field", ""))
        }
    }
}

/**
 * Each design variable -> its field, in the order the design gave them (the TS object keeps its insertion order, and the
 * link's JSON is written in it).
 */
data class LabelLiveMap(val vars: List<LabelLiveVar> = emptyList()) {
    /** null when the design variable is not in the map (JavaScript's `undefined`). */
    operator fun get(name: String): String? = vars.firstOrNull { it.name == name }?.field

    /** The map with this variable set (kept where it was, or added at the end); null removes it. */
    fun with(name: String, field: String?): LabelLiveMap {
        if (field == null) return LabelLiveMap(vars.filter { it.name != name })
        val i = vars.indexOfFirst { it.name == name }
        return if (i >= 0) LabelLiveMap(vars.mapIndexed { k, v -> if (k == i) v.copy(field = field) else v })
        else LabelLiveMap(vars + LabelLiveVar(name, field))
    }

    val names: List<String> get() = vars.map { it.name }

    companion object {
        fun of(vararg pairs: Pair<String, String>): LabelLiveMap = pairs.fold(LabelLiveMap()) { m, (k, v) -> m.with(k, v) }

        fun fromVars(vars: List<LabelLiveVar>): LabelLiveMap = vars.fold(LabelLiveMap()) { m, v -> m.with(v.name, v.field) }
    }
}

/** What the Settings > Labels card keeps and a print needs (TS `LabelLiveConfig`). */
data class LabelLiveConfig(
    /** The design's name as Label LIVE pins it ("minalabel"). */
    val design: String,
    /** Label LIVE's printer id (its Print tab); empty prints to the last printer used. "Preview" previews. */
    val printer: String = "",
    val copies: Int = 1,
    val map: LabelLiveMap = LabelLiveMap(),
    /** Keep Label LIVE's window out of the way while it prints. */
    val hideWindow: Boolean = true,
)

/**
 * As the shop's settings keep it (`app_settings/global` -> `labelLive`, TS `StoredLabelLive`). Lenient: anything missing or
 * odd reads as the default, and `LabelLive.clean` then drops what cannot be printed.
 */
data class StoredLabelLive(
    val design: String,
    val printer: String,
    val copies: Double,
    val hideWindow: Boolean,
    val vars: List<LabelLiveVar>,
) {
    companion object : Decodable<StoredLabelLive> {
        override fun fromMap(m: Map<String, Any?>): StoredLabelLive {
            val c = Container(m)
            return StoredLabelLive(
                design = c.string("design", ""), printer = c.string("printer", ""), copies = c.double("copies", 1.0),
                // `hideWindow !== false`: only a real false shows the window.
                hideWindow = (m["hideWindow"] as? Boolean) != false,
                vars = c.list("vars", LabelLiveVar),
            )
        }
    }
}

/** The design, printer, copies and variable names read out of an Integrate link (TS `ParsedIntegrate`). */
data class LabelLiveIntegrate(val design: String, val printer: String, val copies: Int, val variables: List<String>)

/** What a piece can put on a label (TS `LABEL_FIELDS` and the tag CSV's columns). */
data class LabelField(val key: String, val label: String)

/** Which tag of a design that holds several a variable belongs to. */
class LabelTags(val count: Int, /** 0 for a variable shared by the whole label. */ val tagOf: (String) -> Int)

object LabelLive {
    // MARK: Fields

    /** What a piece can put on a label. Money is whole rupees (decision "Whole rupees"). */
    val labelFields: List<LabelField> = listOf(
        LabelField("sku", "SKU"),
        LabelField("name", "Name"),
        LabelField("price", "Price (Rs 12,500)"),
        LabelField("priceNumber", "Price, number only (12500)"),
        LabelField("weight", "Weight (4.250 g)"),
        LabelField("weightNumber", "Weight, number only (4.250)"),
        LabelField("metal", "Metal and karat (Gold 21k)"),
        LabelField("karat", "Karat (21k)"),
        LabelField("category", "Category"),
        LabelField("stones", "Stones (details)"),
        LabelField("stoneWeight", "Stone weight (g)"),
        LabelField("diamonds", "Diamonds (details)"),
        LabelField("size", "Size"),
        LabelField("plating", "Plating"),
        LabelField("shop", "Shop name"),
        LabelField("qr", "QR / barcode (the SKU)"),
        LabelField("date", "Today’s date"),
    )

    /** The tag CSV's own columns, as the file writes them: `csv:total_price_pkr` -> "20650". */
    val csvFields: List<LabelField> = LabelCSV.baseHeaders.map { LabelField("csv:$it", "Tag CSV: $it") }

    val fieldKeys: List<String> = (labelFields + csvFields).map { it.key }

    // MARK: Reading Label LIVE's Integrate link

    private fun scalars(s: String): IntArray = s.codePoints().toArray()

    private fun str(cps: List<Int>): String = Zpl.text(cps)

    /**
     * Split RJSON `NAME:'Jane Doe',CITY:Karachi` at the commas between pairs (not those inside quotes) and return each
     * pair's key and value.
     */
    fun rjsonPairs(s: String): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        var buf = ArrayList<Int>()
        var quote: Int? = null
        fun flush() {
            val colon = buf.indexOf(':'.code)
            if (colon > 0) {
                var key = JS.trim(str(buf.subList(0, colon)))
                // `.replace(/^['"]|['"]$/g, '')`: one quote off the front and one off the back.
                key.codePoints().toArray().let { k ->
                    var a = 0
                    var b = k.size
                    if (b > 0 && (k[0] == '\''.code || k[0] == '"'.code)) a = 1
                    if (b > a && (k[b - 1] == '\''.code || k[b - 1] == '"'.code)) b -= 1
                    key = Zpl.text(k, a, b)
                }
                var value = JS.trim(str(buf.subList(colon + 1, buf.size)))
                val v = scalars(value)
                if (v.size >= 2 && (v[0] == '\''.code || v[0] == '"'.code) && v[v.size - 1] == v[0]) {
                    val inner = v.copyOfRange(1, v.size - 1)
                    // `.replace(/\\(['"&])/g, '$1')`: an escaped quote or "&" is itself.
                    val unescaped = ArrayList<Int>()
                    var i = 0
                    while (i < inner.size) {
                        if (inner[i] == '\\'.code && i + 1 < inner.size && (inner[i + 1] == '\''.code || inner[i + 1] == '"'.code || inner[i + 1] == '&'.code)) {
                            unescaped.add(inner[i + 1]); i += 2
                        } else { unescaped.add(inner[i]); i += 1 }
                    }
                    value = str(unescaped)
                }
                if (key.isNotEmpty()) out.add(key to value)
            }
            buf = ArrayList()
        }
        val chars = scalars(s)
        var i = 0
        while (i < chars.size) {
            val c = chars[i]
            if (c == '\\'.code && i + 1 < chars.size) { buf.add(c); i += 1; buf.add(chars[i]); i += 1; continue }
            val q = quote
            if (q != null) { if (c == q) quote = null; buf.add(c); i += 1; continue }
            if (c == '\''.code || c == '"'.code) { quote = c; buf.add(c); i += 1; continue }
            if (c == '{'.code || c == '}'.code) { i += 1; continue } // a `{...}` wrapper some links carry
            if (c == ','.code) { flush(); i += 1; continue }
            buf.add(c)
            i += 1
        }
        flush()
        return out
    }

    /**
     * The link Label LIVE's Integrate button copies ("Copy URL" or "Copy Browser URL") -> its design, printer, copies and
     * variable names. Null when it isn't a Label LIVE print link.
     */
    fun parseIntegrateURL(raw: String): LabelLiveIntegrate? {
        val s = JS.trim(raw)
        // `/^labellive:\/\/print\??(.*)$/i`: `.` stops at a line break, so one anywhere fails the match.
        val prefix = "labellive://print"
        if (!s.lowercase().startsWith(prefix)) return null
        val all = scalars(s)
        var rest = Zpl.text(all, minOf(all.size, prefix.length), all.size)
        if (rest.startsWith("?")) rest = rest.substring(1)
        if (scalars(rest).any { isLineTerminator(it) }) return null
        // Its options are split at the "&" that are not escaped as "\&" (Label LIVE's rule inside values).
        val parts = ArrayList<String>()
        val cur = StringBuilder()
        val r = scalars(rest)
        for ((i, c) in r.withIndex()) {
            if (c == '&'.code && !(i > 0 && r[i - 1] == '\\'.code)) { parts.add(cur.toString()); cur.setLength(0) } else cur.appendCodePoint(c)
        }
        parts.add(cur.toString())
        fun get(name: String): String? {
            val p = parts.firstOrNull { it.lowercase().startsWith("$name=") } ?: return null
            val ps = scalars(p)
            val v = Zpl.text(ps, minOf(ps.size, name.length + 1), ps.size)
            return decodeURIComponent(v.replace("+", "%20")) ?: v
        }
        val design = JS.trim(get("design") ?: "")
        if (design.isEmpty()) return null
        return LabelLiveIntegrate(
            design = design,
            printer = JS.trim(get("printer") ?: ""),
            copies = copiesFrom(get("copies")?.let { JS.toNumber(it) } ?: Double.NaN),
            variables = rjsonPairs(get("variables") ?: "").map { it.first },
        )
    }

    /** `Number.isFinite(c) && c >= 1 ? Math.min(99, Math.round(c)) : 1`. */
    private fun copiesFrom(c: Double): Int = if (c.isFinite() && c >= 1) minOf(99.0, JS.round(c)).toInt() else 1

    /** The field a design variable most likely wants, by its name; "" when nothing fits. */
    fun guessField(variable: String): String {
        // A tag CSV column with its tag's number (`TOTAL_PRICE_PKR_1`): the design was built on the CSV.
        val tag = tagSuffix(variable)
        if (tag != null && tag.first.isNotEmpty() && !scalars(tag.first).any { isLineTerminator(it) }) {
            val csv = tag.first.lowercase()
            if (LabelCSV.baseHeaders.contains(csv)) return "csv:$csv"
        }
        val base = (tag?.first ?: variable).lowercase()
        val v = Zpl.text(scalars(base).filter { (it in 97..122) || (it in 48..57) })
        fun has(vararg w: String): Boolean = w.any { v.contains(it) }
        if (has("qr", "barcode")) return "qr"
        if (has("sku", "code", "tag", "itemno", "productid") || v == "id") return "sku"
        if (has("stonewt", "stoneweight")) return "stoneWeight"
        if (has("diamond")) return "diamonds"
        if (has("stone", "gem")) return "stones"
        if (has("weight", "wt", "gram", "gms")) return if (v.endsWith("num") || v.endsWith("number")) "weightNumber" else "weight"
        if (has("price", "amount", "pkr", "rate", "mrp", "cost")) return if (v.endsWith("num") || v.endsWith("number")) "priceNumber" else "price"
        if (has("karat", "carat", "purity") || v == "kt" || v == "k") return "karat"
        if (has("metal", "material")) return "metal"
        if (has("category", "type", "collection")) return "category"
        if (has("size")) return "size"
        if (has("plating", "finish", "polish")) return "plating"
        if (has("shop", "brand", "store", "company")) return "shop"
        if (has("date", "day")) return "date"
        if (has("name", "title", "design", "item", "product", "description")) return "name"
        return ""
    }

    /** A config from a pasted Integrate link, each variable paired with its likely field. */
    fun configFromIntegrate(p: LabelLiveIntegrate, previous: LabelLiveConfig? = null): LabelLiveConfig {
        var map = LabelLiveMap()
        for (v in p.variables) map = map.with(v, previous?.map?.get(v) ?: guessField(v))
        return LabelLiveConfig(p.design, p.printer, p.copies, map, previous?.hideWindow ?: true)
    }

    // MARK: Making the print link

    /**
     * Tag n of a design that holds several: the `_<n>` its variables end with, when they end with at least two different
     * numbers (one `_2` alone is just a name). 0 for a variable shared by the whole label.
     */
    fun tagsOf(config: LabelLiveConfig): LabelTags {
        fun num(name: String): Int = tagSuffix(name)?.second ?: 0
        val seen = config.map.names.map { num(it) }.filter { it > 0 }.toSet()
        if (seen.size < 2) return LabelTags(1) { 0 }
        return LabelTags(minOf(12, seen.max())) { num(it) }
    }

    /** A value for the link: one line, and "&" as "and" (Label LIVE splits its options at "&"; a tag never needs it). */
    private fun oneLine(v: String): String {
        val out = StringBuilder()
        val s = scalars(v)
        var i = 0
        while (i < s.size) {
            if (s[i] == '\r'.code && i + 1 < s.size && s[i + 1] == '\n'.code) { out.append(' '); i += 2 }
            else if (s[i] == '\n'.code) { out.append(' '); i += 1 }
            else if (s[i] == '&'.code) { out.append("and"); i += 1 }
            else { out.appendCodePoint(s[i]); i += 1 }
        }
        return out.toString()
    }

    /**
     * One label's variables, filled from its pieces (as many as the design has tags), as the JSON object Label LIVE's
     * Integrate link carries: `{"SKU_1":"RIN-000069","SKU_2":""}`. A paired variable takes its piece's field; a tag with no
     * piece is sent blank, every variable of it, so the design's sample text never prints; anything else is left as the
     * design has it.
     */
    fun variablesFor(config: LabelLiveConfig, pieces: List<LabelValues>): String = jsonObject(variablesObject(config, pieces))

    fun variablesFor(config: LabelLiveConfig, piece: LabelValues): String = variablesFor(config, listOf(piece))

    private fun variablesObject(config: LabelLiveConfig, group: List<LabelValues>): List<Pair<String, String>> {
        val tagOf = tagsOf(config).tagOf
        val out = ArrayList<Pair<String, String>>()
        for (v in config.map.vars) {
            val tag = tagOf(v.name)
            val at = maxOf(0, tag - 1)
            if (at >= group.size) out.add(v.name to "")
            else if (v.field.isNotEmpty()) out.add(v.name to oneLine(group[at][v.field] ?: ""))
        }
        return out
    }

    /** The pieces in labels: one per label, or two (or more) to a label for a design that holds that many. */
    fun <T> labelsOf(config: LabelLiveConfig, pieces: List<T>): List<List<T>> {
        val count = tagsOf(config).count
        return (0 until pieces.size step count).map { pieces.subList(it, minOf(it + count, pieces.size)) }
    }

    /**
     * One label, or several as a list (`variables=[{...},{...}]`, Label LIVE's own way to print many labels of one design on
     * one printer) -> `labellive://print?...`.
     */
    fun printURL(config: LabelLiveConfig, pieces: List<LabelValues>, copies: Int? = null): String {
        val labels = labelsOf(config, pieces)
        val variables = if (labels.size > 1) "[" + labels.joinToString(",") { jsonObject(variablesObject(config, it)) } + "]" else variablesFor(config, pieces)
        val q = arrayListOf(
            "design=${encodeURIComponent(config.design)}",
            "variables=${encodeURIComponent(variables)}",
        )
        if (config.printer.isNotEmpty()) q.add("printer=${encodeURIComponent(config.printer)}")
        q.add("copies=${clampCopies(copies ?: config.copies)}")
        q.add("window=${if (config.hideWindow) "hide" else "show"}")
        q.add("ignoreWarnings=true")
        return "labellive://print?${q.joinToString("&")}"
    }

    fun printURL(config: LabelLiveConfig, piece: LabelValues, copies: Int? = null): String = printURL(config, listOf(piece), copies)

    /** `Math.max(1, Math.min(99, Math.round(copies) || 1))`. */
    private fun clampCopies(copies: Int): Int = maxOf(1, minOf(99, copies))

    /**
     * Several pieces -> one `labellive://batch?payload=...`. Not used to print: Label LIVE 4.3.3 reads the payload without
     * undoing the link's percent-encoding, so an encoded "+", "/" or "=" breaks it ("... is not valid JSON", 2026-10-23).
     * `labelLiveURL` sends a list of labels in one print link instead. Each job has the design, its variables, printer and copies.
     */
    fun batchURL(config: LabelLiveConfig, pieces: List<LabelValues>, copies: Int? = null): String {
        val jobs = labelsOf(config, pieces).map { group ->
            val fields = arrayListOf("design" to config.design, "variables" to variablesFor(config, group))
            if (config.printer.isNotEmpty()) fields.add("printer" to config.printer)
            fields.add("copies" to clampCopies(copies ?: config.copies).toString())
            fields.add("window" to if (config.hideWindow) "hide" else "show")
            fields.add("ignoreWarnings" to "true")
            jsonObject(fields)
        }
        val json = "[" + jobs.joinToString(",") + "]"
        val bytes = json.toByteArray(Charsets.UTF_8).map { it.toInt() and 255 }.toIntArray()
        return "labellive://batch?payload=${encodeURIComponent(LabelBitmap.base64Encode(bytes))}"
    }

    /** The link for any number of pieces: one print link, a list of labels when there are several. */
    fun labelLiveURL(config: LabelLiveConfig, pieces: List<LabelValues>, copies: Int? = null): String = printURL(config, pieces, copies)

    // MARK: As the settings keep it

    fun toStored(c: LabelLiveConfig): StoredLabelLive =
        StoredLabelLive(JS.trim(c.design), JS.trim(c.printer), c.copies.toDouble(), c.hideWindow, c.map.vars)

    /**
     * A saved config, checked: anything odd is dropped rather than printed wrong. `input` is a settings value as JSON gave it
     * (a map); a legacy `map` object has no order after JSON, so its names are taken alphabetically (the settings keep
     * `vars`, a list).
     */
    fun clean(input: Any?): LabelLiveConfig? {
        val o = input as? Map<*, *> ?: return null
        val design = capped(JS.trim((o["design"] as? String) ?: ""), 120)
        if (design.isEmpty()) return null
        var map = LabelLiveMap()
        var pairs: List<Pair<String, Any?>> = emptyList()
        val vars = o["vars"] as? List<*>
        val legacy = o["map"] as? Map<*, *>
        if (vars != null) {
            pairs = vars.map { v ->
                val d = v as? Map<*, *>
                if (d == null) "" to null else text(d["name"]) to d["field"]
            }
        } else if (legacy != null) {
            pairs = legacy.entries.map { it.key.toString() to it.value }.sortedBy { it.first }
        }
        for ((k, v) in pairs.take(120)) {
            if (k.isEmpty() || k.length > 60) continue
            val f = v as? String
            map = if (f != null && fieldKeys.contains(f)) map.with(k, f) else map.with(k, "")
        }
        return LabelLiveConfig(
            design = design,
            printer = capped(JS.trim((o["printer"] as? String) ?: ""), 200),
            copies = copiesFrom(LabelCSV.jsNumber(o["copies"])),
            map = map,
            hideWindow = (o["hideWindow"] as? Boolean) != false,
        )
    }

    /** A saved config as `Settings.labelLive` decodes it. */
    fun clean(stored: StoredLabelLive?): LabelLiveConfig? {
        val s = stored ?: return null
        return clean(
            mapOf(
                "design" to s.design, "printer" to s.printer, "copies" to s.copies, "hideWindow" to s.hideWindow,
                "vars" to s.vars.map { mapOf("name" to it.name, "field" to it.field) },
            ),
        )
    }

    /** `String(v ?? '')` for a name read from a document. */
    private fun text(v: Any?): String = when (v) {
        is String -> v
        is Boolean -> if (v) "true" else "false"
        is Number -> JS.number(v.toDouble())
        else -> ""
    }

    /** `s.slice(0, n)` (n UTF-16 units). */
    private fun capped(s: String, n: Int): String = if (s.length <= n) s else s.substring(0, n)

    // MARK: A piece's values (label-live-values.ts)

    /**
     * A piece's values for a Label LIVE tag: its price at today's rates the way the tag CSV has always worked it out, in
     * whole rupees.
     */
    fun valuesFor(p: Product, settings: Settings, today: Instant = Instant.now()): LabelValues {
        val costs = calculateProductCosts(PricedPiece(p), PricingRates(settings).flatPalladiumOnly)
        val price = if (p.isCustomPrice && JS.truthy(p.customPrice)) p.customPrice!! else costs.totalPrice
        val karat = p.karat?.rawValue ?: ""
        fun rs(n: Double): String = "Rs ${Money.grouped(JS.round(n))}"
        fun grams(n: Double): String = if (n.isFinite()) JS.toFixed(n, 3) else ""
        fun cap(s: String): String = if (s.isEmpty()) "" else s.take(1).uppercase() + s.drop(1)
        val out = LinkedHashMap<String, String>()
        out["sku"] = p.sku
        out["name"] = p.name
        out["price"] = rs(price)
        out["priceNumber"] = JS.number(JS.round(price))
        out["weight"] = "${grams(p.metalWeightG)} g"
        out["weightNumber"] = grams(p.metalWeightG)
        out["metal"] = listOf(cap(p.metalType.rawValue), karat).filter { it.isNotEmpty() }.joinToString(" ")
        out["karat"] = karat
        out["category"] = categoryTitle(p.categoryId) ?: p.categoryId
        out["stones"] = p.stoneDetails ?: ""
        out["stoneWeight"] = if (p.hasStones) grams(p.stoneWeightG) else ""
        out["diamonds"] = p.diamondDetails ?: ""
        out["size"] = p.size ?: ""
        out["plating"] = p.platingType ?: ""
        out["shop"] = settings.shopName
        out["qr"] = p.sku
        out["date"] = dateText(today)
        // A design built on the tag CSV reads its columns as the file writes them.
        for ((k, v) in LabelCSV.values(p, settings)) out["csv:$k"] = v
        return out
    }

    /** en-GB `{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }`: "24 Oct 2026". */
    private fun dateText(d: Instant): String {
        val local = d.atOffset(ERPDate.karachi)
        return "${local.dayOfMonth} ${JS.shortMonths[local.monthValue - 1]} ${local.year}"
    }

    // MARK: JavaScript's own text rules

    private const val uriKeep = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    /** `encodeURIComponent`: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) as UTF-8 percent bytes (upper-case hex). */
    fun encodeURIComponent(s: String): String {
        val hex = "0123456789ABCDEF"
        val out = StringBuilder()
        for (bb in s.toByteArray(Charsets.UTF_8)) {
            val b = bb.toInt() and 255
            if (b < 128 && uriKeep.indexOf(b.toChar()) >= 0) out.append(b.toChar())
            else { out.append('%'); out.append(hex[b shr 4]); out.append(hex[b and 15]) }
        }
        return out.toString()
    }

    /** `decodeURIComponent`; null where JavaScript throws (a "%" not followed by two hex digits, or bytes that are not UTF-8). */
    fun decodeURIComponent(s: String): String? {
        val b = s.toByteArray(Charsets.UTF_8)
        val out = java.io.ByteArrayOutputStream()
        fun hexValue(c: Int): Int = when (c) {
            in 48..57 -> c - 48
            in 65..70 -> c - 55
            in 97..102 -> c - 87
            else -> -1
        }
        var i = 0
        while (i < b.size) {
            val c = b[i].toInt() and 255
            if (c == 0x25) {
                if (i + 2 >= b.size) return null
                val hi = hexValue(b[i + 1].toInt() and 255)
                val lo = hexValue(b[i + 2].toInt() and 255)
                if (hi < 0 || lo < 0) return null
                out.write(hi shl 4 or lo)
                i += 3
            } else {
                out.write(c)
                i += 1
            }
        }
        var bytes = out.toByteArray()
        // A C string ends at its first NUL (Swift's `String(validatingUTF8:)` reads one).
        val nul = bytes.indexOf(0)
        if (nul >= 0) bytes = bytes.copyOf(nul)
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (e: java.nio.charset.CharacterCodingException) {
            null
        }
    }

    /** `JSON.stringify` of one string. */
    internal fun jsonString(s: String): String {
        val out = StringBuilder("\"")
        for (u in scalars(s)) {
            when (u) {
                '"'.code -> out.append("\\\"")
                '\\'.code -> out.append("\\\\")
                0x08 -> out.append("\\b")
                0x0C -> out.append("\\f")
                '\n'.code -> out.append("\\n")
                '\r'.code -> out.append("\\r")
                '\t'.code -> out.append("\\t")
                else -> if (u < 0x20) {
                    val h = u.toString(16)
                    out.append("\\u").append("0".repeat(4 - h.length)).append(h)
                } else out.appendCodePoint(u)
            }
        }
        return out.append("\"").toString()
    }

    /** `JSON.stringify` of an object of strings, keys in the order given. */
    internal fun jsonObject(pairs: List<Pair<String, String>>): String =
        "{" + pairs.joinToString(",") { "${jsonString(it.first)}:${jsonString(it.second)}" } + "}"

    private fun isLineTerminator(u: Int): Boolean = u == '\n'.code || u == '\r'.code || u == 0x2028 || u == 0x2029

    /** A trailing `_<n>` (one or two digits) and what comes before it: `/_(\d{1,2})$/`. */
    internal fun tagSuffix(name: String): Pair<String, Int>? {
        val s = scalars(name)
        for (k in 1..2) {
            if (s.size < k + 1) continue
            var digits = true
            for (i in s.size - k until s.size) if (s[i] < 48 || s[i] > 57) digits = false
            if (s[s.size - k - 1] == '_'.code && digits) {
                return Zpl.text(s, 0, s.size - k - 1) to (Zpl.text(s, s.size - k, s.size).toIntOrNull() ?: 0)
            }
        }
        return null
    }
}

/** The Label LIVE setup as a print can use it; null until the owner has pasted a link. */
val Settings.labelLiveConfig: LabelLiveConfig? get() = LabelLive.clean(labelLive)
