#if os(macOS)
import SwiftUI
import ERPCore

// An invoice's actions, declared once (docs/features/mac-design.md, rule 3). The Invoice menu in the menu bar, the
// toolbar, the right-click menu and the inspector's buttons all draw from these, so they never disagree about what can
// be done, what it is called or which key does it. Each action only starts a sheet or a send on the desk
// (MacInvoiceDesk); the sheets and the writes are the invoice page's own.

@MainActor
enum MacInvoiceMenu {
    /// Every action of the Invoice menu, in groups: money, sending, changing, and what cannot be taken back. With no
    /// invoice picked they are all disabled (the menu stays, as Mail's Message menu does).
    static func groups(_ inv: Invoice?, _ cx: MacInvoiceContext) -> [[MacAction]] {
        [
            [takePayment(inv, cx), changeDiscount(inv, cx), giveBackCredit(inv, cx)],
            [sendOnWhatsApp(inv, cx), pdf(inv, cx), printBill(inv, cx), copyPaymentLink(inv, cx), copyCustomerLink(inv)],
            [edit(inv, cx), changeRate(inv, cx), customer(inv, cx)],
            [refund(inv, cx), delete(inv, cx)],
        ]
    }

    /// The toolbar's few: taking the money, the bill to the customer, and the paper.
    static func toolbar(_ inv: Invoice?, _ cx: MacInvoiceContext, withEdit: Bool = false) -> [MacAction] {
        var out = [takePayment(inv, cx)]
        if withEdit { out.append(edit(inv, cx)) }
        out.append(sendOnWhatsApp(inv, cx))
        out.append(printBill(inv, cx))
        return out
    }

    /// A record window's More menu: what its toolbar's four do not carry, in the Invoice menu's order.
    static func more(_ inv: Invoice?, _ cx: MacInvoiceContext) -> [[MacAction]] {
        [
            [pdf(inv, cx), copyPaymentLink(inv, cx), copyCustomerLink(inv)],
            [changeDiscount(inv, cx), giveBackCredit(inv, cx), changeRate(inv, cx), customer(inv, cx)],
            [refund(inv, cx), delete(inv, cx)],
        ]
    }

    /// The inspector's buttons: Take Payment (the default while money is owed), WhatsApp, PDF.
    static func buttons(_ inv: Invoice?, _ cx: MacInvoiceContext) -> [MacAction] {
        let owing = inv.map { isOwing($0) } ?? false
        var pay = takePayment(inv, cx)
        pay.title = "Take Payment"
        pay.isDefault = owing
        var whatsApp = sendOnWhatsApp(inv, cx)
        whatsApp.title = "WhatsApp"
        var paper = pdf(inv, cx)
        paper.title = "PDF"
        return [pay, whatsApp, paper]
    }

    /// The page's Import Shopify CSV: an owner's, as its own Firestore write is. It is about the books, not one invoice, so the
    /// Invoices place adds it to its menu and to the empty part of its table, and a record window leaves it out.
    static func importOrders(_ cx: MacInvoiceContext) -> MacAction {
        MacAction("Import Shopify Orders…", symbol: "square.and.arrow.down", enabled: cx.isOwner, id: "import") {
            cx.desk.importing = true
        }
    }

    // MARK: Money

    static func takePayment(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let may = inv.map { MacInvoiceWords.mayTakePayment($0, canPay: cx.canPay) } ?? false
        return MacAction("Take Payment…", symbol: "banknote", shortcut: KeyboardShortcut("p", modifiers: [.command, .option]),
                         enabled: may) {
            if let inv { cx.desk.paying = inv }
        }
    }

    static func changeDiscount(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let may = cx.isOwner && (inv.map { $0.status != .refunded } ?? false)
        return MacAction("Change Discount…", symbol: "percent", shortcut: KeyboardShortcut("d", modifiers: [.command, .shift]),
                         enabled: may) {
            if let inv { cx.desk.acting = MacInvoiceAct(act: .discount, invoice: inv) }
        }
    }

    static func giveBackCredit(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let may = cx.isOwner && (inv.map { InvoiceCredit.held($0) >= 1 } ?? false)
        return MacAction("Give Back Credit…", symbol: "arrow.uturn.left.circle", enabled: may) {
            if let inv { cx.desk.acting = MacInvoiceAct(act: .giveBack, invoice: inv) }
        }
    }

