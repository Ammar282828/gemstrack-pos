import SwiftUI
import ERPCore

/// Book courier (the order page's BookCourierDialog / ShopifyCourierOption), the way the shop books TCS: by
/// fulfilling the order in Shopify, which Universal Courier watches to raise the Envio consignment and write the
/// tracking number back. A custom order taken in the shop has no Shopify order, so one is made first, of custom
/// lines only (nothing joins the catalogue, no receipt is sent), and linked to the order by the ERP itself
/// (/api/shopify/push/from-order); then it is fulfilled (/api/shopify/fulfill). Owners only, as both routes are.
/// The sheet says each step before the button is pressed, and what Shopify said after.
struct OrderCourierSheet: View {
    let order: Order

    @Environment(\.dismiss) private var dismiss
    /// Off by default: the email worth sending is the one with a tracking number, and that does not exist
    /// until Envio has booked it.
    @State private var notify = false
    @State private var busy: Busy?
    @State private var made: OrderActions.MadeShopifyOrder?
    @State private var sent: String?
    @State private var error: String?

    private enum Busy { case creating, fulfilling }

    /// The Shopify order to fulfil: the order's own, or the one just made for it.
    private var linked: String? { made?.id ?? OrderActions.shopifyOrder(order) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Text("Booking happens in Shopify: Universal Courier watches for the fulfilment and raises the Envio consignment.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !OrderActions.delivering(order) {
                    Section {
                        Label(OrderActions.noAddressWarning, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                }
                Section("What happens") {
                    step(1, firstStep, done: linked != nil)
                    step(2, "Fulfil it in Shopify", done: sent != nil)
                    step(3, "Universal Courier raises the Envio consignment and returns the tracking number", done: false)
                }
                Section {
                    Toggle("Email the customer now \u{2014} before there is a tracking number", isOn: $notify)
                        .disabled(busy != nil || sent != nil)
                } footer: {
                    Text(notify
                         ? "Shopify emails the customer that the order is on its way as soon as it is fulfilled."
                         : "No email goes to the customer from here.")
                }
                if let made {
                    let said = OrderActions.madeNote(made)
                    Section {
                        Label(said.title, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Text(said.detail).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let sent {
                    Section {
                        Label("Sent for booking", systemImage: "shippingbox.fill").foregroundStyle(.green)
                        Text(sent).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    } header: {
                        Text("Could not book")
                    }
                }
                }
                .houseRows()
            }
            .navigationTitle("Book courier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .disabled(busy != nil)
                }
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                Button {
                    if sent != nil { dismiss() } else { book() }
                } label: {
                    HStack(spacing: 8) {
                        if busy != nil { SkeletonLoading() }
                        Label(buttonWords, systemImage: sent != nil ? "checkmark" : "truck.box")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
                .disabled(busy != nil)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy != nil)
    }

    private var firstStep: String {
        if let made { return "Shopify order #\(made.number ?? made.id) created" }
        return OrderActions.courierFirstStep(order)
    }

    private var buttonWords: String {
        switch busy {
        case .creating: return "Creating the Shopify order\u{2026}"
        case .fulfilling: return "Fulfilling\u{2026}"
        case nil: return sent != nil ? "Done" : (linked != nil ? "Fulfil in Shopify" : "Create and book")
        }
    }

    private func step(_ n: Int, _ words: String, done: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : "\(n).circle")
                .foregroundStyle(done ? Color.green : Color.secondary)
            Text(words)
                .font(.subheadline)
                .foregroundStyle(done ? Color.secondary : Color.primary)
        }
    }

    private func book() {
        guard busy == nil else { return }
        error = nil
        Task { @MainActor in
            do {
                var shopifyOrderId = linked
                if shopifyOrderId == nil {
                    busy = .creating
                    // The ERP links the Shopify order to this one as it makes it, and never makes a second.
                    let out = try await ERPAPI.shared.send("/api/shopify/push/from-order", ["orderId": order.id])
                    guard let m = OrderActions.madeShopifyOrder(out) else {
                        throw OrderActionFailure(message: "Could not create the Shopify order")
                    }
                    made = m
                    shopifyOrderId = m.id
                    ServerShelf.wake()
                }
                busy = .fulfilling
                let out = try await ERPAPI.shared.send("/api/shopify/fulfill", ["shopifyOrderId": shopifyOrderId ?? "", "notifyCustomer": notify])
                sent = OrderActions.fulfilledWords(out)
            } catch {
                self.error = error.localizedDescription
            }
            busy = nil
        }
    }
}
