import SwiftUI
import ERPCore

/// What the Invoices list and the invoice page say the same way: who a sale was for, where an
/// invoice lives, how its balance is coloured, the customer's link, and how a payment is taken.
enum InvoiceFacts {
    /// The name on the bill, or "Walk-in" for a sale to nobody in particular (lib/walk-in.ts:
    /// no name, or the placeholder, however it is spelled; "Walk-in Customer - 0300…" is a person).
    static func customerName(_ inv: Invoice, walkIn: String = "Walk-in") -> String {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || isWalkInName(name) ? walkIn : name
    }

    /// One part of a path: an id with a "/" or "?" in it must not split the address.
    static func encode(_ part: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        return part.addingPercentEncoding(withAllowedCharacters: allowed) ?? part
    }

    /// "/invoices/INV-000123": the invoice page. `web` asks for the ERP's own page (a native
    /// screen's "Open in the ERP": print, send, refund, delete). `doing` is what that page does as it
    /// opens, once (invoice-viewer.tsx `?do=`, the voice assistant's): "print" draws the PDF Print saves
    /// and hands it to the phone's share sheet; "share" sends it on WhatsApp.
    static func path(_ id: String, web: Bool = false, doing: String? = nil) -> String {
        var query: [String] = []
        if web { query.append("web=1") }
        if let doing { query.append("do=" + doing) }
        return "/invoices/" + encode(id) + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))
    }

    /// The sale form on an invoice (components/sale/sale-page.tsx), which has no native screen.
    static func editPath(_ id: String) -> String { "/invoices/" + encode(id) + "/edit" }

    /// Still owing after this many days reads red, not orange. A way to see the old debts at a
    /// glance (the Awaiting payment section is oldest first for the same reason), not a rule.
    static let staleDays = 30

    /// The tone of an invoice's balance (Ledger.swift): owed amber, red once it is old, credit teal, settled green,
    /// a refund quiet.
    static func balanceTone(_ inv: Invoice, now: Date = Date()) -> Tone {
        if inv.status == .refunded { return .quiet }
        switch balanceLine(inv.balanceDue).state {
        case .due:
            guard let made = ERPDate.parse(inv.createdAt) else { return .owed }
            return now.timeIntervalSince(made) > Double(staleDays) * 86_400 ? .late : .owed
        case .credit:
            return .credit
        case .paid:
            return .settled
        }
    }

    /// What was sold, as the counter remembers a sale: the first piece's name, and "+2 more" for the rest.
    /// A line with no name says its category, else its stock number.
    static func whatSold(_ inv: Invoice) -> String? {
        guard let first = inv.items.first else { return nil }
        var name = first.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { name = OrdersLogic.categorySingular(first.itemCategory) ?? first.sku }
        if name.isEmpty { name = "1 piece" }
        let more = inv.items.count - 1
        return more > 0 ? "\(name) +\(more) more" : name
    }

    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "h:mm a"
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f
    }()

    /// "3:45 pm", Karachi's: a row under its day's heading needs only the time.
    static func time(_ iso: String) -> String {
        ERPDate.parse(iso).map { clock.string(from: $0) } ?? ""
    }

    /// Who may take a payment (/api/app/write recordPayment): owners and staff.
    static func mayTakePayments(role: String) -> Bool { role == "owner" || role == "staff" }

    /// Take a payment, as the invoice page and the list's "Mark paid" do. The server writes it
    /// (lib/writes/invoice-payment.ts) but does not check who may hold credit, so the ERP page's
    /// rule is kept here: money over the balance is a named customer's credit; from nobody in
    /// particular it is change to hand back, so it is refused (invoice-credit.ts).
    @MainActor
    static func record(_ inv: Invoice, amount: Double, method: String, reference: String) async throws {
        let due = max(0, inv.balanceDue)
        if amount > due + 0.5 && !canHoldCredit(inv.customerId) {
            throw ERPAPI.Failure(status: 400, message: "More than the balance of \(Money.pkr(due)). Credit needs a customer: name who this invoice is for first.")
        }
        var fields: [String: Any] = ["invoiceId": inv.id, "amount": amount, "method": method]
        let ref = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        if method != "Cash" && !ref.isEmpty { fields["reference"] = ref }
        try await ERPAPI.shared.write("recordPayment", fields)
    }

    // MARK: The customer's link

    /// JavaScript's encodeURIComponent leaves these alone.
    private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    private static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
    }

    /// The page a customer is sent (lib/share-token.ts `invoiceShareUrl`): `/view-invoice/<id>?t=<key>`.
    /// That page answers only to the invoice's own key, so an invoice from before keys existed has
    /// no link here: the ERP page makes its key as it sends (Send on WhatsApp).
    static func shareURL(_ inv: Invoice) -> URL? {
        guard let key = inv.shareToken, !key.isEmpty else { return nil }
        var origin = House.serverURL.absoluteString
        while origin.hasSuffix("/") { origin.removeLast() }
        return URL(string: "\(origin)/view-invoice/\(component(inv.id))?t=\(component(key))")
    }

    // MARK: What goes out with the link (lib/invoice-share.ts, the viewer's estimateMessage)

    /// Characters no phone or computer allows in a file's name, and runs of spaces (invoice-share.ts `clean`).
    private static func clean(_ s: String) -> String {
        let blocked = Set("\\/:*?\"<>|")
        let spaced = String(s.map { c in
            blocked.contains(c) || (c.asciiValue.map { $0 < 0x20 } ?? false) ? " " : c
        })
        return spaced.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static let karachiDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM yyyy"
        return f
    }()

    /// The subject of a share. Where an invoice is named after its customer (`byCustomer`,
    /// STORE_INVOICE_BY_CUSTOMER: Taheri): "Invoice - Fatima Hussain", never the number, and a walk-in
    /// (no name to give) carries its day instead: "Invoice - 5 Oct 2026". Elsewhere (House of Mina) the
    /// file is "Invoice-<number>", as invoice-pdf.ts names it.
    static func shareTitle(_ inv: Invoice, byCustomer: Bool) -> String {
        if !byCustomer { return "Invoice-" + inv.id }
        let name = String(clean(inv.customerName).prefix(80))
        if !name.isEmpty && !isWalkInName(name) { return "Invoice - \(name)" }
        guard let made = ERPDate.parse(inv.createdAt) else { return "Invoice" }
        return "Invoice - " + karachiDay.string(from: made)
    }

    /// toLocaleString(undefined, { minimumFractionDigits: 2 }): 12,345.00, as the estimate says it.
    private static func twoPlaces(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// The words that go with the link: who it is for and what is owed. Where invoices are named after
    /// the customer (`byCustomer`, Taheri) they carry no number (invoice-share.ts `invoiceWhatsAppCaption`,
    /// "is at the link below"); elsewhere (House of Mina) they are the counter's own (the viewer's
    /// `estimateMessage`: "estimate", its ID, what is owed, and the name as the bill has it). `shopName` is
    /// the shop's, never "… ERP".
    static func shareMessage(_ inv: Invoice, shopName: String, byCustomer: Bool) -> String {
        let line = balanceLine(inv.balanceDue)
        if !byCustomer {
            // `inv.customerName || 'Customer'`: a walk-in's bill reads "Dear Walk-in Customer", as the web's does.
            let named = inv.customerName.isEmpty ? "Customer" : inv.customerName
            var m = "Dear \(named),\n\nHere is your estimate from \(shopName).\n\n*Estimate ID:* \(inv.id)\n*Total Amount:* PKR \(twoPlaces(inv.grandTotal))\n"
            if inv.amountPaid > 0 {
                m += "*Amount Paid:* PKR \(twoPlaces(inv.amountPaid))\n*Balance Due:* PKR \(twoPlaces(inv.balanceDue))\n\n"
            } else {
                m += "*Amount Due:* PKR \(twoPlaces(inv.grandTotal))\n\n"
            }
            return m + "Thank you for your business."
        }
        let name = clean(inv.customerName)
        let who = name.isEmpty || isWalkInName(name) ? "Customer" : name
        var lines = ["Dear \(who),", "", "Your invoice from \(shopName) is at the link below.", "", "*Total:* \(Money.pkr(inv.grandTotal))"]
        if inv.amountPaid > 0 {
            lines.append("*Paid:* \(Money.pkr(inv.amountPaid))")
            lines.append(line.state == .credit ? "*Credit to you:* \(Money.pkr(line.amount))" : "*Balance due:* \(Money.pkr(inv.balanceDue))")
        }
        lines.append("")
        lines.append("Thank you for your business.")
        return lines.joined(separator: "\n")
    }

    // MARK: The PDF (lib/invoice-pdf.ts, drawn on the ERP's server: /api/app/pdf/invoice)

    /// The ERP route that draws the invoice Print saves; `perPiece`, one invoice per piece, each on its own page.
    static func pdfPath(_ id: String, perPiece: Bool = false) -> String {
        "/api/app/pdf/invoice/" + encode(id) + (perPiece ? "?perPiece=1" : "")
    }

    /// The file's name as the browser saves it (invoice-pdf.ts `invoicePdfFileName`): "Invoice - <customer>.pdf"
    /// where invoices are named after the customer (`byCustomer`, Taheri), "Invoice-<number>.pdf" elsewhere; per
    /// piece only names a bill of more than one piece.
    static func pdfFileName(_ inv: Invoice, byCustomer: Bool, perPiece: Bool = false) -> String {
        let split = perPiece && inv.items.count > 1
        if !byCustomer { return "Invoice-" + inv.id + (split ? "-per-piece.pdf" : ".pdf") }
        return shareTitle(inv, byCustomer: true) + (split ? " (per piece).pdf" : ".pdf")
    }

    /// The PDF screen for an invoice (PDFDocumentScreen).
    static func pdfTarget(_ inv: Invoice, byCustomer: Bool, perPiece: Bool = false) -> InvoicePDFTarget {
        InvoicePDFTarget(path: pdfPath(inv.id, perPiece: perPiece),
                         fileName: pdfFileName(inv, byCustomer: byCustomer, perPiece: perPiece),
                         title: perPiece ? "\(inv.id) per piece" : inv.id)
    }

    /// Taheri's Send on WhatsApp from the phone: the ERP draws the PDF Print saves and sends it from the shop's
    /// line through the browser's own send (/api/app/pdf/invoice/[id]/whatsapp → /api/invoices/[id]/whatsapp),
    /// which notes it on the invoice. Answers the file's name and the number it went to.
    @MainActor
    static func sendPDF(_ inv: Invoice, to phone: String) async throws -> (fileName: String, to: String) {
        // The send asks WAHA first whether the number is on WhatsApp, then sends: the ERP gives it two minutes.
        let out = try await ERPAPI.shared.send(pdfPath(inv.id) + "/whatsapp", ["to": phone], timeout: 130)
        // Staff read the books every 25 seconds: fetch them now, so "sent" shows under the button.
        ServerShelf.wake()
        return (out["fileName"] as? String ?? "The PDF", out["to"] as? String ?? phone)
    }

    // MARK: Send on WhatsApp (invoice-viewer.tsx)

    /// The number the ERP page's WhatsApp box starts with: the invoice's own, else its customer's, as the ERP
    /// keeps numbers (+92…).
    static func whatsAppPhone(_ inv: Invoice, customer: Customer?) -> String {
        let own = inv.customerContact ?? ""
        return pakistanE164(own.isEmpty ? (customer?.phone ?? "") : own)
    }

    /// What goes on WhatsApp from the phone (`openWhatsAppWithLink`): the words, then the customer's link,
    /// bare where invoices are named after the customer (Taheri), after "View estimate: " elsewhere.
    static func whatsAppText(_ inv: Invoice, link: URL, shopName: String, byCustomer: Bool) -> String {
        shareMessage(inv, shopName: shopName, byCustomer: byCustomer) + "\n\n" + (byCustomer ? "" : "View estimate: ") + link.absoluteString
    }

    /// wa.me with the number and the words written in (lib/whatsapp.ts `whatsAppLink`); nil without a usable number.
    static func whatsAppURL(phone: String, text: String) -> URL? {
        let number = CustomerKit.whatsAppNumber(phone)
        if number.isEmpty { return nil }
        return URL(string: "https://wa.me/\(number)?text=\(component(text))")
    }
}

