import SwiftUI
import ERPCore
#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import AppKit
#endif

// The one way the app reaches a customer (lib/customer-contact.ts; owner, 2026-11-02: "organize the pdf and
// whatsapp and phone and messaging for customers properly"). Wherever a customer appears — their page, an invoice,
// an order, a repair, an online order, their hisaab — the same actions, in this order:
//
//   Call · WhatsApp · Message · [Send PDF on WhatsApp · Share PDF… — invoice / order] · Copy number
//
// `CustomerContactActions` is the row of round actions on a hero card; `CustomerContactMenu` is the same as a
// toolbar or row Menu ("Contact", person.crop.circle). Send PDF goes from this house's own WhatsApp line through
// /api/app/whatsapp/send-doc (lib/customer-doc-server.ts) after `SendDocSheet` shows the number (changeable) and,
// for an invoice of several pieces, offers one per piece. One number for all of them: ERPCore `toWhatsAppNumber`
// (0300… → +92300…). A walk-in is nobody to call: only the document's actions. No number: "Add phone number".

/// The links for a number, from the one normaliser.
enum CustomerContactLinks {
    /// "+923001234567", or "" when nothing is dialable.
    static func e164(_ phone: String?) -> String {
        let d = toWhatsAppNumber(phone)
        return d.count >= 10 ? "+" + d : ""
    }

    static func callURL(_ phone: String?) -> URL? {
        let n = e164(phone)
        return n.isEmpty ? nil : URL(string: "tel:" + n)
    }

    static func messageURL(_ phone: String?) -> URL? {
        let n = e164(phone)
        return n.isEmpty ? nil : URL(string: "sms:" + n)
    }

    static func whatsAppURL(_ phone: String?, text: String = "") -> URL? {
        let n = e164(phone)
        guard !n.isEmpty else { return nil }
        var s = "https://wa.me/" + n.dropFirst()
        if !text.isEmpty, let q = text.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) { s += "?text=" + q }
        return URL(string: s)
    }

    /// The counter's nobody-in-particular: no customer on file and no name, or the walk-in name.
    static func isWalkIn(customerId: String?, customerName: String?) -> Bool {
        let id = (customerId ?? "").trimmingCharacters(in: .whitespaces)
        let name = (customerName ?? "").trimmingCharacters(in: .whitespaces)
        return id.isEmpty && (name.isEmpty || isWalkInName(name))
    }

    static func copy(_ number: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(number, forType: .string)
        #else
        UIPasteboard.general.string = number
        #endif
    }
}

private extension CharacterSet {
    static let urlQueryValueAllowed: CharacterSet = {
        var s = CharacterSet.urlQueryAllowed
        s.remove(charactersIn: "&+=?#")
        return s
    }()
}

/// An invoice or an order, as the Contact actions send and share it.
struct CustomerDoc: Equatable, Identifiable {
    enum Kind: String { case invoice, order }
    let kind: Kind
    let id: String
    /// An invoice's pieces: more than one offers one invoice per piece.
    var pieces: Int = 1
    /// What Share PDF… saves it as ("Invoice - Test Buyer.pdf", "Order - Test Buyer.pdf").
    var fileName: String

    /// The ERP route that draws it (lib/app-pdf.ts): the customer's copy, never the workshop slip.
    var pdfPath: String { "/api/app/pdf/\(kind.rawValue)/" + InvoiceFacts.encode(id) }
    var noun: String { kind == .invoice ? "invoice" : "order" }

    static func order(_ o: Order, byCustomer: Bool) -> CustomerDoc {
        let name = (o.customerName ?? "").trimmingCharacters(in: .whitespaces)
        let file = byCustomer && !name.isEmpty && !isWalkInName(name) ? "Order - \(name).pdf" : "Order-\(o.id).pdf"
        return CustomerDoc(kind: .order, id: o.id, pieces: o.items.count, fileName: file)
    }
}

/// The send itself: POST /api/app/whatsapp/send-doc. Answers the file's name and the number, masked.
enum CustomerDocSend {
    @MainActor
    static func send(_ doc: CustomerDoc, to phone: String?, perPiece: Bool = false) async throws -> (fileName: String, to: String) {
        var body: [String: Any] = ["kind": doc.kind.rawValue, "id": doc.id, "perPiece": perPiece && doc.kind == .invoice]
        if let phone, !phone.trimmingCharacters(in: .whitespaces).isEmpty { body["to"] = phone }
        // The ERP asks WAHA first whether the number is on WhatsApp, draws the PDF, then sends: two minutes.
        let out = try await ERPAPI.shared.send("/api/app/whatsapp/send-doc", body, timeout: 130)
        ServerShelf.wake()
        return (out["fileName"] as? String ?? "The PDF", out["to"] as? String ?? (phone ?? ""))
    }
}

