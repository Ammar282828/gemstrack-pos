import SwiftUI
import ERPCore

/// Online orders (/orders/online): the web Orders page's "Online — to confirm" inbox (components/order/
/// online-inbox.tsx), which Home's "online orders to confirm" opens. Every order from the website waits here
/// until a person looks at it (docs/decisions.md "Online orders"): each with its pieces, photographs and sizes,
/// who and where, and what the same pieces cost at today's rate, so whoever confirms knows how far gold has
/// moved. Confirm writes the ORD- order and starts the price hold; Decline sends the reason. Both tell the
/// customer on WhatsApp, so each asks first with the words that go (OnlineConfirmSheet, OnlineDeclineSheet).
/// Under them, the last fortnight's: a confirmed one opens its order, where the transfer is checked.
struct OnlineOrdersScreen: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var confirming: OnlineOrderRow?
    @State private var declining: OnlineOrderRow?
    @State private var told: OnlineTold?
    @State private var go: Route?

    private var store: OnlineOrdersStore { OnlineOrdersStore.shared }
    /// The accounts the server lets act on online orders (lib/website/staff-gate.ts): marketing is refused.
    private var mayAct: Bool { session.role == "owner" || session.role == "staff" }
    private var asks: Bool { session.shop.websiteSelling && mayAct }

    var body: some View {
        content
            .navigationTitle("Online orders")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
            .sheet(item: $confirming) { (r: OnlineOrderRow) in
                OnlineConfirmSheet(row: r) { orderId in go = Route(path: "/orders/\(orderId)") }
            }
            .sheet(item: $declining) { (r: OnlineOrderRow) in
                OnlineDeclineSheet(row: r) { t in told = t }
            }
            .refreshable { if asks { await store.load() } }
            .task { if asks { await store.load() } }
            // A new one placed while the screen is open: the app's two-minute count sees it first (OnlineInbox).
            .onChange(of: OnlineInbox.shared.waiting) { _, _ in
                if asks { Task { await store.load() } }
            }
    }

    @ViewBuilder
    private var content: some View {
        if !session.shop.websiteSelling {
            ContentUnavailableView("No online orders here", systemImage: "globe",
                                   description: Text("This house's website takes no orders."))
        } else if !mayAct {
            ContentUnavailableView("Owners and staff only", systemImage: "lock",
                                   description: Text("Only owner and staff accounts can act on online orders."))
        } else {
            switch store.phase {
            case .idle, .loading:
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't read the online orders", systemImage: "exclamationmark.icloud")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") { Task { await store.load() } }
                }
            case .loaded:
                list
            }
        }
    }

    // MARK: The list

    private var list: some View {
        let waiting = store.waiting
        let lately = store.lately
        return List {
            Group {
                if let told {
                    Section {
                        Label(told.words, systemImage: told.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(told.ok ? Color.green : Color.orange)
                    }
                }
                if waiting.isEmpty {
                    Section {
                        Label("Nothing to confirm. A new one shows here, on Home and beside Orders.", systemImage: "checkmark.seal")
                            .foregroundStyle(.secondary)
                    } footer: {
                        Text("Nothing is in the book, and nobody has the bank details, until you confirm.")
                    }
                } else {
                    ForEach(waiting) { (r: OnlineOrderRow) in waitingSection(r) }
                }
                if !lately.isEmpty {
                    Section {
                        ForEach(lately) { (r: OnlineOrderRow) in latelyRow(r) }
                    } header: {
                        Text("The last two weeks")
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    // MARK: One waiting

    @ViewBuilder
    private func waitingSection(_ r: OnlineOrderRow) -> some View {
        Section {
            ForEach(Array(r.lines.enumerated()), id: \.offset) { pair in lineRow(pair.element) }
            customerRows(r)
            if let moved = OnlineOrdersLogic.movedLine(r) {
                let dearer = (OnlineOrdersLogic.moved(r)?.amount ?? 0) > 0
                Label(moved, systemImage: "chart.line.uptrend.xyaxis")
                    .font(.footnote)
                    .foregroundStyle(dearer ? Color.orange : Color.secondary)
            }
            actionsRow(r)
        } header: {
            waitingHeader(r)
        }
    }

    private func waitingHeader(_ r: OnlineOrderRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                // The section says Online already; the number is what the customer quotes.
                Text(r.id)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .monospacedDigit()
                Text(OnlineOrdersLogic.ago(r.placedAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.pkr(r.grandTotal))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .monospacedDigit()
                Text(r.deliveryCharge > 0 ? "incl. \(Money.pkr(r.deliveryCharge)) delivery" : "free delivery")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .textCase(nil)
    }

    private func lineRow(_ l: OnlineOrderLine) -> some View {
        HStack(spacing: 12) {
            StockImage(imageUrl: l.image, name: l.description, key: l.key)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(OnlineOrdersLogic.pieceName(l.description))
                    .font(.subheadline)
                    .lineLimit(2)
                if let size = l.size {
                    Text("Size \(size)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 8)
            Text(Money.pkr(l.price))
                .font(.subheadline)
                .monospacedDigit()
        }
    }

    @ViewBuilder
    private func customerRows(_ r: OnlineOrderRow) -> some View {
        LabeledContent("Customer", value: r.customer.name)
        if let call = OnlineOrdersLogic.callURL(r.customer.phone) {
            Button { openURL(call) } label: {
                Label(r.customer.phone, systemImage: "phone")
            }
        }
        if let chat = OnlineOrdersLogic.chatURL(r.customer.phone) {
            Button { openURL(chat) } label: {
                Label("WhatsApp", systemImage: "message")
            }
        }
        VStack(alignment: .leading, spacing: 2) {
            Label {
                Text([r.delivery.address, r.delivery.city].filter { !$0.isEmpty }.joined(separator: ", "))
            } icon: {
                Image(systemName: "mappin.and.ellipse")
            }
            .font(.subheadline)
            if let notes = r.delivery.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                Text("“\(notes)”")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func actionsRow(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirming" {
            // Someone pressed Confirm a moment ago; the server holds it for them for two minutes.
            HStack(spacing: 8) {
                SkeletonLoading().controlSize(.small)
                Text("Being confirmed" + (OnlineOrdersLogic.who(r.claimedBy).map { " by \($0)" } ?? "") + "…")
                    .foregroundStyle(.secondary)
            }
        } else {
            HStack(spacing: 10) {
                Button { confirming = r } label: {
                    Label("Confirm", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                Button { declining = r } label: {
                    Label("Decline", systemImage: "xmark")
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: The last fortnight's

    @ViewBuilder
    private func latelyRow(_ r: OnlineOrderRow) -> some View {
        if r.state == "confirmed", let orderId = r.orderId, !orderId.isEmpty {
            NavigationLink(value: Route(path: "/orders/\(orderId)")) {
                TwoLine(title: "\(r.id) · \(orderId)", subtitle: confirmedLine(r), trailing: Money.pkr(r.grandTotal))
            }
        } else if r.state == "declined" {
            TwoLine(title: "\(r.id) · declined",
                    subtitle: [r.customer.name, r.declineReason ?? ""].filter { !$0.isEmpty }.joined(separator: " · "),
                    trailing: Money.pkr(r.grandTotal),
                    trailingTint: .secondary)
        } else {
            TwoLine(title: r.id, subtitle: r.customer.name, trailing: Money.pkr(r.grandTotal))
        }
    }

    private func confirmedLine(_ r: OnlineOrderRow) -> String {
        var s = r.customer.name
        if let at = r.confirmedAt, !at.isEmpty { s += " · confirmed " + ShopDate.say(at, withTime: true) }
        if let by = OnlineOrdersLogic.who(r.confirmedBy) { s += " by " + by }
        return s
    }
}
