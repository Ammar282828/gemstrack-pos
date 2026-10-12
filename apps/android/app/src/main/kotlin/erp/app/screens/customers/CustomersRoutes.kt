package erp.app.screens.customers

import erp.app.nav.ScreenRoute

/**
 * The customers' places. A path that asks for "?web=1" is left unmatched on purpose, so it falls through to the ERP's
 * own page (ScreenRoute.bare would otherwise drop the query and open the native screen again): that is how the spam
 * finder reaches the web. Remove (CustomerScreen) and "Merge duplicates" (CustomerMergeSheet, a sheet over the list) are
 * native; the merge has no address of its own. "/customers/<id>/edit" is the native edit form (EditCustomer); it has a
 * slash after the id, so the customer route below never takes it, and "?web=1" on it still opens the ERP's own edit page.
 */
val CustomersRoutes: List<ScreenRoute> = run {
    val list = ScreenRoute(matches = { CustomerKit.isList(it) }, make = { CustomersList() })
    val add = ScreenRoute.exact("/customers/add") { AddCustomer() }
    val edit = ScreenRoute(
        matches = { CustomerKit.editId(it) != null },
        make = { path -> EditCustomer(CustomerKit.editId(path) ?: "") },
    )
    // After the ones above are tried, "add" cannot be an id: id(fromPath:) refuses it as well.
    val one = ScreenRoute(
        matches = { CustomerKit.id(it) != null },
        make = { path -> CustomerScreen(CustomerKit.id(path) ?: "") },
    )
    listOf(list, add, edit, one)
}