/// An invoice's PDF to open (PDFDocumentScreen): one invoice, or one per piece.
struct InvoicePDFTarget: Hashable, Identifiable {
    let path: String
    let fileName: String
    let title: String
    var id: String { path }
}

/// A change that has landed, said for a few seconds over the invoice like the web's toast.
struct InvoiceNote: Equatable, Identifiable {
    let id = UUID()
    let title: String
    let detail: String
}

struct InvoiceNoteBanner: View {
    let note: InvoiceNote

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                Text(note.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

extension View {
    /// The payment sheet for an invoice (Kit's PaymentSheet), the balance one tap away. Closing it
    /// with a refusal showing keeps the sheet open with the ERP's own words.
    func invoicePaymentSheet(for invoice: Binding<Invoice?>) -> some View {
        sheet(item: invoice) { inv in
            // Money over the balance is a named customer's credit; a walk-in's is refused (invoice-credit.ts).
            PaymentSheet(title: "Take payment · \(inv.id)", owed: inv.balanceDue > 0.5 ? inv.balanceDue : nil,
                         customer: PaymentCustomer(name: inv.customerName, canHoldCredit: canHoldCredit(inv.customerId))) { amount, method, reference in
                try await InvoiceFacts.record(inv, amount: amount, method: method, reference: reference)
            }
        }
    }
}

// MARK: The balance, as one pill

/// Where an invoice's balance stands, the one badge a row carries: "Paid", "PKR 86,000 due" (red once it is
/// old), "PKR 3,000 credit", "Refunded" (invoice-credit.ts `balanceLine`, never a negative balance).
struct InvoiceBalancePill: View {
    let invoice: Invoice

    var body: some View {
        let line = balanceLine(invoice.balanceDue)
        let tone = InvoiceFacts.balanceTone(invoice)
        if invoice.status == .refunded {
            Pill("Refunded", tone: .quiet)
        } else {
            switch line.state {
            case .due: Pill("\(Money.pkr(line.amount)) due", tone: tone)
            case .credit: Pill("\(Money.pkr(line.amount)) credit", tone: .credit)
            case .paid: Pill("Paid", tone: .settled)
            }
        }
    }
}

// MARK: Send on WhatsApp, from the page or a swipe

/// The ERP page's Send via WhatsApp, by house (STORE_INVOICE_WHATSAPP_PDF), the same from the invoice page and
/// from a swipe on the list: set `invoice` and it runs. Taheri sends the PDF itself from the shop's line: the ERP
/// draws it (Print's PDF), sends it and notes the send on the invoice, so it is asked first and then done from
/// here (InvoiceFacts.sendPDF). With no number on file, or for another number, the ERP's page opens (`web`) for one
/// to be typed. House of Mina writes the message and the customer's link into WhatsApp on this phone
/// (InvoiceWhatsAppSheet), unless the invoice predates its link's key, which the page makes as it sends.
private struct InvoiceWhatsAppSend: ViewModifier {
    @Binding var invoice: Invoice?
    @Binding var web: Route?
    let sent: (InvoiceNote) -> Void

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    /// Taheri's send from the shop's line, asked first: it really sends.
    @State private var confirming: Invoice?
    /// House of Mina's: the number and the words, then WhatsApp on this phone.
    @State private var linking: Invoice?
    /// Taheri's PDF on its way from the shop's line, and the ERP's words when it could not go.
    @State private var sendingPDF = false
    @State private var failedOn: Invoice?
    @State private var failure: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: invoice) { _, picked in
                guard let picked else { return }
                invoice = nil
                start(picked)
            }
            .confirmationDialog(confirming.map(title) ?? "", isPresented: confirmingShown,
                                titleVisibility: .visible, presenting: confirming) { (inv: Invoice) in
                Button(inv.sentOnWhatsApp == nil ? "Send the PDF" : "Send it again") { Task { await sendPDF(inv) } }
                // The ERP page's box takes another number; its Send goes to whatever is typed there.
                Button("Another number…") { openWeb(inv) }
            } message: { (inv: Invoice) in
                Text(words(inv))
            }
            // As the web's error toast: the shop's line could not send, so the link can go from this phone instead.
            .alert("Could not send the PDF", isPresented: failureShown) {
                if let inv = failedOn, InvoiceFacts.shareURL(inv) != nil {
                    Button("Send a link") { linking = inv }
                }
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
            .sheet(item: $linking) { (inv: Invoice) in
                InvoiceWhatsAppSheet(invoice: inv, phone: phone(inv))
            }
            .overlay(alignment: .top) {
                if sendingPDF {
                    Label("Sending the PDF…", systemImage: "paperplane")
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
    }

    /// The number the ERP page's box starts with: the invoice's, else its customer's.
    private func phone(_ inv: Invoice) -> String {
        InvoiceFacts.whatsAppPhone(inv, customer: inv.customerId.flatMap { book.customers.item($0) })
    }

    private func openWeb(_ inv: Invoice, doing: String? = nil) {
        web = Route(path: InvoiceFacts.path(inv.id, web: true, doing: doing))
    }

    private func start(_ inv: Invoice) {
        if session.shop.invoiceWhatsappPdf {
            if CustomerKit.whatsAppNumber(phone(inv)).isEmpty { openWeb(inv) } else { confirming = inv }
        } else if InvoiceFacts.shareURL(inv) == nil {
            openWeb(inv, doing: "share")
        } else {
            linking = inv
        }
    }

    /// invoice-viewer.tsx `handleSendWhatsApp`: sent, said as its toast says it; refused, the ERP's words.
    private func sendPDF(_ inv: Invoice) async {
        guard !sendingPDF else { return }
        withAnimation { sendingPDF = true }
        defer { withAnimation { sendingPDF = false } }
        do {
            let out = try await InvoiceFacts.sendPDF(inv, to: phone(inv))
            let name = InvoiceFacts.customerName(inv, walkIn: "")
            sent(InvoiceNote(title: "Sent to \(name.isEmpty ? out.to : name)",
                             detail: "\(out.fileName) — on WhatsApp, from the shop's number."))
        } catch {
            failedOn = inv
            failure = error.localizedDescription
        }
    }

    private var confirmingShown: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { (on: Bool) in if !on { confirming = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil; failedOn = nil } })
    }

    private func title(_ inv: Invoice) -> String {
        let to = phone(inv)
        return inv.sentOnWhatsApp == nil ? "Send the PDF to \(to)?" : "Send the PDF to \(to) again?"
    }

    /// What happens, and that it went before (the web shows the send under its button so nobody sends twice).
    private func words(_ inv: Invoice) -> String {
        var s = "From the shop's own WhatsApp, with what is owed written under it: the PDF Print saves, drawn and sent by the ERP."
        if let sent = inv.sentOnWhatsApp {
            s += " Already sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))."
        }
        return s
    }
}

/// A change that has landed, over the top of the screen for a few seconds, like the web's toast.
private struct InvoiceNoteOverlay: ViewModifier {
    @Binding var note: InvoiceNote?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let note {
                    InvoiceNoteBanner(note: note)
                        .padding(.horizontal)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .task(id: note) {
                guard note != nil else { return }
                try? await Task.sleep(for: .seconds(4))
                if !Task.isCancelled { withAnimation { note = nil } }
            }
    }
}

extension View {
    /// Send on WhatsApp for whichever invoice `invoice` is set to (InvoiceWhatsAppSend); `web` opens the ERP's page
    /// where a number has to be typed, `sent` says it went.
    func invoiceWhatsAppSend(_ invoice: Binding<Invoice?>, web: Binding<Route?>, sent: @escaping (InvoiceNote) -> Void) -> some View {
        modifier(InvoiceWhatsAppSend(invoice: invoice, web: web, sent: sent))
    }

    /// The note of a change that has landed, said for a few seconds and then gone.
    func invoiceNoteBanner(_ note: Binding<InvoiceNote?>) -> some View {
        modifier(InvoiceNoteOverlay(note: note))
    }
}
