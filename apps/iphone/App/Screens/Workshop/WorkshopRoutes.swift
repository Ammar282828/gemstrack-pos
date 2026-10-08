import SwiftUI

/// The Workshop group: the board, the karigars, one karigar, and the given items.
///
/// "/workshop" is matched by hand rather than with `.exact`, because the board reads a query: the karigar page's
/// "On his bench" opens "/workshop?karigar=<id>" on his whole bench. "/karigars/add" stays the ERP's own form: it
/// is not an id here. "/karigars/<id>/edit" has a slash after the id, so it falls through to the ERP's edit form
/// by itself, and "?web=1" on any of these paths opens the ERP's page (the registry answers it before the routes).
enum WorkshopRoutes {
    static var all: [ScreenRoute] {
        let board = ScreenRoute(
            matches: { WorkshopLogic.isPage($0, "/workshop") },
            make: { path in AnyView(WorkshopBoard(path: path)) }
        )
        let karigar = ScreenRoute(
            matches: { WorkshopLogic.karigarId(fromPath: $0) != nil },
            make: { path in AnyView(WorkshopKarigarScreen(id: WorkshopLogic.karigarId(fromPath: path) ?? "")) }
        )
        return [
            board,
            .exact("/karigars") { WorkshopKarigarsList() },
            karigar,
            .exact("/given") { WorkshopGivenScreen() },
        ]
    }
}
