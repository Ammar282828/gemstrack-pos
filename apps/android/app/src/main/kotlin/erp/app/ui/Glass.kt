package erp.app.ui

import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.os.Build
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.blur.HazeBlurStyle
import dev.chrisbanes.haze.blur.HazeColorEffect
import dev.chrisbanes.haze.blur.hazeBlur
import dev.chrisbanes.haze.hazeSource
import erp.app.config.Prefs
import erp.app.ui.theme.ErpColors

// Liquid Glass on Android (owner, 2026-11-03: "also for the UI and cards — search and add glassmorphism"; docs/features/liquid-glass.md
// "Cards are glass too"). Under the shop's Interface style "glass" (`settings.uiStyle`) and nowhere else: Standard draws exactly what it
// drew before, because every modifier here falls back to `clip(shape).background(color)`.
//
// Two weights, as the web's `.glass-card` / `.glass-lite` and the iPhone's `.glassCard()` / `.glassRow()`:
//  - glassCard: a true backdrop blur (haze: the app's root content is the `hazeSource`, the card is a `hazeBlur` over it) for the FEW
//    cards a screen shows. Haze renders the source into a layer and blurs it with a RenderEffect (Android 12+); each effect costs a
//    blur of its own area every frame the source changes, so: one source, few effects, never inside a lazy item, never glass in glass.
//  - glassRow: the cheap look (no blur): the card colour at ~0.72 alpha, a specular hairline and a 1 dp highlight. Every other card,
//    segmented tile and row gets it automatically through the kit's surfaces, and so does anything in a sheet or dialog (another
//    window: the source is not behind it) or in a card that is already glass.
// `Modifier.blur` is not used: it blurs a composable's own content, not what is behind it.

/** The glass style as one composition sees it: null (Standard) when [LocalGlass] holds nothing. */
@Immutable
class GlassEnv(
    val hazeState: HazeState,
    /** The view the source lives in: a sheet or dialog is another view, so its cards are never blurred (the source is not behind them). */
    val host: View?,
    /** Backdrop blur is available: Android 12+ (RenderEffect) on a phone that is not low-RAM. Below that the row look stands in for it. */
    val blur: Boolean,
)

val LocalGlass = staticCompositionLocalOf<GlassEnv?> { null }

/** True inside a glass card's body (or a lazy item): cards in there take the row look, never a second blur. */
val LocalGlassNested = compositionLocalOf { false }

/** Marks [content] as inside a glass card: nothing in it blurs. */
@Composable
fun GlassNested(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalGlassNested provides true, content = content)
}

/** The constants of the look, in one place (and under test: the words stay AA on them). */
object GlassTokens {
    /** The row look's card colour: translucent over the ground. */
    const val RowAlpha = 0.72f

    /** True glass's tint over the blurred backdrop. */
    const val CardAlpha = 0.62f

    /** What the tint is when blur is off in haze (its scrim): nearly the card. */
    const val ScrimAlpha = 0.86f
    val BlurRadius: Dp = 16.dp
    val Hairline: Dp = 1.dp

    /** The ground's three washes of the seed colour (alpha of the primary), light and dark. */
    fun groundAlphas(dark: Boolean) = if (dark) floatArrayOf(0.14f, 0.10f, 0.08f) else floatArrayOf(0.12f, 0.09f, 0.07f)

    /** Straight alpha compositing of [fg] over an opaque [bg]. */
    fun over(fg: Color, bg: Color): Color = Color(
        red = fg.red * fg.alpha + bg.red * (1 - fg.alpha),
        green = fg.green * fg.alpha + bg.green * (1 - fg.alpha),
        blue = fg.blue * fg.alpha + bg.blue * (1 - fg.alpha),
    )
}

/** Where the glass style is kept between launches: the first paint reads it before the settings arrive (per business, like the theme). */
object GlassChoice {
    private const val KEY = "erp.uiStyle"

    /** The style the open business last had, "glass" or anything else; Standard when none was ever saved. */
    fun cached(): Boolean = Prefs.string(KEY) == "glass"

    fun remember(uiStyle: String?) { Prefs.putString(KEY, uiStyle) }

    /** What the settings say, or the last they said while they are on their way. */
    fun resolve(uiStyle: String?): Boolean = if (uiStyle != null) uiStyle == "glass" else cached()

    /**
     * Android has no "reduce transparency". Its nearest wish is Android 14's colour-contrast setting (medium or high): then the cards
     * stay solid. Motion does not matter: glass is static.
     */
    fun allowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        val ui = context.getSystemService(UiModeManager::class.java) ?: return true
        return ui.contrast <= 0f
    }

    fun blurAvailable(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31) return false
        val am = context.getSystemService(ActivityManager::class.java)
        return am?.isLowRamDevice != true
    }
}

