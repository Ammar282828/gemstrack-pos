// Ported from src/lib/work-drafts.ts (tests: WorkDraftsTests, from work-drafts.test.ts) — the reading side:
// what a draft's card says, when a draft is forgotten, where it opens, and what makes a valid id.
//
// Orders and sales started and not yet saved live in Firestore `drafts`, one document per unfinished form
// (decisions.md "Drafts"). The form's own values (`data`) are the form's business and are not decoded here:
// a draft with sample photos can weigh most of a megabyte, and a list of cards has no use for them.

import Foundation

/// A month without a keystroke and a draft is clutter, not work in hand.
public let DRAFT_MAX_AGE_DAYS = 30

/// One draft as the Drafts list shows it (`WorkDraft` less its `data`).
public struct WorkDraft: Decodable, Identifiable, Hashable {
    public let id: String
    /// "order" or "sale".
    public let kind: String
    /// Who it is for, or "No customer yet".
    public let title: String
    /// What is in it, in a few words.
    public let detail: String
    /// Pieces in it.
    public let items: Int
    /// The running total, PKR (0 when unknown).
    public let total: Double
    /// The device it was last typed on ("iPhone", "Mac"…).
    public let device: String
    public let createdAt: String
    public let updatedAt: String
    /// Anything too big to keep and left out (the order's sample photos, rarely).
    public let leftOut: [String]

    private enum K: String, CodingKey {
        case id, kind, title, detail, items, total, device, createdAt, updatedAt, leftOut
    }

    public init(id: String, kind: String, title: String, detail: String, items: Int, total: Double,
                device: String, createdAt: String, updatedAt: String, leftOut: [String] = []) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.items = items
        self.total = total
        self.device = device
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.leftOut = leftOut
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        kind = c.string(.kind, default: "")
        title = c.string(.title, default: "")
        detail = c.string(.detail, default: "")
        items = c.int(.items) ?? 0
        total = c.double(.total, default: 0)
        device = c.string(.device, default: "")
        createdAt = c.string(.createdAt, default: "")
        updatedAt = c.string(.updatedAt, default: "")
        leftOut = c.strings(.leftOut)
    }

    public var isOrder: Bool { kind == "order" }
    public var isSale: Bool { kind == "sale" }
}

/// A draft's id as `newDraftId` makes it: its kind, the time in base 36, a few letters
/// (`DRAFT_ID_RE`, which /api/app/drafts checks before it writes or removes anything).
public func isDraftId(_ id: String) -> Bool {
    let parts = id.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "order" || parts[0] == "sale" else { return false }
    func word(_ s: Substring, _ lengths: ClosedRange<Int>) -> Bool {
        lengths.contains(s.count) && s.unicodeScalars.allSatisfy { ("0"..."9").contains($0) || ("a"..."z").contains($0) }
    }
    return word(parts[1], 6...12) && word(parts[2], 1...8)
}

/// `encodeURIComponent`: what a query value leaves alone.
private let draftQuerySafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

/// Where the ERP's own form continues a draft (`draftHref`).
public func draftHref(kind: String, id: String) -> String {
    let query = id.addingPercentEncoding(withAllowedCharacters: draftQuerySafe) ?? id
    return kind == "order" ? "/orders/add?draft=\(query)" : "/invoices/new?draft=\(query)"
}

/// Forgotten once a month old, or when it never said when it was last typed (`isExpired`).
public func isDraftExpired(_ d: WorkDraft, now: Date) -> Bool {
    guard let t = ERPDate.parse(d.updatedAt) else { return true }
    return now.timeIntervalSince(t) > Double(DRAFT_MAX_AGE_DAYS) * 86_400
}

/// The list as the Drafts page keeps it: the live ones newest-typed first, and the expired ones apart
/// (the web removes those as it sees them).
public func draftList(_ drafts: [WorkDraft], now: Date) -> (live: [WorkDraft], expired: [WorkDraft]) {
    var live: [WorkDraft] = []
    var expired: [WorkDraft] = []
    for d in drafts {
        if isDraftExpired(d, now: now) { expired.append(d) } else { live.append(d) }
    }
    // ISO instants sort as text; newest last-typed first, as the web sorts (`updatedAt`, descending).
    let sorted = live.jsSorted { a, b in
        a.updatedAt == b.updatedAt ? 0 : (a.updatedAt > b.updatedAt ? -1 : 1)
    }
    return (sorted, expired)
}

/// "Ruby ring, Bangles +1" — the first two pieces by name, the rest counted.
private func draftNames(_ names: [String]) -> String {
    names.prefix(2).joined(separator: ", ") + (names.count > 2 ? " +\(names.count - 2)" : "")
}

/// An order draft's second line (`summarizeOrder`): the pieces by what they are, then the advance.
/// `names` are the pieces' words (blank ones left out by the caller); `pieces` is how many there are.
public func draftOrderDetail(names: [String], pieces: Int, advance: Double) -> String {
    var parts: [String] = []
    if !names.isEmpty {
        parts.append(draftNames(names))
    } else {
        parts.append(pieces > 0 ? "\(pieces) piece\(pieces == 1 ? "" : "s")" : "No pieces yet")
    }
    if advance > 0 { parts.append("advance \(Money.pkr(advance))") }
    return parts.joined(separator: " · ")
}

/// A sale draft's second line (`summarizeSale`): the pieces in the cart, then the discount.
public func draftSaleDetail(names: [String], discount: Double) -> String {
    var parts: [String] = []
    parts.append(names.isEmpty ? "No pieces yet" : draftNames(names))
    if discount > 0 { parts.append("discount \(Money.pkr(discount))") }
    return parts.joined(separator: " · ")
}

/// A draft's first line: who it is for.
public func draftTitle(customer: String) -> String {
    let t = customer.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? "No customer yet" : t
}
