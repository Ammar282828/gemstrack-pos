import SwiftUI

/// The customers' places. A path that asks for "?web=1" is left unmatched on purpose, so it
/// falls through to the ERP's own page (ScreenRoute.bare would otherwise drop the query and open
/// the native screen again): that is how the spam finder reaches the web. Remove (CustomerScreen) and
/// "Merge duplicates" (CustomerMergeSheet, a sheet over the list) are native; the merge has no address of its own.
/// "/customers/<id>/edit" is the native edit form (EditCustomer); it has a slash after the id, so the customer
/// route below never takes it, and "?web=1" on it still opens the ERP's own edit page.
enum CustomersRoutes {
    static var all: [ScreenRoute] {
        let list = ScreenRoute(matches: { CustomerKit.isList($0) }, make: { _ in AnyView(CustomersList()) })
        let add = ScreenRoute.exact("/customers/add") { AddCustomer() }
        let edit = ScreenRoute(
            matches: { CustomerKit.editId(fromPath: $0) != nil },
            make: { path in AnyView(EditCustomer(id: CustomerKit.editId(fromPath: path) ?? "")) }
        )
        // After the ones above are tried, "add" cannot be an id: id(fromPath:) refuses it as well.
        let one = ScreenRoute(
            matches: { CustomerKit.id(fromPath: $0) != nil },
            make: { path in AnyView(CustomerScreen(id: CustomerKit.id(fromPath: path) ?? "")) }
        )
        return [list, add, edit, one]
    }
}