/**
 * The root of the glass style: under [on], draws the ground (a static mesh of the house colour) and makes its content the one
 * haze source; otherwise the content just sits in a Box. The same Box either way, so flipping the style never resets a screen.
 */
@Composable
fun GlassLayer(on: Boolean, content: @Composable BoxScope.() -> Unit) {
    val context = LocalContext.current
    val active = on && GlassChoice.allowed(context)
    val state = remember { HazeState() }
    val view = LocalView.current
    val env = remember(state, view, active) { if (active) GlassEnv(state, view, GlassChoice.blurAvailable(context)) else null }
    CompositionLocalProvider(LocalGlass provides env) {
        Box(
            Modifier.fillMaxSize()
                .then(if (env != null) Modifier.hazeSource(state).glassGround() else Modifier),
            content = content,
        )
    }
}

/** The colour of a screen's own page: the scheme's surface, or nothing under glass so the ground shows through. */
@Composable
fun pageColor(standard: Color = MaterialTheme.colorScheme.surface): Color =
    if (LocalGlass.current != null) Color.Transparent else standard

// MARK: The ground

/**
 * The page under the glass: the surface with three large soft radial washes of the house's seed colour (top left, right, bottom
 * left). Static: drawn once per size from cached brushes, never animated, so the source layer it sits in does not change by itself.
 */
@Composable
fun Modifier.glassGround(): Modifier {
    val scheme = MaterialTheme.colorScheme
    val surface = scheme.surface
    val seed = scheme.primary
    val soft = scheme.primaryContainer
    val a = GlassTokens.groundAlphas(ErpColors.dark)
    return drawWithCache {
        val w = size.width
        val h = size.height
        val reach = maxOf(w, h)
        val washes = listOf(
            Brush.radialGradient(listOf(seed.copy(alpha = a[0]), Color.Transparent), Offset(w * 0.12f, h * 0.04f), reach * 0.85f),
            Brush.radialGradient(listOf(soft.copy(alpha = a[1] * 1.6f), Color.Transparent), Offset(w * 1.0f, h * 0.45f), reach * 0.75f),
            Brush.radialGradient(listOf(seed.copy(alpha = a[2]), Color.Transparent), Offset(w * 0.1f, h * 1.0f), reach * 0.9f),
        )
        onDrawBehind {
            drawRect(surface)
            washes.forEach { drawRect(it) }
        }
    }
}

// MARK: The two weights

/** Which look a surface wears right now. */
enum class GlassWeight { Standard, Row, Card }

/** What a surface that asked for [wantCard] gets: Standard when the style is off, a blur only where one can be seen and is affordable. */
@Composable
fun glassWeight(wantCard: Boolean): GlassWeight {
    val env = LocalGlass.current ?: return GlassWeight.Standard
    val nested = LocalGlassNested.current
    val sameWindow = LocalView.current === env.host
    return if (wantCard && env.blur && !nested && sameWindow) GlassWeight.Card else GlassWeight.Row
}

/**
 * The cheap look: [color] at ~0.72, a specular hairline (bright top-left) and a 1 dp highlight along the top. No blur on purpose:
 * a backdrop blur is paid per element per frame, so dozens of rows would drop frames. Under Standard it is the plain card.
 */
@Composable
fun Modifier.glassRow(shape: Shape = Radius.cardShape, color: Color = ErpColors.card): Modifier {
    if (LocalGlass.current == null) return clip(shape).background(color)
    val look = rememberEdgeLook()
    return clip(shape).background(color.copy(alpha = GlassTokens.RowAlpha)).glassEdge({ shape }, look, highlight = true)
}

/**
 * True glass for the few cards a screen shows: the app's content behind it, blurred 16 dp (haze, RenderEffect), saturated a little
 * and tinted with [color] at low alpha, with the specular hairline. Falls back to [glassRow] where a blur cannot be drawn (below
 * Android 12, low-RAM phones, inside a sheet, dialog or another glass card) and to the plain card under Standard.
 * Never inside a lazy item: the caller's lists wrap their items in [GlassNested] or use [glassRow].
 */
