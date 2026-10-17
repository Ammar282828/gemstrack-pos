import SwiftUI
import ERPCore

// What the Repairs screens share (src/app/repairs/page.tsx, src/lib/repairs.ts): a ticket's sums,
// its words, how the list groups it, and a few small views. Every type here carries the word Repairs
// so it cannot meet another group's helpers in the one module.

/// A repair to open as a sheet: its id, and the ticket itself when it was only just written (the
/// shelf brings it back within a second, so until then the sheet shows what the ERP answered).
struct RepairsOpen: Identifiable {
    let id: String
    var seed: Repair?
}

/// One status on the list: In the shop, Ready, Collected, Cancelled.
struct RepairsGroup: Identifiable {
    let id: String
    let title: String
    let rows: [Repair]
    /// Collected and Cancelled are history, not work: they fold away.
    let folded: Bool
}

enum RepairsKit {
    // MARK: A ticket's sums (src/lib/repairs.ts)

    static func repairTotal(_ r: Repair) -> Double { ERPCore.repairTotal(r) }

    static func repairPaid(_ r: Repair) -> Double { ERPCore.repairPaid(r) }

    /// What the customer still owes on the ticket.
    static func repairBalance(_ r: Repair) -> Double { ERPCore.repairBalance(r) }

    /// "Gold ring" or "Gold ring + 2 more".
    static func repairSummary(_ r: Repair) -> String { ERPCore.repairSummary(r) }

    // MARK: Words

    /// REPAIR_STATUS_LABELS.
    static func label(_ s: RepairStatus) -> String {
        switch s {
        case .received: return "In the shop"
        case .ready: return "Ready"
        case .collected: return "Collected"
        case .cancelled: return "Cancelled"
        case .unknown(let word): return word.isEmpty ? "No status" : word
        }
    }

    /// The web's STATUS_TONE (warning, success, quiet, destructive) in the kit's tones; a cancelled ticket says
    /// nothing, as a cancelled order does.
    static func tone(_ s: RepairStatus) -> Tone {
        switch s {
        // Amber is money owed; a ticket in the shop is work in hand (blue).
        case .received: return .working
        case .ready: return .settled
        case .collected, .cancelled, .unknown: return .quiet
        }
    }

