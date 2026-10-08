// Ported from src/lib/walk-in.ts (tests: WalkInTests, from walk-in.test.ts).
//
// A walk-in: a sale to nobody in particular. No customer picked, no name typed, no number.
//
// It is not a customer. Until 2026-09-29 the cart sent "Walk-in Customer" as the name and
// generateInvoice made a customer of any name it was given without an id, so every walk-in
// sale added a "Walk-in Customer" to the book (17 in Taheri's by then). The usual shape: the
// counter billed first, took the money, then edited the invoice to put the real name on it,
// which re-saved it against a new customer and left the walk-in one pointing at nothing.
//
// Now a walk-in invoice carries no customerId and "Walk-in Customer" as its name; a balance
// it leaves goes to the hisaab under the fixed entity 'walk-in'. A typed name or number is a
// real person and still becomes a customer, unless the number is already on file.

import Foundation

public let WALK_IN_NAME = "Walk-in Customer"
/// The hisaab entityId for a balance nobody's name is on; also what Analytics keys them by.
public let WALK_IN_ENTITY = "walk-in"

/// "Walk-in Customer", "walk in", "Walkin"… but not "Walk-in Customer - 0300…", a real number.
/// (The TS is the pattern `^walk[\s-]*in(?:[\s-]+customer)?$`, case-insensitive, on the trimmed name.)
public func isWalkInName(_ name: String?) -> Bool {
    let text = JS.trim(name ?? "").lowercased()
    guard text.hasPrefix("walk") else { return false }
    let separator: (Character) -> Bool = { $0 == "-" || JS.isSpace($0) }
    var rest = Substring(text.dropFirst(4)).drop(while: separator)
    guard rest.hasPrefix("in") else { return false }
    rest = rest.dropFirst(2)
    if rest.isEmpty { return true }
    // " customer" needs at least one separator before it.
    guard let first = rest.first, separator(first) else { return false }
    return rest.drop(while: separator) == "customer"
}

/// The last ten digits, so 0300…, +92300… and 92300… are the same number; "" for too few.
public func phoneKey(_ phone: String?) -> String {
    let digits = (phone ?? "").filter { $0 >= "0" && $0 <= "9" }
    return digits.count >= 7 ? String(digits.suffix(10)) : ""
}

private func nameKey(_ name: String?) -> String {
    JS.trim(name ?? "").split(whereSeparator: JS.isSpace).joined(separator: " ").lowercased()
}

public struct SaleCustomer: Equatable {
    /// Set when the sale goes to someone already in the book.
    public let id: String?
    public let name: String
    public let phone: String
    /// A person not yet in the book: generateInvoice adds them. Never true for a walk-in.
    public let isNew: Bool

    public init(id: String? = nil, name: String, phone: String, isNew: Bool) {
        self.id = id
        self.name = name
        self.phone = phone
        self.isNew = isNew
    }
}

/// Who a sale in the cart is for. (The TS lists the book as `{id, name, phone?}`; `Customer` has all three.)
///
/// - A customer picked from the list is that customer (their number, or the one typed if they
///   have none). A picked "Walk-in Customer" left over from before is not a person: it is read
///   as a walk-in, so re-saving one of those invoices lets go of it.
/// - Otherwise a typed number already on file is that customer, when no name was typed or the
///   name typed is theirs. Typing rather than tapping the suggestion no longer makes a second
///   copy of somebody (House of Mina's book has one number under 23 "Nilofar"s). A number that
///   belongs to someone of another name is left alone: two people can share a phone.
/// - A typed name, or a number nobody has, is a new customer; a number alone is named
///   "Walk-in Customer - <number>", as before.
/// - Nothing typed, or only the placeholder (an edited walk-in invoice puts "Walk-in Customer"
///   back in the name box): a walk-in, and no customer is made.
public func resolveSaleCustomer(
    selectedId: String? = nil,
    typedName: String? = nil,
    typedPhone: String? = nil,
    customers: [Customer]
) -> SaleCustomer {
    let typedPhone = JS.trim(typedPhone ?? "")
    let typedName = isWalkInName(typedName) ? "" : JS.trim(typedName ?? "")

    let selected = JS.has(selectedId) ? selectedId : nil
    let picked = selected.flatMap { id in customers.first { $0.id == id } }
    if let selected, picked == nil {
        // Not in the list this device holds (just added elsewhere, or removed): keep the id and
        // let generateInvoice read the record, as it always has.
        return SaleCustomer(id: selected, name: typedName, phone: typedPhone, isNew: false)
    }
    if let picked, !isWalkInName(picked.name) {
        return SaleCustomer(id: picked.id, name: picked.name, phone: JS.has(picked.phone) ? picked.phone! : typedPhone, isNew: false)
    }

    let key = phoneKey(typedPhone)
    if !key.isEmpty {
        let sameNumber = customers
            .filter { !isWalkInName($0.name) && phoneKey($0.phone) == key }
            .jsSorted { Double(JS.localeCompare($0.id, $1.id)) }
        let names = Set(sameNumber.map { nameKey($0.name) })
        let match: Customer?
        if !typedName.isEmpty {
            match = sameNumber.first { nameKey($0.name) == nameKey(typedName) }
        } else {
            match = names.count == 1 ? sameNumber.first : nil
        }
        if let match {
            return SaleCustomer(id: match.id, name: match.name, phone: JS.has(match.phone) ? match.phone! : typedPhone, isNew: false)
        }
    }

    if !typedName.isEmpty { return SaleCustomer(name: typedName, phone: typedPhone, isNew: true) }
    if !typedPhone.isEmpty { return SaleCustomer(name: "\(WALK_IN_NAME) - \(typedPhone)", phone: typedPhone, isNew: true) }
    return SaleCustomer(name: WALK_IN_NAME, phone: "", isNew: false)
}

/// generateInvoice's side of it: make a customer only for a person, never for the placeholder.
public func shouldCreateCustomer(id: String? = nil, name: String? = nil) -> Bool {
    !JS.has(id) && !JS.trim(name ?? "").isEmpty && !isWalkInName(name)
}

public func shouldCreateCustomer(_ info: SaleCustomer) -> Bool {
    shouldCreateCustomer(id: info.id, name: info.name)
}

/// Who a sale is credited to in Analytics: its customer, else the name it was written for,
/// else nobody. Every walk-in is the one row, however it was recorded: no id, the
/// placeholder name, or (from before 2026-09-29) a customer of its own still named
/// "Walk-in Customer". `currentName` is the book's name for an id, so one of those renamed
/// since to a real person counts as that person.
public func saleCustomerKey(
    customerId: String? = nil,
    customerName: String? = nil,
    currentName: ((String) -> String?)? = nil
) -> String {
    let id = JS.has(customerId) && customerId != WALK_IN_ENTITY ? customerId! : ""
    if !id.isEmpty { return isWalkInName(currentName?(id) ?? customerName) ? WALK_IN_ENTITY : id }
    let name = JS.trim(customerName ?? "")
    return !name.isEmpty && !isWalkInName(name) ? "name:\(name)" : WALK_IN_ENTITY
}

public func saleCustomerKey(_ invoice: Invoice, currentName: ((String) -> String?)? = nil) -> String {
    saleCustomerKey(customerId: invoice.customerId, customerName: invoice.customerName, currentName: currentName)
}

public func saleCustomerKey(_ order: Order, currentName: ((String) -> String?)? = nil) -> String {
    saleCustomerKey(customerId: order.customerId, customerName: order.customerName, currentName: currentName)
}
