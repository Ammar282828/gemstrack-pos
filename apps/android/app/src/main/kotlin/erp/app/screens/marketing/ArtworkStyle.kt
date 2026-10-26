package erp.app.screens.marketing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ui.PickerRow
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import java.util.Locale

// Designer v2 controls for look (ArtworkStyle.swift): blend, opacity, shadow / glow / outline on shapes, photos, marks and QR codes,
// the text effects, and the photo adjustments. They write exactly the web's fields and ranges (src/lib/social/editor.ts, design.ts;
// panels/blend-fx.tsx, adjust.tsx, editor-panels.tsx EffectControls). Every field is optional, so a document without them looks and
// saves as it did.

/**
 * A change a control makes to a layer (or to a stretch of the document): the new value and, for a slider, a key that folds its many
 * steps into one undo (the editor's `fold`).
 */
typealias ArtworkChange = (MarketingValue, String?) -> Unit

object ArtworkFx {
    class Blend(val id: String, val label: String, val hint: String)

    /** BLENDS (panels/blend-fx.tsx): the engine's nine composite operations, with the web's hint for each. */
    val blends: List<Blend> = listOf(
        Blend("normal", "Normal", "Just on top"),
        Blend("multiply", "Multiply", "Darkens: a soft shadow under a cut-out piece"),
        Blend("screen", "Screen", "Lightens: glow, sparkle, gold light"),
        Blend("overlay", "Overlay", "Deepens contrast and colour"),
        Blend("soft-light", "Soft light", "A gentle wash of colour or light"),
        Blend("hard-light", "Hard light", "A strong wash"),
        Blend("color-dodge", "Colour dodge", "Bright, burning highlights"),
        Blend("darken", "Darken", "Keeps whichever is darker"),
        Blend("lighten", "Lighten", "Keeps whichever is lighter"),
    )

    /** FX_DEFAULTS, key for key. */
    val defaults: Map<String, MarketingValue> = mapOf(
        "shadow" to MarketingValue.of(mapOf("color" to "#000000", "x" to 0, "y" to 12, "blur" to 28, "alpha" to 0.35)),
        "glow" to MarketingValue.of(mapOf("color" to "#FFD98A", "blur" to 30, "alpha" to 0.8)),
        "outline" to MarketingValue.of(mapOf("color" to "#FFFFFF", "width" to 6)),
    )

    /** EFFECTS (text), in the web's order. */
    val textEffects: List<Pair<String, String>> = listOf(
        "none" to "None", "shadow" to "Shadow", "lift" to "Lift", "hollow" to "Hollow", "outline" to "Outline",
        "splice" to "Splice", "echo" to "Echo", "neon" to "Neon", "glitch" to "Glitch",
    )

    /** effectDefaults(kind, text colour), key for key. */
    fun effectDefaults(kind: String, ink: String): MarketingValue {
        val e = linkedMapOf<String, Any?>("kind" to kind, "color" to "#000000", "offset" to 30, "angle" to 45, "blur" to 20, "thickness" to 40, "transparency" to 50)
        val dark = ink.lowercase() == "#000000" || ink.lowercase() == "#111111"
        when (kind) {
            "lift" -> e["transparency"] = 40
            "hollow" -> e["thickness"] = 35
            "outline" -> { e["color"] = if (dark) "#FFFFFF" else "#111111"; e["thickness"] = 45 }
            "splice" -> { e["color"] = "#C9973F"; e["offset"] = 40; e["thickness"] = 35 }
            "echo" -> { e["color"] = ink; e["offset"] = 35 }
            "neon" -> { e["color"] = ink; e["blur"] = 50 }
        }
        return MarketingValue.of(e)
    }

    /** Which of a text effect's parameters its kind uses (the Swift `uses`). */
    fun uses(kind: String, key: String): Boolean = when (key) {
        "offset" -> kind in listOf("shadow", "splice", "echo", "glitch")
        "angle" -> kind in listOf("shadow", "splice", "echo")
        "blur" -> kind in listOf("shadow", "neon")
        "thickness" -> kind in listOf("hollow", "outline", "splice")
        "transparency" -> kind in listOf("shadow", "lift")
        else -> kind in listOf("shadow", "outline", "splice", "echo", "neon")
    }

