import SwiftUI

/// The Stock group: the list of pieces (/products), one piece (/products/<sku>), and the product form,
/// adding a piece (/products/add) and editing one (/products/<sku>/edit), and adding many at once
/// (/products/bulk-add); the label designer is Settings, Labels (/settings/printer, LabelSettings). "?web=1" on
/// any of these opens the ERP's page (a piece's Delete and Print tag, the form's photo).
enum StockRoutes {
    static var all: [ScreenRoute] {
        // `item` alone would take "add" and "bulk-add" for SKUs, so the match leaves them out.
        let piece = ScreenRoute.item("/products/") { sku in StockPieceScreen(sku: sku) }
        let pieceNotAForm = ScreenRoute(
            matches: { path in piece.matches(path) && !StockKit.ownPages.contains(ScreenRoute.bare(path)) },
            make: piece.make
        )
        // The voice assistant's new piece (?voice=1) is filled in from the ERP page's own memory, so it stays there.
        let add = ScreenRoute(
            matches: { path in ScreenRoute.bare(path) == StockKit.addPath && !StockKit.fromVoice(path) },
            make: { _ in AnyView(StockPieceForm(sku: nil)) }
        )
        // A SKU and the form's word after it: `item` leaves any path with a second slash out, so this is the only match.
        let edit = ScreenRoute(
            matches: { path in StockKit.editSku(fromPath: path) != nil },
            make: { path in AnyView(StockPieceForm(sku: StockKit.editSku(fromPath: path) ?? "")) }
        )
        // Adding in bulk is a form of its own, not a piece called "bulk-add".
        let bulk = ScreenRoute.exact(StockKit.bulkAddPath) { StockBulkAdd() }
        // The forms first, then the piece.
        return [
            ScreenRoute.exact("/products") { StockList() },
            add,
            edit,
            bulk,
            pieceNotAForm,
        ]
    }
}
