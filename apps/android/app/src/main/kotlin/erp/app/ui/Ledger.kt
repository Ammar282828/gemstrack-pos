package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.logic.OrderStage
import erp.core.logic.OrderTiming
import erp.core.logic.PromiseState
import erp.core.logic.isUrgent
import erp.core.logic.isWalkInName
import erp.core.models.OrderStatus
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

// The ledger: the look of Home, Orders and Invoices (Ledger.swift). Money is the subject (the display size for a
// screen's one big figure, steady digits); colour means something or it is not used (Tone); a person comes
// before a number; one badge at most on a card.

// MARK: Words in a capsule

/**
 * A short state in its tone's colour: "Paid", "PKR 86,000 due", "Late 2 days". At most one to a card.
 * [icon] is decorative: the words say it.
 */
@Composable
fun Pill(text: String, modifier: Modifier = Modifier, tone: Tone = Tone.quiet, icon: ImageVector? = null) {
    PillBody(text, tone.onContainer(), tone.container(), modifier, icon)
}

/** A colour no tone has (older [StatusBadge] call sites); new code passes a [Tone]. */
@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    PillBody(text, color, color.copy(alpha = 0.16f).compositeOver(MaterialTheme.colorScheme.surfaceContainer), modifier, icon)
}

/** A tonal container with its on-container words (Material's own roles), as a small capsule. */
@Composable
private fun PillBody(text: String, inkTo: Color, washTo: Color, modifier: Modifier, icon: ImageVector?) {
    // A status that changes cross-fades its colour (150 ms) instead of blinking.
    val spec = Motion.exit<Color>(reduceMotion()).let { if (reduceMotion()) it else androidx.compose.animation.core.tween(150) }
    val ink by androidx.compose.animation.animateColorAsState(inkTo, spec, label = "pillInk")
    val wash by androidx.compose.animation.animateColorAsState(washTo, spec, label = "pillWash")
    Row(
        modifier
            .clip(CircleShape)
            .background(wash)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, Modifier.size(12.dp), tint = ink)
        Text(
            text,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** An order's status as a coloured word. A thin wrapper over [Pill], kept for the iPhone's call sites. */
@Composable
fun StatusBadge(text: String, color: Color, modifier: Modifier = Modifier) = Pill(text, color, modifier)

@Composable
fun StatusBadge(text: String, tone: Tone, modifier: Modifier = Modifier) = Pill(text, modifier, tone)

@Composable
fun StatusBadge(order: OrderStatus, modifier: Modifier = Modifier) =
    Pill(order.rawValue.ifEmpty { "No status" }, modifier, Tone(order))

// MARK: Who

/** The three sizes screens use; pass one rather than a number. */
object MonogramSize {
    /** A list row. */
    val row = 38.dp

    /** Inside a card. */
    val card = 38.dp

    /** A detail page's header. */
    val hero = 56.dp
}

/** "Sana Demo" -> "SD", "M. Hussain" -> "MH", a walk-in or no name -> "". */
fun monogramLetters(name: String): String {
    if (isWalkInName(name)) return ""
    return name.split(' ', '.', '-')
        .filter { it.isNotEmpty() && it.first().isLetter() }
        .take(2)
        .joinToString("") { it.first().uppercase() }
}

/** A person's initials in the house's accent, or a figure for a walk-in: what a row leads with. */
@Composable
fun Monogram(name: String, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val letters = monogramLetters(name)
    // Material's contact avatar: the secondary container with its on-container letters (a hero card is the primary container, so it stays apart from it).
    val accent = MaterialTheme.colorScheme.onSecondaryContainer
    // Sized in dp whatever the font scale: the circle is a fixed mark, the words beside it are what scale.
    val textSize = with(LocalDensity.current) { (size * 0.38f).toSp() }
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        if (letters.isEmpty()) {
            Icon(Symbols.Person, contentDescription = null, Modifier.size(size * 0.5f), tint = accent)
        } else {
            Text(
                letters,
                style = ErpType.heading.copy(fontSize = textSize, lineHeight = textSize),
                color = accent,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

// MARK: When

private fun karachiFormat(pattern: String): DateTimeFormatter =
    DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)

private val weekdayFormat = karachiFormat("EEE")
private val dayFormat = karachiFormat("d")
private val monthFormat = karachiFormat("MMM")
private val promiseDayFormat = karachiFormat("EEE d MMM")

/** A promised day as a small calendar leaf: the weekday over the date, in the promise's tone. A calendar when none. */
@Composable
fun DateLeaf(date: Instant?, modifier: Modifier = Modifier, tone: Tone = Tone.quiet, size: Dp = 44.dp) {
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    val toned = if (tone == Tone.quiet) quiet else tone.color()
    val density = LocalDensity.current
    fun fixed(ratio: Float) = with(density) { (size * ratio).toSp() }
    Column(
        modifier
            .defaultMinSize(minWidth = size, minHeight = size + 6.dp)
            .clip(Radius.thumbShape)
            .background(if (tone == Tone.quiet) MaterialTheme.colorScheme.surfaceContainerHighest else tone.container())
            .padding(horizontal = 2.dp)
            .clearAndSetSemantics {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (date != null) {
            Text(weekdayFormat.format(date).uppercase(), fontSize = fixed(0.2f), lineHeight = fixed(0.24f), fontWeight = FontWeight.Bold, color = toned, maxLines = 1)
            Text(
                dayFormat.format(date),
                style = ErpType.heading.copy(fontSize = fixed(0.42f), lineHeight = fixed(0.5f), fontFeatureSettings = TabularDigits),
                color = if (tone == Tone.late) tone.color() else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
            Text(monthFormat.format(date).uppercase(), fontSize = fixed(0.16f), lineHeight = fixed(0.2f), fontWeight = FontWeight.SemiBold, color = quiet, maxLines = 1)
        } else {
            Icon(Symbols.CalendarToday, contentDescription = null, Modifier.size(size * 0.36f), tint = quiet.copy(alpha = 0.6f))
        }
    }
}

/** An order's promise as words and a tone: "Late 2 days", "Due today", "Due Thu 12 Oct", "No date". */
object PromiseWords {
    data class Said(val text: String, val tone: Tone)

    fun say(t: OrderTiming): Said = when (t.state) {
        PromiseState.late -> {
            val d = maxOf(t.daysLate, 1)
            Said("Late $d day${if (d == 1) "" else "s"}", Tone.late)
        }
        PromiseState.today -> Said("Due today", Tone.owed)
        PromiseState.upcoming -> {
            val due = t.due
            if (due == null) Said("No date", Tone.quiet) else Said("Due " + promiseDayFormat.format(due), if (isUrgent(t)) Tone.owed else Tone.quiet)
        }
        PromiseState.noPromise -> Said("No date", Tone.quiet)
    }
}

// MARK: Where an order stands

/** Booked -> Making -> Ready -> Invoiced: the four bars and where each stage falls on them. */
object StageSteps {
    val names = listOf("Booked", "Making", "Ready", "Invoiced")

    fun index(s: OrderStage): Int = when (s) {
        OrderStage.transfer, OrderStage.new -> 0
        OrderStage.karigar -> 1
        OrderStage.ready -> 2
        OrderStage.payment, OrderStage.done -> 3
        OrderStage.closed -> -1
    }
}

/**
 * Booked -> Making -> Ready -> Invoiced, as four short bars: how far an order has come, at a glance. Awaiting an
 * online transfer stands at Booked; a cancelled or refunded order shows no track. [labels] puts the step names
 * under the bars (the order's page); the card shows the bars alone.
 */
@Composable
fun StageTrack(stage: OrderStage, modifier: Modifier = Modifier, labels: Boolean = false) {
    val at = StageSteps.index(stage)
    val reduce = reduceMotion()
    // Inactive bars a little firmer in dark, where 0.18 of grey nearly vanishes on the card.
    val idle = MaterialTheme.colorScheme.outlineVariant
    val accent = ErpColors.accent
    val spoken = if (at < 0) "Closed" else "Stage: " + StageSteps.names[minOf(at, StageSteps.names.size - 1)]
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        StageSteps.names.forEachIndexed { index, name ->
            // The bars travel to the new stage (none with animations off).
            val fill by animateColorAsState(if (index <= at) accent else idle, Motion.travel(reduce), label = "stage")
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.fillMaxWidth().height(if (labels) 5.dp else 4.dp).clip(CircleShape).background(fill))
                if (labels) {
                    Text(
                        name,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = if (index == at) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (index == at) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

// MARK: Headings

/** A section's heading: its name in the primary, a count, and what it comes to on the right. */
@Composable
fun LedgerHeading(
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    trailing: String? = null,
    tone: Tone = Tone.quiet,
) {
    val head: @Composable () -> Unit = {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
            Text(
                title,
                // Android Settings' group header: sentence case, small, in the primary.
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                color = if (tone == Tone.late) tone.color() else MaterialTheme.colorScheme.primary,
            )
            if (count != null && count > 0) {
                Text(
                    "$count",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    val total: @Composable () -> Unit = {
        if (trailing != null) {
            Text(
                trailing,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    val merged = modifier.fillMaxWidth().semantics(mergeDescendants = true) { heading() }
    if (isLargeText()) {
        Column(merged, verticalArrangement = Arrangement.spacedBy(6.dp)) { head(); total() }
    } else {
        Row(merged, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.weight(1f)) { head() }
            total()
        }
    }
}
