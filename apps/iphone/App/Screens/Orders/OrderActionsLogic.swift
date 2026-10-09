import Foundation
import ERPCore

/// The order page's own moves (src/app/orders/[id]/page.tsx): which an order offers, the words each one says
/// before and after, and the answers of the routes they call. Foundation only, so it is read here once and the
/// sheets only draw it. Types here carry the word Order so they cannot meet another group's helpers.
///
/// The writes are the ERP's: Undo invoice, Refund order and Delete order run lib/writes/order-undo.ts through
/// /api/app/write (ops-orders.ts); Book courier, Track and the online order's Leopards moves call the routes the
/// page calls; Send to customer writes lib/order-message.ts's words into WhatsApp on this phone.
enum OrderActions {
    // MARK: Which moves an order offers

    static func hasInvoice(_ o: Order) -> Bool { !(o.invoiceId ?? "").isEmpty }

    static func isClosed(_ o: Order) -> Bool { o.status == .cancelled || o.status == .refunded }

    /// Cancel invoice and Unlock & edit (the invoiced banner): an invoiced order. An owner's, as every write
    /// the store makes to Firestore itself (the shop floor's would be refused).
    static func canUndoInvoice(_ o: Order, isOwner: Bool) -> Bool { isOwner && hasInvoice(o) }

    /// Refund order (⋯ menu): not once the order is cancelled or refunded.
    static func canRefund(_ o: Order, isOwner: Bool) -> Bool { isOwner && !isClosed(o) }

    /// Delete order (⋯ menu): an owner's; an invoiced order says why not instead (`deleteBlocked`).
    static func canDelete(_ o: Order, isOwner: Bool) -> Bool { isOwner && !hasInvoice(o) }

    /// The menu's disabled line on an invoiced order, in the page's words.
    static func deleteBlocked(_ o: Order) -> String? {
        hasInvoice(o) ? "Delete order: delete or undo \(o.invoiceId ?? "") first" : nil
    }

