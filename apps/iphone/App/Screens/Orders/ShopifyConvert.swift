import SwiftUI
import ERPCore

// Old Shopify sales are still invoices (owner, 2026-11-09, FIX 2). An owner can turn them into orders: the pieces go to the
// workshop, the money already paid becomes advances, and the sale counts again when the order is finalized. The ERP's server
// does it (`shopifyInvoicesToOrders`, behind the delete code); this file is the explanation, the code and the answer.

/// What one run of the conversion answered: the orders made and the invoices it left alone.
struct ShopifyConvertResult {
    let converted: [(invoiceId: String, orderId: String)]
    let skipped: [(invoiceId: String, reason: String)]

    init(_ response: [String: Any]) {
        let made = response["converted"] as? [[String: Any]] ?? []
        let left = response["skipped"] as? [[String: Any]] ?? []
        converted = made.compactMap { (row: [String: Any]) -> (invoiceId: String, orderId: String)? in
            guard let invoice = row["invoiceId"] as? String, let order = row["orderId"] as? String else { return nil }
            return (invoiceId: invoice, orderId: order)
        }
        skipped = left.compactMap { (row: [String: Any]) -> (invoiceId: String, reason: String)? in
            guard let invoice = row["invoiceId"] as? String else { return nil }
            return (invoiceId: invoice, reason: row["reason"] as? String ?? "not converted")
        }
    }

    /// "12 made orders, 2 skipped" and what was skipped, for the toast.
    var note: Note {
        func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
        if converted.isEmpty && skipped.isEmpty { return Note(title: "Nothing to convert") }
        var title = plural(converted.count, "sale") + " made into orders"
        if converted.count == 1 { title = "1 sale made into an order" }
        if converted.isEmpty { title = "No sales were converted" }
        var detail = ""
        if !skipped.isEmpty {
            let shown = skipped.prefix(3).map { "\($0.invoiceId): \($0.reason)" }.joined(separator: "; ")
            detail = "\(skipped.count) skipped (\(shown)\(skipped.count > 3 ? "; …" : ""))"
        }
        return Note(title: title, detail: detail, failed: converted.isEmpty && !skipped.isEmpty)
    }
}

/// One intent to convert: the invoices, and the one request name every retry of it sends (so the server never does it twice).
struct ShopifyConvertRequest: Identifiable {
    let id = UUID()
    let ids: [String]
    var requestId: String { "shopify-to-orders-" + id.uuidString }

    init(ids: [String]) { self.ids = ids }
}

/// Sets a request to start the flow: explanation, delete code, then `onResult`.
extension View {
    func shopifyConvertFlow(_ request: Binding<ShopifyConvertRequest?>, onResult: @escaping (ShopifyConvertResult) -> Void) -> some View {
        modifier(ShopifyConvertFlow(request: request, onResult: onResult))
    }
}

struct ShopifyConvertFlow: ViewModifier {
    @Binding var request: ShopifyConvertRequest?
    let onResult: (ShopifyConvertResult) -> Void

    /// Explained and agreed: the code is asked as the explanation closes (two sheets cannot share one moment).
    @State private var agreed: ShopifyConvertRequest?
    @State private var deletion: OwnerDeletion?
    @State private var result: ShopifyConvertResult?

    func body(content: Content) -> some View {
        content
            .sheet(item: $request, onDismiss: askForCode) { (r: ShopifyConvertRequest) in
                ShopifyConvertExplainSheet(count: r.ids.count) {
                    agreed = r
                    request = nil
                }
                .presentationSizing(.form)
            }
            .sheet(item: $deletion) { (d: OwnerDeletion) in
                OwnerDeleteCodeSheet(deletion: d) {
                    if let done = result {
                        result = nil
                        onResult(done)
                    }
                }
                .presentationSizing(.form)
            }
    }

    private func askForCode() {
        guard let r = agreed else { return }
        agreed = nil
        let ids = r.ids
        let requestId = r.requestId
        let many = ids.count == 1 ? "This sale" : "These \(ids.count) sales"
        deletion = OwnerDeletion(
            what: ids.count == 1 ? "Make \(ids[0]) an order" : "Make \(ids.count) Shopify sales orders",
            detail: "\(many) stop being invoice\(ids.count == 1 ? "" : "s") and become orders for the workshop.",
            final: false
        ) { code in
            let out = try await ERPAPI.shared.write("shopifyInvoicesToOrders",
                                                    ["invoiceIds": ids, "deleteCode": code], requestId: requestId)
            result = ShopifyConvertResult(out)
        }
    }
}

/// What converting does, said before the code is asked for.
struct ShopifyConvertExplainSheet: View {
    let count: Int
    let onContinue: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("The pieces go to the workshop, to be made and given to karigars.", systemImage: "hammer")
                    Label("What the customer has already paid becomes advances on the order.", systemImage: "banknote")
                    Label("The sale counts as revenue again when the order is finalized and invoiced.", systemImage: "doc.text")
                    Label("The old invoice\(count == 1 ? " is" : "s are") removed. Sales already fulfilled on Shopify are left alone.",
                          systemImage: "trash")
                } header: {
                    Text(count == 1 ? "Make this sale an order" : "Make \(count) sales orders").textCase(nil)
                }
                .font(.house(.callout))
                Section {
                    Button("Continue", action: onContinue)
                        .buttonStyle(.houseProminent)
                }
            }
            .houseForm()
            .navigationTitle("Make orders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}
