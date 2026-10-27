package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilterChip as M3FilterChip
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import java.util.Locale
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

// Designer v2 rich text and gradients (ArtworkRichText.swift; src/lib/social/editor.ts setRunStyle / normalizeRuns, gradient.ts;
// panels/text-runs.tsx, gradient-editor.tsx). Runs index the words as written, in UTF-16 units like the web's string offsets (a Kotlin
// String is UTF-16 too), so a design edited here and on the web styles the same letters.

// MARK: - Runs

object ArtworkRuns {
    class Piece(val from: Int, val to: Int, val style: Map<String, MarketingValue>)
    class Token(val from: Int, val to: Int, val text: String, val word: Boolean)

    /** tokenise (text-runs.tsx): the words and the gaps between them, with where each starts. */
    fun tokens(text: String): List<Token> {
        val out = ArrayList<Token>()
        var i = 0
        while (i < text.length) {
            val isSpace = text[i].isWhitespace()
            var j = i + 1
            while (j < text.length && text[j].isWhitespace() == isSpace) j += 1
            out.add(Token(i, j, text.substring(i, j), !isSpace))
            i = j
        }
        return out
    }

    /** normalizeRuns: kept inside the words (0…len), without empty ones. */
    fun normalize(runs: List<MarketingValue>, len: Int): List<Piece> {
        val out = ArrayList<Piece>()
        for (r in runs) {
            if (r["from"].isNull || r["to"].isNull) continue
            val from = max(0, min(len, Math.round(r.n("from")).toInt()))
            val to = max(0, min(len, Math.round(r.n("to")).toInt()))
            if (to <= from) continue
            out.add(Piece(from, to, r.obj.filterKeys { it != "from" && it != "to" }))
        }
        return out
    }

    fun encode(p: Piece): MarketingValue = MarketingValue.of(LinkedHashMap<String, Any?>(p.style).apply { put("from", p.from); put("to", p.to) })

    /** setRunStyle: characters `from`…`to` are styled, the runs cut at the edges, a null patch value clears that key, and neighbours with the same style join. */
    fun set(runs: List<MarketingValue>, from: Int, to: Int, patch: Map<String, MarketingValue?>, len: Int): List<MarketingValue> {
        val cur = normalize(runs, len)
        val a = max(0, min(len, from))
        val b = max(0, min(len, to))
        if (b <= a) return cur.map(::encode)
        val cuts = sortedSetOf(0, len, a, b)
        for (r in cur) { cuts.add(r.from); cuts.add(r.to) }
        val pts = cuts.toList()
        val pieces = ArrayList<Piece>()
        for (i in 0 until max(0, pts.size - 1)) {
            val f = pts[i]
            val t = pts[i + 1]
            val style = LinkedHashMap<String, MarketingValue>()
            for (r in cur) if (r.from <= f && r.to >= t) style.putAll(r.style)
            if (f >= a && t <= b) {
                for ((k, v) in patch) if (v != null) style[k] = v else style.remove(k)
            }
            if (style.isNotEmpty()) {
                val last = pieces.lastOrNull()
                if (last != null && last.to == f && last.style == style) pieces[pieces.size - 1] = Piece(last.from, t, last.style)
                else pieces.add(Piece(f, t, style))
            }
        }
        return pieces.map(::encode)
    }

    /** BOLD_OF / ITALIC_OF. */
    val boldOf = mapOf("light" to "regular", "regular" to "bold", "bold" to "regular", "montserrat" to "montserrat-bold", "montserrat-bold" to "montserrat")
    val italicOf = mapOf("serif" to "serif-italic", "serif-italic" to "serif", "cormorant" to "cormorant-italic", "cormorant-italic" to "cormorant")
}

/** FONT_LABEL, in the web's order (the fourteen faces plus the six Designer v2 jewellery faces). */
object ArtworkFont {
    val faces: List<Pair<String, String>> = listOf(
        "condensed" to "Condensed (headline)", "light" to "Light", "regular" to "Regular", "bold" to "Bold",
        "serif" to "Didone", "serif-italic" to "Didone italic", "futura" to "Futura (stamp)",
        "cormorant" to "Cormorant", "cormorant-italic" to "Cormorant italic", "playfair" to "Playfair", "script" to "Script",
        "montserrat" to "Montserrat", "montserrat-bold" to "Montserrat bold", "cinzel" to "Cinzel (capitals)",
        "cormorant-infant" to "Cormorant Infant", "italiana" to "Italiana", "jost" to "Jost", "tenor" to "Tenor Sans", "dm-serif" to "DM Serif", "marcellus" to "Marcellus",
    )

