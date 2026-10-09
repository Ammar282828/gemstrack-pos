import SwiftUI
import ERPCore

/// Send on WhatsApp where the house sends the customer's link from the phone (House of Mina:
/// NEXT_PUBLIC_STORE_INVOICE_WHATSAPP_PDF "0"; invoice-viewer.tsx `openWhatsAppWithLink`): the number in the
/// box, as the ERP page fills it, and the page's own words with the link, written into WhatsApp on this phone.
/// A person still presses send there, so nothing is recorded (the web records only the shop line's PDF send).
/// An invoice without its link's key never reaches here: the ERP's page makes the key as it sends.
struct InvoiceWhatsAppSheet: View {
    let invoice: Invoice

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var phone: String

    init(invoice: Invoice, phone: String) {
        self.invoice = invoice
        _phone = State(initialValue: phone)
    }

    private var text: String? {
        InvoiceFacts.shareURL(invoice).map {
            InvoiceFacts.whatsAppText(invoice, link: $0, shopName: session.shop.name, byCustomer: session.shop.invoiceByCustomer)
        }
    }

    private var url: URL? { text.flatMap { InvoiceFacts.whatsAppURL(phone: phone, text: $0) } }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                } header: {
                    Text("WhatsApp number")
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
                        Text("The message")
                    } footer: {
                        Text("WhatsApp opens with it written: press send there.")
                    }
                }
                }
                .houseRows()
            }
            .navigationTitle("Send on WhatsApp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                Button {
                    if let url {
                        openURL(url)
                        dismiss()
                    }
                } label: {
                    Label("Open WhatsApp", systemImage: "message")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
                .disabled(url == nil)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
        .presentationDetents([.medium, .large])
    }
}
