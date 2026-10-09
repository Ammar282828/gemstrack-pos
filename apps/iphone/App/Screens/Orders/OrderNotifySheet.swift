import SwiftUI
import ERPCore

/// Send to customer (the order page's ⋯ menu, "Notify Customer via WhatsApp"): the order's summary written into
/// WhatsApp on this phone, at the number in the box (the order's own to start with, as the page fills it). A person
/// presses send there, so nothing goes from the shop's line and nothing is recorded, as on the web. The words are
/// lib/order-message.ts's, shown in full before WhatsApp opens. The page reaches only the summary since the status
/// updates stopped opening the dialog by themselves; `kind` keeps the two updates for when they do.
struct OrderNotifySheet: View {
    let order: Order
    var kind: OrderActions.MessageKind = .summary

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var phone: String

    init(order: Order, kind: OrderActions.MessageKind = .summary) {
        self.order = order
        self.kind = kind
        _phone = State(initialValue: pakistanE164(order.customerContact ?? ""))
    }

    private var text: String { OrderActions.customerMessage(order, kind: kind, shopName: session.shop.name) }

    private var url: URL? { InvoiceFacts.whatsAppURL(phone: phone, text: text) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("WhatsApp number", text: $phone, prompt: Text("0300 1234567"))
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                } header: {
                    Text("Customer WhatsApp Number")
                } footer: {
                    if CustomerKit.whatsAppNumber(phone).isEmpty {
                        Text("Please enter the customer's phone number.")
                    } else {
                        Text(kind == .summary
                             ? "Would you like to send a summary of this order to the customer?"
                             : "The order status has been updated. Would you like to send a notification?")
                    }
                }
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
                .houseRows()
            }
            .navigationTitle("Notify Customer via WhatsApp")
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
                    Label("Send Message", systemImage: "message")
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
