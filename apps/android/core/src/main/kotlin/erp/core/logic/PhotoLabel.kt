package erp.core.logic

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.pow

// Ported from src/app/website/weights/page.tsx (the carats line and its geometry) and src/lib/website/label-ink.ts (tests:
// PhotoLabelTests, from label-ink.test.ts and the page's caratsText / caratsLine). Photo weights draws the weight and, for a
// diamond piece, its carats under it, in the overlay tool's Futura, white or dark by the photo behind (2026-11-10).
// Every number is against the overlay tool's 3000-unit-wide reference.

object PhotoLabel {
    /** The reference width every number below is measured against. */
    const val REFERENCE = 3000.0

    // The weight: Futura LT Light, 143 high, 120 in, baseline at 100 + 143 × 1.1, tracking 2.
    const val WEIGHT_SIZE = 143.0
    const val LEFT = 120.0
    const val TRACKING = 2.0
    const val WEIGHT_BASELINE = 100 + WEIGHT_SIZE * 1.1

    // The carats line under it: the same face, smaller; baseline 1.3 of its size under the weight's.
    const val CT_SIZE = 90.0
    const val CT_BASELINE = WEIGHT_BASELINE + CT_SIZE * 1.3

    /** "0.50ct": two places, as JavaScript's toFixed does (the double's own binary value, ties up). */
    fun caratsText(n: Double): String = BigDecimal(n).setScale(2, RoundingMode.HALF_UP).toPlainString() + "ct"

    /** The line under the weight: the solitaire's carats, then the smaller diamonds' after a plus; either alone when the other is 0. */
    fun caratsLine(main: Double, side: Double): String =
        listOf(if (main > 0) caratsText(main) else "", if (side > 0) caratsText(side) else "").filter { it.isNotEmpty() }.joinToString(" + ")

    /** What was typed in a carats field: nothing for an empty one, NaN for what is not a number (as the page's Number(...)). */
    fun parseCarats(text: String): Double? {
        val t = text.trim()
        if (t.isEmpty()) return null
        return t.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() } ?: Double.NaN
    }

    /** The server takes more than 0 and under 500 carats; a field left empty is fine. */
    fun caratsValid(v: Double?): Boolean = v == null || (v > 0 && v < 500)

    // MARK: White or dark, by the photo

    /** The label's corner of the photo, against the 3000 reference: the weight and the carats under it. */
    const val AREA_X = 80.0
    const val AREA_Y = 40.0
    const val AREA_W = 900.0
    const val AREA_H = 400.0

    /** The two inks: white is the overlay tool's own, #1a1a1a its dark one (0xRRGGBB). */
    const val WHITE_INK = 0xFFFFFF
    const val DARK_INK = 0x1A1A1A

    /** The corner as pixels of an image `width` × `height`: left, top, width, height (the website's ink route's extract). */
    data class Area(val left: Int, val top: Int, val width: Int, val height: Int)

    fun area(width: Int, height: Int): Area {
        val k = width / REFERENCE
        val left = Math.floor(AREA_X * k).toInt()
        val top = Math.floor(AREA_Y * k).toInt()
        return Area(
            left, top,
            maxOf(1, minOf(Math.round(AREA_W * k).toInt(), width - left)),
            maxOf(1, minOf(Math.round(AREA_H * k).toInt(), height - top)),
        )
    }

    /** sRGB 0–255 to linear light. */
    fun linear(v: Int): Double {
        val c = v / 255.0
        return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }

    /** The mean relative luminance of pixels as 0xRRGGBB ints (alpha ignored); 0 for none. */
    fun meanLuminance(rgb: IntArray): Double {
        if (rgb.isEmpty()) return 0.0
        var sum = 0.0
        for (p in rgb) sum += 0.2126 * linear((p shr 16) and 0xFF) + 0.7152 * linear((p shr 8) and 0xFF) + 0.0722 * linear(p and 0xFF)
        return sum / rgb.size
    }

    /** White below L ≈ 0.20, where 1.05 / (L + 0.05) beats (L + 0.05) / 0.06 (#1a1a1a). */
    fun inkFor(l: Double): Int = if (1.05 / (l + 0.05) >= (l + 0.05) / 0.06) WHITE_INK else DARK_INK
}
