package erp.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import erp.app.ui.theme.ErpColors
import erp.core.models.OrderStatus

/**
 * What a colour means on these screens (Ledger.swift `Tone`). Nothing else picks a colour.
 *
 * - [late]: a promise missed, a piece sitting too long. [problem]: a failed or refused write. Both red, never
 *   swapped, so the two can be told apart later.
 * - [owed]: due soon, money still to come. [settled]: paid, done, ready. [working]: with the karigars.
 * - [credit]: in credit, the shop owes the customer. [quiet]: nothing to say. [house]: the house's own accent.
 */
enum class Tone { late, owed, settled, credit, working, quiet, house, problem }

/** An order's status in its tone: waiting is owed, with the karigars is working, done is settled; the rest say nothing. */
fun Tone(status: OrderStatus): Tone = when (status) {
    OrderStatus.pending -> Tone.owed
    OrderStatus.inProgress -> Tone.working
    OrderStatus.completed -> Tone.settled
    else -> Tone.quiet // cancelled, refunded, unknown
}

// The iPhone uses the system colours, which adapt. Android has none, so these are Apple's values: the fill
// for tints, bars and icons, and an ink for words, since orange or green words on white do not reach 4.5:1
// (the values are the web's tone tokens, docs/features/web-matches-app.md a.2). In dark the two are one.
private class TonePalette(fillLight: Long, inkLight: Long, dark: Long) {
    val fillLight = Color(fillLight)
    val inkLight = Color(inkLight)
    val dark = Color(dark)
}

private val lateTone = TonePalette(0xFFFF3B30, 0xFFD70015, 0xFFFF453A)
private val owedTone = TonePalette(0xFFFF9500, 0xFFC93400, 0xFFFF9F0A)
private val settledTone = TonePalette(0xFF34C759, 0xFF248A3D, 0xFF30D158)
private val creditTone = TonePalette(0xFF30B0C7, 0xFF008299, 0xFF40C8E0)
private val workingTone = TonePalette(0xFF007AFF, 0xFF0040DD, 0xFF0A84FF)

private fun Tone.palette(): TonePalette? = when (this) {
    Tone.late, Tone.problem -> lateTone
    Tone.owed -> owedTone
    Tone.settled -> settledTone
    Tone.credit -> creditTone
    Tone.working -> workingTone
    Tone.quiet, Tone.house -> null
}

/** The colour for words and icons of this tone: readable on the house's cards in light and dark. */
@Composable
@ReadOnlyComposable
fun Tone.color(): Color {
    val p = palette() ?: return if (this == Tone.house) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant
    return if (ErpColors.dark) p.dark else p.inkLight
}

/** The colour for a tone's tints, bars and dots (its pill's wash is this at 13%). */
@Composable
@ReadOnlyComposable
fun Tone.fill(): Color {
    val p = palette() ?: return if (this == Tone.house) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant
    return if (ErpColors.dark) p.dark else p.fillLight
}
