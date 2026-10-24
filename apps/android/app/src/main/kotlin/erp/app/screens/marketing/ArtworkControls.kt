package erp.app.screens.marketing

import erp.core.logic.ShopNumber
import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.ui.FieldRow
import erp.app.ui.NumberRow
import erp.app.ui.PickerRow
import erp.app.ui.ToggleRow
import erp.app.ui.ValueRow
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import java.util.Locale
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Controls the designer gained on the web (src/lib/social/editor.ts, editor-panels.tsx), shared by the two native
// editors: the gradient over a photo, the zoom of a photo inside its frame, and the logo (monogram, a logo file).
// The pure parts are plain Kotlin with JVM tests; the Compose parts follow.

object ArtworkShade {
    /** SHADE_DEFAULT, key for key. */
    val standard: MarketingValue = MarketingValue.of(mapOf("from" to "#000000", "fromAlpha" to 0, "to" to "#000000", "toAlpha" to 0.7, "angle" to 180, "start" to 0.4, "end" to 1))

    /** SHADE_WAYS: the angle each arrow sends the fade toward (CSS degrees), its arrow and its name. */
    val ways: List<Triple<Int, String, String>> = listOf(
        Triple(180, "↓", "Down"), Triple(0, "↑", "Up"), Triple(90, "→", "Right"), Triple(270, "←", "Left"),
        Triple(135, "↘", "Down and right"), Triple(225, "↙", "Down and left"),
    )
}

/** Colours as the documents hold them: "#RRGGBB" (and the short "#RGB"). */
object ArtworkColor {
    /** The three bytes of a hex colour, or null when it is not one. */
    fun parse(hex: String): Triple<Int, Int, Int>? {
        var h = hex.trim().removePrefix("#")
        if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
        if (h.length != 6 || h.any { it.digitToIntOrNull(16) == null }) return null
        return Triple(h.substring(0, 2).toInt(16), h.substring(2, 4).toInt(16), h.substring(4, 6).toInt(16))
    }

    fun color(hex: String): Color? = parse(hex)?.let { (r, g, b) -> Color(r, g, b) }

    /** "#RRGGBB" in capitals, each byte clamped (a wide-gamut colour never gives more than six digits). */
    fun hex(r: Int, g: Int, b: Int): String = String.format(Locale.ROOT, "#%02X%02X%02X", r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))

    fun hex(color: Color): String = hex((color.red * 255).roundToInt(), (color.green * 255).roundToInt(), (color.blue * 255).roundToInt())

    /** Perceived brightness 0…1 (0.299 R + 0.587 G + 0.114 B). */
    fun luminance(hex: String): Double? = parse(hex)?.let { (r, g, b) -> (0.299 * r + 0.587 * g + 0.114 * b) / 255.0 }
}

/** The pixel size of a picture and the pan of a photo inside its frame. */
object ArtworkPixels {
    /** A picture's own size without decoding it (an SVG has none: null). */
    fun size(data: ByteArray): Pair<Double, Double>? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, o)
        return if (o.outWidth > 0 && o.outHeight > 0) o.outWidth.toDouble() to o.outHeight.toDouble() else null
    }

    /** A PNG's size from its header (IHDR), no decoder needed. */
    fun pngSize(data: ByteArray): Pair<Double, Double>? {
        if (data.size < 24) return null
        fun int(at: Int) = ((data[at].toInt() and 0xFF) shl 24) or ((data[at + 1].toInt() and 0xFF) shl 16) or ((data[at + 2].toInt() and 0xFF) shl 8) or (data[at + 3].toInt() and 0xFF)
        val w = int(16)
        val h = int(20)
        return if (w > 0 && h > 0) w.toDouble() to h.toDouble() else null
    }

    /**
     * panInFrame (editor.ts) line for line: the crop (fx, fy) after the photo is dragged (dx, dy) page px from
     * (fx0, fy0), clamped so it always covers the frame. [natural] is the picture's own size, null when unknown.
     */
    fun panned(l: MarketingValue, natural: Pair<Double, Double>?, fx0: Double, fy0: Double, dx: Double, dy: Double): Pair<Double, Double> {
        val w = l.n("w")
        val ratio = natural?.let { if (it.first > 0) it.second / it.first else 1.0 } ?: 1.0
        val h = if (l["h"].isNull) w * ratio else l.n("h")
        val iw = if ((natural?.first ?: 0.0) > 0) natural!!.first else w
        val ih = if ((natural?.second ?: 0.0) > 0) natural!!.second else h
        val s = max(w / iw, h / ih) * max(1.0, l.n("iz", 1.0))
        val spareX = iw * s - w
        val spareY = ih * s - h
        fun cl(v: Double) = floor(min(1.0, max(0.0, v)) * 1000 + 0.5) / 1000
        return (if (spareX > 0.5) cl(fx0 - dx / spareX) else 0.5) to (if (spareY > 0.5) cl(fy0 - dy / spareY) else 0.5)
    }
}