    fun label(id: String): String = faces.firstOrNull { it.first == id }?.second ?: ArtworkProperties.label(id)
}

// MARK: - Gradients

class ArtworkStop(val at: Double, val color: String, val alpha: Double? = null)

object ArtworkGradients {
    fun make(type: String = "linear", angle: Double, stops: List<ArtworkStop>): MarketingValue = MarketingValue.of(
        mapOf(
            "type" to type, "angle" to angle,
            "stops" to stops.map { s -> linkedMapOf<String, Any?>("at" to s.at, "color" to s.color).apply { if (s.alpha != null) put("alpha", s.alpha) } },
        ),
    )

    /** normalizeGradient: sorted by position, 0…1, at least two stops. */
    fun stops(g: MarketingValue): List<ArtworkStop> {
        var out = g["stops"].array.filter { !it["color"].isNull && !it["at"].isNull }
            .map { ArtworkStop(min(1.0, max(0.0, it.n("at"))), it.s("color"), if (it["alpha"].isNull) null else min(1.0, max(0.0, it.n("alpha")))) }
        out = out.withIndex().sortedWith(compareBy({ it.value.at }, { it.index })).map { it.value }
        if (out.isEmpty()) return listOf(ArtworkStop(0.0, "#000000"), ArtworkStop(1.0, "#ffffff"))
        if (out.size == 1) {
            val s = out[0]
            out = (out + ArtworkStop(if (s.at < 1) 1.0 else 0.0, s.color, s.alpha)).sortedBy { it.at }
        }
        return out
    }

    private fun foil(stops: List<Pair<Double, String>>): MarketingValue = make(angle = 100.0, stops = stops.map { ArtworkStop(it.first, it.second) })

    val gold = foil(listOf(0.0 to "#8C6A25", 0.3 to "#E9C979", 0.5 to "#FBEFC4", 0.7 to "#C9973F", 1.0 to "#7A5A1E"))
    val rose = foil(listOf(0.0 to "#8E5B4B", 0.35 to "#EBB8A0", 0.55 to "#FBE3D4", 0.8 to "#C4856C", 1.0 to "#7C4A3C"))
    val silver = foil(listOf(0.0 to "#7C7F86", 0.3 to "#E3E5EA", 0.5 to "#FAFAFC", 0.72 to "#B4B8C0", 1.0 to "#6E7178"))

    class Preset(val id: String, val label: String, val gradient: MarketingValue)

    /** FOILS: the house's own first (gold and rose for a gold house, silver for a silver one: the descriptor's `metal`). */
    val foils: List<Preset>
        get() {
            val all = listOf(Preset("gold", "Gold foil", gold), Preset("rose", "Rose gold", rose), Preset("silver", "Silver foil", silver))
            return if (House.metal == "silver") listOf(all[2], all[1], all[0]) else all
        }

    val others: List<Preset> = listOf(
        Preset("dusk", "Dark fade", make(angle = 180.0, stops = listOf(ArtworkStop(0.0, "#000000"), ArtworkStop(1.0, "#1F4A2C")))),
        Preset("glow", "Soft glow", make(type = "radial", angle = 0.0, stops = listOf(ArtworkStop(0.0, "#FFE9B0"), ArtworkStop(1.0, "#C9973F", 0.0)))),
        Preset("ivory", "Ivory", make(angle = 160.0, stops = listOf(ArtworkStop(0.0, "#FBF6EC"), ArtworkStop(1.0, "#E8D5B5")))),
    )

    /** Two "#rrggbb" mixed, for a stop added between its neighbours. */
    fun mix(a: String, b: String, t: Double): String {
        val x = ArtworkColor.parse(a) ?: return a
        val y = ArtworkColor.parse(b) ?: return a
        fun c(p: Int, q: Int) = Math.round(p + (q - p) * t).toInt()
        return String.format(Locale.ROOT, "#%02x%02x%02x", c(x.first, y.first), c(x.second, y.second), c(x.third, y.third))
    }
}

// MARK: - Compose

private fun colourOf(s: ArtworkStop): Color = (ArtworkColor.color(s.color) ?: Color.White).copy(alpha = (s.alpha ?: 1.0).toFloat())

