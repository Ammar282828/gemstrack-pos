package erp.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * The corner radii every surface uses (Ledger.swift `Radius`). Nothing else picks a corner.
 * (The iPhone's are `.continuous`; Compose has no squircle, the round corner is the closest.)
 */
object Radius {
    /** A card of content: `ledgerCard`, hero and section cards. */
    val card = 22.dp

    /** A chip or round-cornered control: `QuickAction`, a button-like tile. */
    val chip = 14.dp

    /** A small tile: a step, a picker cell, a figure tile. */
    val tile = 12.dp

    /** A thumbnail or a calendar leaf. */
    val thumb = 10.dp

    val cardShape = RoundedCornerShape(card)
    val chipShape = RoundedCornerShape(chip)
    val tileShape = RoundedCornerShape(tile)
    val thumbShape = RoundedCornerShape(thumb)
}
