import SwiftUI
import Observation
import ERPCore

/// The record a screen has open, as voice is told it (owner, 2026-11-02: "smart enough to know what im referring to
/// and change small details from there"). Sent with every sentence as `context` (/api/voice/native, src/lib/voice/
/// context.ts): the server reads the record itself from its book by kind and id, so the label and the pieces here
/// are only a fallback for a record made a moment ago. "Change the weight to 12 grams" then lands on this order.
struct VoiceFocus: Equatable {
    /// order, invoice, customer, karigar, product, repair, job, expense (context.ts CONTEXT_KINDS).
    let kind: String
    /// The record's id (a stock piece's SKU).
    let id: String
    /// "Order ORD-0123 · Ayesha · 2 pieces".
    let label: String
    /// An order's or invoice's pieces, in order: what "the second piece" is.
    var pieces: [String] = []
    /// The one piece open (the Workshop's Details), from 0: what "it" is.
    var piece: Int?

    var payload: [String: Any] {
        var out: [String: Any] = ["kind": kind, "id": id, "label": label,
                                  "pieces": pieces.enumerated().map { ["index": $0.offset, "name": $0.element] as [String: Any] }]
        if let piece { out["piece"] = piece }
        return out
    }

    private static func count(_ n: Int) -> String { n == 1 ? "1 piece" : "\(n) pieces" }

    static func order(_ o: Order) -> VoiceFocus {
        VoiceFocus(kind: "order", id: o.id,
                   label: "Order \(o.id) · \(o.customerName ?? "Walk-in") · \(count(o.items.count))",
                   pieces: o.items.map(\.description))
    }

    static func invoice(_ i: Invoice) -> VoiceFocus {
        VoiceFocus(kind: "invoice", id: i.id, label: "Invoice \(i.id) · \(i.customerName) · \(count(i.items.count))",
                   pieces: i.items.map(\.name))
    }

    static func customer(_ c: Customer) -> VoiceFocus {
        VoiceFocus(kind: "customer", id: c.id, label: "Customer \(c.name)")
    }

    static func karigar(_ k: Karigar) -> VoiceFocus {
        VoiceFocus(kind: "karigar", id: k.id, label: "Karigar \(k.name)")
    }

    static func product(_ p: Product) -> VoiceFocus {
        VoiceFocus(kind: "product", id: p.sku, label: "Piece \(p.sku) · \(p.name)")
    }

    static func repair(_ r: Repair) -> VoiceFocus {
        VoiceFocus(kind: "repair", id: r.id, label: "Repair \(r.id) · \(r.customerName)", pieces: r.pieces.map(\.item))
    }

    static func job(_ j: KarigarJob) -> VoiceFocus {
        VoiceFocus(kind: "job", id: j.id, label: "Workshop job · \(j.description) · \(j.karigarName)")
    }
}

/// Which records are open, the newest last. A stack, not one slot: a page pushed over another appears before the
/// one under it disappears, and a sheet closing does not tell the page under it that it appeared again; each screen
/// takes out only its own entry, so what is left on top is always what is in front.
@MainActor @Observable
final class VoiceContext {
    /// App-wide, and a business's records: emptied on a switch (Businesses.resetPerBusinessState).
    static let shared = VoiceContext()
    static func reset() { shared.open = [] }

    private var open: [(owner: UUID, focus: VoiceFocus)] = []

    /// The record in front: what "it", "her" and "the second piece" mean.
    var focus: VoiceFocus? { open.last?.focus }

    func set(_ focus: VoiceFocus?, owner: UUID) {
        open.removeAll { $0.owner == owner }
        if let focus { open.append((owner, focus)) }
    }

    func clear(owner: UUID) { open.removeAll { $0.owner == owner } }
}

private struct VoiceFocusModifier: ViewModifier {
    let focus: VoiceFocus?
    @State private var owner = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { VoiceContext.shared.set(focus, owner: owner) }
            .onChange(of: focus) { _, now in VoiceContext.shared.set(now, owner: owner) }
            .onDisappear { VoiceContext.shared.clear(owner: owner) }
    }
}

extension View {
    /// This screen shows `focus` (nil while it loads, or when the record is gone): voice is told so while it is open.
    func voiceFocus(_ focus: VoiceFocus?) -> some View { modifier(VoiceFocusModifier(focus: focus)) }
}
