#if os(macOS)
import SwiftUI
import Observation
import ERPCore

// The Mac's invoice desk (docs/features/mac-design.md, "Invoices"): what the Invoices place, its inspector and an
// invoice's own window share. One `MacInvoiceDesk` holds the sheet or send an action has started (take a payment, change
// the discount, WhatsApp, the PDF…); `MacInvoiceSheetHost` presents them, so the place and the record window show the same
// sheets the same way. Nothing is written here: every sheet and send is the invoice page's own (InvoiceSupport.swift,
// InvoiceAction*Sheet.swift), and the writes stay theirs.

/// An owner's sheet on one invoice: which action, and for whom.
struct MacInvoiceAct: Identifiable {
    let act: InvoiceAct
    let invoice: Invoice
    var id: String { act.rawValue + "|" + invoice.id }
}

/// What an action has started and the window is now showing. Setting a property starts the sheet or the send.
@MainActor
@Observable
final class MacInvoiceDesk {
    /// Take a payment (Kit's PaymentSheet through `invoicePaymentSheet`).
    var paying: Invoice?
    /// Send on WhatsApp (`invoiceWhatsAppSend`): the house's own way, the PDF from the shop's line or the link.
    var sending: Invoice?
    /// The Shopify payment link to make and copy (`invoicePaymentLink`).
    var linking: Invoice?
    /// The invoice's PDF, shown over the window.
    var pdf: InvoicePDFTarget?
    /// Name the customer, or change them.
    var naming: Invoice?
    /// Discount, give back credit, refund, delete.
    var acting: MacInvoiceAct?
    /// A payment on its way to being deleted, and what the page says once it is gone.
    var paymentDeletion: OwnerDeletion?
    var paymentOutcome: InvoiceActionOutcome?
    /// Import Shopify orders (CSV): an owner's.
    var importing = false
    /// A page to push where there is no window to open it in (a record window's Edit).
    var web: Route?
    /// What was done, said for a few seconds.
    var note: Note?

    /// A binding to one of the desk's properties, for a sheet or a destination.
    func binding<V>(_ keyPath: ReferenceWritableKeyPath<MacInvoiceDesk, V>) -> Binding<V> {
        Binding(get: { self[keyPath: keyPath] }, set: { self[keyPath: keyPath] = $0 })
    }
}

/// Who is acting and where things open, for the actions of `MacInvoiceMenu`.
struct MacInvoiceContext {
    /// Owners change the discount, refund, delete, give credit back, name the customer.
    let isOwner: Bool
    /// Owners and staff take payments.
    let canPay: Bool
    /// The house names an invoice after its customer (the PDF's file name).
    let byCustomer: Bool
    let desk: MacInvoiceDesk
    /// Opens a record or a document in a window of its own (a page pushed where the environment has no windows).
    let open: (Route) -> Void
}

// MARK: The sheets

/// Presents what the desk has started, over the place or the record window that holds it. `removed` hears that the
/// invoice is gone (deleted, or refunded in full) so a record window can close.
struct MacInvoiceSheetHost: ViewModifier {
    let desk: MacInvoiceDesk
    var removed: (() -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .invoicePaymentSheet(for: desk.binding(\.paying)) { paid, amount in recorded(paid, amount) }
            .sheet(item: desk.binding(\.naming)) { (inv: Invoice) in
                InvoiceCustomerSheet(invoice: inv) { (saved: InvoiceNote) in say(saved) }
            }
            .sheet(item: desk.binding(\.acting)) { (a: MacInvoiceAct) in
                actSheet(a)
            }
            .sheet(item: desk.binding(\.pdf)) { (t: InvoicePDFTarget) in
                MacInvoicePDFSheet(target: t)
            }
            .sheet(item: desk.binding(\.paymentDeletion)) { (d: OwnerDeletion) in
                paymentCodeSheet(d)
            }
            .sheet(isPresented: desk.binding(\.importing)) {
                InvoiceCSVImportSheet { (done: InvoiceNote) in say(done) }
            }
            .invoiceWhatsAppSend(desk.binding(\.sending)) { sent in say(sent) }
            .invoicePaymentLink(desk.binding(\.linking)) { made in say(made) }
            .navigationDestination(item: desk.binding(\.web)) { (r: Route) in
                ScreenRegistry.view(for: r.path)
            }
            .noteToast(desk.binding(\.note))
    }

    @ViewBuilder
    private func actSheet(_ a: MacInvoiceAct) -> some View {
        switch a.act {
        case .discount: InvoiceActionDiscountSheet(invoice: a.invoice, onDone: acted)
        case .giveBack: InvoiceActionCreditSheet(invoice: a.invoice, onDone: acted)
        case .refund: InvoiceActionRefundSheet(invoice: a.invoice, onDone: acted)
        case .delete: InvoiceActionDeleteSheet(invoice: a.invoice, onDone: acted)
        }
    }

    /// Deleting one payment: the delete code is a field of this one sheet, and what the page says follows it.
    private func paymentCodeSheet(_ d: OwnerDeletion) -> some View {
        MacInvoiceCodeSheet(title: "Delete Payment", subtitle: d.what, confirmTitle: "Delete Payment",
                            prepare: { d }, onDone: {
            if let outcome = desk.paymentOutcome { acted(outcome) }
        }) {
            Text(d.detail).foregroundStyle(.secondary)
        }
    }

    /// After a sheet: its note, and the window's goodbye when the invoice is gone.
    private func acted(_ o: InvoiceActionOutcome) {
        say(o.note)
        if o.removed { removed?() }
    }

    private func say(_ n: InvoiceNote) {
        Note.show(Note(title: n.title, detail: n.detail), in: desk.binding(\.note), reduce: reduceMotion)
    }

    /// A payment taken: what is left, said as the sheet closes.
    private func recorded(_ inv: Invoice, _ amount: Double) {
        let line = balanceLine(inv.balanceDue - amount)
        let detail: String
        switch line.state {
        case .due: detail = "\(Money.pkr(line.amount)) still due"
        case .credit: detail = "Paid in full, \(Money.pkr(line.amount)) in credit"
        case .paid: detail = "Paid in full"
        }
        Note.show(Note(title: "Payment recorded", detail: detail), in: desk.binding(\.note), reduce: reduceMotion)
    }
}

// MARK: The PDF

/// The invoice's PDF over the window, as Quick Look shows a file: Done (or Esc) puts it away; Print and Share are the
/// PDF screen's own.
struct MacInvoicePDFSheet: View {
    let target: InvoicePDFTarget
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PDFDocumentScreen(path: target.path, fileName: target.fileName, title: target.title)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                            .keyboardShortcut(.cancelAction)
                    }
                }
        }
        .frame(minWidth: 640, idealWidth: 720, minHeight: 700, idealHeight: 820)
    }
}

// MARK: A link to another record

/// The name of another record (the customer, the order an invoice came from) as a link: it opens in a window of its own
/// where the environment has windows, else it is pushed.
struct MacInvoiceLink: View {
    let title: String
    let route: Route
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        if let openPlace {
            Button(title) { openPlace(route) }
                .buttonStyle(.link)
        } else {
            NavigationLink(value: route) { Text(title) }
        }
    }
}
#endif
