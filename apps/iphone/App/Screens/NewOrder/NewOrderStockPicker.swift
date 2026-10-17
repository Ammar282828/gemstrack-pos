import SwiftUI
import ERPCore

/// "Add from stock" (order-form.tsx's inventory dialog): a piece in stock as the start of an order piece, its
/// category, metal, weights, charges and details copied and its SKU kept as the reference, so a copy of a piece
/// in the case is ordered in a tap. Found as the sale finds stock (SaleLookup).
struct NewOrderStockPicker: View {
    let pick: (Product) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var found: [Product] {
        let q = query.trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return Array(book.products.items.prefix(40)) }
        return SaleLookup.matches(q, in: book.products.items, excluding: [], limit: 40)
    }

    var body: some View {
        NavigationStack {
            List { Group {
                ForEach(found, id: \.sku) { p in
                    Button {
                        pick(p)
                        dismiss()
                    } label: {
                        TwoLine(title: p.name, subtitle: p.sku).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
                }
                .houseRows()
            }
            .overlay {
                if !book.products.loaded {
                    SkeletonLoading()
                } else if found.isEmpty {
                    if query.trimmingCharacters(in: .whitespaces).isEmpty {
                        EmptyState("No stock yet", symbol: "shippingbox")
                    } else {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "SKU or name")
            .navigationTitle("Add from stock")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task { book.products.need() }
    }
}