/** The brush a gradient draws with in a swatch (a CSS angle: 180 runs down, 90 to the right). */
fun artworkBrush(g: MarketingValue, width: Float, height: Float): Brush {
    val stops = ArtworkGradients.stops(g).map { it.at.toFloat() to colourOf(it) }.toTypedArray()
    if (g.s("type") == "radial") return Brush.radialGradient(*stops, radius = max(width, height) / 2f)
    val rad = Math.toRadians(g.n("angle", 180.0))
    val dx = sin(rad).toFloat()
    val dy = -cos(rad).toFloat()
    val cx = width / 2f
    val cy = height / 2f
    return Brush.linearGradient(*stops, start = androidx.compose.ui.geometry.Offset(cx - dx * width / 2f, cy - dy * height / 2f), end = androidx.compose.ui.geometry.Offset(cx + dx * width / 2f, cy + dy * height / 2f))
}

/**
 * Mixed styles in one box: pick words, style them (face, bold, italic, underline, capitals, size, colour, foil), see and remove the
 * styled stretches; under it what applies to the whole text (gradient fill, bullets or numbers).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArtworkRunsRows(layer: MarketingValue, words: String, change: ArtworkChange) {
    var picked by remember(layer.s("id")) { mutableStateOf(setOf<Int>()) }
    var customFoil by remember(layer.s("id")) { mutableStateOf(false) }
    val length = words.length
    val tokens = remember(words) { ArtworkRuns.tokens(words).filter { it.word } }
    // The stretches to style: runs of neighbouring picked words, or all of it when none are picked.
    val spans: List<Pair<Int, Int>> = run {
        val idx = picked.filter { it < tokens.size }.sorted()
        if (idx.isEmpty()) listOf(0 to length)
        else {
            val out = ArrayList<Pair<Int, Int>>()
            var start = idx[0]
            var prev = idx[0]
            for (i in idx.drop(1)) { if (i == prev + 1) prev = i else { out.add(tokens[start].from to tokens[prev].to); start = i; prev = i } }
            out.add(tokens[start].from to tokens[prev].to)
            out
        }
    }
    val f = spans.firstOrNull()?.first ?: 0
    val here = ArtworkRuns.normalize(layer["runs"].array, length).firstOrNull { it.from <= f && it.to > f }

    fun apply(patch: Map<String, MarketingValue?>, key: String? = null) {
        if (length == 0) return
        var runs = layer["runs"].array
        for (s in spans) runs = ArtworkRuns.set(runs, s.first, s.second, patch, length)
        change(if (runs.isEmpty()) layer.without("runs") else layer.with("runs", MarketingValue.array(runs)), key)
    }

    if (layer.n("curve") != 0.0) {
        Text("Bent text is drawn in one style. Set its Curve to 0 to style single words.", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
    }
    if (length == 0) {
        Text("Type some words first.", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Pick the words", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { picked = tokens.indices.toSet() }) { Text("All") }
            TextButton(onClick = { picked = emptySet() }) { Text("None") }
        }
        FlowRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            tokens.forEachIndexed { i, t ->
                val on = i in picked
                M3FilterChip(selected = on, onClick = { picked = if (on) picked - i else picked + i }, label = { Text(t.text) })
            }
        }
        Text(
            if (picked.isEmpty()) "None picked: styles go on all of it." else "${picked.size} picked. Tap a word to add or remove it.",
            Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // Face, bold, italic, underline, capitals, size, colour and foil of the picked stretch.
        val face = here?.style?.get("font")?.string ?: layer.s("font", "regular")
        val boldOn = face == "bold" || face == "montserrat-bold"
        val italicOn = face.endsWith("italic")
        PickerRow("Face", here?.style?.get("font")?.string ?: "__base", listOf("__base" to "Same as the rest") + ArtworkFont.faces) { v -> apply(mapOf("font" to if (v == "__base") null else MarketingValue.string(v))) }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip("Bold", boldOn, { ArtworkRuns.boldOf[face]?.let { b -> apply(mapOf("font" to if (b == layer.s("font")) null else MarketingValue.string(b))) } })
            FilterChip("Italic", italicOn, { ArtworkRuns.italicOf[face]?.let { i -> apply(mapOf("font" to if (i == layer.s("font")) null else MarketingValue.string(i))) } })
            FilterChip("Underline", here?.style?.get("underline")?.bool ?: false, { apply(mapOf("underline" to if (here?.style?.get("underline")?.bool == true) null else MarketingValue.bool(true))) })
            FilterChip("Capitals", here?.style?.get("upper")?.bool ?: false, { apply(mapOf("upper" to if (here?.style?.get("upper")?.bool == true) null else MarketingValue.bool(true))) })
        }
        ArtworkSlider("Size ×", here?.style?.get("size")?.number ?: 1.0, 0.4..3.0, { v -> apply(mapOf("size" to if (Math.abs(v - 1) < 0.03) null else MarketingValue.number(v)), "run-size") }, step = 0.05, format = { String.format(Locale.ROOT, "%.2f×", it) })
        ArtworkColorRow("Colour", here?.style?.get("color")?.string ?: layer.s("color", "#FFFFFF")) { c -> apply(mapOf("color" to MarketingValue.string(c.lowercase()), "gradient" to null), "run-colour") }
        if (here?.style?.get("color") != null) erp.app.ui.ActionRow("Colour: same as the rest", { apply(mapOf("color" to null)) })
        ArtworkMenuRow(
            "Foil",
            ArtworkGradients.foils.map { fo -> MenuNode.Action(fo.label) { apply(mapOf("gradient" to fo.gradient)) } } +
                (if (here?.style?.get("gradient") != null) listOf(MenuNode.Action("Remove foil", destructive = true) { apply(mapOf("gradient" to null)); customFoil = false }) else emptyList()),
        )
        if (here?.style?.get("gradient") != null) {
            ToggleRow("Fine-tune the foil", customFoil, onChange = { customFoil = it })
            if (customFoil) ArtworkGradientRows(here.style["gradient"] ?: MarketingValue.NULL) { g, key -> apply(mapOf("gradient" to g), key) }
        }
        erp.app.ui.ActionRow("Clear styles on the picked words", { apply(mapOf("font" to null, "color" to null, "size" to null, "upper" to null, "underline" to null, "gradient" to null)) })

        val runs = ArtworkRuns.normalize(layer["runs"].array, length)
        if (runs.isNotEmpty()) {
            Text("Styled stretches · ${runs.size}", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall)
            runs.forEachIndexed { index, r ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(words.substring(r.from, r.to), maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                        Text(runSummary(r), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { picked = tokens.indices.filter { tokens[it].from >= r.from && tokens[it].to <= r.to }.toSet() }, Modifier.semantics { contentDescription = "Pick these words" }) { Icon(Symbols.GpsFixed, null) }
                    IconButton(onClick = {
                        val all = ArtworkRuns.normalize(layer["runs"].array, length).toMutableList()
                        if (index in all.indices) {
                            all.removeAt(index)
                            change(if (all.isEmpty()) layer.without("runs") else layer.with("runs", MarketingValue.array(all.map(ArtworkRuns::encode))), null)
                        }
                    }, Modifier.semantics { contentDescription = "Remove this style" }) { Icon(Symbols.Delete, null, tint = Tone.problem.color()) }
                }
            }
        }
    }
    Text("The whole text", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall)
    ToggleRow("Gradient fill (gold foil text)", !layer["fillGradient"].isNull, onChange = { on ->
        change(if (on) layer.with("fillGradient", ArtworkGradients.foils[0].gradient) else layer.without("fillGradient"), null)
    })
    if (!layer["fillGradient"].isNull) ArtworkGradientRows(layer["fillGradient"]) { g, key -> change(layer.with("fillGradient", g), key) }
    PickerRow("List", layer.s("list", "none"), listOf("none" to "None", "bullet" to "Bullets", "number" to "Numbers")) { v ->
        change(if (v == "none") layer.without("list") else layer.with("list", MarketingValue.string(v)), null)
    }
    Text("A list puts a bullet or a number at every line break.", Modifier.padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun runSummary(r: ArtworkRuns.Piece): String {
    val parts = ArrayList<String>()
    r.style["font"]?.string?.let { parts.add(ArtworkFont.label(it)) }
    r.style["size"]?.number?.let { parts.add(String.format(Locale.ROOT, "%.2f×", it)) }
    r.style["color"]?.string?.let { parts.add(it) }
    if (r.style["gradient"] != null) parts.add("foil")
    if (r.style["upper"]?.bool == true) parts.add("capitals")
    if (r.style["underline"]?.bool == true) parts.add("underline")
    return parts.joinToString(" · ")
}

/** The gradient editor: linear at any angle or radial, two to eight stops, each with colour, position and opacity. */
@Composable
fun ArtworkGradientRows(gradient: MarketingValue, change: ArtworkChange) {
    var sel by remember { mutableIntStateOf(0) }
    val stops = ArtworkGradients.stops(gradient)
    val type = if (gradient.s("type") == "radial") "radial" else "linear"
    val angle = gradient.n("angle", 180.0)
    val at = min(sel, stops.size - 1)
    fun put(type: String? = null, angle: Double? = null, stops: List<ArtworkStop>? = null, key: String? = null) {
        change(ArtworkGradients.make(type ?: (if (gradient.s("type") == "radial") "radial" else "linear"), angle ?: gradient.n("angle", 180.0), stops ?: ArtworkGradients.stops(gradient)), key)
    }
    fun setPosition(v: Double) {
        val list = stops.toMutableList()
        list[at] = ArtworkStop((v * 100).let { Math.rint(it) } / 100, list[at].color, list[at].alpha)
        val order = list.withIndex().sortedWith(compareBy({ it.value.at }, { it.index }))
        sel = order.indexOfFirst { it.index == at }.coerceAtLeast(0)
        put(stops = order.map { it.value }, key = "g-pos")
    }
    fun setStop(key: String, f: (ArtworkStop) -> ArtworkStop) {
        val list = stops.toMutableList()
        list[at] = f(list[at])
        put(stops = list, key = key)
    }
    fun addStop(position: Double) {
        if (stops.size >= 8) return
        val list = stops.toMutableList()
        val t = min(1.0, max(0.0, Math.rint(position * 100) / 100))
        val before = list.lastOrNull { it.at <= t } ?: list[0]
        val after = list.firstOrNull { it.at >= t } ?: list[list.size - 1]
        val span = after.at - before.at
        val colour = ArtworkGradients.mix(before.color, after.color, if (span > 0) (t - before.at) / span else 0.0)
        list.add(ArtworkStop(t, colour))
        list.sortBy { it.at }
        sel = list.indexOfFirst { it.at == t && it.color == colour }.coerceAtLeast(0)
        put(stops = list)
    }

    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).height(44.dp).clip(Radius.thumbShape).border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)), Radius.thumbShape).semantics { contentDescription = "The gradient" }) {
        androidx.compose.foundation.Canvas(Modifier.matchParentSize()) { drawRect(artworkBrush(gradient, size.width, size.height)) }
    }
    ArtworkMenuRow("Presets", (ArtworkGradients.foils + ArtworkGradients.others).map { p -> MenuNode.Action(p.label) { sel = 0; change(p.gradient, null) } })
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip("Linear", type == "linear", { put(type = "linear") })
        FilterChip("Radial", type == "radial", { put(type = "radial") })
    }
    if (type == "linear") {
        val ways = listOf(180 to "↓ Down", 0 to "↑ Up", 90 to "→ Right", 270 to "← Left", 135 to "↘", 225 to "↙", 45 to "↗", 315 to "↖")
        val current = Math.round(angle).toInt()
        PickerRow("Direction", current.toString(), ways.map { it.first.toString() to it.second } + (if (ways.none { it.first == current }) listOf(current.toString() to "Custom") else emptyList())) { put(angle = it.toDouble()) }
        ArtworkSlider("Angle", angle, 0.0..360.0, { put(angle = Math.rint(it), key = "g-angle") }, format = { String.format(Locale.ROOT, "%.0f°", it) })
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        stops.forEachIndexed { i, s ->
            Box(
                Modifier.size(48.dp).clickable(onClickLabel = "Stop ${i + 1}") { sel = i }.padding(9.dp)
                    .background(colourOf(s), CircleShape)
                    .border(BorderStroke(if (i == at) 3.dp else 1.dp, if (i == at) ErpColors.accent else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)), CircleShape),
            )
        }
    }
    Text("Stop ${at + 1} of ${stops.size}", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    ArtworkColorRow("Stop colour", stops[at].color) { c -> setStop("g-colour") { ArtworkStop(it.at, c.lowercase(), it.alpha) } }
    ArtworkSlider("Position", stops[at].at * 100, 0.0..100.0, { setPosition(it / 100) }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    ArtworkSlider("Opacity", (stops[at].alpha ?: 1.0) * 100, 0.0..100.0, { v -> setStop("g-alpha") { ArtworkStop(it.at, it.color, if (v >= 100) null else v / 100) } }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { val s = stops[at]; addStop(if (s.at < 0.85) s.at + 0.15 else s.at - 0.15) }, enabled = stops.size < 8) { Text("Add stop") }
        OutlinedButton(onClick = { val list = stops.toMutableList(); list.removeAt(at); sel = 0; put(stops = list) }, enabled = stops.size > 2) { Text("Remove stop", color = Tone.problem.color()) }
        OutlinedButton(onClick = { put(stops = stops.reversed().map { ArtworkStop(Math.rint((1 - it.at) * 100) / 100, it.color, it.alpha) }); sel = 0 }) { Text("Reverse") }
    }
}
