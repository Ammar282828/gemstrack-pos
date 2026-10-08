import SwiftUI

/// The Stock group: the list of pieces (/products) and one piece (/products/<sku>). Adding a piece
/// (/products/add), adding in bulk (/products/bulk-add) and the label printer (/settings/printer)
/// stay the ERP's own pages, and so does "/products/<sku>/edit": `item` leaves out any path with a
/// second slash, so it falls through by itself. "?web=1" on a piece opens the ERP's page (Delete).
enum StockRoutes {
    static var all: [ScreenRoute] {
        // `item` alone would take "add" and "bulk-add" for SKUs, so the match leaves them out.
        let piece = ScreenRoute.item("/products/") { sku in StockPieceScreen(sku: sku) }
        let pieceNotAForm = ScreenRoute(
            matches: { path in piece.matches(path) && !StockKit.ownPages.contains(ScreenRoute.bare(path)) },
            make: piece.make
        )
        return [
            ScreenRoute.exact("/products") { StockList() },
            pieceNotAForm,
        ]
    }
}
