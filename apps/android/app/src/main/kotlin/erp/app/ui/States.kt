package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.draw.drawBehind
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType

// MARK: Loading

// Owner, 2026-11-03: "fix all loading states, skeleton for known state and loading circle for unknown state" (decisions.md "Loading").
// A SKELETON when the shape of what comes is known (a list, a record page, cards, figure tiles, a chart, a form, a photo grid, a
// photo): the same row heights, avatar circles, line bars and card sizes as the real thing, so nothing jumps when the data arrives,
// with one soft pulse (none when the system's animation scale is 0 or Reduce Motion is on). A CIRCLE when it is not (saving, sending,
// a PDF being drawn, a scan, sign-in, a check): the Material circular progress indicator, with short words when it lasts; in a
// button it takes the label's place and the button keeps its size ([BusyLabel]). (Skeletons.swift.)

/** What a skeleton is shaped like. */
enum class SkeletonShape { Page, Rows, Cards, Figures, Record, ThumbGrid, Chart, Photo, Form }

/** The pulse at rest (Reduce Motion, or a placeholder outside a [SkeletonLoading]): static. */
private val StaticPulse: State<Float> = mutableFloatStateOf(0.12f)

/**
 * The soft pulse every placeholder bar shares: ONE clock for the whole skeleton, provided by [SkeletonLoading] and read in the
 * draw phase only (a bar never recomposes to breathe). Outside one, and under Reduce Motion, it is a still shade.
 */
val LocalSkeletonPulse = compositionLocalOf<State<Float>> { StaticPulse }

/** The one clock (none under Reduce Motion): its value is the bar's alpha, 0.08 to 0.16. */
@Composable
fun rememberSkeletonPulse(): State<Float> {
    if (reduceMotion()) return StaticPulse
    val pulse = androidx.compose.animation.core.rememberInfiniteTransition(label = "skeleton")
    return pulse.animateFloat(
        initialValue = 0.08f, targetValue = 0.16f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable(
            androidx.compose.animation.core.tween(900, easing = androidx.compose.animation.core.FastOutSlowInEasing),
            androidx.compose.animation.core.RepeatMode.Reverse,
        ),
        label = "skeletonPulse",
    )
}

/** Fills a placeholder with the shared pulse, read when drawing. */
@Composable
private fun Modifier.skeletonFill(): Modifier {
    val base = MaterialTheme.colorScheme.onSurfaceVariant
    val pulse = LocalSkeletonPulse.current
    return drawBehind { drawRect(base, alpha = pulse.value) }
}

/** A bar of text. */
@Composable
fun SkeletonBar(width: Dp, height: Dp = 11.dp, modifier: Modifier = Modifier) {
    Spacer(modifier.width(width).height(height).clip(RoundedCornerShape(height / 2.5f)).skeletonFill())
}

/** A bar as wide as it is given. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(Radius.tile)) {
    Spacer(modifier.clip(shape).skeletonFill())
}

@Composable
private fun SkeletonCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(horizontal = 16.dp),
        contentAlignment = Alignment.CenterStart,
    ) { content() }
}

/** The rows of a list, a record's row each: an avatar circle, two lines, a figure on the right (a row is 64 dp, as the real one is). */
@Composable
fun SkeletonRows(count: Int = 6, modifier: Modifier = Modifier, avatar: Boolean = true, grouped: Boolean = true) {
    val rows: @Composable () -> Unit = {
        Column {
            repeat(count) { index ->
                Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (avatar) SkeletonBlock(Modifier.size(36.dp), CircleShape)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SkeletonBar(if (index % 3 == 1) 120.dp else 150.dp, 11.dp)
                        SkeletonBar(90.dp, 9.dp)
                    }
                    SkeletonBar(56.dp, 11.dp)
                }
            }
        }
    }
    if (grouped) SkeletonCard(modifier) { rows() } else Box(modifier.fillMaxWidth().padding(horizontal = 16.dp)) { rows() }
}

