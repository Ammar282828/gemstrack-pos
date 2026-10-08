import SwiftUI

/// The Sale group: the New chooser, a new sale, and Scan a tag.
///
/// "/invoices/new" is a path the Invoices group's item route already leaves out ("new" is not an
/// invoice id), so the two never meet. `?web=1` on any of these opens the ERP's own page instead
/// (ScreenRegistry.wantsWeb), which is how the phone links to what it does not do: editing an
/// invoice, the AI bill scanner, and billing a piece that was never in stock.
enum SaleRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/new") { NewChooser() },
            .exact("/invoices/new") { NewSale() },
            .exact("/scan") { ScanTag() },
        ]
    }
}
