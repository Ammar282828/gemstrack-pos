package erp.app.screens.neworder

import erp.app.config.Businesses
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.app.data.Outbox
import erp.app.data.ReadCache
import erp.core.Json
import erp.core.logic.categorySingular
import java.net.URLEncoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// Semi-automatic descriptions (owner, 2026-11-03: "make product description semi automatic since the product is usually described
// as its stone"): a row of suggestion chips under the description, drawn from what this shop has already written
// (`GET /api/app/describe`), plus saved stone combos worded with the category ("Ruby & diamond" + Rings = "Ruby & diamond ring").
// Used by the new-order piece editor and the new-sale line editor. (DescribeKit.swift: the model and the matching are here, the
// chips and sheets in DescribeKit.kt.)
//
// Typing never waits on the network: the answer is read once per category (kept in memory for the session and on disk, in
// ReadCache, for offline) and matched locally.

// MARK: What the server gives

/** One past description: how often it was written, when last, and in which category. `lower` is for a keystroke to compare against. */
data class DescribeEntry(val text: String, val count: Int, val lastAt: String, val category: String) {
    val lower: String = text.lowercase()
    val id: String get() = "$category|$lower"
}

data class DescribePayload(val history: List<DescribeEntry> = emptyList(), val combos: List<String> = emptyList())

/** One chip's words. */
data class DescribeSuggestion(val text: String)

object DescribeLogic {
    const val LIMIT = 8

    /** "Ruby & diamond" + Rings = "Ruby & diamond ring": the combo's words, then the category's singular word. */
    fun compose(combo: String, word: String): String {
        val c = combo.trim()
        if (c.isEmpty()) return ""
        val head = c.replaceFirstChar { it.uppercaseChar() }
        if (word.isEmpty() || c.lowercase().endsWith(word)) return head
        return "$head $word"
    }

    /**
     * What to offer for what is typed: this category's past descriptions first, then the combos worded with the category, then
     * (only while something is typed) the other categories'. An empty field offers the category's top ones.
     */
    fun compute(query: String, category: String, entries: List<DescribeEntry>, combos: List<String>): List<DescribeSuggestion> {
        val q = query.trim().lowercase()
        val tokens = q.split(' ').filter { it.isNotEmpty() }
        val word = (categorySingular(category) ?: "").lowercase()
        fun fits(lower: String) = lower != q && tokens.all { lower.contains(it) }
        val seen = HashSet<String>()
        val mine = ArrayList<DescribeSuggestion>()
        val other = ArrayList<DescribeSuggestion>()
        for (e in entries) {
            if (mine.size >= 24 && other.size >= 24) break
            if (!fits(e.lower) || e.lower in seen) continue
            if (category.isEmpty() || e.category == category) {
                seen.add(e.lower)
                mine.add(DescribeSuggestion(e.text))
            } else if (q.isNotEmpty()) {
                seen.add(e.lower)
                other.add(DescribeSuggestion(e.text))
            }
        }
        val composed = ArrayList<DescribeSuggestion>()
        for (c in combos) {
            val t = compose(c, word)
            val lower = t.lowercase()
            if (t.isEmpty() || !fits(lower) || lower in seen) continue
            seen.add(lower)
            composed.add(DescribeSuggestion(t))
        }
        fun leading(list: List<DescribeSuggestion>): List<DescribeSuggestion> {
            if (q.isEmpty()) return list
            val (starts, rest) = list.partition { it.text.lowercase().startsWith(q) }
            return starts + rest
        }
        return (leading(mine) + leading(composed) + leading(other)).take(LIMIT)
    }

    /** The stone combo the sheet saves: the picked stones (lower case) and the typed words, joined with " & ". */
    fun combo(picked: List<String>, extra: String): String {
        val parts = picked.map { it.lowercase() }.toMutableList()
        for (piece in extra.split(',')) {
            val t = piece.trim()
            if (t.isNotEmpty()) parts.add(t)
        }
        return parts.joinToString(" & ").replaceFirstChar { it.uppercaseChar() }
    }