/** Cards of the list's card size: a name line, a detail line, a progress bar, a footer of two bars. */
@Composable
fun SkeletonCards(count: Int = 3, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(count) {
            SkeletonCard(Modifier.defaultMinSize(minHeight = 132.dp).padding(vertical = 16.dp)) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        SkeletonBlock(Modifier.size(36.dp), CircleShape)
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { SkeletonBar(140.dp, 12.dp); SkeletonBar(90.dp, 9.dp) }
                    }
                    SkeletonBlock(Modifier.fillMaxWidth().height(6.dp), RoundedCornerShape(3.dp))
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) { SkeletonBar(80.dp, 10.dp); SkeletonBar(64.dp, 10.dp) }
                }
            }
        }
    }
}

/** A row of figure tiles (title over a big figure), as many as fit two to a row. */
@Composable
fun SkeletonFigures(count: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (rowStart in 0 until count step 2) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (i in rowStart until minOf(count, rowStart + 2)) {
                    Column(
                        Modifier.weight(1f).clip(Radius.cardShape).background(ErpColors.card).padding(16.dp).defaultMinSize(minHeight = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) { SkeletonBar(70.dp, 9.dp); SkeletonBar(110.dp, 22.dp) }
                }
            }
        }
    }
}

/** A record's page: its hero card (name, a big figure, a status line), a card of facts, then a list of lines. */
@Composable
fun SkeletonRecordPage(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SkeletonCard(Modifier.defaultMinSize(minHeight = 172.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { SkeletonBar(84.dp, 10.dp); SkeletonBar(190.dp, 30.dp); SkeletonBar(120.dp, 10.dp) }
        }
        SkeletonCard(Modifier.defaultMinSize(minHeight = 52.dp)) { SkeletonBar(120.dp, 12.dp) }
        SkeletonBar(96.dp, 12.dp, Modifier.padding(horizontal = 4.dp).padding(top = 8.dp))
        SkeletonRows(3, Modifier.padding(0.dp), grouped = true)
    }
}

/** A grid of square thumbnails (photos, pieces), three across. */
@Composable
fun SkeletonThumbGrid(count: Int = 12, modifier: Modifier = Modifier, columns: Int = 3) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (rowStart in 0 until count step columns) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (i in 0 until columns) SkeletonBlock(Modifier.weight(1f).aspectRatio(1f))
            }
        }
    }
}

/** A chart in its card: a title line, then bars of rising height on a baseline. */
@Composable
fun SkeletonChart(modifier: Modifier = Modifier) {
    SkeletonCard(modifier.padding(horizontal = 16.dp).defaultMinSize(minHeight = 200.dp).padding(vertical = 16.dp)) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SkeletonBar(110.dp, 11.dp)
            Row(Modifier.fillMaxWidth().height(120.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                listOf(0.35f, 0.5f, 0.42f, 0.7f, 0.58f, 0.85f, 0.65f, 0.95f).forEach { h ->
                    SkeletonBlock(Modifier.weight(1f).fillMaxHeight(h), RoundedCornerShape(4.dp))
                }
            }
        }
    }
}

/** A photo: a block of the photo's shape (square unless given), rounded as the real one is. */
@Composable
fun SkeletonPhoto(modifier: Modifier = Modifier) {
    SkeletonBlock(modifier.defaultMinSize(minWidth = 24.dp, minHeight = 24.dp))
}

/** A form: a heading, then a card of labelled rows, twice. */
@Composable
fun SkeletonForm(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(2) { section ->
            SkeletonBar(96.dp, 12.dp, Modifier.padding(horizontal = 4.dp).padding(top = 6.dp))
            SkeletonCard {
                Column {
                    repeat(if (section == 0) 4 else 3) {
                        Row(Modifier.fillMaxWidth().height(56.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            SkeletonBar(96.dp, 12.dp)
                            SkeletonBar(70.dp, 12.dp)
                        }
                    }
                }
            }
        }
    }
}

