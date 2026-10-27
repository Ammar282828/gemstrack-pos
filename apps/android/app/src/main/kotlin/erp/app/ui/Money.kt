package erp.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

// MARK: Words for money and weight (KitComponents.swift)

/** "+ PKR 30,000" / "− PKR 30,000": the sign said by the amount, the minus a real minus (U+2212). */
fun Money.signed(n: Double): String = "${if (n < 0) "−" else "+"} ${pkr(kotlin.math.abs(n))}"

/** "− PKR 30,000" whatever the sign of [n]: a line that takes away (a discount, an exchange). */
fun Money.minus(n: Double): String = "− ${pkr(kotlin.math.abs(n))}"

/** Weights the way the shop says them. */
object Weight {
    const val GRAMS_PER_TOLA = 11.664

    /** "12.5 g · 1.072 tola" (units.ts `formatWeight`): grams first, because that is what was weighed. */
    fun grams(g: Double, tolaDigits: Int = 3, gramDigits: Int = 2): String {
        val grams = if (g.isFinite()) g else 0.0
        return "${localeNumber(grams, gramDigits)} g · ${localeNumber(grams / GRAMS_PER_TOLA, tolaDigits)} tola"
    }

    // Not in :core yet (Units.swift). `n.toLocaleString('en-US', { maximumFractionDigits })`: grouped, a half
    // going up, no trailing zeros. Move to core with its tests when Units is ported.
    internal fun localeNumber(x: Double, maxDigits: Int): String {
        val format = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).apply {
            minimumFractionDigits = 0
            maximumFractionDigits = maxDigits
            roundingMode = RoundingMode.HALF_UP
        }
        val text = format.format(BigDecimal(x.toString()))
        return if (text == "-0") "0" else text
    }
}

// MARK: Figures that roll

/**
 * A figure whose new value rolls in rather than blinking (the iPhone's `.contentTransition(.numericText)`): up
 * when it grew, down when it fell, on the enter and exit curves; plain text when animations are off.
 * [autoSize] shrinks the text to fit one line (the iPhone's `minimumScaleFactor`).
 */
@Composable
fun NumericText(
    text: String,
    value: Double,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    autoSize: Boolean = false,
    maxLines: Int = 1,
) {
    val motion = rememberErpMotion()
    val reduce = motion.reduce
    val rollUp = motion.roll(up = true)
    val rollDown = motion.roll(up = false)
    val resolved = style.copy(fontFeatureSettings = TabularDigits, textAlign = textAlign ?: style.textAlign)
    val tint = if (color == Color.Unspecified) MaterialTheme.colorScheme.onSurface else color
    val draw: @Composable (String) -> Unit = { shown ->
        if (autoSize && resolved.fontSize.isSpecified) {
            BasicText(
                shown,
                style = resolved.copy(color = tint),
                maxLines = maxLines,
                overflow = TextOverflow.Clip,
                autoSize = TextAutoSize.StepBased(minFontSize = resolved.fontSize * 0.5f, maxFontSize = resolved.fontSize),
            )
        } else {
            Text(shown, style = resolved, color = tint, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
        }
    }
    if (reduce) {
        Box(modifier) { draw(text) }
    } else {
        AnimatedContent(
            targetState = text to value,
            modifier = modifier,
            contentKey = { it.first },
            // A figure that grew rolls up, one that fell rolls down, on the theme's springs.
            transitionSpec = { if (ErpMotion.rollsUp(initialState.second, targetState.second)) rollUp else rollDown },
            label = "numeric",
        ) { (shown, _) -> draw(shown) }
    }
}

/** A sum the way the shop reads it: "PKR 4.5 lac" at a glance, the exact rupees where they are owed. */
@Composable
fun MoneyText(
    amount: Double,
    modifier: Modifier = Modifier,
    exact: Boolean = false,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = Color.Unspecified,
) {
    NumericText(if (exact) Money.pkr(amount) else Money.pkrLac(amount), amount, modifier, style, color)
}

/** The number without its "PKR ". */
fun heroFigure(amount: Double, lac: Boolean): String {
    val s = if (lac) Money.pkrLac(amount) else Money.pkr(amount)
    return if (s.startsWith("PKR ")) s.drop(4) else s
}

/**
 * A screen's one big sum: the serif, the rupees exact, "PKR" set small beside it. [unit] is "PKR" for money;
 * pass another ("g", "tola") for a weight, with [text] for the figure itself ([Weight.grams]).
 */
@Composable
fun HeroAmount(
    amount: Double,
    modifier: Modifier = Modifier,
    tone: Color = Color.Unspecified,
    lac: Boolean = false,
    unit: String = "PKR",
    text: String? = null,
) {
    val figure = text ?: heroFigure(amount, lac)
    val spoken = if (unit == "PKR") "$unit $figure" else "$figure $unit"
    Row(
        modifier.clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            unit,
            Modifier.alignByBaseline(),
            style = ErpType.heroUnit,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        NumericText(
            figure, amount,
            Modifier.alignByBaseline().weight(1f, fill = false),
            style = ErpType.heroNumber,
            color = tone,
            autoSize = true,
        )
    }
}

/** A row's sum: semibold, digits steady. */
@Composable
fun RowAmount(
    amount: Double,
    modifier: Modifier = Modifier,
    lac: Boolean = false,
    tone: Color = Color.Unspecified,
) {
    NumericText(
        if (lac) Money.pkrLac(amount) else Money.pkr(amount), amount, modifier,
        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
        color = tone,
    )
}

/**
 * A label and its sum: label leading, amount trailing, in the shared money words. Stacks at large text sizes.
 * [tone] colours the amount (quiet keeps it primary); [signed] says "+ PKR" / "− PKR".
 */
@Composable
fun MoneyRow(
    label: String,
    amount: Double,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.quiet,
    lac: Boolean = false,
    emphasis: Boolean = false,
    signed: Boolean = false,
) {
    val words = if (signed) Money.signed(amount) else if (lac) Money.pkrLac(amount) else Money.pkr(amount)
    val figureStyle = if (emphasis) {
        MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
    } else {
        MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
    }
    val figureColor = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurface else tone.color()
    val nameColor = if (emphasis) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    val nameStyle = if (emphasis) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium
    val merged = modifier.fillMaxWidth().semantics(mergeDescendants = true) {}
    if (isLargeText()) {
        Column(merged, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = nameStyle, color = nameColor)
            NumericText(words, amount, style = figureStyle, color = figureColor)
        }
    } else {
        Row(merged, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Text(label, Modifier.alignByBaseline().weight(1f), style = nameStyle, color = nameColor)
            NumericText(
                words, amount, Modifier.alignByBaseline(),
                style = figureStyle, color = figureColor, textAlign = TextAlign.End,
            )
        }
    }
}