@Composable
fun Modifier.glassCard(
    shape: Shape = Radius.cardShape,
    color: Color = ErpColors.card,
    tintAlpha: Float = GlassTokens.CardAlpha,
): Modifier {
    val env = LocalGlass.current
    return when (glassWeight(wantCard = true)) {
        GlassWeight.Standard -> clip(shape).background(color)
        GlassWeight.Row -> glassRow(shape, color)
        GlassWeight.Card -> {
            val look = rememberEdgeLook()
            // The row look sits under the blur: haze's blurred backdrop is opaque and covers it, but until haze has its first frame (or where it
            // draws nothing) the card is still a card.
            clip(shape).background(color.copy(alpha = GlassTokens.RowAlpha)).glassBlur(env!!, color, tintAlpha).glassEdge({ shape }, look, highlight = false)
        }
    }
}

/** The blur itself: the app's content behind this node, blurred and tinted. Callers have checked [glassWeight] is Card. */
@Composable
fun Modifier.glassBlur(env: GlassEnv, color: Color, tintAlpha: Float = GlassTokens.CardAlpha): Modifier {
    val style = remember(color, tintAlpha) { glassBlurStyle(color, tintAlpha) }
    return hazeBlur(input = HazeInput.Sources(env.hazeState), style = style)
}

/** Haze's style for a glass card: the card colour under a blurred, slightly saturated backdrop; the scrim (no blur) is nearly solid. */
private fun glassBlurStyle(color: Color, tintAlpha: Float): HazeBlurStyle {
    val saturate = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(1.35f) })
    return HazeBlurStyle {
        backgroundColor(color)
        blurRadius(GlassTokens.BlurRadius)
        noiseFactor(0f)
        colorEffects(listOf(HazeColorEffect.colorFilter(saturate), HazeColorEffect.tint(color.copy(alpha = tintAlpha))))
        fallbackColorEffect(HazeColorEffect.tint(color.copy(alpha = GlassTokens.ScrimAlpha)))
    }
}

// MARK: The edge

@Immutable
class EdgeLook(val bright: Color, val dim: Color, val highlight: Color)

/** Light needs a hairline of its own at the far corner (white on a pale card is invisible); dark just fades the white. */
@Composable
private fun rememberEdgeLook(): EdgeLook {
    val dark = ErpColors.dark
    val outline = MaterialTheme.colorScheme.outline
    return remember(dark, outline) {
        if (dark) EdgeLook(Color.White.copy(alpha = 0.50f), Color.White.copy(alpha = 0.07f), Color.White.copy(alpha = 0.16f))
        else EdgeLook(Color.White.copy(alpha = 0.95f), outline.copy(alpha = 0.22f), Color.White.copy(alpha = 0.70f))
    }
}

/**
 * The specular edge: a gradient stroke, bright at the top left and dim at the bottom right, and optionally a 1 dp highlight just
 * inside the top edge. The brushes are built once per size; [shape] is read when drawing (a pressed card's corner animates).
 */
fun Modifier.glassEdge(shape: () -> Shape, look: EdgeLook, highlight: Boolean): Modifier = drawWithCache {
    val w = size.width
    val h = size.height
    val ring = Brush.linearGradient(
        0f to look.bright, 0.5f to look.dim.copy(alpha = look.dim.alpha * 0.6f), 1f to look.dim,
        start = Offset.Zero, end = Offset(w, h),
    )
    val top = Brush.horizontalGradient(
        0f to Color.Transparent, 0.2f to look.highlight, 0.8f to look.highlight.copy(alpha = look.highlight.alpha * 0.4f), 1f to Color.Transparent,
    )
    val line = GlassTokens.Hairline.toPx()
    onDrawWithContent {
        drawContent()
        // Drawn over the content but only on the edge pixels: half the stroke is outside the card's clip.
        drawOutline(shape().createOutline(size, layoutDirection, this), ring, style = Stroke(line * 2f))
        if (highlight) drawLine(top, Offset(line * 12f, line * 1.5f), Offset(w - line * 12f, line * 1.5f), strokeWidth = line)
    }
}

/** The same edge for a card whose corner moves (see [morphCard]): [corner] is read in the draw phase. */
fun Modifier.glassEdgeMorphing(corner: () -> Dp, look: EdgeLook): Modifier = drawWithCache {
    val ring = Brush.linearGradient(
        0f to look.bright, 0.5f to look.dim.copy(alpha = look.dim.alpha * 0.6f), 1f to look.dim,
        start = Offset.Zero, end = Offset(size.width, size.height),
    )
    val line = GlassTokens.Hairline.toPx()
    onDrawWithContent {
        drawContent()
        val r = corner().toPx()
        drawRoundRect(ring, cornerRadius = CornerRadius(r), style = Stroke(line * 2f))
    }
}

/** The look a surface that draws its own edge (morphCard, the segmented tiles) asks for, or null under Standard. */
@Composable
fun glassEdgeLookOrNull(): EdgeLook? = if (LocalGlass.current == null) null else rememberEdgeLook()
