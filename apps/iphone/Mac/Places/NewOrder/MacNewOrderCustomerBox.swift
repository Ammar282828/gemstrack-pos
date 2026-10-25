#if os(macOS)
import SwiftUI
import ERPCore

// Who a document is for, the Mac's way (docs/features/mac-design.md, "New order"): the name is a combo box, so the book is
// offered in its drop-down list as the name is typed and never as rows in the form; the phone sits beneath it. The book, the
// search and the rules are the phone's CustomerField (App/UI/CustomerField.swift): a pick fills the name, the customer and
// their number; typing lets go of a pick; a number typed finds its customer. New order and New repair both use it.

struct MacNewOrderCustomerBox: View {
    /// The name as typed, or the picked customer's.
    let name: String
    /// The customer on file, when one was picked.
    let pickedId: String?
    @Binding var phone: String
    /// The whole book; removed customers and old walk-in records are left out by the search.
    let book: [Customer]
    /// The last few people served, offered before anything is typed.
    var recent: () -> [Customer] = { [] }
    /// Changes whenever what `recent` reads has changed (the shelves' revisions), so the books are walked once per change.
    var recentKey: [Int] = []
    /// Typing lets go of a picked customer.
    let type: (String) -> Void
    /// A pick from the book; nil is the walk-in.
    let pick: (Customer?) -> Void

    @FocusState private var phoneFocused: Bool
    @State private var offered = Memo<[Customer]>()

    private var typed: String { name.trimmingCharacters(in: .whitespaces) }

    private var picked: Customer? {
        guard let id = pickedId, !id.isEmpty else { return nil }
        return book.first { $0.id == id }
    }

    /// What the drop-down offers: the last people served while nothing is typed, then the best matches for what is.
    private func hits() -> [Customer] {
        let key: [Int] = [typed.hashValue] + recentKey
        return offered(key) { () -> [Customer] in
            if typed.isEmpty { return Array(recent().prefix(6)) }
            return CustomerSearch.rank(typed, in: book, limit: 8).map { $0.customer }
        }
    }

    private func label(_ c: Customer) -> String {
        let number = (c.phone ?? "").trimmingCharacters(in: .whitespaces)
        return number.isEmpty ? c.name : c.name + " \u{00B7} " + number
    }

    /// A number being typed with no name picked: who it already belongs to.
    private var phoneHits: [CustomerSearch.Hit] {
        guard phoneFocused, picked == nil, CustomerSearch.digitsTyped(phone).count >= 4 else { return [] }
        return CustomerSearch.rank(phone, in: book, limit: 3)
    }

    var body: some View {
        let list = hits()
        Group {
            LabeledContent("Customer") {
                MacComboBox(placeholder: "Search or type a new name", text: nameBinding(list), items: list.map { label($0) }, pick: { i in
                    if i >= 0 && i < list.count { pick(list[i]) }
                })
                .frame(minWidth: 150, maxWidth: .infinity)
                .frame(height: 24)
            }
            note
            LabeledContent("Phone") {
                TextField("Phone", text: $phone, prompt: Text("Optional"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .focused($phoneFocused)
            }
            ForEach(phoneHits, id: \.customer.id) { hit in
                Button { pick(hit.customer) } label: {
                    Label("\(hit.customer.name) has this number", systemImage: "person.crop.circle.badge.checkmark")
                }
                .buttonStyle(.link)
            }
        }
        // The number kept as the ERP keeps it (+92...), as the web's phone box does, once the counter moves on.
        .onChange(of: phoneFocused) { old, new in
            guard old, !new else { return }
            let kept = pakistanE164(phone)
            if kept != phone { phone = kept }
        }
    }

    /// Typing is a name; the whole of a line the list offered is that customer.
    private func nameBinding(_ list: [Customer]) -> Binding<String> {
        Binding(
            get: { name },
            set: { text in
                if let hit = list.first(where: { label($0) == text }) {
                    pick(hit)
                } else {
                    type(text)
                }
            }
        )
    }

    /// Under the name: who is picked, or that a new customer will be made.
    @ViewBuilder
    private var note: some View {
        if let c = picked {
            let sub = [c.phone ?? "", c.city ?? ""].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
            Label(sub.isEmpty ? "On file" : "On file \u{00B7} " + sub, systemImage: "checkmark.seal.fill")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else if !typed.isEmpty && CustomerSearch.exact(typed, in: book).isEmpty {
            Label("New customer \u{201C}\(typed)\u{201D}", systemImage: "person.badge.plus")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}
#endif