/** The logo layers the web adds (editor.ts newMonogram, newUploadLayer). */
object ArtworkLogo {
    private fun newId(kind: String) = kind + "-" + UUID.randomUUID().toString().take(6).lowercase()

    /** newMonogram, key for key: the tall "t", top right. */
    fun monogram(ink: String): MarketingValue = MarketingValue.of(
        mapOf("id" to newId("t"), "kind" to "wordmark", "mark" to "t", "x" to 930, "y" to 140, "width" to 60, "color" to ink, "autoColor" to false, "rotate" to 0, "opacity" to 1),
    )

    /** The web picks white ink on a dark palette and near-black on a light one; here the background decides. */
    fun ink(doc: MarketingValue): String {
        if (doc["bg"].s("photoId").isNotEmpty()) return "#FFFFFF"
        val lum = ArtworkColor.luminance(doc["bg"].s("color")) ?: return "#111111"
        return if (lum < 0.5) "#FFFFFF" else "#111111"
    }

    /** newUploadLayer: an ordinary image layer holding the file as a data: URL, at most 600 wide, centred. Null if neither PNG nor SVG. */
    fun uploadLayer(data: ByteArray, frameW: Double, frameH: Double): MarketingValue? {
        val mime: String
        val natural: Pair<Double, Double>
        if (data.size >= 8 && data[0] == 0x89.toByte() && data[1] == 0x50.toByte() && data[2] == 0x4E.toByte() && data[3] == 0x47.toByte()) {
            natural = ArtworkPixels.pngSize(data) ?: return null
            mime = "image/png"
        } else {
            val text = String(data, Charsets.UTF_8)
            if (!text.contains("<svg", ignoreCase = true)) return null
            mime = "image/svg+xml"
            natural = svgSize(text)
        }
        val w = min(600.0, if (natural.first > 0) natural.first else 600.0)
        val h = w * (if (natural.first > 0) natural.second / natural.first else 1.0)
        return MarketingValue.of(
            mapOf(
                "id" to newId("upload"), "kind" to "image", "photoId" to "", "src" to "data:$mime;base64," + java.util.Base64.getEncoder().encodeToString(data),
                "x" to Math.rint(frameW / 2 - w / 2), "y" to Math.rint(frameH * 0.45 - h / 2), "w" to w,
                "radius" to 0, "border" to null, "shadow" to false, "rotate" to 0, "opacity" to 1, "name" to "Logo file",
            ),
        )
    }

    /** An SVG's own size: its width and height, else its viewBox; 600 × 600 when it says neither. */
    fun svgSize(text: String): Pair<Double, Double> {
        fun first(pattern: String): String? = Regex(pattern, setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).find(text)?.groupValues?.getOrNull(1)
        val w = first("""<svg[^>]*?\swidth\s*=\s*["']\s*([0-9.]+)""")?.toDoubleOrNull()
        val h = first("""<svg[^>]*?\sheight\s*=\s*["']\s*([0-9.]+)""")?.toDoubleOrNull()
        if (w != null && h != null && w > 0 && h > 0) return w to h
        first("""<svg[^>]*?viewBox\s*=\s*["']([^"']+)["']""")?.let { box ->
            val n = box.split(Regex("[^0-9.\\-]+")).mapNotNull { it.toDoubleOrNull() }
            if (n.size == 4 && n[2] > 0 && n[3] > 0) return n[2] to n[3]
        }
        return 600.0 to 600.0
    }
}

/** The properties of a layer as rows: how a key is named, which keys are a choice from a list. */
object ArtworkProperties {
    private val names = mapOf(
        "x" to "Across", "y" to "Down", "w" to "Width", "h" to "Height", "fx" to "Photo focus across", "fy" to "Photo focus down",
        "flipX" to "Mirror across", "flipY" to "Mirror down", "photoId" to "Photo", "rotate" to "Rotation", "autoColor" to "Choose ink from the photo",
        "fit" to "Fit the words", "upper" to "Capitals", "spacing" to "Letter spacing", "lineHeight" to "Line spacing", "stroke" to "Outline width",
        "fill2" to "Gradient end", "focusX" to "Focus across", "focusY" to "Focus down",
    )

    fun label(key: String): String {
        names[key]?.let { return it }
        val words = key.replace(Regex("([a-z])([A-Z])"), "$1 $2").replace("-", " ")
        return words.take(1).uppercase() + words.drop(1)
    }

