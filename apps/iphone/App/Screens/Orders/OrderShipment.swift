import SwiftUI
import ERPCore

/// The order's parcel (components/order/tcs-shipping.tsx, lib/tracking.ts; owner, 2026-11-09): where it is, one shape
/// whoever answers (TCS's own scans, else Shopify's fulfilment events), from GET /api/app/tracking; and for owners what
/// TCS charged for it (`Order.shippingCost`). The page owns the model and asks as it opens and after a booking or a
/// cancel; Refresh asks TCS again (fresh=1). Nothing is shown for an order with no parcel or one the server knows nothing of.

/// What the page holds of the order's parcel.
@MainActor @Observable
final class OrderParcelModel {
    var tracking: ParcelTracking?
    var loaded = false
    var failure: String?
    var refreshing = false
    /// Bumped after a booking or a cancel so the page asks again.
    var reload = 0

    private struct Answer: Decodable {
        let tracking: ParcelTracking?
        private enum K: String, CodingKey { case tracking }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            tracking = c.object(.tracking)
        }
    }

    /// The order has a parcel to ask about (a TCS number, a booking made here, or Shopify having shipped it).
    static func hasParcel(_ o: Order) -> Bool {
        TcsShipping.hasParcel(consignmentNo: o.tcsConsignmentNo, bookingCN: o.tcsBooking?.cn,
                              bookingCancelled: !(o.tcsBooking?.cancelledAt ?? "").isEmpty,
                              shopifyDelivery: o.shopifyDelivery, shopifyTrackingNumber: o.shopifyTracking?.number)
    }

    /// What the page's `.task(id:)` watches: a new number, a booking, or a bump.
    static func key(_ o: Order, reload: Int) -> String {
        [o.id, o.tcsConsignmentNo ?? "", o.tcsBooking?.cn ?? "", o.tcsBooking?.cancelledAt ?? "", o.shopifyDelivery ?? "", o.shopifyTracking?.number ?? "", String(reload)]
            .joined(separator: "|")
    }

    func load(_ o: Order, fresh: Bool) async {
        guard Self.hasParcel(o) else {
            tracking = nil
            loaded = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        do {
            let path = "/api/app/tracking?order=" + InvoiceFacts.encode(o.id) + (fresh ? "&fresh=1" : "")
            let answer: Answer = try await ERPAPI.shared.get(path, as: Answer.self)
            tracking = answer.tracking
            failure = nil
        } catch {
            // The last answer stays on screen; the card says the line did not answer.
            failure = error.localizedDescription
        }
        loaded = true
    }
}

extension ParcelTone {
    var tone: Tone {
        switch self {
        case .settled: return .settled
        case .late: return .late
        case .owed: return .owed
        case .working: return .working
        case .quiet: return .quiet
        }
    }
}

/// The Shipment card's rows: status, carrier and number (copy), the timeline, Refresh and Open on TCS. Empty when there
/// is nothing to say (no parcel, or the server has none), so the page puts it in a section / card only when `shows`.
struct OrderShipmentRows: View {
    let order: Order
    let model: OrderParcelModel

    @Environment(\.openURL) private var openURL
    @State private var copied = 0

    static func shows(_ o: Order, _ m: OrderParcelModel) -> Bool {
        OrderParcelModel.hasParcel(o) && (!m.loaded || m.tracking != nil || m.failure != nil)
    }

