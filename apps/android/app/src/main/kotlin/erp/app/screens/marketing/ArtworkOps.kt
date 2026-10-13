package erp.app.screens.marketing

import java.util.UUID

// The editor's own moves on a design, as plain functions on the raw document (ArtworkEditor.swift's private funcs):
// which layers a tap selects, the arrangement menu, the undo that folds a slider's steps. The engine does the rest
// (presets, palettes, alignment, scale); nothing here knows a layer's fields beyond `id`, `group`, `locked`, `x`, `y`.

object ArtworkOps {
    fun layers(doc: MarketingValue): List<MarketingValue> = doc["layers"].array

    fun withLayers(doc: MarketingValue, layers: List<MarketingValue>) = doc.with("layers", MarketingValue.array(layers))

    /** A tap selects the layer and its whole group; a long press adds it to, or takes it from, the chosen; tapping a chosen one of several keeps them. */
    fun select(layers: List<MarketingValue>, selected: Set<String>, id: String, multiple: Boolean): Set<String> {
        if (multiple) return if (id in selected) selected - id else selected + id
        if (id in selected && selected.size > 1) return selected
        val group = layers.firstOrNull { it.s("id") == id }?.s("group") ?: ""
        return if (group.isEmpty()) setOf(id) else layers.filter { it.s("group") == group }.map { it.s("id") }.toSet()
    }

    /** Fields set on one layer. */
    fun patch(doc: MarketingValue, id: String, fields: Map<String, MarketingValue>): MarketingValue =
        withLayers(doc, layers(doc).map { l -> if (l.s("id") == id) fields.entries.fold(l) { n, (k, v) -> n.with(k, v) } else l })

    /** Fields set on every chosen layer that is not locked. */
    fun setSelected(doc: MarketingValue, selected: Set<String>, fields: Map<String, MarketingValue>): MarketingValue =
        withLayers(doc, layers(doc).map { l -> if (l.s("id") in selected && !l["locked"].bool) fields.entries.fold(l) { n, (k, v) -> n.with(k, v) } else l })

    /** Mirror: each chosen, unlocked layer's flag turned over. */
    fun flip(doc: MarketingValue, selected: Set<String>, key: String): MarketingValue =
        withLayers(doc, layers(doc).map { l -> if (l.s("id") in selected && !l["locked"].bool) l.with(key, MarketingValue.bool(!l[key].bool)) else l })

    /** Bring to front / send to back: the chosen keep their order among themselves. */
    fun reorder(doc: MarketingValue, selected: Set<String>, front: Boolean): MarketingValue {
        val kept = layers(doc).filter { it.s("id") !in selected }
        val own = layers(doc).filter { it.s("id") in selected }
        return withLayers(doc, if (front) kept + own else own + kept)
    }

    /** One place up or down the stack for each chosen layer (the page's ↑/↓), the others keeping their order. */
    fun step(doc: MarketingValue, selected: Set<String>, by: Int): MarketingValue {
        val a = layers(doc).toMutableList()
        val order = if (by > 0) a.indices.reversed() else a.indices
        for (i in order) {
            if (a[i].s("id") !in selected) continue
            val j = i + by
            if (j !in a.indices || a[j].s("id") in selected) continue
            val t = a[i]; a[i] = a[j]; a[j] = t
        }
        return withLayers(doc, a)
    }

    /** Copies 24 px down and across, unlocked, each group a new group; returns the document and the copies' ids. */
    fun duplicate(doc: MarketingValue, source: List<MarketingValue>, newId: () -> String = { UUID.randomUUID().toString() }): Pair<MarketingValue, Set<String>> {
        val groups = HashMap<String, String>()
        val made = source.map { l ->
            var n = l.with("id", MarketingValue.string(newId()))
                .with("x", MarketingValue.number(l.n("x") + 24)).with("y", MarketingValue.number(l.n("y") + 24))
                .with("locked", MarketingValue.bool(false))
            val g = l.s("group")
            if (g.isNotEmpty()) {
                val id = groups.getOrPut(g) { newId() }
                n = n.with("group", MarketingValue.string(id))
            }
            n
        }
        return withLayers(doc, layers(doc) + made) to made.map { it.s("id") }.toSet()
    }