    // MARK: Sending

    static func sendOnWhatsApp(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("Send on WhatsApp", symbol: "message", shortcut: KeyboardShortcut("w", modifiers: [.command, .shift]),
                  enabled: inv != nil) {
            if let inv { cx.desk.sending = inv }
        }
    }

    static func pdf(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("PDF", symbol: "doc.richtext", enabled: inv != nil) {
            if let inv { cx.desk.pdf = InvoiceFacts.pdfTarget(inv, byCustomer: cx.byCustomer) }
        }
    }

    /// The Mac's print panel with the PDF Print saves (drawn by the ERP's server).
    static func printBill(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("Print…", symbol: "printer", shortcut: KeyboardShortcut("p", modifiers: .command), enabled: inv != nil) {
            if let inv {
                let path = InvoiceFacts.pdfPath(inv.id)
                let name = InvoiceFacts.pdfFileName(inv, byCustomer: cx.byCustomer)
                Task { await MacPrint.printPDF(path: path, name: name) }
            }
        }
    }

    /// Shopify's checkout for what is owed, made fresh and copied.
    static func copyPaymentLink(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let may = inv.map { InvoiceFacts.offersPaymentLink($0) } ?? false
        return MacAction("Copy Payment Link", symbol: "link.badge.plus", enabled: may) {
            if let inv { cx.desk.linking = inv }
        }
    }

    /// The customer's own page for the bill, when the invoice has its key.
    static func copyCustomerLink(_ inv: Invoice?) -> MacAction {
        let url = inv.flatMap { InvoiceFacts.shareURL($0) }
        return MacAction("Copy Customer Link", symbol: "link", enabled: url != nil) {
            if let url { UIPasteboard.general.string = url.absoluteString }
        }
    }

    // MARK: Changing

    /// The sale document on this invoice.
    static func edit(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("Edit", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command), enabled: inv != nil) {
            if let inv { cx.open(Route(path: InvoiceFacts.editPath(inv.id))) }
        }
    }

    /// Gold moves: the same edit, at its rates (an owner's, as Edit is on the web).
    static func changeRate(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("Change Rate…", symbol: "chart.line.uptrend.xyaxis", enabled: cx.isOwner && inv != nil) {
            if let inv { cx.open(Route(path: InvoiceFacts.changeRatePath(inv.id))) }
        }
    }

    static func customer(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let unnamed = inv.map { MacInvoiceWords.unnamed($0) } ?? true
        let may = cx.isOwner && (inv.map { $0.status != .refunded } ?? false)
        return MacAction(unnamed ? "Name the Customer…" : "Change Customer…", symbol: "person.crop.circle", enabled: may) {
            if let inv { cx.desk.naming = inv }
        }
    }

    // MARK: What cannot be taken back

    static func refund(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        let may = cx.isOwner && (inv.map { $0.status != .refunded } ?? false)
        return MacAction("Refund…", symbol: "arrow.uturn.backward", role: .destructive, enabled: may) {
            if let inv { cx.desk.acting = MacInvoiceAct(act: .refund, invoice: inv) }
        }
    }

    static func delete(_ inv: Invoice?, _ cx: MacInvoiceContext) -> MacAction {
        MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive,
                  enabled: cx.isOwner && inv != nil) {
            if let inv { cx.desk.acting = MacInvoiceAct(act: .delete, invoice: inv) }
        }
    }
}

/// The "More" menu of a record window's toolbar: actions in groups, drawn without their keys (the menu bar's Invoice menu owns
/// them; the same key twice would answer in neither). Its label is an `Image` and a `Text` only, as AppKit draws a menu's.
struct MacInvoiceMoreMenu: View {
    let groups: [[MacAction]]

    var body: some View {
        Menu {
            ForEach(Array(groups.enumerated()), id: \.offset) { i, group in
                if i > 0 { Divider() }
                ForEach(group) { (a: MacAction) in
                    Button(role: a.role, action: a.perform) { Label(a.title, systemImage: a.symbol ?? "circle") }
                        .disabled(!a.enabled)
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
        .help("More: PDF, discount, customer, links, refund, delete")
    }
}
#endif
