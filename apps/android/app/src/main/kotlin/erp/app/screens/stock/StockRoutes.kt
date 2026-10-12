package erp.app.screens.stock

import erp.app.nav.ScreenRoute

/**
 * The Stock group: the list of pieces (/products), one piece (/products/<sku>), and the product form, adding a piece
 * (/products/add) and editing one (/products/<sku>/edit), and adding many at once (/products/bulk-add); the label
 * designer is Settings, Labels (/settings/printer). "?web=1" on any of these opens the ERP's page (a piece's Delete and
 * Print tag, the form's photo).
 */
val StockRoutes: List<ScreenRoute> = run {
    // `item` alone would take "add" and "bulk-add" for SKUs, so the match leaves them out.
    val piece = ScreenRoute.item("/products/") { sku -> StockPieceScreen(sku) }
    val pieceNotAForm = ScreenRoute(
        matches = { path -> piece.matches(path) && ScreenRoute.bare(path) !in StockKit.ownPages },
        make = piece.make,
    )
    // The voice assistant's new piece (?voice=1) is filled in from the ERP page's own memory, so it stays there.
    val add = ScreenRoute(
        matches = { path -> ScreenRoute.bare(path) == StockKit.addPath && !StockKit.fromVoice(path) },
        make = { StockPieceForm(sku = null) },
    )
    // A SKU and the form's word after it: `item` leaves any path with a second slash out, so this is the only match.
    val edit = ScreenRoute(
        matches = { path -> StockKit.editSku(path) != null },
        make = { path -> StockPieceForm(sku = StockKit.editSku(path) ?: "") },
    )
    // Adding in bulk is a form of its own, not a piece called "bulk-add".
    val bulk = ScreenRoute.exact(StockKit.bulkAddPath) { StockBulkAdd() }
    // The forms first, then the piece.
    listOf(ScreenRoute.exact("/products") { StockList() }, add, edit, bulk, pieceNotAForm)
}
