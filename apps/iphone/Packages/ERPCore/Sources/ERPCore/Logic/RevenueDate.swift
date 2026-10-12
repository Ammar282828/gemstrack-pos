// Ported from src/lib/store.ts getInvoiceRevenueDate.

import Foundation

/// Revenue-recognition date for an invoice. Sales are recognised on the date the underlying ORDER was
/// created, not the day it happened to be invoiced, so an old order invoiced later does not inflate the
/// later period. Falls back to the invoice's own createdAt for a direct sale with no source order.
public func getInvoiceRevenueDate(_ invoice: Invoice, ordersById: [String: Order]) -> String {
    if let source = invoice.sourceOrderId, !source.isEmpty, let order = ordersById[source], !order.createdAt.isEmpty {
        return order.createdAt
    }
    return invoice.createdAt
}
