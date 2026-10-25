import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
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
    /// The rate boxes as typed: the order's booked rates to start with (gold moves; the counter may change any).
    @State private var rateTexts: RateTexts = [:]
    @State private var costTola = ""
    @State private var started = false
    @State private var confirming = false
    @State private var saving = false
    @State private var failure: String?
    @State private var made: String?

    private var order: Order? { book.orders.item(id) }

    var body: some View {
        Group {
            if let made {
                InvoiceScreen(id: made)
                    .environment(\.zoomNamespace, nil)  // swapped in place after a save: no row to zoom from
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
                SkeletonLoading()
            }
        }
        .navigationTitle(made == nil ? "Make invoice" : (made ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .moneyFeedback(success: made, failure: 0)
        .failureAlert($failure, title: "Not made")
        .onAppear {
            book.orders.need()
            book.settings.need()
            book.invoices.need()
            start()
        }
        .onChange(of: order?.id) { _, _ in start() }
        .onChange(of: book.settings.value != nil) { _, _ in start() }
    }

    /// The dialog's opening figures, once: the order's own.
    private func start() {
        guard !started, let order, let settings = book.settings.value else { return }
        rows = order.items.enumerated().map { OrderFinalizeRow($1, index: $0) }
        rateTexts = OrderFinalizeMath.bookedTexts(order, settings)
        discount = NewOrderFormat.rupeeBox(order.discountAmount)
        let perGram = order.costRate24k ?? 0
        costTola = perGram > 0 ? String(Int((perGram * NewOrderWords.gramsPerTola).rounded())) : ""
        started = true
    }

    // MARK: The form

    private func form(_ order: Order, _ settings: Settings) -> some View {
        let f = OrderFinalizeMath.figures(order, rows: rows, discount: discount, settings: settings, rateTexts: rateTexts)
        return TransactionWorkspace {
          Form { Group {
            Section {
                header(order, due: f.balance)
            }
            ratesSection(order, settings)
            ForEach($rows) { $row in
                pieceSection($row, price: row.index < f.prices.count ? f.prices[row.index] : 0)
            }
            Section {
                LabeledContent("Discount") {
                    TextField("0", text: $discount.wholeRupees)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
                // FinalizeOrderDialog: the bill before any discount is the pieces less the exchange.
                RoundOffChips(payable: f.subtotal - f.exchange, discount: f.discount) { n in
                    discount = NewOrderFormat.rupeeBox(n)
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
                LabeledContent(isCredit(f.balance) ? "Credit to customer" : "Balance due") {
                    Text(Money.pkr(abs(f.balance))).font(.headline).monospacedDigit()
                }
            } header: {
                LedgerHeading(title: "The invoice")
            } footer: {
                Text("Priced at the rates above (the order's booked ones unless you changed one). The advances become the invoice's payments, each on its own day; the exchange comes off the total.")
            }
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .disabled(saving)
        } review: {
            TransactionReview(customer: order.customerName ?? "", pieces: rows.enumerated().map { index, row in
                .init(label: "\(index + 1). \(row.item.description)", value: Money.pkr(index < f.prices.count ? f.prices[index] : 0))
            }, figures: [
                .init(label: "Invoice total", value: Money.pkr(f.total)),
                .init(label: "Advance paid", value: Money.pkr(f.advances)),
                .init(label: isCredit(f.balance) ? "Credit to customer" : "Balance due", value: Money.pkr(abs(f.balance)))
            ])
        } footer: {
            VStack(spacing: pt(10)) {
            Button {
                if let problem = OrderFinalizeMath.problem(rows, discount: discount, order: order, rateTexts: rateTexts) {
                    failure = problem
                } else {
                    failure = nil
                    confirming = true
                }
            } label: {
                HStack(spacing: pt(8)) {
                    if saving { ProgressView().controlSize(.small) }
                    Text("Make invoice \u{00B7} \(Money.pkr(f.total))")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .largeOnPhone()
            #if os(macOS)
            // Return makes the invoice from the keyboard, as a Mac dialog's default button does.
            .keyboardShortcut(.defaultAction)
            .help("Make the invoice (Return)")
            #endif
            .disabled(saving)
            }
            .padding(.horizontal, pt(16))
            .padding(.bottom, pt(8))
        }
        .confirmationDialog("Make the invoice?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Make invoice") { Task { await finalize(order) } }
        } message: {
            Text(confirmWords(order, f))
        }
    }

    /// Rates (PKR per gram) for the metals and karats the order uses, prefilled with the booked rates (the web
    /// dialog's block): gold moves daily and orders are delivered weeks after they are booked, so any may be changed,
    /// or all set to today's. Silver's rate is all-in (it holds the making and wastage). Nothing is sent unless
    /// one changed.
    @ViewBuilder
    private func ratesSection(_ order: Order, _ settings: Settings) -> some View {
        let rateRows = finalizeRateRows(order.items)
        if !rateRows.isEmpty {
            let booked = orderInvoiceRates(order, settings)
            let changed = OrderFinalizeMath.changedRates(order, settings, texts: rateTexts)
            Section {
                ForEach(rateRows, id: \.field) { r in
                    LabeledContent(r.label) {
                        VStack(alignment: .trailing, spacing: 2) {
                            TextField("0", text: rateBinding(r.field))
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                                .accessibilityLabel("\(r.label) rate per gram")
                            if changed[r.field] != nil {
                                Text("Booked at " + OrderFinalizeMath.rateText(rateShown(booked, r.field)))
                                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                    }
                }
                if OrderFinalizeMath.todayDiffers(order, settings, texts: rateTexts) {
                    Button("Use today's rates") {
                        rateTexts.merge(OrderFinalizeMath.todayTexts(order, settings)) { _, today in today }
                    }
                    .buttonStyle(.borderless)
                }
            } header: {
                LedgerHeading(title: "Rates (PKR per gram)")
            } footer: {
                Text("Booked rates unless you change one."
                     + (rateRows.contains { $0.field == .silverRatePerGram } ? " Silver's rate already holds its making and wastage." : "")
                     + " The invoice keeps the rates it was priced at.")
            }
        }
    }

    private func rateBinding(_ field: RateField) -> Binding<String> {
        Binding(get: { rateTexts[field] ?? "" }, set: { rateTexts[field] = $0 })
    }

    /// Who it is for, which order, and what is due once the advances are counted.
    private func header(_ order: Order, due: Double) -> some View {
        HStack(alignment: .center, spacing: pt(12)) {
            Monogram(name: OrdersLogic.customerName(order), size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 2) {
                Text(OrdersLogic.customerName(order)).font(.headline).lineLimit(2)
                Text(order.id).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if abs(due) >= 1 {
                    RowAmount(amount: abs(due), tone: due < 0 ? Tone.credit.color : Tone.owed.color)
                    Text(due < 0 ? "In credit" : "Due").font(.caption).foregroundStyle(.secondary)
                } else {
                    Pill("Paid", tone: .settled)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// What is agreed to: the invoice's total and what is left owing (or in credit).
    private func confirmWords(_ order: Order, _ f: OrderFinalizeMath.Figures) -> String {
        let rest = isCredit(f.balance) ? "with " + Money.pkr(abs(f.balance)) + " in credit" : Money.pkr(f.balance) + " still due"
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
            LedgerHeading(title: "\(r.index + 1). \(r.item.description.isEmpty ? "A piece" : r.item.description)",
                          trailing: Money.pkr(price))
        } footer: {
            if r.onOrder > 0 && Int(r.onOrder.rounded()) != Int(price.rounded()) {
                Text("On the order \(Money.pkr(r.onOrder)).")
            }
        }
    }

    /// A number-pad box is a sum of money, kept to whole rupees (owner, 2026-10-17: "there should be no decimals").
    private func field(_ title: String, _ text: Binding<String>, keyboard: UIKeyboardType, placeholder: String = "0") -> some View {
        LabeledContent(title) {
            TextField(placeholder, text: keyboard == .numberPad ? text.wholeRupees : text)
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
            // Only the rates changed from the booked ones go (none, and the server prices as booked).
            let changed = book.settings.value.map { OrderFinalizeMath.changedRates(order, $0, texts: rateTexts) } ?? [:]
            let out = try await ERPAPI.shared.write("finalizeOrder", OrderFinalizeMath.request(order.id, rows: rows, discount: discount, costTola: costTola, changedRates: changed))
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
            // The invoice replaces the form with no animation: the glass Make invoice button can't fade (the "bubble").
            var still = Transaction()
            still.disablesAnimations = true
            withTransaction(still) { made = invoiceId }
        } catch let e as ERPAPI.Failure {
            failure = e.message
        } catch {
            failure = error.localizedDescription + "\n\nIf the connection dropped, the invoice may have been made. Check the order before trying again."
        }
    }
}
