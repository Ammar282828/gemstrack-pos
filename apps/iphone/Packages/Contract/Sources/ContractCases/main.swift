import Foundation
import ERPCore

/// One case: what the phone shows (`shown`) and what it sends (`send`), for one house.
struct ContractCase {
    let name: String
    let house: String
    /// The op's fields exactly as the screen passes them to `ERPAPI.write`.
    let send: [String: Any]
    /// The figures the screen showed before Save.
    let shown: [String: Double]
    /// The shop's settings the screen priced with (the server reads none: it prices from what is sent).
    let settings: [String: Any]
    /// Stock the sale's pieces come from, keyed by SKU, as the server must find them.
    var stock: [String: [String: Any]] = [:]
    /// The customers on the books the screen chose from.
    var customers: [[String: Any]] = []

    var json: [String: Any] {
        ["name": name, "house": house, "send": send, "shown": shown, "settings": settings, "stock": stock, "customers": customers]
    }
}

/// Builds a model from a Firestore-shaped dictionary, as the shelves do.
func decode<T: Decodable>(_ type: T.Type, _ id: String, _ data: [String: Any]) -> T {
    guard let v = DocJSON.decode(T.self, id: id, data: data) else { fatalError("could not decode \(T.self) \(id)") }
    return v
}

func run(_ house: String, _ make: () -> [ContractCase]) -> [[String: Any]] {
    House.id = house
    return make().map(\.json)
}

let out: [String: Any] = [
    "orders": run("taheri", OrderCases.taheri) + run("mina", OrderCases.mina),
    "sales": run("taheri", SaleCases.taheri) + run("mina", SaleCases.mina),
]
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