/** A whole page still loading, by shape. [Page] is the ledger page's own (a date line, the hero card, a folded card, a section of rows). */
@Composable
fun SkeletonPage(shape: SkeletonShape = SkeletonShape.Page, modifier: Modifier = Modifier) {
    when (shape) {
        SkeletonShape.Rows -> Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.padding(horizontal = 16.dp).padding(top = 4.dp)) { SkeletonBlock(Modifier.fillMaxWidth().height(56.dp), CircleShape) }
            SkeletonRows(7, Modifier.padding(horizontal = 16.dp), grouped = false)
        }
        SkeletonShape.Cards -> Column(modifier.padding(top = 4.dp)) { SkeletonCards(3) }
        SkeletonShape.Figures -> Column(modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { SkeletonFigures(4); SkeletonRows(3, Modifier.padding(horizontal = 16.dp)) }
        SkeletonShape.Record -> SkeletonRecordPage(modifier)
        SkeletonShape.ThumbGrid -> Column(modifier.padding(top = 4.dp)) { SkeletonThumbGrid(15) }
        SkeletonShape.Chart -> Column(modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { SkeletonFigures(4); SkeletonChart(); SkeletonChart() }
        SkeletonShape.Photo -> Box(modifier.fillMaxWidth().padding(16.dp)) { SkeletonPhoto(Modifier.fillMaxWidth().aspectRatio(1f)) }
        SkeletonShape.Form -> SkeletonForm(modifier)
        SkeletonShape.Page -> Column(
            modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SkeletonBar(132.dp, 10.dp, Modifier.padding(horizontal = 4.dp).padding(top = 6.dp))
            SkeletonCard(Modifier.defaultMinSize(minHeight = 172.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { SkeletonBar(84.dp, 10.dp); SkeletonBar(190.dp, 30.dp); SkeletonBar(120.dp, 10.dp) }
            }
            SkeletonCard(Modifier.defaultMinSize(minHeight = 52.dp)) { SkeletonBar(120.dp, 12.dp) }
            SkeletonBar(96.dp, 12.dp, Modifier.padding(horizontal = 4.dp).padding(top = 14.dp))
            SkeletonRows(3, Modifier)
        }
    }
}

/**
 * A page whose shape is known (the default is the ledger page). With [compact] it is not a skeleton at all: three short lines were
 * once drawn inside a row or a button for a wait of unknown length, which is the circle's job ([Busy]); the argument is kept so a
 * call that said it reads as what it meant.
 */
@Composable
fun SkeletonLoading(modifier: Modifier = Modifier, label: String = "Loading", compact: Boolean = false, shape: SkeletonShape = SkeletonShape.Page) {
    if (compact) {
        Busy(modifier, label = null, description = label)
        return
    }
    val pulse = rememberSkeletonPulse()
    CompositionLocalProvider(LocalSkeletonPulse provides pulse) {
        Box(modifier.clearAndSetSemantics { contentDescription = label }) { SkeletonPage(shape) }
    }
}

// MARK: The circle

/**
 * A wait of unknown length: the Material circular progress indicator, with [label] under it when it lasts ("Preparing the PDF…").
 * Without words it is just the circle at [size], centred in what it is given.
 */
@Composable
fun Busy(modifier: Modifier = Modifier, label: String? = null, description: String = label ?: "Working", size: Dp = 24.dp, color: Color = Color.Unspecified) {
    Column(
        modifier.semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Loading(Modifier.size(size), color)
        if (!label.isNullOrEmpty()) Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

/** The circle with its words, centred in the room it is given (a save or a draw that takes over a card or a page). */
@Composable
fun BusyBlock(label: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().defaultMinSize(minHeight = 96.dp).padding(20.dp), contentAlignment = Alignment.Center) { Busy(label = label, size = 36.dp) }
}

/**
 * A button's label while it works: the circle takes the label's place and the button keeps its size (the label stays laid out,
 * unseen, under the circle). [color] is the label's colour on the button (onPrimary on a filled one).
 */
@Composable
fun BusyLabel(busy: Boolean, modifier: Modifier = Modifier, color: Color = Color.Unspecified, label: @Composable () -> Unit) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.alpha(if (busy) 0f else 1f)) { label() }
        if (busy) Loading(Modifier.size(22.dp), if (color == Color.Unspecified) androidx.compose.material3.LocalContentColor.current else color)
    }
}