    val choices: Map<String, List<String>> = mapOf(
        "font" to listOf(
            "condensed", "light", "regular", "bold", "serif", "serif-italic", "futura", "cormorant", "cormorant-italic", "playfair", "script", "montserrat", "montserrat-bold", "cinzel",
            // Designer v2's jewellery set (src/lib/social/editor.ts FontKey, 2026-10-12); the bundled engine carries the faces.
            "cormorant-infant", "italiana", "jost", "tenor", "dm-serif", "marcellus",
        ),
        "blend" to listOf("normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "color-dodge", "darken", "lighten"),
        "align" to listOf("left", "center", "right"), "gradient" to listOf("none", "top", "bottom", "both"), "mode" to listOf("fill", "fit"), "dash" to listOf("solid", "dash", "dot"),
        "mask" to listOf("rounded", "ellipse", "arch", "heart", "star", "hexagon", "diamond", "sparkle", "gem", "pill"),
    )

    fun isColorKey(key: String): Boolean = key.lowercase().contains("color") || key in listOf("fill", "fill2", "border")

    /** A number as the row shows it: whole numbers plain, otherwise up to three decimals without trailing zeros. */
    fun numberText(v: Double): String {
        if (v == Math.rint(v) && kotlin.math.abs(v) < 1e12) return v.toLong().toString()
        return String.format(Locale.ROOT, "%.3f", v).trimEnd('0').trimEnd('.')
    }
}

// MARK: Compose

/** A titled slider as the board designer draws them, for the editors that have no slider of their own. */
@Composable
fun ArtworkSlider(title: String, value: Double, range: ClosedFloatingPointRange<Double>, onChange: (Double) -> Unit, step: Double = 1.0, format: (Double) -> String = { String.format(Locale.ROOT, "%.0f", it) }) {
    val clamped = min(range.endInclusive, max(range.start, value))
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(format(clamped), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val steps = if (step > 0) (((range.endInclusive - range.start) / step).roundToInt() - 1).coerceAtLeast(0) else 0
        Slider(
            value = clamped.toFloat(),
            onValueChange = { onChange(if (step > 0) Math.rint(it / step) * step else it.toDouble()) },
            valueRange = range.start.toFloat()..range.endInclusive.toFloat(),
            steps = steps,
            modifier = Modifier.semantics { contentDescription = title },
        )
    }
}

/** A colour row: the label, a swatch, and a small picker (hex, or a mix of the three bytes). The value is "#RRGGBB". */
@Composable
fun ArtworkColorRow(label: String, hex: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = ArtworkColor.color(hex)
    ValueRow(label, Modifier.clickable(role = Role.Button) { open = true }) {
        Box(
            Modifier.size(28.dp).clip(CircleShape).background(shown ?: Color.White)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape),
        )
        Text(hex.uppercase(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (open) ArtworkColorDialog(label, hex, onDismiss = { open = false }, onPick = { onChange(it); open = false })
}

private val swatches = listOf("#FFFFFF", "#111111", "#EDE6DA", "#C9A24B", "#8C1D2C", "#540000", "#1F3A5F", "#2E6B4F", "#D98E73", "#F4C7C3", "#7A7A7A", "#000000")

@Composable
private fun ArtworkColorDialog(title: String, hex: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val start = ArtworkColor.parse(hex) ?: Triple(255, 255, 255)
    var r by remember { mutableStateOf(start.first.toDouble()) }
    var g by remember { mutableStateOf(start.second.toDouble()) }
    var b by remember { mutableStateOf(start.third.toDouble()) }
    var typed by remember { mutableStateOf(ArtworkColor.hex(start.first, start.second, start.third)) }
    fun sync() { typed = ArtworkColor.hex(r.roundToInt(), g.roundToInt(), b.roundToInt()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (s in swatches) {
                        Box(
                            Modifier.size(36.dp).clip(CircleShape).background(ArtworkColor.color(s) ?: Color.White)
                                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                                .clickable(role = Role.Button) { ArtworkColor.parse(s)?.let { (pr, pg, pb) -> r = pr.toDouble(); g = pg.toDouble(); b = pb.toDouble(); sync() } }
                                .semantics { contentDescription = s },
                        )
                    }
                }
                ArtworkSlider("Red", r, 0.0..255.0, { r = it; sync() })
                ArtworkSlider("Green", g, 0.0..255.0, { g = it; sync() })
                ArtworkSlider("Blue", b, 0.0..255.0, { b = it; sync() })
                OutlinedTextField(
                    value = typed,
                    onValueChange = { t ->
                        typed = t
                        ArtworkColor.parse(t)?.let { (pr, pg, pb) -> r = pr.toDouble(); g = pg.toDouble(); b = pb.toDouble() }
                    },
                    label = { Text("Hex") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onPick(ArtworkColor.hex(r.roundToInt(), g.roundToInt(), b.roundToInt())) }) { Text("Use this colour") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Every editable field remains in the document; importing an old design doesn't discard its layer settings. [keys] are
 * the keys of [value] shown, each as the row its value asks for; [onChange] gets the whole new value.
 */
@Composable
fun ArtworkPropertyRows(value: MarketingValue, keys: List<String>, onChange: (MarketingValue) -> Unit) {
    for (key in keys) PropertyRow(value, key, onChange)
}

@Composable
private fun PropertyRow(value: MarketingValue, key: String, onChange: (MarketingValue) -> Unit) {
    val field = value[key]
    val label = ArtworkProperties.label(key)
    val prim = field.json as? kotlinx.serialization.json.JsonPrimitive
    when {
        field.json is kotlinx.serialization.json.JsonObject -> NestedRows(label, field) { onChange(value.with(key, it)) }
        prim == null || prim is kotlinx.serialization.json.JsonNull -> Unit
        !prim.isString && prim.content in listOf("true", "false") -> ToggleRow(label, field.bool, onChange = { onChange(value.with(key, MarketingValue.bool(it))) })
        !prim.isString -> {
            val shown = ArtworkProperties.numberText(field.number)
            var text by remember(key, shown) { mutableStateOf(shown) }
            NumberRow(label, text, { t ->
                text = t
                ShopNumber.parse(t)?.let { onChange(value.with(key, MarketingValue.number(it))) }
            }, decimal = true)
        }
        ArtworkProperties.choices[key] != null -> PickerRow(label, field.string, ArtworkProperties.choices.getValue(key).map { it to ArtworkProperties.label(it) }) { onChange(value.with(key, MarketingValue.string(it))) }
        ArtworkProperties.isColorKey(key) -> ArtworkColorRow(label, field.string) { onChange(value.with(key, MarketingValue.string(it))) }
        else -> FieldRow(label, field.string, { onChange(value.with(key, MarketingValue.string(it))) }, singleLine = false, minLines = 1, maxLines = 8)
    }
}

@Composable
private fun NestedRows(label: String, field: MarketingValue, onChange: (MarketingValue) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(if (open) "Hide" else "Show", style = MaterialTheme.typography.bodyMedium, color = ErpColors.accent)
    }
    if (open) Column(Modifier.padding(start = 12.dp)) { ArtworkPropertyRows(field, field.obj.keys.sorted(), onChange) }
}

/**
 * ShadeControls (editor-panels.tsx): a gradient over a photo, with direction, angle, two colours and opacities, and
 * where the fade runs. [shade] is the document's value (null when off); [apply] gets the whole new value and a key that
 * lets the caller fold a slider's many steps into one undo.
 */
@Composable
fun ArtworkShadeControls(shade: MarketingValue, apply: (MarketingValue, String?) -> Unit, title: String = "Gradient over the photo") {
    val on = !shade.isNull
    fun set(key: String, value: MarketingValue, folded: Boolean = true) {
        val g = (if (on) shade else ArtworkShade.standard).with(key, value)
        apply(g, if (folded) key else null)
    }
    ToggleRow(title, on, onChange = { apply(if (it) ArtworkShade.standard else MarketingValue.NULL, null) })
    if (!on) return
    // The arrows: one tap sends the fade that way.
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((angle, arrow, name) in ArtworkShade.ways) {
            erp.app.ui.FilterChip(title = arrow, chosen = shade.n("angle").roundToInt() == angle, onClick = { set("angle", MarketingValue.number(angle.toDouble()), folded = false) }, modifier = Modifier.semantics { contentDescription = name })
        }
    }
    ArtworkSlider("Angle", shade.n("angle"), 0.0..360.0, { set("angle", MarketingValue.number(it)) }, format = { String.format(Locale.ROOT, "%.0f°", it) })
    // The web writes the colour input's own lowercase "#rrggbb".
    ArtworkColorRow("From", shade.s("from", "#000000")) { set("from", MarketingValue.string(it.lowercase())) }
    ArtworkSlider("From opacity", shade.n("fromAlpha") * 100, 0.0..100.0, { set("fromAlpha", MarketingValue.number(it / 100)) }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    ArtworkColorRow("To", shade.s("to", "#000000")) { set("to", MarketingValue.string(it.lowercase())) }
    ArtworkSlider("To opacity", shade.n("toAlpha") * 100, 0.0..100.0, { set("toAlpha", MarketingValue.number(it / 100)) }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    ArtworkSlider("Fade starts", shade.n("start") * 100, 0.0..100.0, { set("start", MarketingValue.number(it / 100)) }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
    ArtworkSlider("Fade ends", shade.n("end") * 100, 0.0..100.0, { set("end", MarketingValue.number(it / 100)) }, format = { String.format(Locale.ROOT, "%.0f%%", it) })
}