    /// Who it is for: a ticket with no name, or the old "Walk-in Customer", is a walk-in.
    static func customer(_ r: Repair) -> String {
        let n = r.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty || isWalkInName(n) ? "Walk-in" : n
    }

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func filled(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// A day the way the shop says it, mid-sentence: "ready by tomorrow", "ready by Sat 10 Oct".
    static func byDay(_ iso: String?) -> String {
        let s = ShopDate.say(iso)
        return ["Today", "Tomorrow", "Yesterday"].contains(s) ? s.lowercased() : s
    }

    /// "12.5 g": up to three decimals, none trailing.
    static func grams(_ w: Double) -> String {
        var s = String(format: "%.3f", w)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s + " g"
    }

    /// A figure back in the form's box: up to `decimals` places, none trailing; nothing or 0 is blank
    /// (sale-flow fields show 0 as blank).
    static func typed(_ v: Double?, decimals: Int) -> String {
        guard let v, v > 0 else { return "" }
        var s = String(format: "%.\(decimals)f", v)
        while s.contains(".") && s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// "Today · Cash · Advance": a payment taken on a ticket, in a line.
    static func paymentWords(_ p: RepairPayment) -> String {
        [ShopDate.say(p.date), p.method?.rawValue ?? "", p.note ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// Karachi's day, `n` days on from now (the form's quick dates).
    static func days(adding n: Int, from now: Date = Date()) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ERPDate.karachi
        return cal.date(byAdding: .day, value: n, to: now) ?? now
    }

    // MARK: Promised dates

    // TODO(logic): ERPCore's orderTiming takes an Order; the TS takes any { promisedDate, createdAt, status }.
    /// The web's `daysLate` for a repair still in the shop: the same rule an order in progress is timed by. A
    /// ticket with no promised date, or one that has left the shop, has no timing (nil), as on the web.
    static func timing(_ r: Repair, now: Date) -> OrderTiming? {
        guard r.status == .received, let promised = filled(r.promisedDate) else { return nil }
        let fields: [String: Any] = ["createdAt": r.receivedAt, "status": "In Progress", "promisedDate": promised]
        guard let order = DocJSON.decode(Order.self, id: r.id, data: fields) else { return nil }
        return orderTiming(order, now: now)
    }

    // MARK: The list

    /// The web's search: REP number, name, phone, karigar, or any piece or work on the ticket.
    /// `q` is trimmed and lower-cased already.
    static func matches(_ r: Repair, _ q: String) -> Bool {
        var fields: [String] = [r.id, r.customerName, r.customerContact ?? "", r.karigarName ?? ""]
        for p in r.pieces {
            fields.append(p.item)
            fields.append(p.work)
        }
        for f in fields where f.lowercased().contains(q) { return true }
        // A number typed with its spaces or dashes still finds the customer.
        let digits = onlyDigits(q)
        let typedANumber = q.allSatisfy { (c: Character) -> Bool in isDigit(c) || c == " " || c == "-" || c == "+" }
        if digits.count >= 3 && typedANumber {
            return onlyDigits(r.customerContact ?? "").contains(digits)
        }
        return false
    }

    private static func isDigit(_ c: Character) -> Bool { c >= "0" && c <= "9" }

    private static func onlyDigits(_ s: String) -> String { String(s.filter { isDigit($0) }) }

    /// Still in the shop: by the day promised (undated last). The rest: the latest thing that happened first.
    static func groups(_ repairs: [Repair]) -> [RepairsGroup] {
        var inShop: [Repair] = []
        var ready: [Repair] = []
        var collected: [Repair] = []
        var cancelled: [Repair] = []
        var other: [Repair] = []
        for r in repairs {
            switch r.status {
            case .received: inShop.append(r)
            case .ready: ready.append(r)
            case .collected: collected.append(r)
            case .cancelled: cancelled.append(r)
            case .unknown: other.append(r)
            }
        }
        inShop.sort(by: promisedSooner)
        ready.sort(by: latestFirst)
        collected.sort(by: latestFirst)
        cancelled.sort(by: latestFirst)
        other.sort(by: latestFirst)

        var out: [RepairsGroup] = []
        if !inShop.isEmpty { out.append(RepairsGroup(id: "received", title: "In the shop", rows: inShop, folded: false)) }
        if !ready.isEmpty { out.append(RepairsGroup(id: "ready", title: "Ready", rows: ready, folded: false)) }
        if !collected.isEmpty { out.append(RepairsGroup(id: "collected", title: "Collected", rows: collected, folded: true)) }
        if !cancelled.isEmpty { out.append(RepairsGroup(id: "cancelled", title: "Cancelled", rows: cancelled, folded: true)) }
        if !other.isEmpty { out.append(RepairsGroup(id: "other", title: "Other", rows: other, folded: true)) }
        return out
    }

    private static func promisedSooner(_ a: Repair, _ b: Repair) -> Bool {
        let pa = filled(a.promisedDate) ?? "9999"
        let pb = filled(b.promisedDate) ?? "9999"
        if pa != pb { return pa < pb }
        if a.receivedAt != b.receivedAt { return a.receivedAt > b.receivedAt }
        return a.id > b.id
    }

    private static func latestFirst(_ a: Repair, _ b: Repair) -> Bool {
        let la = latest(a)
        let lb = latest(b)
        if la != lb { return la > lb }
        return a.id > b.id
    }

    private static func latest(_ r: Repair) -> String {
        filled(r.collectedAt) ?? filled(r.readyAt) ?? filled(r.receivedAt) ?? ""
    }

    // MARK: What a ticket still allows

    /// Ready, Collected, Take payment: the buttons under a ticket. Cancelled owes nothing to take.
    static func hasActions(_ r: Repair) -> Bool {
        if r.status == .received || r.status == .ready { return true }
        return r.status != .cancelled && repairBalance(r) > 0
    }

    // MARK: Phones and WhatsApp

    static func normalizePhone(_ phone: String) -> String { normalizePhoneNumber(phone) }

    /// What can be dialled: digits, and a leading "+".
    static func callURL(_ phone: String?) -> URL? {
        var out = ""
        for ch in (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines) {
            if ch == "+" && out.isEmpty { out.append(ch) } else if ch >= "0" && ch <= "9" { out.append(ch) }
        }
        return out.isEmpty ? nil : URL(string: "tel:" + out)
    }

    static func whatsAppNumber(_ phone: String?) -> String { toWhatsAppNumber(phone) }

    /// The page's "Tell them" message, word for word. `shopName` is the shop's own (session.shop.name),
    /// since the customer reads it: never the app's "… ERP".
    static func readyMessage(_ r: Repair, shopName: String) -> String {
        var greeting = "Assalam o Alaikum"
        if let name = filled(r.customerName), !isWalkInName(name) { greeting += " " + name }
        let what: String
        if r.pieces.count == 1 {
            what = "your \(r.pieces[0].item.lowercased()) is"
        } else {
            what = "your \(r.pieces.count) pieces are"
        }
        var text = "\(greeting), \(what) ready for collection at \(shopName) (repair \(r.id))."
        let owing = repairBalance(r)
        if owing >= 1 { text += " Balance: \(Money.pkr(owing))." }
        return text + " Please bring your receipt."
    }

    /// wa.me with the message, for a ticket that is Ready and has a number.
    static func whatsAppURL(for r: Repair, shopName: String) -> URL? {
        let number = whatsAppNumber(r.customerContact)
        if number.isEmpty { return nil }
        // encodeURIComponent leaves these alone.
        let keep = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")
        let text = readyMessage(r, shopName: shopName).addingPercentEncoding(withAllowedCharacters: keep) ?? ""
        return URL(string: "https://wa.me/\(number)?text=\(text)")
    }

    /// The receipt Print receipt saves (src/lib/repair-pdf.ts), drawn by the ERP's server: "Repair-<id>.pdf".
    static func receipt(_ id: String) -> InvoicePDFTarget {
        InvoicePDFTarget(path: "/api/app/pdf/repair/" + InvoiceFacts.encode(id),
                         fileName: "Repair-\(id).pdf",
                         title: "Receipt \(id)")
    }
}

/// "Ready by Sat 10 Oct · 3 days late": the promise of a ticket still in the shop, in the web's
/// colours (late in red, the day itself in orange, otherwise quiet). Nothing for any other status.
struct RepairsPromiseText: View {
    let repair: Repair
    let now: Date
    var font: Font = .caption

    var body: some View {
        if let t = RepairsKit.timing(repair, now: now) {
            Text(line(t))
                .font(font)
                .fontWeight(t.state == .late ? .semibold : .regular)
                .foregroundStyle(tone(t))
                .monospacedDigit()
        }
    }

    private func line(_ t: OrderTiming) -> String {
        let base = "Ready by " + RepairsKit.byDay(repair.promisedDate)
        if t.state == .today { return base }
        let when = timingLabel(t)
        return when.isEmpty ? base : base + " · " + when
    }

    private func tone(_ t: OrderTiming) -> Color {
        switch t.state {
        case .late: return Tone.late.color
        case .today: return Tone.owed.color
        default: return Tone.quiet.color
        }
    }
}
