import SwiftUI
import ERPCore

/// Send on WhatsApp where the house sends the customer's link from the phone (House of Mina:
/// NEXT_PUBLIC_STORE_INVOICE_WHATSAPP_PDF "0"; invoice-viewer.tsx `openWhatsAppWithLink`): the number in the
/// box, as the ERP page fills it, and the page's own words with the link, written into WhatsApp on this phone.
/// A person still presses send there, so nothing is recorded (the web records only the shop line's PDF send).
/// An invoice without its link's key comes with the one just given it (`key`, InvoiceFacts.giveShareKey).
struct InvoiceWhatsAppSheet: View {
    let invoice: Invoice
    /// The link's key given a moment ago, before the shelf's invoice carries it.
    let key: String?

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var phone: String

    init(invoice: Invoice, phone: String, key: String? = nil) {
        self.invoice = invoice
        self.key = key
        _phone = State(initialValue: phone)
    }

    private var text: String? {
        InvoiceFacts.shareURL(invoice, key: key).map {
            InvoiceFacts.whatsAppText(invoice, link: $0, shopName: session.shop.name, byCustomer: session.shop.invoiceByCustomer)
        }
    }

    private var url: URL? { text.flatMap { InvoiceFacts.whatsAppURL(phone: phone, text: $0) } }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        NavigationStack {
            Form { Group {
                Section {
                    TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                        .keyboardType(.phonePad)
                        .fieldKind(.telephoneNumber)
                } footer: {
                    if CustomerKit.whatsAppNumber(phone).isEmpty {
                        Text("Enter the customer's WhatsApp number.")
                    } else if let sent = invoice.sentOnWhatsApp {
                        Text("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))")
                    }
                }
                if let text {
                    Section {
                        Text(text)
                            .font(.subheadline)
                            .textSelection(.enabled)
                    } header: {
                        LedgerHeading(title: "The message")
                    } footer: {
                        Text("WhatsApp opens with it written: press send there.")
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .navigationTitle("Send on WhatsApp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
            .actionBar(primary: ActionBar.Action("Open WhatsApp", systemImage: "message", isDisabled: url == nil) {
                if let url {
                    openURL(url)
                    dismiss()
                }
            })
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        #endif
    }
}

/// Taheri's Send on WhatsApp to a number typed here (invoice-viewer.tsx's WhatsApp box): no number on file, or
/// "Another number…". The ERP draws the PDF Print saves and sends it from the shop's line to whatever is typed,
/// as the page's Send does (InvoiceFacts.sendPDF), and notes the send on the invoice.
struct InvoicePDFNumberSheet: View {
    let invoice: Invoice
    let sent: (InvoiceNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var phone: String
    @State private var sending = false
    @State private var failure: String?

    init(invoice: Invoice, phone: String, sent: @escaping (InvoiceNote) -> Void) {
        self.invoice = invoice
        self.sent = sent
        _phone = State(initialValue: phone)
    }

    /// The number as the ERP keeps numbers (+92…), as the page's box sends it; empty until it is one.
    private var number: String {
        CustomerKit.whatsAppNumber(phone).isEmpty ? "" : pakistanE164(phone)
    }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        NavigationStack {
            Form { Group {
                Section {
                    TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                        .keyboardType(.phonePad)
                        .fieldKind(.telephoneNumber)
                } footer: {
                    if number.isEmpty {
                        Text("Enter the customer's WhatsApp number.")
                    } else if let done = invoice.sentOnWhatsApp {
                        Text("PDF sent to \(done.to) · \(ShopDate.say(done.at, withTime: true))")
                    } else {
                        Text("From the shop's own WhatsApp, with what is owed written under it: the PDF Print saves, drawn and sent by the ERP.")
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .navigationTitle("Send the PDF")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .disabled(sending)
                }
            }
            .actionBar(primary: ActionBar.Action(invoice.sentOnWhatsApp == nil ? "Send the PDF" : "Send it again",
                                                 systemImage: "paperplane", isBusy: sending, isDisabled: number.isEmpty) {
                Task { await send() }
            })
            .failureAlert($failure, title: "Could not send the PDF")
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(sending)
        #endif
    }

    /// invoice-viewer.tsx `handleSendWhatsApp`: sent, said as its toast says it; refused, the ERP's words here.
    private func send() async {
        guard !sending, !number.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let out = try await InvoiceFacts.sendPDF(invoice, to: number)
            let name = InvoiceFacts.customerName(invoice, walkIn: "")
            sent(InvoiceNote(title: "Sent to \(name.isEmpty ? out.to : name)",
                             detail: "\(out.fileName) — on WhatsApp, from the shop's number."))
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}

#if os(macOS)
// The Mac's WhatsApp sheets (docs/features/mac-design.md, rule 7): the number focused, what is sent or written under it, and a
// button that says what it does. The numbers, the message and the send are the sheets' own.
extension InvoiceWhatsAppSheet {
    var macBody: some View {
        MacInvoiceSheetFrame(title: "Send on WhatsApp", subtitle: invoice.id + " · " + InvoiceActionWords.who(invoice),
                             confirmTitle: "Open WhatsApp", canConfirm: url != nil,
                             confirm: {
            if let url {
                openURL(url)
                dismiss()
            }
        }, cancel: { dismiss() }) {
            MacInvoiceTextField(title: "WhatsApp Number", text: $phone, prompt: "0300 1234567")
            macNumberNote
            if let text {
                Text("The Message").font(.headline)
                Text(text).font(.callout).textSelection(.enabled)
                Text("WhatsApp opens with it written: press send there.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var macNumberNote: some View {
        if CustomerKit.whatsAppNumber(phone).isEmpty {
            Text("Enter the customer's WhatsApp number.").font(.callout).foregroundStyle(.secondary)
        } else if let sent = invoice.sentOnWhatsApp {
            Text("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))").font(.callout).foregroundStyle(.secondary)
        }
    }
}

extension InvoicePDFNumberSheet {
    var macBody: some View {
        let name = InvoiceFacts.customerName(invoice, walkIn: "")
        let verb = invoice.sentOnWhatsApp == nil ? "Send PDF" : "Send PDF Again"
        return MacInvoiceSheetFrame(title: "Send the PDF", subtitle: invoice.id + " · " + InvoiceActionWords.who(invoice),
                                    confirmTitle: name.isEmpty ? verb : verb + " to " + name,
                                    canConfirm: !number.isEmpty, busy: sending,
                                    confirm: { Task { await send() } }, cancel: { dismiss() }) {
            MacInvoiceTextField(title: "WhatsApp Number", text: $phone, prompt: "0300 1234567")
            macNumberNote
        }
        .failureAlert($failure, title: "Could not send the PDF")
        .interactiveDismissDisabled(sending)
    }

    @ViewBuilder
    private var macNumberNote: some View {
        if number.isEmpty {
            Text("Enter the customer's WhatsApp number.").font(.callout).foregroundStyle(.secondary)
        } else if let done = invoice.sentOnWhatsApp {
            Text("PDF sent to \(done.to) · \(ShopDate.say(done.at, withTime: true))").font(.callout).foregroundStyle(.secondary)
        } else {
            Text("From the shop's own WhatsApp, with what is owed written under it: the PDF Print saves, drawn and sent by the ERP.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}
#endif
