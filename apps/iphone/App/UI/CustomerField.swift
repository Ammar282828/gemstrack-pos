import SwiftUI
import ERPCore

/// Who a sale or an order is for, as New sale and New order take it (the web's customer-autocomplete.tsx, both
/// forms): the book is offered as the name is typed, in the same section, and a tap fills the name, the customer
/// and their number. A number typed first finds its customer too. Nothing picked is a new customer (a name or a
/// number typed) or a walk-in (nothing), and the screen's own rules decide which (lib/walk-in.ts).
///
/// Rows for a `Section`; the screen keeps its own header, footer and other rows.
struct CustomerField: View {
    /// The name as typed, or the picked customer's.
    let name: String
    /// The customer on file, when one was picked.
    let pickedId: String?
    @Binding var phone: String
    /// The whole book; removed customers and old walk-in records are left out here.
    let book: [Customer]
    /// The last few people served, offered before anything is typed. Asked for only then: it reads the books.
    var recent: () -> [Customer] = { [] }
    /// Typing lets go of a picked customer, as the web's box does.
    let type: (String) -> Void
    /// A pick from the book; nil is the walk-in.
    let pick: (Customer?) -> Void

    private enum Field { case name, phone }
    @FocusState private var focus: Field?
    /// The customer just picked. The name box gives way to them while it still has the keyboard, and on its way
    /// out it writes back what it last held (the letters typed, or nothing for a recent customer), which would let
    /// go of the pick: nothing it writes counts until Change, or the screen, lets go of them.
    @State private var settled: String?

    private var picked: Customer? {
        guard let id = pickedId, !id.isEmpty else { return nil }
        return book.first { $0.id == id }
    }

    private var nameBinding: Binding<String> {
        Binding(get: { name }, set: { if settled == nil { type($0) } })
    }

    private var typed: String { name.trimmingCharacters(in: .whitespaces) }

    private var nameHits: [CustomerSearch.Hit] {
        guard focus == .name, picked == nil, !typed.isEmpty else { return [] }
        return CustomerSearch.rank(typed, in: book, limit: 6)
    }

    /// A number being typed with no name picked: who it already belongs to.
    private var phoneHits: [CustomerSearch.Hit] {
        guard focus == .phone, picked == nil, CustomerSearch.digitsTyped(phone).count >= 4 else { return [] }
        return CustomerSearch.rank(phone, in: book, limit: 3)
    }

    var body: some View {
        Group {
            if let c = picked {
                pickedRow(c)
            } else {
                LabeledContent {
                    TextField("Name", text: nameBinding, prompt: Text("Search or type a new name"))
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focus, equals: .name)
                        .onSubmit { focus = .phone }
                } label: {
                    Text("Name")
                }
                if focus == .name { suggestions }
                LabeledContent {
                    TextField("Phone", text: $phone, prompt: Text("Optional"))
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .focused($focus, equals: .phone)
                } label: {
                    Text("Phone")
                }
                ForEach(phoneHits, id: \.customer.id) { hit in
                    hitRow(hit, note: "This number is on file")
                }
            }
        }
        // The number kept as the ERP keeps it (+92…), as the web's phone box does, once the counter moves on.
        .onChange(of: focus) { old, new in
            guard old == .phone, new != .phone else { return }
            let kept = pakistanE164(phone)
            if kept != phone { phone = kept }
        }
        .onChange(of: pickedId) { _, now in
            if (now ?? "").isEmpty { settled = nil }
        }
        .animation(.snappy(duration: 0.22), value: focus)
        .animation(.snappy(duration: 0.22), value: name)
    }

    // MARK: Rows

    @ViewBuilder
    private var suggestions: some View {
        if typed.isEmpty {
            Button {
                pick(nil)
                focus = nil
            } label: {
                Label("Walk-in", systemImage: "figure.walk").foregroundStyle(.secondary)
            }
            ForEach(recent().prefix(4), id: \.id) { c in
                hitRow(CustomerSearch.Hit(customer: c, match: nil, byPhone: false), note: "Recent")
            }
        } else {
            ForEach(nameHits, id: \.customer.id) { hit in
                hitRow(hit, note: nil)
            }
            if CustomerSearch.exact(typed, in: book).isEmpty {
                Label {
                    Text("New customer “\(typed)”").foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "person.badge.plus").foregroundStyle(Theme.accent)
                }
                .font(.subheadline)
            }
        }
    }

    private func hitRow(_ hit: CustomerSearch.Hit, note: String?) -> some View {
        Button {
            settled = hit.customer.id
            focus = nil
            pick(hit.customer)
        } label: {
            HStack(spacing: 12) {
                Initials(name: hit.customer.name)
                VStack(alignment: .leading, spacing: 1) {
                    Text(marked(hit)).lineLimit(1)
                    let sub = [hit.customer.phone ?? "", hit.customer.city ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
                    if !sub.isEmpty || note != nil {
                        Text([note ?? "", sub].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.left").font(.caption).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func pickedRow(_ c: Customer) -> some View {
        HStack(spacing: 12) {
            Initials(name: c.name, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(.headline).lineLimit(1)
                let sub = [phone.isEmpty ? (c.phone ?? "") : phone, c.city ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
                Label(sub.isEmpty ? "On file" : sub, systemImage: "checkmark.seal.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Change") {
                settled = nil
                type("")
                phone = ""
                focus = .name
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
        }
        .padding(.vertical, 2)
    }

    /// The typed letters marked in the name.
    private func marked(_ hit: CustomerSearch.Hit) -> AttributedString {
        var s = AttributedString(hit.customer.name)
        if let r = hit.match, let ar = Range(r, in: s) {
            s[ar].font = .body.weight(.semibold)
            s[ar].foregroundColor = Theme.accent
        }
        return s
    }

    /// The last people served, newest first: the invoices' and orders' customers, once each, still in the book.
    static func recent(invoices: [Invoice], orders: [Order], book: [Customer], count: Int = 4) -> [Customer] {
        let byId = Dictionary(CustomerSearch.people(book).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let stamped = invoices.compactMap { i in i.customerId.map { ($0, i.createdAt) } }
            + orders.compactMap { o in o.customerId.map { ($0, o.createdAt) } }
        var seen = Set<String>()
        var out: [Customer] = []
        for (id, _) in stamped.sorted(by: { $0.1 > $1.1 }) {
            guard out.count < count, !seen.contains(id), let c = byId[id] else { continue }
            seen.insert(id)
            out.append(c)
        }
        return out
    }
}

/// A person's initials in a small circle of the house's colour, as Contacts and Messages show people.
struct Initials: View {
    let name: String
    var size: CGFloat = 30

    private var letters: String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
        return s.isEmpty ? "?" : s
    }

    var body: some View {
        Text(letters)
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .foregroundStyle(Theme.accent)
            .frame(width: size, height: size)
            .background(Theme.accent.opacity(0.16), in: .circle)
            .accessibilityHidden(true)
    }
}
