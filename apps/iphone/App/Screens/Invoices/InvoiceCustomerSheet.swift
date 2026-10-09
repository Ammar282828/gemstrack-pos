import SwiftUI
import ERPCore

/// Who a saved sale was for, set on the invoice (components/invoice/set-customer-dialog.tsx; decision "Name a
/// sale"): pick them from the book, or type a new name and a number. The ERP moves the sale's hisaab line to them
/// and re-prices nothing (lib/writes/invoice-customer.ts, `setInvoiceCustomer`). An owner's, as on the web, where it
/// is a Firestore write the shop floor cannot make.
struct InvoiceCustomerSheet: View {
    let invoice: Invoice
    /// Told once it is saved, in the web's words.
    let onSaved: (InvoiceNote) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    /// The dialog's `who`: the name as typed or picked, the customer picked, the number.
    @State private var name = ""
    @State private var customerId: String?
    @State private var phone = ""
    @State private var saving = false
    @State private var error: String?

    /// Already someone's (not a walk-in, however it was spelled).
    private var named: Bool {
        let n = invoice.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return !n.isEmpty && !isWalkInName(n)
    }

    private var owes: Bool { invoice.balanceDue > 0.5 }

    private var typed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// A person's name, never the walk-in placeholder (the store refuses both).
    private var canSave: Bool { !saving && !typed.isEmpty && !isWalkInName(typed) }

    private var explanation: String {
        let lead = named ? "\(invoice.id) is \(invoice.customerName)'s now." : "\(invoice.id) was saved as a walk-in."
        return lead + " Pick them, or type a new name." + (owes ? " What is still owed moves to them." : "")
            + " The pieces and prices stay as they are."
    }

    private var customerNote: String {
        if customerId != nil { return "An existing customer." }
        return typed.isEmpty ? "" : "A new customer will be made."
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Text(explanation)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Section {
                    // The book is offered as the name is typed (customer-autocomplete.tsx); a number typed first
                    // finds its customer too. Typing again lets go of a pick.
                    CustomerField(
                        name: name,
                        pickedId: customerId,
                        phone: $phone,
                        book: book.customers.items,
                        recent: { CustomerField.recent(invoices: book.invoices.items, orders: book.orders.items, book: book.customers.items) },
                        type: { text in typeName(text) },
                        pick: { c in pickCustomer(c) }
                    )
                } header: {
                    Text("Customer")
                } footer: {
                    Text(customerNote)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(named ? "Change the customer" : "Who was it for?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
        // Full height: the book's suggestions open under the name as it is typed.
        .interactiveDismissDisabled(saving)
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
        }
    }

    /// Typing lets go of a picked customer and keeps the number typed, as the web's box does.
    private func typeName(_ text: String) {
        guard text != name else { return }
        name = text
        customerId = nil
    }

    /// A pick from the book: their name and their number (or the one typed, if they have none). The walk-in
    /// row empties the box, and Save stays closed until a person is named.
    private func pickCustomer(_ c: Customer?) {
        guard let c else {
            customerId = nil
            name = ""
            phone = ""
            return
        }
        customerId = c.id
        name = c.name
        if let p = c.phone, !p.isEmpty { phone = p }
    }

    private func save() async {
        saving = true
        error = nil
        var fields: [String: Any] = ["invoiceId": invoice.id, "name": typed]
        if let customerId { fields["customerId"] = customerId }
        let number = pakistanE164(phone)
        if !number.isEmpty { fields["phone"] = number }
        do {
            let out = try await ERPAPI.shared.write("setInvoiceCustomer", fields)
            // The name on file when one was picked, which the ERP puts on the invoice over the one typed.
            let saved = (out["invoice"] as? [String: Any])?["customerName"] as? String ?? typed
            onSaved(InvoiceNote(
                title: "\(invoice.id) is \(saved)'s",
                detail: owes ? "The \(Money.pkr(invoice.balanceDue)) still owed is on their hisaab now." : "Nothing was re-priced."
            ))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