    /** The layer with `blend` set (normal drops it: the web writes `undefined`). */
    fun withBlend(layer: MarketingValue, v: String): MarketingValue = if (v == "normal") layer.without("blend") else layer.with("blend", MarketingValue.string(v))

    /** `layerFx[name]` switched on (its defaults) or off; an empty `layerFx` goes. */
    fun withFxToggled(layer: MarketingValue, name: String, on: Boolean): MarketingValue {
        var all = layer["layerFx"]
        all = if (on) all.with(name, defaults[name] ?: MarketingValue.NULL) else all.without(name)
        return if (all.obj.isEmpty()) layer.without("layerFx") else layer.with("layerFx", all)
    }

    fun withFxValue(layer: MarketingValue, name: String, key: String, value: MarketingValue): MarketingValue {
        val all = layer["layerFx"]
        val one = (if (all[name].isNull) (defaults[name] ?: MarketingValue.NULL) else all[name]).with(key, value)
        return layer.with("layerFx", all.with(name, one))
    }

    /** The text effect picked: none drops it, else its defaults, and the plain shadow switch goes off. */
    fun withTextEffect(layer: MarketingValue, kind: String): MarketingValue =
        if (kind == "none") layer.without("effect") else layer.with("effect", effectDefaults(kind, layer.s("color", "#FFFFFF"))).with("shadow", MarketingValue.bool(false))

    fun withEffectValue(layer: MarketingValue, key: String, value: MarketingValue): MarketingValue =
        layer.with("effect", layer["effect"].with(key, value)).with("shadow", MarketingValue.bool(false))
}

/**
 * Blend, opacity, and (for anything that is not text) shadow, glow and outline: the web's Effects panel. [layer] may be the first of
 * several selected layers; the editor copies the result to the rest.
 */
