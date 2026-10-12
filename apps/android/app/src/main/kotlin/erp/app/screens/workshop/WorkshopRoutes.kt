package erp.app.screens.workshop

import erp.app.nav.ScreenRoute

/**
 * The Workshop group: the board, the karigars, one karigar, the karigar form (new and edit), and the given items.
 *
 * "/workshop" is matched by hand rather than with `exact`, because the board reads a query: the karigar page's "On
 * his bench" opens "/workshop?karigar=<id>" on his whole bench, and an order's Give out "/workshop?order=<id>".
 * "/karigars/add" and "/karigars/<id>/edit" are the karigar form's, tried before the karigar route (which refuses
 * "add" and any path with a slash after the id as well, so the specific ones win either way). "?web=1" on any of
 * these paths opens the ERP's page (the registry answers it before the routes).
 */
val WorkshopRoutes: List<ScreenRoute> = listOf(
    ScreenRoute(
        matches = { WorkshopLogic.isPage(it, "/workshop") },
        make = { path -> WorkshopBoard(path) },
    ),
    ScreenRoute.exact("/karigars") { WorkshopKarigarsList() },
    ScreenRoute.exact("/karigars/add") { KarigarForm() },
    ScreenRoute(
        matches = { WorkshopLogic.karigarEditId(it) != null },
        make = { path -> KarigarForm(WorkshopLogic.karigarEditId(path)) },
    ),
    ScreenRoute(
        matches = { WorkshopLogic.karigarId(it) != null },
        make = { path -> WorkshopKarigarScreen(WorkshopLogic.karigarId(path) ?: "") },
    ),
    ScreenRoute.exact("/given") { WorkshopGivenScreen() },
)