// MARK: The row on a hero card

/// Call, WhatsApp, Message, then the document's Send PDF, then More (Share PDF…, Copy number). A page that has
/// its own send or PDF screen (the invoice) passes `onSend` / `onShare`; otherwise the row opens its own.
struct CustomerContactActions: View {
    let phone: String?
    var customerId: String? = nil
    var customerName: String? = nil
    var doc: CustomerDoc? = nil
    var onSend: (() -> Void)? = nil
    var onShare: (() -> Void)? = nil
    /// Said after a send from the row's own sheet ("Sent to Test Buyer").
    var sent: ((String) -> Void)? = nil

    @Environment(\.openURL) private var openURL
    @State private var sending: CustomerDoc?
    @State private var sharing: CustomerDoc?
    @State private var addingPhone: String?

    private var walkIn: Bool { CustomerContactLinks.isWalkIn(customerId: customerId, customerName: customerName) }
    private var number: String { walkIn ? "" : CustomerContactLinks.e164(phone) }

    var body: some View {
        HStack(alignment: .top, spacing: pt(10)) {
            if !number.isEmpty {
                QuickAction(title: "Call", symbol: "phone.fill", prominent: doc == nil) { open(CustomerContactLinks.callURL(number)) }
                QuickAction(title: "WhatsApp", symbol: "message.fill") { open(CustomerContactLinks.whatsAppURL(number)) }
                QuickAction(title: "Message", symbol: "text.bubble.fill") { open(CustomerContactLinks.messageURL(number)) }
            } else if !walkIn, let id = customerId, !id.isEmpty {
                QuickAction(title: "Add phone", symbol: "person.crop.circle.badge.plus") { addingPhone = id }
            }
            if let doc {
                QuickAction(title: "Send PDF", symbol: "paperplane.fill", prominent: true) {
                    if let onSend { onSend() } else { sending = doc }
                }
            }
            if doc != nil || !number.isEmpty {
                Menu {
                    CustomerContactMoreItems(number: number, doc: doc, share: { if let onShare { onShare() } else { sharing = doc } })
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                            .frame(maxWidth: .infinity, minHeight: Metrics.tap)
                            .background(Theme.accent.opacity(0.12), in: .rect(cornerRadius: Radius.chip, style: .continuous))
                        Text("More").font(.house(.caption2).weight(.medium)).foregroundStyle(Color.primary).lineLimit(1)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("More ways to reach the customer")
            }
        }
        .customerDocSheets(sending: $sending, sharing: $sharing, addingPhone: $addingPhone,
                           phone: number.isEmpty ? (walkIn ? (phone ?? "") : "") : number, customerName: walkIn ? nil : customerName, sent: sent)
    }

    private func open(_ url: URL?) { if let url { openURL(url) } }
}

/// Share PDF… and Copy number, the end of every Contact menu.
private struct CustomerContactMoreItems: View {
    let number: String
    let doc: CustomerDoc?
    let share: () -> Void

    var body: some View {
        if let doc {
            Button { share() } label: { Label("Share \(doc.noun) PDF…", systemImage: "square.and.arrow.up") }
        }
        if !number.isEmpty {
            Button { CustomerContactLinks.copy(number) } label: { Label("Copy number", systemImage: "doc.on.doc") }
        }
    }
}

// MARK: The menu, for a toolbar or a row

/// The same actions as a Menu: "Contact" with person.crop.circle. In a toolbar, on a row's trailing side, or in
/// a context menu's place. Nothing for a walk-in with no document.
struct CustomerContactMenu: View {
    let phone: String?
    var customerId: String? = nil
    var customerName: String? = nil
    var doc: CustomerDoc? = nil
    /// Words written into the WhatsApp chat ("your repair is ready").
    var message: String = ""
    var sent: ((String) -> Void)? = nil

    @Environment(\.openURL) private var openURL
    @State private var sending: CustomerDoc?
    @State private var sharing: CustomerDoc?
    @State private var addingPhone: String?

    private var walkIn: Bool { CustomerContactLinks.isWalkIn(customerId: customerId, customerName: customerName) }
    private var number: String { walkIn ? "" : CustomerContactLinks.e164(phone) }

