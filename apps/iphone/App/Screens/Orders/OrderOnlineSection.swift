import SwiftUI
import ERPCore

/// An online order's own panel, read-only (components/order/website-order-panel.tsx): where the money
/// stands, the price hold, the slips the customer sent, the courier. Its moves (Transfer received, Let
/// it lapse, Book with Leopards, Delivered) each message the customer and the first books money, so
/// they stay in the ERP's page.
struct OrderOnlineSection: View {
    let order: Order
    let openWeb: (OrdersWebTarget) -> Void

    var body: some View {
        if let w = order.website {
            Section {
                row("Payment", OrdersLogic.paymentWords(w.paymentStatus), tint: tone(w.paymentStatus))
                if let leopards = order.leopards, !leopards.cn.isEmpty { courier(leopards) }
                row("Placed", ShopDate.say(w.placedAt, withTime: true))
                if let confirmed = w.confirmedAt, !confirmed.isEmpty { row("Confirmed", confirmedLine(w, confirmed)) }
                row("Customer pays", Money.pkr(OrdersLogic.onlineTotal(order)) + deliveryNote(w))
                if let city = order.delivery?.city, !city.isEmpty { row("City", city) }
                hold(w)
                ForEach(w.slips) { s in slip(s) }
                Button { openWeb(.orderPage(order.id)) } label: {
                    Label("Transfer received, ship or let it lapse: in the ERP", systemImage: "globe")
                }
            } header: {
                Label("Online order" + (w.onlineId.map { " " + $0 } ?? ""), systemImage: "globe")
            }
        }
    }

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
        if let by = w.confirmedBy, !by.isEmpty, by != "dev-bypass" {
            s += " by " + (by.split(separator: "@").first.map(String.init) ?? by)
        }
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

    private func slip(_ s: WebsiteSlip) -> some View {
        let wrong = (s.amount ?? 0) > 0 && abs((s.amount ?? 0) - OrdersLogic.onlineTotal(order)) > 0.5
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Label("Slip " + ShopDate.say(s.at, withTime: true), systemImage: "doc.text")
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
    }
}
