import SwiftUI

/// The Workshop group: the board, the karigars, one karigar, the karigar form (new and edit), and the given items.
///
/// "/workshop" is matched by hand rather than with `.exact`, because the board reads a query: the karigar page's
/// "On his bench" opens "/workshop?karigar=<id>" on his whole bench. "/karigars/add" and "/karigars/<id>/edit" are
/// the karigar form's, tried before the karigar route (which refuses "add" and any path with a slash after the id as
/// well, so the specific ones win either way). "?web=1" on any of these paths opens the ERP's page (the registry
/// answers it before the routes).
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
        let add = ScreenRoute.exact("/karigars/add") { KarigarForm() }
        let edit = ScreenRoute(
            matches: { WorkshopLogic.karigarEditId(fromPath: $0) != nil },
            make: { path in AnyView(KarigarForm(id: WorkshopLogic.karigarEditId(fromPath: path))) }
        )
        return [
            board,
            .exact("/karigars") { WorkshopKarigarsList() },
            add,
            edit,
            karigar,
            .exact("/given") { WorkshopGivenScreen() },
        ]
    }
}
