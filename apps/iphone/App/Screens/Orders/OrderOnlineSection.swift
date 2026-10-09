import SwiftUI
import ERPCore

/// An online order's own panel (components/order/website-order-panel.tsx): where the money stands, the price
/// hold, the slips the customer sent (each opens), the courier, and the moves. Transfer received and Let it
/// lapse are native (OnlineMoveSheet): both message the customer and the first books money, so each says
/// first, word for word, what goes and to whom, and what it books. Bank details on WhatsApp opens this phone's
/// WhatsApp with the amount written in, as the web's button does; the person sends it. The Leopards moves (book,
/// a CN typed in, tracking, Delivered) are the order page's courier work: `leopards` when it is passed, the
/// ERP's page until then.
struct OrderOnlineSection: View {
    let order: Order
    let openWeb: (OrdersWebTarget) -> Void
    /// The native Leopards moves, when the order page has them; nil opens the ERP's page.
    var leopards: (() -> Void)? = nil

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var move: OnlineMoveSheet.Kind?
    @State private var slip: WebsiteSlip?
    @State private var told: OnlineTold?

    /// The accounts the server lets move an online order (lib/website/staff-gate.ts).
    private var mayAct: Bool { session.role == "owner" || session.role == "staff" }

    var body: some View {
        if let w = order.website {
            Section {
                row("Payment", OrdersLogic.paymentWords(w.paymentStatus), tint: tone(w.paymentStatus))
                    .sheet(item: $move) { (k: OnlineMoveSheet.Kind) in
                        OnlineMoveSheet(order: order, kind: k) { t in told = t }
                    }
                if let told {
                    Label(told.words, systemImage: told.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(told.ok ? Color.green : Color.orange)
                }
                if let l = order.leopards, !l.cn.isEmpty { courier(l) }
                row("Placed", ShopDate.say(w.placedAt, withTime: true))
                    .sheet(item: $slip) { (s: WebsiteSlip) in OnlineSlipSheet(orderId: order.id, slip: s) }
                if let confirmed = w.confirmedAt, !confirmed.isEmpty { row("Confirmed", confirmedLine(w, confirmed)) }
                row("Customer pays", Money.pkr(OrdersLogic.onlineTotal(order)) + deliveryNote(w))
                if let city = order.delivery?.city, !city.isEmpty { row("City", city) }
                hold(w)
                ForEach(w.slips) { s in slipRow(s) }
                if w.slips.isEmpty && awaitingMoney(w) {
                    Text("No slip yet. People often pay and send the slip on WhatsApp instead: check the bank and the chat.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if mayAct { moves(w) }
            } header: {
                Label("Online order" + (w.onlineId.map { " " + $0 } ?? ""), systemImage: "globe")
            }
        }
    }

    // MARK: The moves

    /// Not paid, not lapsed, not cancelled: the money moves are open (the web's `!paid && !lapsed && status !== 'Cancelled'`).
    private func awaitingMoney(_ w: WebsiteOrderMeta) -> Bool {
        w.paymentStatus != .transferReceived && w.paymentStatus != .expired && order.status != .cancelled
    }

    @ViewBuilder
    private func moves(_ w: WebsiteOrderMeta) -> some View {
        if awaitingMoney(w) {
            if let url = bankDetailsURL(w) {
                // The shop sends its bank details itself (owner, 2026-10-04): the chat, the amount written in.
                Button { openURL(url) } label: {
                    Label("Bank details on WhatsApp", systemImage: "paperplane")
                }
            }
            Button { move = .paid } label: {
                Label("Transfer received: \(Money.pkr(OrdersLogic.onlineTotal(order)))", systemImage: "banknote")
            }
            Button(role: .destructive) { move = .lapse } label: {
                Label("Let it lapse", systemImage: "nosign")
            }
        } else if w.paymentStatus == .transferReceived && (order.leopards?.deliveredAt ?? "").isEmpty {
            let shipped = !(order.leopards?.cn ?? "").isEmpty
            Button {
                if let leopards { leopards() } else { openWeb(.orderPage(order.id)) }
            } label: {
                Label(shipped ? "Tracking and Delivered" : "Book with Leopards, or enter a CN",
                      systemImage: shipped ? "shippingbox" : "truck.box")
            }
        }
    }

    private func bankDetailsURL(_ w: WebsiteOrderMeta) -> URL? {
        let contact = (order.customerContact ?? "").trimmingCharacters(in: .whitespaces)
        let phone = contact.isEmpty ? (w.customerPhone ?? "") : contact
        let ref = (w.onlineId ?? "").isEmpty ? order.id : (w.onlineId ?? order.id)
        return OnlineOrdersLogic.bankDetailsURL(phone: phone, name: order.customerName ?? "", ref: ref, total: OrdersLogic.onlineTotal(order))
    }

    // MARK: Rows

    private func row(_ label: String, _ value: String, tint: Color = .primary) -> some View {
        LabeledContent(label) {
            Text(value)
                .foregroundStyle(tint)
                .multilineTextAlignment(.trailing)
        }
    }

    private func tone(_ s: WebsitePaymentStatus) -> Color {
        switch s {
        case .transferReceived: return .green
        case .expired, .refunded: return .secondary
        default: return .orange
        }
    }

    private func deliveryNote(_ w: WebsiteOrderMeta) -> String {
        w.deliveryCharge > 0 ? " (incl. \(Money.pkr(w.deliveryCharge)) delivery)" : ""
    }

    private func confirmedLine(_ w: WebsiteOrderMeta, _ confirmed: String) -> String {
        var s = ShopDate.say(confirmed, withTime: true)
        if let by = OnlineOrdersLogic.who(w.confirmedBy) { s += " by " + by }
        return s
    }

    @ViewBuilder
    private func courier(_ l: LeopardsMeta) -> some View {
        LabeledContent("Courier") {
            if let url = URL(string: l.trackingUrl), !l.trackingUrl.isEmpty {
                Link((l.deliveredAt == nil ? "Leopards " : "Delivered, Leopards ") + l.cn, destination: url)
            } else {
                Text("Leopards " + l.cn)
            }
        }
    }

    /// The price is held for the transfer, until the hold ends.
    @ViewBuilder
    private func hold(_ w: WebsiteOrderMeta) -> some View {
        if let until = w.holdUntil, let when = ERPDate.parse(until),
           w.paymentStatus != .transferReceived, w.paymentStatus != .expired {
            let ended = when <= Date()
            let relative = RelativeDateTimeFormatter().localizedString(for: when, relativeTo: Date())
            Label(
                ended
                    ? "The price hold ended \(relative). Check the bank before anything else."
                    : "Price held until \(ShopDate.say(until, withTime: true)) (\(relative))",
                systemImage: "clock"
            )
            .font(.footnote)
            .foregroundStyle(ended ? Color.red : Color.secondary)
        }
    }

    /// A slip the customer sent: tapped, it opens (owners and staff, as the slip's route is theirs).
    @ViewBuilder
    private func slipRow(_ s: WebsiteSlip) -> some View {
        if mayAct {
            Button { slip = s } label: { slipLine(s) }
                .buttonStyle(.plain)
        } else {
            slipLine(s)
        }
    }

    private func slipLine(_ s: WebsiteSlip) -> some View {
        let wrong = (s.amount ?? 0) > 0 && abs((s.amount ?? 0) - OrdersLogic.onlineTotal(order)) > 0.5
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Label("Slip " + ShopDate.say(s.at, withTime: true), systemImage: "doc.text")
                    .foregroundStyle(mayAct ? Theme.accent : Color.primary)
                Spacer()
                if let amount = s.amount, amount > 0 {
                    Text(Money.pkr(amount) + (wrong ? " (not the total)" : ""))
                        .monospacedDigit()
                        .foregroundStyle(wrong ? Color.red : Color.primary)
                }
            }
            .font(.subheadline)
            let detail = [s.fromBank ?? "", (s.reference ?? "").isEmpty ? "" : "ref " + (s.reference ?? "")].filter { !$0.isEmpty }
            if !detail.isEmpty {
                Text(detail.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(.rect)
    }
}