    /** Lenient: a row without text is skipped, a missing count is 1. */
    fun parse(text: String): DescribePayload {
        val root = Json.parse(text) as? Map<*, *> ?: return DescribePayload()
        val history = ArrayList<DescribeEntry>()
        for (r in (root["history"] as? List<*>).orEmpty()) {
            val row = r as? Map<*, *> ?: continue
            val t = ((row["text"] as? String) ?: "").trim()
            if (t.isEmpty()) continue
            val count = (row["count"] as? Number)?.toInt() ?: 1
            val lastAt = (row["lastAt"] as? String) ?: (row["lastAt"] as? Number)?.toString() ?: ""
            history.add(DescribeEntry(t, count, lastAt, (row["category"] as? String) ?: ""))
        }
        history.sortWith(compareByDescending<DescribeEntry> { it.count }.thenByDescending { it.lastAt })
        val combos = ArrayList<String>()
        for (any in (root["combos"] as? List<*>).orEmpty()) {
            val t = (any as? String)?.trim() ?: continue
            if (t.isNotEmpty() && combos.none { it.equals(t, ignoreCase = true) }) combos.add(t)
        }
        return DescribePayload(history, combos)
    }
}

// MARK: The store

/** The shop's past descriptions and saved stone combos. Keyed by business, so a switch never shows another shop's words. */
object DescribeStore {
    private val history = HashMap<String, List<DescribeEntry>>()
    private var combosList: List<String> = emptyList()
    private var combosFor = ""
    private val fresh = HashSet<String>()
    private val inFlight = HashSet<String>()
    private val rev = MutableStateFlow(0)

    /** Bumped on every change, so a small view can recompute when it moves. */
    val revision: StateFlow<Int> = rev.asStateFlow()

    private fun business(): String = Businesses.current.id
    private fun key(category: String) = business() + "|" + category
    private const val COMBOS_KEY = "erp.describe.combos"

    val combos: List<String> get() { loadCombos(); return combosList }

    /** The past descriptions read for this category ("" is every category), most used first. */
    fun entries(category: String): List<DescribeEntry> = history[key(category)].orEmpty()

    private fun path(category: String) =
        if (category.isEmpty()) "/api/app/describe" else "/api/app/describe?category=" + URLEncoder.encode(category, "UTF-8")

    private fun loadCombos() {
        val b = business()
        if (combosFor == b) return
        combosFor = b
        combosList = (Prefs.string(COMBOS_KEY, b)?.let { runCatching { Json.parse(it) }.getOrNull() } as? List<*>)?.filterIsInstance<String>().orEmpty()
    }

    /** Reads the answer once per category and session: what is on disk shows at once, the network answer replaces it. */
    suspend fun load(category: String) {
        val k = key(category)
        if (k in fresh || !inFlight.add(k)) return
        try {
            loadCombos()
            val p = path(category)
            if (history[k] == null) ReadCache.load(p, business())?.let { apply(DescribeLogic.parse(it), k) }
            try {
                val text = ErpApi.shared.data(p)
                apply(DescribeLogic.parse(text), k)
                fresh.add(k)
            } catch (e: ErpApi.Failure) {
                // Offline: what was kept on the device is what shows.
            }
        } finally {
            inFlight.remove(k)
        }
    }

    internal fun apply(payload: DescribePayload, k: String) {
        history[k] = payload.history
        val merged = payload.combos.toMutableList()
        for (local in Prefs.string(COMBOS_KEY, business())?.let { runCatching { Json.parse(it) }.getOrNull() }.let { (it as? List<*>)?.filterIsInstance<String>().orEmpty() }) {
            if (merged.none { it.equals(local, ignoreCase = true) }) merged.add(local)
        }
        if (merged.isNotEmpty() || combosList.isEmpty()) combosList = merged
        rev.value = rev.value + 1
    }