@Composable
fun ArtworkEffectsRows(layer: MarketingValue, change: ArtworkChange) {
    val isText = layer.s("kind") == "text"
    fun fx(name: String) = layer["layerFx"][name]
    fun number(name: String, key: String, scale: Double = 1.0): Double = fx(name).n(key, ArtworkFx.defaults[name]?.n(key) ?: 0.0) * scale
    val blend = layer.s("blend", "normal")
    PickerRow("Blend", blend, ArtworkFx.blends.map { it.id to it.label }) { change(ArtworkFx.withBlend(layer, it), null) }
    ArtworkFx.blends.firstOrNull { it.id == blend }?.takeIf { blend != "normal" }?.let {
        Text(it.hint + ".", Modifier.padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    // The web's slider is "Transparency" 0…95%; opacity is kept 0.05…1.
    ArtworkSlider("Opacity", layer.n("opacity", 1.0) * 100, 5.0..100.0, { change(layer.with("opacity", MarketingValue.number(Math.rint(it) / 100)), "opacity") }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    if (!isText) {
        ToggleRow("Shadow", fx("shadow").isNull.not(), onChange = { change(ArtworkFx.withFxToggled(layer, "shadow", it), null) })
        if (!fx("shadow").isNull) {
            ArtworkColorRow("Shadow colour", fx("shadow").s("color", "#000000")) { change(ArtworkFx.withFxValue(layer, "shadow", "color", MarketingValue.string(it.lowercase())), null) }
            ArtworkSlider("Across", number("shadow", "x"), -100.0..100.0, { change(ArtworkFx.withFxValue(layer, "shadow", "x", MarketingValue.number(it)), "fx-shadow-x") })
            ArtworkSlider("Down", number("shadow", "y"), -100.0..100.0, { change(ArtworkFx.withFxValue(layer, "shadow", "y", MarketingValue.number(it)), "fx-shadow-y") })
            ArtworkSlider("Blur", number("shadow", "blur"), 0.0..120.0, { change(ArtworkFx.withFxValue(layer, "shadow", "blur", MarketingValue.number(it)), "fx-shadow-blur") })
            ArtworkSlider("Strength", number("shadow", "alpha", 100.0), 0.0..100.0, { change(ArtworkFx.withFxValue(layer, "shadow", "alpha", MarketingValue.number(it / 100)), "fx-shadow-alpha") }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
        }
        ToggleRow("Glow", fx("glow").isNull.not(), onChange = { change(ArtworkFx.withFxToggled(layer, "glow", it), null) })
        if (!fx("glow").isNull) {
            ArtworkColorRow("Glow colour", fx("glow").s("color", "#FFD98A")) { change(ArtworkFx.withFxValue(layer, "glow", "color", MarketingValue.string(it.lowercase())), null) }
            ArtworkSlider("Spread", number("glow", "blur"), 0.0..160.0, { change(ArtworkFx.withFxValue(layer, "glow", "blur", MarketingValue.number(it)), "fx-glow-blur") })
            ArtworkSlider("Strength", number("glow", "alpha", 100.0), 0.0..100.0, { change(ArtworkFx.withFxValue(layer, "glow", "alpha", MarketingValue.number(it / 100)), "fx-glow-alpha") }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
        }
        ToggleRow("Outline", fx("outline").isNull.not(), onChange = { change(ArtworkFx.withFxToggled(layer, "outline", it), null) })
        if (!fx("outline").isNull) {
            ArtworkColorRow("Outline colour", fx("outline").s("color", "#FFFFFF")) { change(ArtworkFx.withFxValue(layer, "outline", "color", MarketingValue.string(it.lowercase())), null) }
            ArtworkSlider("Thickness", number("outline", "width"), 1.0..60.0, { change(ArtworkFx.withFxValue(layer, "outline", "width", MarketingValue.number(it)), "fx-outline-width") })
        }
        if (layer.s("kind") == "image" && layer["shadow"].bool && !layer["layerFx"].isNull) {
            Text("An effect here replaces the photo’s plain Shadow switch.", Modifier.padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A text layer's own effect (shadow, lift, hollow, outline, splice, echo, neon, glitch) with only the parameters the kind uses, in the web's ranges. */
@Composable
fun ArtworkTextEffectRows(layer: MarketingValue, change: ArtworkChange) {
    val kind = layer["effect"].s("kind", "none")
    fun number(key: String) = layer["effect"].n(key)
    PickerRow("Text effect", kind, ArtworkFx.textEffects) { change(ArtworkFx.withTextEffect(layer, it), null) }
    if (kind == "none") return
    @Composable fun slider(title: String, key: String, range: ClosedFloatingPointRange<Double>, format: (Double) -> String = { String.format(Locale.ROOT, "%.0f", it) }) =
        ArtworkSlider(title, number(key), range, { change(ArtworkFx.withEffectValue(layer, key, MarketingValue.number(it)), "effect-$key") }, format = format)
    if (ArtworkFx.uses(kind, "offset")) slider("Offset", "offset", 0.0..100.0)
    if (ArtworkFx.uses(kind, "angle")) slider("Direction", "angle", -180.0..180.0) { String.format(Locale.ROOT, "%.0f°", it) }
    if (ArtworkFx.uses(kind, "blur")) slider(if (kind == "neon") "Glow" else "Blur", "blur", 0.0..100.0)
    if (ArtworkFx.uses(kind, "thickness")) slider("Thickness", "thickness", 1.0..100.0)
    if (ArtworkFx.uses(kind, "transparency")) slider(if (kind == "lift") "Softness" else "Transparency", "transparency", 0.0..100.0)
    if (ArtworkFx.uses(kind, "color")) ArtworkColorRow("Effect colour", layer["effect"].s("color", "#000000")) { change(ArtworkFx.withEffectValue(layer, "color", MarketingValue.string(it.lowercase())), "effect-color") }
}

/** Photo adjustments (panels/adjust.tsx): the sliders the engine has, grouped, with the web's quick fixes. */
object ArtworkAdjust {
    class Slider(val key: String, val label: String, val min: Double, val max: Double)
    class Group(val title: String, val sliders: List<Slider>)

    val groups: List<Group> = listOf(
        Group("Light", listOf(Slider("brightness", "Brightness", -100.0, 100.0), Slider("contrast", "Contrast", -100.0, 100.0), Slider("highlights", "Highlights", -100.0, 100.0), Slider("shadows", "Shadows", -100.0, 100.0), Slider("fade", "Fade", 0.0, 100.0))),
        Group("Colour", listOf(Slider("saturation", "Saturation", -100.0, 100.0), Slider("warmth", "Warmth", -100.0, 100.0), Slider("tint", "Tint", -100.0, 100.0), Slider("hue", "Hue", -100.0, 100.0))),
        Group("Detail", listOf(Slider("sharpen", "Sharpen", 0.0, 100.0), Slider("blur", "Blur", 0.0, 100.0), Slider("grain", "Grain", 0.0, 100.0), Slider("vignette", "Vignette", 0.0, 100.0))),
    )

    /** QUICK_FIXES: they set these fields over whatever is there. */
    val quick: List<Pair<String, Map<String, Double>>> = listOf(
        "Tame glare" to mapOf("highlights" to -55.0, "shadows" to 25.0),
        "Sparkle" to mapOf("sharpen" to 55.0, "contrast" to 12.0, "highlights" to -15.0),
        "Warm gold" to mapOf("warmth" to 22.0, "saturation" to 10.0, "tint" to 4.0),
    )

    /** NO_ADJUST: the six keys the web always writes. */
    val none: MarketingValue = MarketingValue.of(mapOf("brightness" to 0, "contrast" to 0, "saturation" to 0, "warmth" to 0, "fade" to 0, "vignette" to 0))

    fun put(adjust: MarketingValue, key: String, value: Double): MarketingValue = (if (adjust.isNull) none else adjust).with(key, MarketingValue.number(value))

    fun quickFix(adjust: MarketingValue, patch: Map<String, Double>): MarketingValue {
        var a = if (adjust.isNull) none else adjust
        for ((k, v) in patch) a = a.with(k, MarketingValue.number(v))
        return a
    }
}

/** A filter, three quick fixes for jewellery shots, and every slider; `adjust` is null while off, and sliders never touched stay absent. */
@Composable
fun ArtworkAdjustRows(adjust: MarketingValue, filters: List<MarketingValue>, onAdjust: (MarketingValue, String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ArtworkMenuRow("Choose filter", filters.map { f -> MenuNode.Action(f.s("label")) { onAdjust(f["adjust"], null) } })
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((label, patch) in ArtworkAdjust.quick) OutlinedButton(onClick = { onAdjust(ArtworkAdjust.quickFix(adjust, patch), null) }) { Text(label, style = MaterialTheme.typography.labelMedium) }
    }
    if (adjust.isNull) {
        erp.app.ui.ActionRow("Adjust by hand", { onAdjust(ArtworkAdjust.none, null); open = true })
    } else {
        erp.app.ui.ActionRow(if (open) "Hide the sliders" else "Fine-tune with sliders", { open = !open })
        if (open) {
            Column(Modifier.fillMaxWidth()) {
                for (g in ArtworkAdjust.groups) {
                    Text(g.title, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    for (s in g.sliders) ArtworkSlider(s.label, adjust.n(s.key), s.min..s.max, { onAdjust(ArtworkAdjust.put(adjust, s.key, it), "adj-${s.key}") })
                }
                erp.app.ui.ActionRow("Reset everything", { onAdjust(ArtworkAdjust.none, null) }, tone = Tone.quiet)
                erp.app.ui.ActionRow("No filter", { onAdjust(MarketingValue.NULL, null); open = false }, tone = Tone.problem)
            }
        }
    }
}