    var body: some View {
        if let t = model.tracking {
            LabeledContent("Status") {
                Pill(TcsShipping.headline(t), tone: TcsShipping.tone(t.state).tone)
            }
            if let cn = t.cn, !cn.isEmpty {
                LabeledContent(t.carrier.isEmpty ? "Consignment" : "\(t.carrier) number") {
                    Button {
                        CustomerContactLinks.copy(cn)
                        copied += 1
                    } label: {
                        Label(cn, systemImage: copied == 0 ? "doc.on.doc" : "checkmark")
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Copy \(cn)")
                }
            }
            if let line = TcsShipping.deliveredLine(t) {
                Text(line).font(.house(.subheadline)).foregroundStyle(.secondary)
            }
            ForEach(Array(t.events.enumerated()), id: \.offset) { pair in
                HStack(alignment: .firstTextBaseline, spacing: pt(10)) {
                    Text(pair.element.at)
                        .font(.house(.caption))
                        .foregroundStyle(.secondary)
                        .frame(width: pt(96), alignment: .leading)
                    VStack(alignment: .leading, spacing: pt(2)) {
                        Text(pair.element.status).font(.house(.subheadline))
                        if let place = pair.element.location, !place.isEmpty {
                            Text(place).font(.house(.caption)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let link = t.url.flatMap({ URL(string: $0) }) {
                Button { openURL(link) } label: {
                    Label(t.source == "tcs" ? "Open on TCS" : "Open tracking", systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.borderless)
            }
        } else if !model.loaded {
            LoadingRow("Asking for the parcel\u{2026}")
        }
        if let failure = model.failure, model.loaded {
            Text(model.tracking == nil ? "Tracking could not be read. \(failure)" : "Could not refresh: \(failure)")
                .font(.house(.caption))
                .foregroundStyle(Tone.owed.color)
        }
        if model.loaded {
            Button {
                Task { await model.load(order, fresh: true) }
            } label: {
                if model.refreshing { BusySpinner("Refreshing\u{2026}", inline: true) } else { Label("Refresh", systemImage: "arrow.clockwise") }
            }
            .buttonStyle(.borderless)
            .disabled(model.refreshing)
        }
    }
}

/// Courier cost: what TCS charged, for owners (the page's data-testid courier-cost). Total, what it is made of, the
/// withholding tax taken from the payout, and what TCS paid out.
struct OrderCourierCostRows: View {
    let cost: TcsShipping.ShippingCost

    var body: some View {
        LabeledContent("Courier cost") {
            Text(pkr(cost.total)).font(.house(.body).weight(.semibold)).monospacedDigit()
        }
        let breakdown = TcsShipping.costBreakdown(cost)
        if !breakdown.isEmpty {
            Text(breakdown).font(.house(.caption)).foregroundStyle(.secondary)
        }
        if let line = TcsShipping.withholdingLine(cost) {
            Text(line).font(.house(.caption)).foregroundStyle(.secondary)
        }
        if let line = TcsShipping.receivedLine(cost) {
            Text(line).font(.house(.caption)).foregroundStyle(.secondary)
        }
    }
}

/// The order page's Shipment section: tracking, then the owner's courier cost. Nothing when there is neither.
struct OrderShipmentSection: View {
    let order: Order
    let model: OrderParcelModel
    let isOwner: Bool

    var body: some View {
        let parcel = OrderShipmentRows.shows(order, model)
        let cost = isOwner && TcsShipping.showsCost(order.shippingCost) ? order.shippingCost : nil
        if parcel || cost != nil {
            Section {
                if parcel { OrderShipmentRows(order: order, model: model) }
                if let cost { OrderCourierCostRows(cost: cost) }
            } header: {
                LedgerHeading(title: "Shipment")
            }
        }
    }
}

extension OrderActions {
    /// Book with TCS: owners and the counter, on an open order with no live TCS number or booking (TcsShipping.canBook).
    static func canBookTcs(_ o: Order, role: String) -> Bool {
        guard role == "owner" || role == "staff" else { return false }
        return TcsShipping.canBook(isOpen: !isClosed(o), consignmentNo: o.tcsConsignmentNo, bookingCN: o.tcsBooking?.cn,
                                   bookingCancelled: !(o.tcsBooking?.cancelledAt ?? "").isEmpty)
    }

    /// Cancel booking: a booking made from the ERP, while the parcel has not moved on (`state` is what tracking says, nil unknown).
    static func canCancelTcs(_ o: Order, role: String, state: String?) -> Bool {
        guard role == "owner" || role == "staff" else { return false }
        return TcsShipping.canCancelBooking(bookingCN: o.tcsBooking?.cn, bookingCancelled: !(o.tcsBooking?.cancelledAt ?? "").isEmpty, state: state)
    }

    /// The confirmation's words (the page's): TCS voids the number; a Shopify fulfilment made with it stays.
    /// Cancel the booking made from the ERP (op cancelTcs) and answer its number. Needs the line: TCS voids it, so it is never
    /// kept to send later.
    @MainActor
    static func cancelTcs(_ o: Order) async throws -> String {
        if Connection.shared.isOffline {
            throw OrderActionFailure(message: "Needs a connection. TCS voids the booking, so it can't wait for the line to come back.")
        }
        let out = try await ERPAPI.shared.write("cancelTcs", ["orderId": o.id], queueOffline: false)
        return (out["cn"] as? String) ?? ""
    }

    static let cancelTcsWords = "TCS voids the consignment; tear up its slip. A Shopify fulfilment made with it stays until it is cancelled on Shopify."
}