    /** Appends a stone combo to the shop's list and sends the whole list (`setStoneCombos`, not a money op, through the Outbox). */
    fun addCombo(raw: String): Boolean {
        loadCombos()
        val t = raw.trim()
        if (t.isEmpty() || combosList.any { it.equals(t, ignoreCase = true) }) return false
        combosList = combosList + t
        Prefs.putString(COMBOS_KEY, JsonText.of(combosList), business())
        rev.value = rev.value + 1
        Outbox.enqueue("setStoneCombos", mapOf("combos" to combosList), "Stone combos")
        return true
    }
}

// MARK: Wastage

/** 10% · 12% · 15% · 25% · Other. A value that is not on the list reads as Other, with its own fields; the stored figure is the same percentage as before. */
object WastagePicks {
    val presets: List<Int> = listOf(10, 12, 15, 25)

    fun preset(percent: String): Int? {
        val v = percent.trim().toDoubleOrNull() ?: return null
        return presets.firstOrNull { kotlin.math.abs(it - v) < 0.0001 }
    }

    /** Whether Other's fields show: Other was chosen (and stays chosen while "12" is typed in it), or the value is not on the list. */
    fun reveals(percent: String, other: Boolean): Boolean = other || preset(percent) == null
}

// MARK: The catalogue

/**
 * One piece of the website catalogue: [image] is the full picture (what the bill prints), [thumb] a small one for the grid.
 * [type] and [stones] are the facet ids the server names (empty from an older server); [haystack] is the lower-cased
 * words the search looks through (title, category, type and stones), built once at decode.
 */
data class CataloguePiece(
    val id: String, val title: String, val category: String, val image: String, val thumb: String,
    val type: String = "", val stones: List<String> = emptyList(), val haystack: String = "",
)

/** One chip of a facet row: the server's id and label, and how many pieces carry it in the loaded category. */
data class CatalogueFacet(val id: String, val label: String, val count: Int)

/** A category's pieces with the facets the server offered for them (empty from an older server: the rows hide). */
data class CatalogueSet(val pieces: List<CataloguePiece> = emptyList(), val types: List<CatalogueFacet> = emptyList(), val stones: List<CatalogueFacet> = emptyList())

/** What the picker narrows the loaded set by, instantly and on the phone: words, types (any of), stones (all of, as the server). */
data class CatalogueFilter(val query: String = "", val types: Set<String> = emptySet(), val stones: Set<String> = emptySet()) {
    val isEmpty: Boolean get() = query.isBlank() && types.isEmpty() && stones.isEmpty()

    /** Every typed word must be somewhere in the piece's words. */
    private val words: List<String> get() = query.lowercase().split(' ', ',').filter { it.isNotEmpty() }

    /** The server's rule: one of the types, and every chosen stone (a stone chip narrows, as the web's does), and every typed word. */
    private fun matches(p: CataloguePiece, words: List<String>, extraStone: String? = null, ignoringTypes: Boolean = false): Boolean {
        if (!ignoringTypes && types.isNotEmpty() && p.type !in types) return false
        for (s in stones) if (s !in p.stones) return false
        if (extraStone != null && extraStone !in p.stones) return false
        for (w in words) if (!p.haystack.contains(w)) return false
        return true
    }

    fun apply(pieces: List<CataloguePiece>): List<CataloguePiece> {
        if (isEmpty) return pieces
        val w = words
        return pieces.filter { matches(it, w) }
    }

    /** The facets with the count each chip would show if tapped now (the other row and the words kept), in the server's order. */
    fun recount(facets: List<CatalogueFacet>, pieces: List<CataloguePiece>, stonesRow: Boolean): List<CatalogueFacet> {
        val w = words
        if (stonesRow) return facets.map { f -> f.copy(count = pieces.count { matches(it, w, extraStone = f.id) }) }
        val counts = HashMap<String, Int>()
        for (p in pieces) if (matches(p, w, ignoringTypes = true)) counts[p.type] = (counts[p.type] ?: 0) + 1
        return facets.map { f -> f.copy(count = counts[f.id] ?: 0) }
    }

