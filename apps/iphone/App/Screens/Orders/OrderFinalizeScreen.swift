import SwiftUI
import UIKit
import ERPCore

/// Finalize & invoice (/orders/<id>/finalize; the web's dialog on the order page, ?do=finalize): each finished
/// piece's weight, wastage, making, stones and diamonds (or a fixed price), the discount and the shop's 24k rate,
/// with what the invoice comes to as they are typed (OrderFinalizeModel). Finalize asks once, with the total and
/// the balance, then the ERP makes the invoice (`finalizeOrder`, lib/writes/finalize-order.ts, owners only as in
/// the browser): the next number, the advances as payments, the exchange, the order Completed and linked, the
/// hisaab. The invoice then opens in its place.
struct OrderFinalizeScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var rows: [OrderFinalizeRow] = []
    @State private var discount = ""
    @State private var costTola = ""
    @State private var started = false
    @State private var confirming = false
    @State private var saving = false
    @State private var failure: String?
    @State private var made: String?

    private var order: Order? { book.orders.items.first { $0.id == id } }

    var body: some View {
        Group {
            if let made {
                InvoiceScreen(id: made)
            } else if !session.isOwner {
                ContentUnavailableView("Only an owner can invoice an order", systemImage: "lock", description: Text("Ask an owner to finalize it."))
            } else if let order, let settings = book.settings.value {
                if let inv = order.invoiceId, !inv.isEmpty {
                    ContentUnavailableView("Invoiced already", systemImage: "doc.text", description: Text("\(order.id) is on \(inv)."))
                } else {
                    form(order, settings)
                }
            } else if book.orders.loaded && order == nil {
                ContentUnavailableView("No such order", systemImage: "questionmark.folder", description: Text("\(id) isn't in the book."))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(made == nil ? "Finalize & invoice" : (made ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            book.orders.need()
            book.settings.need()
            book.invoices.need()
            start()
        }
        .onChange(of: order?.id) { _, _ in start() }
    }

    /// The dialog's opening figures, once: the order's own.
    private func start() {
        guard !started, let order else { return }
        rows = order.items.enumerated().map { OrderFinalizeRow($1, index: $0) }
        discount = NewOrderFormat.boxText(order.discountAmount ?? 0)
        let perGram = order.costRate24k ?? 0
        costTola = perGram > 0 ? String(Int((perGram * NewOrderWords.gramsPerTola).rounded())) : ""
        started = true
    }

    // MARK: The form

    private func form(_ order: Order, _ settings: Settings) -> some View {
        let f = OrderFinalizeMath.figures(order, rows: rows, discount: discount, settings: settings)
        return Form { Group {
            ForEach($rows) { $row in
                pieceSection($row, price: row.index < f.prices.count ? f.prices[row.index] : 0)
            }
            Section {
                LabeledContent("Discount") {
                    TextField("0", text: $discount)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
                // The shop's own figure for its margin: owners only, never the customer (decisions.md "Margin").
                LabeledContent("24k a tola now") {
                    TextField("For the margin", text: $costTola)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
            } footer: {
                Text("The 24k rate is the shop's own, for its margin. It is never printed.")
            }
            Section {
                LabeledContent("Pieces", value: Money.pkr(f.subtotal))
                if f.discount > 0 { LabeledContent("Discount", value: "− " + Money.pkr(f.discount)) }
                if f.exchange > 0 { LabeledContent("Exchange", value: "− " + Money.pkr(f.exchange)) }
                LabeledContent("Invoice total", value: Money.pkr(f.total))
                if f.advances > 0 { LabeledContent("Advance paid", value: "− " + Money.pkr(f.advances)) }
                LabeledContent(f.balance < 0 ? "Credit to customer" : "Balance due") {
                    Text(Money.pkr(abs(f.balance))).font(.headline).monospacedDigit()
                }
            } header: {
                Text("The invoice")
            } footer: {
                Text("Priced at the rates the order was booked at. The advances become the invoice's payments, each on its own day; the exchange comes off the total.")
            }
            if let failure {
                Section { Label(failure, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .disabled(saving)
        .safeAreaBar(edge: .bottom) {
            Button {
                if let problem = OrderFinalizeMath.problem(rows, discount: discount) {
                    failure = problem
                } else {
                    failure = nil
                    confirming = true
                }
            } label: {
                HStack(spacing: 8) {
                    if saving { ProgressView() }
                    Text("Finalize · \(Money.pkr(f.total))")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .disabled(saving)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .confirmationDialog("Make the invoice?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Make invoice") { Task { await finalize(order) } }
        } message: {
            Text(confirmWords(order, f))
        }
    }

    /// What is agreed to: the invoice's total and what is left owing (or in credit).
    private func confirmWords(_ order: Order, _ f: OrderFinalizeMath.Figures) -> String {
        let rest = f.balance < 0 ? "with " + Money.pkr(abs(f.balance)) + " in credit" : Money.pkr(f.balance) + " still due"
        return order.id + " becomes an invoice of " + Money.pkr(f.total) + ", " + rest + ". The order is then completed. Undoing it needs the delete code."
    }

    private func pieceSection(_ row: Binding<OrderFinalizeRow>, price: Double) -> some View {
        let r = row.wrappedValue
        let takes = takesWastageAndMaking(r.item.metalType)
        return Section {
            Toggle("Fixed price", isOn: row.manual)
            if r.manual {
                field("Final price", row.price, keyboard: .numberPad)
                field("Weight (g)", row.weight, keyboard: .decimalPad, placeholder: "Optional")
            } else {
                field("Final weight (g)", row.weight, keyboard: .decimalPad)
                if takes {
                    LabeledContent("Wastage %") {
                        VStack(alignment: .trailing, spacing: 2) {
                            TextField("0", text: row.wastage)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                            Text(SaleNumber.grams(r.wastageGrams) + " g")
                                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    field("Making", row.making, keyboard: .numberPad)
                }
                field("Stones", row.stones, keyboard: .numberPad)
                field("Diamonds", row.diamonds, keyboard: .numberPad)
            }
        } header: {
            HStack {
                Text("\(r.index + 1). \(r.item.description.isEmpty ? "A piece" : r.item.description)")
                Spacer()
                Text(Money.pkr(price)).monospacedDigit()
            }
        } footer: {
            if r.onOrder > 0 && Int(r.onOrder.rounded()) != Int(price.rounded()) {
                Text("On the order \(Money.pkr(r.onOrder)).")
            }
        }
    }

    private func field(_ title: String, _ text: Binding<String>, keyboard: UIKeyboardType, placeholder: String = "0") -> some View {
        LabeledContent(title) {
            TextField(placeholder, text: text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }

    private func finalize(_ order: Order) async {
        saving = true
        failure = nil
        defer { saving = false }
        do {
            let out = try await ERPAPI.shared.write("finalizeOrder", OrderFinalizeMath.request(order.id, rows: rows, discount: discount, costTola: costTola))
            let invoiceId = (out["invoice"] as? [String: Any])?["id"] as? String ?? ""
            if invoiceId.isEmpty {
                failure = "The invoice was made, but the ERP did not say its number. Look for it under Invoices."
                return
            }
            // The invoice reaches the shelf a moment after the server writes it.
            for _ in 0..<12 {
                if book.invoices.item(invoiceId) != nil { break }
                try? await Task.sleep(for: .milliseconds(250))
            }
            made = invoiceId
        } catch let e as ERPAPI.Failure {
            failure = e.message
        } catch {
            failure = error.localizedDescription + "\n\nIf the connection dropped, the invoice may have been made. Check the order before trying again."
        }
    }
}
