#if os(macOS)
import SwiftUI
import ERPCore

/// ⌘K: open anything without leaving the page (2026-10-25 audit, owner: "operate this fluidly", the Claude app's ⌘K).
/// A panel over the window: type, and places, customers, invoices, orders, stock and repairs come up as you type; ↑ ↓
/// move, Return opens, ⌘Return opens in a window of its own, Esc closes. Nothing typed, it offers New sale, New order and
/// the sidebar's places. Reads the books already on the shelves; it never asks the ERP for anything itself.
struct MacQuickOpen: View {
    let map: NavMap
    let model: MacShellModel
    let canCreate: Bool

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openWindow) private var openWindow
    @State private var text = ""
    @State private var picked = 0
    @State private var made = Memo<[Hit]>()
    @FocusState private var focused: Bool

    /// One line of the panel.
    struct Hit: Identifiable {
        enum Kind { case place, record, create }
        let id: String
        let title: String
        let detail: String
        let symbol: String
        let path: String
        let kind: Kind
    }

    private static let perKind = 5

    var body: some View {
        let hits = self.hits
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary).font(.title3)
                TextField("Open a customer, invoice, order, piece or place", text: $text)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($focused)
                    .onSubmit { open(hits, inWindow: false) }
            }
            // The keys while the field has the keyboard: a field takes ↑ and ↓ for itself before any view hears them,
            // but a key equivalent is asked first (as Search does).
            .background {
                Group {
                    Button("") { move(1, hits.count) }.keyboardShortcut(.downArrow, modifiers: [])
                    Button("") { move(-1, hits.count) }.keyboardShortcut(.upArrow, modifiers: [])
                    Button("") { open(hits, inWindow: true) }.keyboardShortcut(.return, modifiers: .command)
                    Button("") { close() }.keyboardShortcut(.cancelAction)
                }
                .opacity(0).allowsHitTesting(false).accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            if !hits.isEmpty {
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 1) {
                            ForEach(Array(hits.enumerated()), id: \.element.id) { i, hit in
                                row(hit, lit: i == picked)
                                    .id(hit.id)
                                    .onTapGesture { picked = i; open(hits, inWindow: false) }
                            }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 360)
                    .onChange(of: picked) { _, p in
                        if hits.indices.contains(p) { proxy.scrollTo(hits[p].id) }
                    }
                }
            } else if !typed.isEmpty {
                Divider()
                Text("Nothing matches “\(text)”.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            Divider()
            HStack(spacing: 14) {
                Text("↑↓ to move").foregroundStyle(.tertiary)
                Text("↩ to open").foregroundStyle(.tertiary)
                Text("⌘↩ in a new window").foregroundStyle(.tertiary)
                Spacer()
                Text("esc").foregroundStyle(.tertiary)
            }
            .font(.caption)
            .padding(.horizontal, 16)
            .padding(.vertical, 7)
        }
        .frame(width: 600)
        .background(.regularMaterial, in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color(nsColor: .separatorColor), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.25), radius: 24, y: 10)
        .onAppear {
            focused = true
            if session.role != "marketing" {
                book.customers.need(); book.invoices.need(); book.orders.need(); book.products.need(); book.repairs.need()
            }
        }
        .onChange(of: text) { _, _ in picked = 0 }
    }

    private func row(_ hit: Hit, lit: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: hit.symbol)
                .frame(width: 20)
                .foregroundStyle(lit ? Theme.onAccent : Theme.accent)
            Text(hit.title).lineLimit(1)
                .foregroundStyle(lit ? Theme.onAccent : Color.primary)
            Spacer(minLength: 8)
            Text(hit.detail).lineLimit(1).monospacedDigit()
                .foregroundStyle(lit ? Theme.onAccent.opacity(0.85) : Color.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(lit ? Theme.accent : Color.clear, in: .rect(cornerRadius: 7, style: .continuous))
        .contentShape(Rectangle())
    }

    // MARK: What it finds

    private var typed: String { text.trimmingCharacters(in: .whitespaces).lowercased() }

    /// Made once per word typed and change of the books, not per arrow key.
    private var hits: [Hit] {
        let key = [typed.hashValue, book.customers.revision, book.invoices.revision, book.orders.revision,
                   book.products.revision, book.repairs.revision, canCreate ? 1 : 0]
        return made(key) { find(typed) }
    }

    private func find(_ q: String) -> [Hit] {
        if q.isEmpty { return idle() }
        var out: [Hit] = []
        let places = map.allPlaces.lazy.filter { h in
            h.place.label.lowercased().contains(q)
                || (h.place.keywords ?? []).contains { $0.lowercased().contains(q) }
                || (h.entry?.label.lowercased().contains(q) ?? false)
        }
        for h in places.prefix(Self.perKind) {
            let under = h.entry.map { $0.label == h.place.label ? "" : $0.label } ?? ""
            out.append(Hit(id: "place:" + h.id, title: h.place.title, detail: under,
                           symbol: NavIcon.symbol(for: h.place.icon ?? h.entry?.icon), path: h.place.href, kind: .place))
        }
        guard session.role != "marketing" else { return out }
        let digits = q.filter(\.isNumber)
        let byPhone = digits.count >= 4
        // Lazily, five of each: a panel of the first matches, so a word typed never walks every record.
        for c in book.customers.items.lazy.filter({ c in
            guard (c.deletedAt ?? "").isEmpty else { return false }
            if c.name.lowercased().contains(q) { return true }
            return byPhone && [c.phone ?? "", c.altPhone ?? ""].contains { $0.filter(\.isNumber).contains(digits) }
        }).prefix(Self.perKind) {
            out.append(Hit(id: "c:" + c.id, title: c.name, detail: c.phone ?? "", symbol: "person",
                           path: "/customers/" + Self.encode(c.id), kind: .record))
        }
        for i in book.invoices.items.lazy.filter({ $0.id.lowercased().contains(q) || $0.customerName.lowercased().contains(q) }).prefix(Self.perKind) {
            out.append(Hit(id: "i:" + i.id, title: "\(i.id) · \(i.customerName.isEmpty ? "Walk-in" : i.customerName)",
                           detail: Money.pkr(i.grandTotal), symbol: "doc.text", path: "/invoices/" + Self.encode(i.id), kind: .record))
        }
        for o in book.orders.items.lazy.filter({ $0.id.lowercased().contains(q) || ($0.customerName ?? "").lowercased().contains(q) }).prefix(Self.perKind) {
            out.append(Hit(id: "o:" + o.id, title: "\(o.id) · \(o.customerName ?? "")", detail: o.status.rawValue,
                           symbol: "list.clipboard", path: "/orders/" + Self.encode(o.id), kind: .record))
        }
        for p in book.products.items.lazy.filter({ $0.sku.lowercased().contains(q) || $0.name.lowercased().contains(q) }).prefix(Self.perKind) {
            out.append(Hit(id: "p:" + p.sku, title: "\(p.sku) · \(p.name)", detail: String(format: "%.2f g", p.metalWeightG),
                           symbol: "tag", path: "/products/" + Self.encode(p.sku), kind: .record))
        }
        for r in book.repairs.items.lazy.filter({ $0.id.lowercased().contains(q) || $0.customerName.lowercased().contains(q) }).prefix(Self.perKind) {
            out.append(Hit(id: "r:" + r.id, title: "\(r.id) · \(r.customerName)", detail: r.pieces.map(\.item).joined(separator: ", "),
                           symbol: "wrench.and.screwdriver", path: "/repairs?id=" + Self.encode(r.id), kind: .record))
        }
        return out
    }

    /// Nothing typed: what is made most (New sale, New order), then the sidebar's places.
    private func idle() -> [Hit] {
        var out: [Hit] = []
        if canCreate {
            if let sale = map.newSale {
                out.append(Hit(id: "new:sale", title: "New sale", detail: "⌘N", symbol: "banknote", path: sale.href, kind: .create))
            }
            out.append(Hit(id: "new:order", title: "New order", detail: "⇧⌘N", symbol: "list.clipboard", path: "/orders/add", kind: .create))
            out.append(Hit(id: "new:repair", title: "New repair", detail: "⌥⌘N", symbol: "wrench.and.screwdriver", path: "/repairs?new=1", kind: .create))
        }
        for e in map.entries {
            out.append(Hit(id: "place:" + e.href, title: e.id == "home" ? "Home" : e.label, detail: "",
                           symbol: NavIcon.symbol(for: e.icon), path: e.href, kind: .place))
        }
        return out
    }

    private static func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    // MARK: Acting

    private func move(_ step: Int, _ count: Int) {
        guard count > 0 else { return }
        picked = min(max(picked + step, 0), count - 1)
    }

    private func open(_ hits: [Hit], inWindow: Bool) {
        guard hits.indices.contains(picked) else { return }
        let hit = hits[picked]
        close()
        if inWindow {
            openWindow(id: MacWindows.place, value: Route(path: hit.path))
            return
        }
        switch hit.kind {
        case .place: model.go(hit.path)
        case .record: model.stack.append(Route(path: hit.path))
        case .create: model.creating = Route(path: hit.path)
        }
    }

    private func close() { model.quickOpen = false }
}
#endif
