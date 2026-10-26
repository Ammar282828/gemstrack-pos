package erp.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import erp.app.ui.theme.LocalToneColors
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

// Material You (2026-10-26): the tones are tonal palettes, as Material builds a role. Red is the scheme's error; amber,
// green, teal and blue are blended toward the business's colour (Material's harmonisation) and read at tone 40 in light,
// 80 in dark, so every one clears 4.5:1 on the scheme's surfaces. The roles are made once per theme (erp.app.ui.theme.ToneColors).

/** The colour for words and icons of this tone: readable on the scheme's surfaces in light and dark. */
@Composable
@ReadOnlyComposable
fun Tone.color(): Color = LocalToneColors.current[this].ink

/** The colour for a tone's bars and dots. */
@Composable
@ReadOnlyComposable
fun Tone.fill(): Color = LocalToneColors.current[this].fill

/** A pill's ground in this tone (a tonal container), with [onContainer] for its words. */
@Composable
@ReadOnlyComposable
fun Tone.container(): Color = LocalToneColors.current[this].container

@Composable
@ReadOnlyComposable
fun Tone.onContainer(): Color = LocalToneColors.current[this].onContainer
