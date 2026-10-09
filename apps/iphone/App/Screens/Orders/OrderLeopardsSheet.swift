import SwiftUI
import ERPCore

/// An online order's courier (components/order/website-order-panel.tsx): Book with Leopards once the transfer is
/// in, or the CN of a packet booked at the counter; then where it is (Refresh) and Mark delivered. Each goes
/// through the page's own route (/api/website/orders/<id>: ship, delivered, and GET for the tracking), which holds
/// Leopards' key and sends WhatsApp from the shop's number; owners and staff, as there.
///
/// Shipping messages the customer, so it asks first and says so. Afterwards the sheet says what the ERP said:
/// told, or why the message did not go (the booking stands either way). Refresh and Mark delivered message
/// nobody; a packet Leopards calls delivered closes the order, as the route does.
struct OrderLeopardsSheet: View {
    let order: Order

    @Environment(\.dismiss) private var dismiss
    @State private var cn = ""
    @State private var busy = false
    @State private var asking: Ask?
    @State private var said: (title: String, detail: String)?
    @State private var track: OrderActions.LeopardsTrack?
    @State private var shipped: String?
    @State private var delivered = false
    @State private var error: String?

    private enum Ask: Identifiable {
        case book, useCN(String)
        var id: String {
            switch self {
            case .book: return "book"
            case .useCN(let cn): return "cn-" + cn
            }
        }
    }

    private var path: String {
        "/api/website/orders/" + (order.id.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? order.id)
    }

    private var customer: String {
        let name = (order.customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "The customer" : name
    }

    private var customerInSentence: String { customer == "The customer" ? "the customer" : customer }

    /// Booked on file, or just now.
    private var cnOnFile: String? { shipped ?? OrderActions.leopards(order)?.cn }

    var body: some View {
        NavigationStack {
            Form { Group {
                if cnOnFile == nil && OrderActions.canShipLeopards(order) {
                    shipSection
                }
                if let cnOnFile {
                    followSection(cnOnFile)
                }
                if let said {
                    Section {
                        Label(said.title, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        if !said.detail.isEmpty {
                            Text(said.detail).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    }
                }
                }
                .houseRows()
            }
            .navigationTitle("Leopards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .disabled(busy)
                }
            }
            .confirmationDialog(askTitle, isPresented: askShown, titleVisibility: .visible, presenting: asking) { (a: Ask) in
                Button(askButton) { ship(a) }
                Button("Not yet", role: .cancel) {}
            } message: { (_: Ask) in
                Text(askWords)
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    // MARK: Ship

    private var shipSection: some View {
        Section {
            Button { asking = .book } label: {
                Label("Book with Leopards", systemImage: "truck.box")
            }
            .disabled(busy)
            TextField("CN number", text: $cn, prompt: Text("CN booked at the counter"))
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Use this CN") { asking = .useCN(cn.trimmingCharacters(in: .whitespacesAndNewlines)) }
                .disabled(busy || !OrderActions.cnLooksRight(cn))
        } header: {
            Text("Ship")
        } footer: {
            Text("Or enter a CN booked at the counter. Either way \(customerInSentence) is sent the tracking number on WhatsApp.")
        }
    }

    private var askShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { if !$0 { asking = nil } })
    }

    private var askTitle: String {
        switch asking {
        case .useCN(let cn): return "Ship \(order.id) with CN \(cn)?"
        default: return "Book \(order.id) with Leopards?"
        }
    }

    private var askButton: String {
        switch asking {
        case .useCN: return "Use this CN"
        default: return "Book with Leopards"
        }
    }

    private var askWords: String {
        let told = "\(customer) is sent the tracking number and its link on WhatsApp from the shop's number."
        switch asking {
        case .useCN: return "The order is marked shipped with this CN. " + told
        default: return "Leopards books the packet to \(order.delivery?.city ?? "the customer's city"). " + told
        }
    }

    private func ship(_ ask: Ask) {
        guard !busy else { return }
        asking = nil
        var body: [String: Any] = ["action": "ship"]
        if case .useCN(let typed) = ask { body["cn"] = typed }
        run(title: ask.id == "book" ? "Booked with Leopards" : "Shipped") {
            let out = try await ERPAPI.shared.send(path, body)
            shipped = OrderActions.shippedCN(out) ?? shipped
            return OrderActions.notifiedWords(out)
        }
    }

    // MARK: Follow

    @ViewBuilder
    private func followSection(_ cn: String) -> some View {
        let done = delivered || !(OrderActions.leopards(order)?.deliveredAt ?? "").isEmpty
        Section {
            if let url = URL(string: OrderActions.leopards(order)?.trackingUrl ?? ""), !(OrderActions.leopards(order)?.trackingUrl ?? "").isEmpty {
                Link(destination: url) {
                    Label("Track \(cn) on Leopards", systemImage: "arrow.up.right.square")
                }
            } else {
                LabeledContent("CN", value: cn)
            }
            if let track {
                Text(track.status).font(.subheadline.weight(.semibold))
                ForEach(Array(track.lines.enumerated()), id: \.offset) { pair in
                    Text(pair.element).font(.caption).foregroundStyle(.secondary)
                }
            }
            if !done {
                Button { refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(busy)
                Button { markDelivered() } label: { Label("Mark delivered", systemImage: "shippingbox.and.arrow.backward") }
                    .disabled(busy)
            }
        } header: {
            Text(done ? "Delivered" : "Leopards \(cn)")
        } footer: {
            if !done {
                Text("Mark delivered closes the order as Completed. Neither tells the customer anything.")
            }
        }
    }

    private func refresh() {
        run(title: "Tracking refreshed") {
            let data = try await ERPAPI.shared.data(path)
            let out = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
            let t = OrderActions.leopardsTrack(out)
            track = t
            // The route closes an order Leopards calls delivered.
            if t.delivered { delivered = true }
            return ""
        }
    }

    private func markDelivered() {
        run(title: "Delivered") {
            _ = try await ERPAPI.shared.send(path, ["action": "delivered"])
            delivered = true
            return "The order is Completed."
        }
    }

    /// One move at a time; what the ERP said, or its refusal in its own words.
    private func run(title: String, _ move: @escaping @MainActor () async throws -> String) {
        guard !busy else { return }
        busy = true
        error = nil
        Task { @MainActor in
            do {
                let detail = try await move()
                said = (title, detail)
                ServerShelf.wake()
            } catch {
                self.error = "\(title) failed: \(error.localizedDescription)"
            }
            busy = false
        }
    }
}