    fun toggleType(id: String): CatalogueFilter = copy(types = if (id in types) types - id else types + id)

    fun toggleStone(id: String): CatalogueFilter = copy(stones = if (id in stones) stones - id else stones + id)
}

/**
 * `GET /api/app/catalogue?category=`, kept in memory for the session so a category seen before is instant. The words, types
 * and stones are filtered on the loaded set ([CatalogueFilter]), so only a new category asks the server again.
 */
object CatalogueStore {
    private val cache = HashMap<String, CatalogueSet>()

    private fun key(category: String) = Businesses.current.id + "|" + category

    fun cached(category: String): CatalogueSet? = cache[key(category)]

    fun path(category: String, q: String = ""): String {
        val items = ArrayList<String>()
        if (category.isNotEmpty()) items.add("category=" + URLEncoder.encode(category, "UTF-8"))
        if (q.isNotEmpty()) items.add("q=" + URLEncoder.encode(q, "UTF-8"))
        return "/api/app/catalogue" + if (items.isEmpty()) "" else "?" + items.joinToString("&")
    }

    suspend fun fetch(category: String): CatalogueSet {
        val k = key(category)
        cache[k]?.let { return it }
        val set = parse(ErpApi.shared.data(path(category)))
        cache[k] = set
        return set
    }

    fun parse(text: String): CatalogueSet {
        val root = Json.parse(text) as? Map<*, *> ?: return CatalogueSet()
        val out = ArrayList<CataloguePiece>()
        for (r in (root["pieces"] as? List<*>).orEmpty()) {
            val row = r as? Map<*, *> ?: continue
            val image = (row["image"] as? String) ?: ""
            val thumb = (row["thumb"] as? String) ?: ""
            if (!image.startsWith("http") && !thumb.startsWith("http")) continue
            val title = (row["title"] as? String) ?: ""
            val category = (row["category"] as? String) ?: ""
            val type = (row["type"] as? String) ?: ""
            val stones = (row["stones"] as? List<*>).orEmpty().filterIsInstance<String>()
            out.add(
                CataloguePiece(
                    id = (row["id"] as? String) ?: image.ifEmpty { thumb }, title = title, category = category,
                    image = image.ifEmpty { thumb }, thumb = thumb.ifEmpty { image },
                    type = type, stones = stones, haystack = (listOf(title, category, type) + stones).joinToString(" ").lowercase(),
                ),
            )
        }
        val facets = root["facets"] as? Map<*, *>
        val types = facetList(facets?.get("types"))
        val stoneFacets = facetList(facets?.get("stones"))
        // Their labels also join each piece's search words ("emerald" finds a stone id "emerald").
        val typeLabels = types.associate { it.id to it.label.lowercase() }
        val stoneLabels = stoneFacets.associate { it.id to it.label.lowercase() }
        val pieces = if (types.isEmpty() && stoneFacets.isEmpty()) out else out.map { p ->
            var h = p.haystack
            typeLabels[p.type]?.let { h += " $it" }
            for (s in p.stones) stoneLabels[s]?.let { h += " $it" }
            p.copy(haystack = h)
        }
        return CatalogueSet(pieces, types, stoneFacets)
    }

    /** The facet rows, decoded leniently: a row without an id is skipped, a missing label is the id, a missing count is 0. */
    private fun facetList(any: Any?): List<CatalogueFacet> =
        (any as? List<*>).orEmpty().mapNotNull { r ->
            val row = r as? Map<*, *> ?: return@mapNotNull null
            val id = (row["id"] as? String).orEmpty()
            if (id.isEmpty()) return@mapNotNull null
            CatalogueFacet(id, (row["label"] as? String) ?: id, (row["count"] as? Number)?.toInt() ?: 0)
        }
}
