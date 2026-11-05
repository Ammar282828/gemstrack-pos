package erp.app.ui

import androidx.compose.ui.unit.dp

/**
 * The corner radii every surface uses: Material 3 Expressive's shape scale (extraSmall 4, small 8, medium 12, large 16,
 * largeIncreased 20, extraLarge 28, extraLargeIncreased 32). Nothing else picks a corner. The shapes are continuous-curvature
 * corners ([ContinuousRoundedShape], the iOS-style squircle), the same in the theme's `Shapes`.
 */
object Radius {
    /** A card of content, a hero card, the outer corners of a group of rows: extraLarge. */
    val card = 28.dp

    /** A chip, a button-like tile, a text field: large. */
    val chip = 16.dp

    /** A small tile: a step, a picker cell, a figure's inner block: medium. */
    val tile = 12.dp

    /** A thumbnail or a calendar leaf: small. */
    val thumb = 8.dp

    /** Where two rows of a group meet: extraSmall. */
    val joint = 4.dp

    val cardShape = ContinuousRoundedShape(card)
    val chipShape = ContinuousRoundedShape(chip)
    val tileShape = ContinuousRoundedShape(tile)
    val thumbShape = ContinuousRoundedShape(thumb)
}