    var body: some View {
        if !number.isEmpty || doc != nil || (!walkIn && !(customerId ?? "").isEmpty) {
            Menu {
                if !number.isEmpty {
                    Section {
                        Button { open(CustomerContactLinks.callURL(number)) } label: { Label("Call", systemImage: "phone") }
                        Button { open(CustomerContactLinks.whatsAppURL(number, text: message)) } label: { Label("WhatsApp", systemImage: "message") }
                        Button { open(CustomerContactLinks.messageURL(number)) } label: { Label("Message", systemImage: "text.bubble") }
                    }
                } else if !walkIn, let id = customerId, !id.isEmpty {
                    Button { addingPhone = id } label: { Label("Add phone number", systemImage: "person.crop.circle.badge.plus") }
                }
                if let doc {
                    Section {
                        Button { sending = doc } label: { Label("Send \(doc.noun) PDF on WhatsApp", systemImage: "paperplane") }
                        Button { sharing = doc } label: { Label("Share PDF…", systemImage: "square.and.arrow.up") }
                    }
                }
                if !number.isEmpty {
                    Button { CustomerContactLinks.copy(number) } label: { Label("Copy number", systemImage: "doc.on.doc") }
                }
            } label: {
                Label("Contact", systemImage: "person.crop.circle")
            }
            .accessibilityLabel("Contact \(customerName ?? "the customer")")
            .customerDocSheets(sending: $sending, sharing: $sharing, addingPhone: $addingPhone,
                               phone: number.isEmpty ? (walkIn ? (phone ?? "") : "") : number, customerName: walkIn ? nil : customerName, sent: sent)
        }
    }

    private func open(_ url: URL?) { if let url { openURL(url) } }
}

// MARK: The sheets both open

private extension View {
    func customerDocSheets(sending: Binding<CustomerDoc?>, sharing: Binding<CustomerDoc?>, addingPhone: Binding<String?>,
                           phone: String, customerName: String?, sent: ((String) -> Void)?) -> some View {
        self
            .sheet(item: sending) { (d: CustomerDoc) in
                SendDocSheet(doc: d, phone: phone, customerName: customerName, sent: sent)
            }
            // Share PDF goes straight to the system's share sheet (Print, WhatsApp, Files), never a viewer first.
            .pdfQuickShare(Binding(
                get: { sharing.wrappedValue.map { InvoicePDFTarget(path: $0.pdfPath, fileName: $0.fileName, title: $0.id) } },
                set: { if $0 == nil { sharing.wrappedValue = nil } }))
            .sheet(item: Binding(get: { addingPhone.wrappedValue.map(EditTarget.init) }, set: { addingPhone.wrappedValue = $0?.id })) { (t: EditTarget) in
                NavigationStack {
                    ScreenRegistry.view(for: "/customers/\(t.id)/edit")
                        .navigationBarTitleDisplayMode(.inline)
                }
            }
    }
}

private struct EditTarget: Identifiable { let id: String }

/// Send the PDF from the shop's line: the number (the one on file, changeable), one per piece for an invoice of
/// several, then Send. A line that isn't connected offers WhatsApp on this phone instead.
struct SendDocSheet: View {
    let doc: CustomerDoc
    let customerName: String?
    var sent: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var phone: String
    @State private var perPiece = false
    @State private var busy = false
    @State private var failure: String?
    @State private var noLine = false
    @State private var done = 0

    init(doc: CustomerDoc, phone: String, customerName: String?, sent: ((String) -> Void)? = nil) {
        self.doc = doc
        self.customerName = customerName
        self.sent = sent
        _phone = State(initialValue: phone)
    }

    private var dialable: Bool { !CustomerContactLinks.e164(phone).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                        #if os(iOS)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        #endif
                        .contactPickable { if !$0.phone.isEmpty { phone = $0.phone } }
                } footer: {
                    Text("\(doc.id) goes as a PDF from the shop’s own WhatsApp number\(customerName.map { " to \($0)" } ?? "").")
                }
                if doc.kind == .invoice && doc.pieces > 1 {
                    Section {
                        Toggle("One invoice per piece", isOn: $perPiece)
                    }
                }
            }
            .houseForm()
            .navigationTitle("Send \(doc.noun) PDF")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Send") { Task { await send() } }.disabled(!dialable)
                    }
                }
            }
            .failureAlert($failure, title: "Could not send the PDF")
            .alert("WhatsApp line not connected", isPresented: $noLine) {
                if let url = CustomerContactLinks.whatsAppURL(phone) {
                    Button("Open WhatsApp") { openURL(url) }
                }
                Button("OK", role: .cancel) {}
            } message: {
                Text("This shop’s WhatsApp line isn’t connected to the ERP. Open WhatsApp on this phone and attach the PDF from Share PDF… instead.")
            }
            .savedFeedback(trigger: done)
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    private func send() async {
        busy = true
        defer { busy = false }
        do {
            let out = try await CustomerDocSend.send(doc, to: phone, perPiece: perPiece)
            done += 1
            sent?("Sent to \(customerName ?? out.to): \(out.fileName)")
            dismiss()
        } catch let e as ERPAPI.Failure where e.status == 503 {
            noLine = true
        } catch {
            failure = error.localizedDescription
        }
    }
}