    /// The TCS consignment on the order, when it has one (Track replaces Book courier then).
    static func tcsConsignment(_ o: Order) -> String? {
        let cn = (o.tcsConsignmentNo ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return cn.isEmpty ? nil : cn
    }

    /// Book courier, where the page offers it: the header's button on an order neither invoiced nor being made
    /// (it shows Finalize & invoice then), and the ⋯ menu's on an invoiced or completed order not yet given a TCS
    /// number. Owners only: both Shopify routes it calls are (shopify/push/from-order, shopify/fulfill).
    static func canBookCourier(_ o: Order, isOwner: Bool) -> Bool {
        guard isOwner else { return false }
        let header = !hasInvoice(o) && o.status != .completed && o.status != .inProgress
        let menu = tcsConsignment(o) == nil && (hasInvoice(o) || o.status == .completed)
        return header || menu
    }

    /// Online orders only (website-order-panel.tsx): booked once the transfer is in, followed once booked.
    static func isOnline(_ o: Order) -> Bool { o.source == .website && o.website != nil }

    static func leopards(_ o: Order) -> LeopardsMeta? {
        guard let l = o.leopards, !l.cn.isEmpty else { return nil }
        return l
    }

    /// Book with Leopards, or a CN booked at the counter: paid and not yet shipped.
    static func canShipLeopards(_ o: Order) -> Bool {
        isOnline(o) && o.website?.paymentStatus == .transferReceived && leopards(o) == nil
    }

    /// Refresh the tracking and Mark delivered: shipped, not yet delivered.
    static func canFollowLeopards(_ o: Order) -> Bool {
        guard isOnline(o), let l = leopards(o) else { return false }
        return (l.deliveredAt ?? "").isEmpty
    }

    /// The page's box takes a CN of six characters or more.
    static func cnLooksRight(_ cn: String) -> Bool { cn.trimmingCharacters(in: .whitespacesAndNewlines).count >= 6 }

    // MARK: The undoing moves' words (the page's confirmations, the store's delete-code words, its toasts)

    /// The store's words for the delete code (lib/writes/order-undo.ts undoWhat, refundWhat, deleteWhat).
    static func undoWhat(_ o: Order) -> String { "Undo invoice \(o.invoiceId ?? "") back to order \(o.id)" }
    static func refundWhat(_ o: Order) -> String { "Refund order \(o.id)" }
    static func deleteWhat(_ o: Order) -> String { "Delete order \(o.id)" }

    /// Cancel invoice's confirmation. "This can't be undone" is the code sheet's own last line.
    static func undoDetail(_ o: Order) -> String {
        "This will permanently cancel invoice \(o.invoiceId ?? "") and revert this order back to \u{201C}In Progress\u{201D} so it can be edited and re-finalized. Any hisaab entries linked to the invoice will also be removed."
    }

    /// Unlock & edit's confirmation.
    static func unlockDetail(_ o: Order) -> String {
        "This will revert invoice \(o.invoiceId ?? ""), removing it and its ledger entries. Revenue calculations will be updated. You can re-finalize a new invoice after editing."
    }

    /// Refund order's confirmation: what goes with the invoice, or that the order stays on file.
    static func refundDetail(_ o: Order) -> String {
        "This will mark order \(o.id) as Refunded."
            + (hasInvoice(o)
                ? " Invoice \(o.invoiceId ?? "") will be permanently deleted, all hisaab entries removed, and items returned to stock."
                : " The order record will be kept but removed from revenue calculations.")
    }

    /// Delete order asks only the code on the page; the photos going with it is said here.
    static func deleteDetail(_ o: Order) -> String { "Its sample photos go with it." }

    /// What the page's toast says once each has gone through.
    static func undoneNote(_ o: Order, invoiceId: String) -> (title: String, detail: String) {
        ("Order Reverted", "Invoice \(invoiceId) has been cancelled and order is now editable.")
    }

    static func unlockedNote(invoiceId: String) -> (title: String, detail: String) {
        ("Invoice Cancelled", "Invoice \(invoiceId) removed. You can now edit the order.")
    }

    static func refundedNote(_ o: Order) -> (title: String, detail: String) {
        ("Order Refunded", "Order \(o.id) has been marked as refunded and stock restored.")
    }

    static func deletedNote(_ o: Order) -> String { "Order \(o.id) deleted" }

    // MARK: Send to customer (lib/order-message.ts, line for line)

    enum MessageKind { case inProgress, completed, summary }

    static func customerMessage(_ o: Order, kind: MessageKind, shopName: String) -> String {
        let name = (o.customerName ?? "").isEmpty ? "Customer" : (o.customerName ?? "")
        var message = "Dear \(name),\n\n"
        if kind == .summary {
            message += "Here is a summary of your custom order *#\(o.id)* from \(shopName).\n\n"
            for (index, item) in o.items.enumerated() {
                message += "*Item \(index + 1):* \(item.description)\n"
                if !item.isManualPrice {
                    let karat = item.karat?.rawValue ?? ""
                    message += "  - Est. Weight: \(jsNumber(item.estimatedWeightG))g \(karat.isEmpty ? "" : "(\(karat))")\n"
                }
            }
            message += "\n*Total Balance Due:* PKR \(amount(o.grandTotal))\n\n"
            message += "We are working on your order and will notify you of any updates.\n\n"
        } else {
            message += "This is an update regarding your order *#\(o.id)* from \(shopName).\n\n"
            if kind == .inProgress {
                message += "We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n"
            } else {
                message += "Your custom order is now *Completed* and ready for collection.\n\n"
                message += "*Amount Due:* PKR \(amount(o.grandTotal))\n\n"
            }
        }
        message += "Thank you for your business."
        return message
    }

    /// A number as JavaScript writes it into text: 3 not 3.0, 4.25 as it is.
    static func jsNumber(_ x: Double) -> String {
        if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int(x)) }
        return String(x)
    }

    /// "45,500.00": `toLocaleString('en-US', { minimumFractionDigits: 2 })` (three decimals at most, as there).
    static func amount(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: n.isFinite ? n : 0)) ?? String(n)
    }

    // MARK: Book courier (the page's ShopifyCourierOption)

    /// The order's delivery has an address: the courier has somewhere to send it.
    static func delivering(_ o: Order) -> Bool {
        guard let d = o.delivery, d.required else { return false }
        return !d.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The order's Shopify order, when it has one (a web order, or one made for a courier before).
    static func shopifyOrder(_ o: Order) -> String? {
        let id = (o.shopifyOrderId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return id.isEmpty ? nil : id
    }

    static func courierFirstStep(_ o: Order) -> String {
        if let linked = shopifyOrder(o) {
            return "Shopify order #\(o.shopifyOrderNumber.map(String.init) ?? linked) already exists"
        }
        return "Create a matching Shopify order \u{2014} custom lines only, nothing added to your catalogue"
    }

    static let noAddressWarning = "This order has no delivery address. It can still be booked, but the courier will have nowhere to send it \u{2014} add one on the order first."

    /// What /api/shopify/push/from-order answers: the Shopify order made (or the one already linked).
    struct MadeShopifyOrder {
        let id: String
        let number: String?
        let hasShippingAddress: Bool
    }

    static func madeShopifyOrder(_ json: [String: Any]) -> MadeShopifyOrder? {
        guard let id = text(json["shopifyOrderId"]), !id.isEmpty else { return nil }
        return MadeShopifyOrder(id: id, number: text(json["shopifyOrderNumber"]), hasShippingAddress: json["hasShippingAddress"] as? Bool ?? false)
    }

    /// The page's toast for the Shopify order just made.
    static func madeNote(_ m: MadeShopifyOrder) -> (title: String, detail: String) {
        ("Shopify order #\(m.number ?? m.id) created",
         m.hasShippingAddress ? "Delivery address attached." : "No delivery address on this order \u{2014} add one so the courier has somewhere to send it.")
    }

    /// What /api/shopify/fulfill says it did.
    static func fulfilledWords(_ json: [String: Any]) -> String {
        text(json["message"]) ?? "Fulfilled. Universal Courier will book it with Envio and add the tracking number."
    }

    // MARK: Track (TCS, /api/tcs)

    struct TCSTrack {
        let summary: String
        let checkpoints: [(datetime: String, status: String)]
    }

    /// The page reads a TCS answer as found when it says SUCCESS or carries checkpoints; otherwise its words.
    static func tcsTrack(_ json: [String: Any]) -> Result<TCSTrack, OrderActionFailure> {
        let found = text(json["message"]) == "SUCCESS" || (json["checkpoints"] != nil && !(json["checkpoints"] is NSNull))
        guard found else {
            return .failure(OrderActionFailure(message: text(json["shipmentsummary"]) ?? text(json["error"]) ?? "No data found."))
        }
        let list = (json["checkpoints"] as? [[String: Any]] ?? []).prefix(5).map {
            (datetime: text($0["datetime"]) ?? "", status: text($0["status"]) ?? "")
        }
        return .success(TCSTrack(summary: text(json["shipmentsummary"]) ?? "No summary available.", checkpoints: Array(list)))
    }

    static func tcsURL(_ cn: String) -> URL? {
        var c = URLComponents(string: "https://www.tcscourier.com/domestic/tracking/")
        c?.queryItems = [URLQueryItem(name: "ref", value: cn)]
        return c?.url
    }

    // MARK: Leopards (website-order-panel.tsx, /api/website/orders/<id>)

    struct LeopardsTrack {
        let status: String
        let delivered: Bool
        /// The last five, as the panel lists them: "when — what · where".
        let lines: [String]
    }

    static func leopardsTrack(_ json: [String: Any]) -> LeopardsTrack {
        let history = json["history"] as? [[String: Any]] ?? []
        let lines = history.suffix(5).map { h -> String in
            let place = text(h["location"]) ?? ""
            return "\(text(h["at"]) ?? "") \u{2014} \(text(h["status"]) ?? "")" + (place.isEmpty ? "" : " \u{00B7} \(place)")
        }
        return LeopardsTrack(status: text(json["status"]) ?? "Unknown", delivered: json["delivered"] as? Bool ?? false, lines: Array(lines))
    }

    /// After a move that messages the customer: told, or why the message did not go (the move itself stands).
    static func notifiedWords(_ json: [String: Any]) -> String {
        if let n = text(json["notified"]), !n.isEmpty { return "Done \u{2014} but the customer's WhatsApp did not send: \(n)" }
        return "Done. The customer has been told on WhatsApp."
    }

    /// The Leopards line booked, from the ship answer.
    static func shippedCN(_ json: [String: Any]) -> String? {
        (json["leopards"] as? [String: Any]).flatMap { text($0["cn"]) }
    }

    /// A route's field as text, whether it came as text or a number.
    static func text(_ v: Any?) -> String? {
        switch v {
        case let s as String: return s
        case let n as Int: return String(n)
        case let d as Double: return jsNumber(d)
        default: return nil
        }
    }
}

/// A route that answered but found nothing, in its own words.
struct OrderActionFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