    /** Remove: the chosen go, a locked one stays. */
    fun remove(doc: MarketingValue, selected: Set<String>): MarketingValue =
        withLayers(doc, layers(doc).filter { it.s("id") !in selected || it["locked"].bool })

    fun add(doc: MarketingValue, layer: MarketingValue): MarketingValue = withLayers(doc, layers(doc) + layer)

    /** Moves the chosen unlocked layers by (dx, dy) page px from where [start] had them; `flow` is let go, as a dragged layer is placed by hand. */
    fun dragged(start: MarketingValue, selected: Set<String>, dx: Double, dy: Double): MarketingValue =
        withLayers(start, layers(start).map { s ->
            if (s.s("id") !in selected || s["locked"].bool) s
            else s.with("x", MarketingValue.number(s.n("x") + dx)).with("y", MarketingValue.number(s.n("y") + dy)).with("flow", MarketingValue.NULL)
        })

    /** What the layers list calls a layer: its name, the field it is bound to, its words, else its kind. */
    fun name(l: MarketingValue): String {
        if (l.s("name").isNotEmpty()) return l.s("name")
        if (l.s("bind").isNotEmpty()) return ArtworkProperties.label(l.s("bind"))
        return if (l.s("text").isEmpty()) ArtworkProperties.label(l.s("kind")) else l.s("text")
    }

    fun photoName(photoIds: Collection<String>, key: String): String = "Photo ${(photoIds.sorted().indexOf(key).takeIf { it >= 0 } ?: 0) + 1}"

    /** The background's crop lives per photo in a square (`placements`), else in the background itself. */
    fun placement(doc: MarketingValue): MarketingValue {
        val id = doc["bg"].s("photoId")
        if (!doc["placements"].isNull) {
            return if (doc["placements"][id].isNull) MarketingValue.of(mapOf("mode" to "fill", "zoom" to 1, "focusX" to 0.5, "focusY" to 0.5)) else doc["placements"][id]
        }
        return doc["bg"]["placement"]
    }

    fun withPlacement(doc: MarketingValue, value: MarketingValue): MarketingValue {
        val id = doc["bg"].s("photoId")
        return if (!doc["placements"].isNull && id.isNotEmpty()) doc.withPath(listOf("placements", id), value) else doc.withPath(listOf("bg", "placement"), value)
    }
}

/**
 * The editor's undo: at most 80 steps; slider steps close together (the same key within 1.2 s) are one step, as on the
 * board designer. A pure holder: the document itself lives with the caller, which passes the current one in.
 */
class ArtworkHistory {
    private val undo = ArrayList<MarketingValue>()
    private val redo = ArrayList<MarketingValue>()
    private var coalesceKey = ""
    private var coalesceAt = Long.MIN_VALUE / 2

    val canUndo: Boolean get() = undo.isNotEmpty()
    val canRedo: Boolean get() = redo.isNotEmpty()

    /** Records that [current] is about to become [next]. Returns false when nothing changed. */
    fun change(current: MarketingValue, next: MarketingValue, key: String? = null, nowMillis: Long): Boolean {
        if (next == current) return false
        val previous = coalesceAt
        coalesceAt = nowMillis
        if (key != null && key == coalesceKey && nowMillis - previous < 1200) {
            redo.clear()
            return true
        }
        coalesceKey = key ?: ""
        undo.add(current)
        if (undo.size > 80) undo.removeAt(0)
        redo.clear()
        return true
    }

    /** A step taken by a gesture (a drag): [start] is where it began; it is one undo step if it moved anything. */
    fun gesture(start: MarketingValue, end: MarketingValue) {
        if (start != end) { undo.add(start); redo.clear() }
    }

    /** The document after Undo / Redo from [current]; null when there is none. */
    fun back(current: MarketingValue): MarketingValue? {
        coalesceKey = ""
        val d = undo.removeLastOrNull() ?: return null
        redo.add(current)
        return d
    }

    fun forward(current: MarketingValue): MarketingValue? {
        coalesceKey = ""
        val d = redo.removeLastOrNull() ?: return null
        undo.add(current)
        return d
    }
}
