import SwiftUI
import UIKit
import ERPCore

// The small pieces New sale, the edit sheet and Scan a tag share.

/// A label with a number typed at its right edge. Zero is blank, as the sale's fields show it
/// (decisions.md "Number fields").
struct SaleNumberField: View {
    let label: String
    @Binding var text: String
    var prompt = "0"
    var decimal = true

    var body: some View {
        LabeledContent(label) {
            TextField(prompt, text: $text)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }
}

enum SaleKeyboard {
    /// Puts the number pad away (it has no Return key).
    static func dismiss() {
        _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

/// Where the sale links to.
enum SaleLinks {
    static let newSale = Route(path: "/invoices/new")
    /// The ERP's own pages, for what the phone does not do: reading a written bill (the AI scanner), and
    /// putting a new piece in stock ("New piece"). Editing an invoice is its `/edit` page.
    static let webBill = Route(path: "/invoices/new?web=1&scan=bill")
    static let newPiece = Route(path: "/products/add")

    /// A piece's page, which is the ERP's (`/products/<sku>`).
    static func piece(_ sku: String) -> Route {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return Route(path: "/products/" + (sku.addingPercentEncoding(withAllowedCharacters: allowed) ?? sku))
    }

    static func invoice(_ id: String) -> Route {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return Route(path: "/invoices/" + (id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id))
    }
}

/// "yyyy-MM-dd", the form the ERP keeps a delivery's expected date in.
enum SaleDates {
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ d: Date) -> String { day.string(from: d) }
    static func date(_ s: String) -> Date? { s.isEmpty ? nil : day.date(from: s) }
}

/// Pick the sale's customer from the book, or make it a walk-in. Typing a name and number on the
/// sale itself is the other way; the ERP adds a person it has not seen when the sale is saved.
struct SaleCustomerPicker: View {
    /// nil is the walk-in.
    let pick: (Customer?) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private func digits(_ s: String?) -> String { (s ?? "").filter { $0 >= "0" && $0 <= "9" } }

    private var people: [Customer] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let wanted = digits(q)
        return book.customers.items.filter { c in
            // Removed customers stay out of every list; the old "Walk-in Customer" records are not people (lib/walk-in.ts).
            if !(c.deletedAt ?? "").isEmpty || isWalkInName(c.name) { return false }
            if q.isEmpty { return true }
            if c.name.localizedCaseInsensitiveContains(q) { return true }
            return wanted.count >= 3 && digits(c.phone).contains(wanted)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { pick(nil); dismiss() } label: {
                        Label("Walk-in", systemImage: "figure.walk")
                    }
                } footer: {
                    Text("A sale to nobody in particular. No customer is made.")
                }
                Section {
                    ForEach(people) { c in
                        Button { pick(c); dismiss() } label: {
                            TwoLine(title: c.name, subtitle: c.phone).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Customer")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "Name or phone")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { book.customers.need() }
        }
        .presentationDetents([.large])
    }
}

/// New sale's Scan: the camera stays open so several tags can be read one after another, and says
/// what became of the last one.
struct SaleScanSheet: View {
    /// Takes the code, does what it does to the sale, and answers in a sentence.
    let handle: (String) -> String

    @Environment(\.dismiss) private var dismiss
    @State private var said = ""
    @State private var tick = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    TagScanner { code in
                        said = handle(code)
                        tick += 1
                    }
                    if !said.isEmpty {
                        Text(said)
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(.background.secondary, in: .rect(cornerRadius: 14))
                    }
                }
                .padding(16)
            }
            .navigationTitle("Scan a tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sensoryFeedback(.success, trigger: tick)
        }
        .presentationDetents([.large])
    }
}
