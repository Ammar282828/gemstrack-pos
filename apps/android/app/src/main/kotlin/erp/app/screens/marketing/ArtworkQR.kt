package erp.app.screens.marketing

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import erp.app.ui.ActionRow
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import java.util.Locale
import java.util.UUID

// Designer v2 QR layers (ArtworkQR.swift; editor.ts newQr / QrLayer, panels/qr.tsx): `value`, `w` (square), `fg`, `bg` (null leaves the
// quiet zone clear), `quiet` 0…8 modules. The bundled engine draws them; this writes the same fields.
object ArtworkQR {
    /** QR_MIN (lib/design/safe.ts): below it a phone cannot scan the code. */
    const val MINIMUM = 120.0

    /** newQr: 300 wide, on white, centred. */
    fun layer(value: String, frameW: Double, frameH: Double, id: String = "qr-" + UUID.randomUUID().toString().take(6).lowercase()): MarketingValue {
        val w = minOf(300.0, frameW - 160)
        return MarketingValue.of(
            mapOf(
                "id" to id, "kind" to "qr", "role" to "cta", "x" to Math.rint(frameW / 2 - w / 2), "y" to Math.rint(frameH * 0.45 - w / 2), "w" to w,
                "value" to value, "fg" to "#111111", "bg" to "#FFFFFF", "quiet" to 4, "rotate" to 0, "opacity" to 1,
            ),
        )
    }

    /** Nothing is drawn for no words or more than a code can hold (the engine returns no matrix). */
    fun problem(value: String): String? {
        if (value.isEmpty()) return "Nothing to encode yet, so nothing is drawn."
        if (value.toByteArray(Charsets.UTF_8).size > 2000) return "That is too long to fit in a QR code here, so nothing is drawn."
        return null
    }
}

/** The controls of a QR code on the page: what it says, its size, its two colours and its quiet edge. */
@Composable
fun ArtworkQRRows(layer: MarketingValue, change: ArtworkChange) {
    val context = LocalContext.current
    erp.app.ui.FieldRow("Says", layer.s("value"), { change(layer.with("value", MarketingValue.string(it)), "qrvalue") }, singleLine = false, maxLines = 4)
    ArtworkQR.problem(layer.s("value"))?.let { Text(it, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
    val clip = runCatching { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty() }.getOrDefault("")
    if (clip.isNotEmpty()) ActionRow("Paste a link or words", { change(layer.with("value", MarketingValue.string(clip)), null) })
    ArtworkSlider("Size", layer.n("w", 300.0), ArtworkQR.MINIMUM..1000.0, { change(layer.with("w", MarketingValue.number(it)), "qrw") }, step = 4.0, format = { String.format(Locale.ROOT, "%.0f px", it) })
    if (layer.n("w", 300.0) < ArtworkQR.MINIMUM + 40) {
        Text(
            "Small codes are hard to scan from a phone screen; ${(ArtworkQR.MINIMUM + 40).toInt()} px or more is safer.",
            Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = Tone.owed.color(),
        )
    }
    ArtworkColorRow("Dark parts", layer.s("fg", "#111111")) { change(layer.with("fg", MarketingValue.string(it.lowercase())), "qrfg") }
    ToggleRow("Light square behind it", !layer["bg"].isNull, onChange = { change(layer.with("bg", if (it) MarketingValue.string("#FFFFFF") else MarketingValue.NULL), null) })
    if (!layer["bg"].isNull) ArtworkColorRow("Behind", layer.s("bg", "#FFFFFF")) { change(layer.with("bg", MarketingValue.string(it.lowercase())), "qrbg") }
    ArtworkSlider("Quiet edge", layer.n("quiet", 4.0), 0.0..8.0, { change(layer.with("quiet", MarketingValue.number(it)), "qrq") })
    Text(
        "Keep a light border round the code (4 modules is the standard) and a strong contrast between dark and light so every phone reads it. The code stays square.",
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
