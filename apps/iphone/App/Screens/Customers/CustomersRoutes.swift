import SwiftUI

/// The customers' places. A path that asks for "?web=1" is left unmatched on purpose, so it
/// falls through to the ERP's own page (ScreenRoute.bare would otherwise drop the query and open
/// the native screen again): that is how Remove and "Merge duplicates" reach the web.
/// "/customers/<id>/edit" has a slash after the id, so it falls through to the ERP's edit form.
enum CustomersRoutes {
    static var all: [ScreenRoute] {
        let list = ScreenRoute(matches: { CustomerKit.isList($0) }, make: { _ in AnyView(CustomersList()) })
        let add = ScreenRoute.exact("/customers/add") { AddCustomer() }
        // After the two above are tried, "add" cannot be an id: id(fromPath:) refuses it as well.
        let one = ScreenRoute(
            matches: { CustomerKit.id(fromPath: $0) != nil },
            make: { path in AnyView(CustomerScreen(id: CustomerKit.id(fromPath: path) ?? "")) }
        )
        return [list, add, one]
    }
}