// MARK: What the books say

/**
 * Show cached books immediately; only a confirmed network loss warrants an offline warning. [offline] says the
 * shelf is the phone's own copy; [connectionLost] is the app's reading of the line. Both must hold for the banner.
 */
@Composable
fun ShelfState(
    loaded: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
    offline: Boolean = false,
    connectionLost: Boolean = false,
    shape: SkeletonShape = SkeletonShape.Page,
    content: @Composable () -> Unit,
) {
    val motion = rememberErpMotion()
    val crossFade = motion.crossFade()
    val showingOfflineCopy = offline && connectionLost
    val phase = when {
        !loaded -> 0
        !error.isNullOrEmpty() && !showingOfflineCopy -> 1
        else -> 2
    }
    // The books arriving cross-fade over the outline (none with animations off).
    AnimatedContent(
        targetState = phase,
        modifier = modifier,
        transitionSpec = { crossFade },
        label = "shelf",
    ) { shown ->
        when (shown) {
            0 -> SkeletonLoading(Modifier.fillMaxSize(), shape = shape)
            1 -> NotAvailableState("Couldn't read the books", why = error, icon = Symbols.CloudOff, modifier = Modifier.fillMaxSize())
            else -> Column(Modifier.fillMaxSize()) {
                if (showingOfflineCopy) {
                    Text(
                        "Offline: showing this phone's copy",
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(top = 4.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    )
                }
                Box(Modifier.weight(1f).fillMaxWidth()) { content() }
            }
        }
    }
}

/** A page or section the signed-in person cannot have, or that has nothing to show, in the ERP's words. */
@Composable
fun NotAvailableState(
    title: String,
    modifier: Modifier = Modifier,
    why: String? = null,
    icon: ImageVector = Symbols.Lock,
) {
    Column(
        modifier.fillMaxWidth().padding(32.dp).semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text(title, style = ErpType.heading, textAlign = TextAlign.Center)
        if (!why.isNullOrEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

// MARK: Not done

/**
 * An alert for a refused or failed action, shown while [message] is set and clearing it on OK (call [onDismiss]
 * to set it back to null). Taps the error haptic as it appears.
 */
@Composable
fun FailureAlert(message: String?, onDismiss: () -> Unit, title: String = "Not done") {
    if (message == null) return
    val haptics = rememberHaptics()
    LaunchedEffect(message) { haptics.failure() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}

/**
 * A picture from an address: a still shade of its box while it comes (a static placeholder painter: no subcomposition and no
 * pulse per picture, so a grid of them costs nothing extra), so the box never opens blank or jumps. [decodePx] fixes the decode
 * size (a square it must fit in); null lets Coil measure the box.
 */
@Composable
fun SkeletonAsyncImage(
    model: Any?, contentDescription: String?, modifier: Modifier = Modifier,
    contentScale: androidx.compose.ui.layout.ContentScale = androidx.compose.ui.layout.ContentScale.Fit,
    decodePx: Int? = null,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val request = remember(model, decodePx) {
        coil3.request.ImageRequest.Builder(context).data(model).apply { if (decodePx != null) size(coil3.size.Size(decodePx, decodePx)) }.build()
    }
    coil3.compose.AsyncImage(
        model = request, contentDescription = contentDescription, modifier = modifier, contentScale = contentScale,
        placeholder = androidx.compose.ui.graphics.painter.ColorPainter(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)),
    )
}
