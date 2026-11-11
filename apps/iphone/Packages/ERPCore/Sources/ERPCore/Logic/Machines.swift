// The state machines as the server exports them (src/lib/machines/export.ts -> App/Resources/machines.json). The apps mirror the
// labels, tones and moves instead of re-deciding them: the server checks every move in the write's transaction and answers 409
// with what is allowed, so a screen offers only what it will accept. Lenient like every model: an odd file gives fewer machines,
// never a throw, and a missing machine or state answers nil so the caller keeps its own table.

import Foundation

public struct MachineMove: Equatable, Sendable {
    /// The states this move starts from; `anyFrom` is the file's "*".
    public let from: [String]
    public let anyFrom: Bool
    public let to: String
    public let event: String
    public let when: String?
    public let note: String?

    public init(from: [String], anyFrom: Bool = false, to: String, event: String, when: String? = nil, note: String? = nil) {
        self.from = from
        self.anyFrom = anyFrom
        self.to = to
        self.event = event
        self.when = when
        self.note = note
    }

    public func starts(at state: String) -> Bool { anyFrom || from.contains(state) }
}

extension MachineMove: Decodable {
    private enum Keys: String, CodingKey { case from, to, event, when, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        // `from` is "*" (any state) or a list of states.
        if let word = try? c.decode(String.self, forKey: .from) {
            self.anyFrom = word == "*"
            self.from = word == "*" ? [] : [word]
        } else {
            self.anyFrom = false
            self.from = c.strings(.from)
        }
        self.to = c.string(.to, default: "")
        self.event = c.string(.event, default: "")
        self.when = c.string(.when)
        self.note = c.string(.note)
    }
}

public struct Machine: Equatable, Sendable {
    public let name: String
    public let field: String
    public let states: [String]
    public let finals: [String]
    public let labels: [String: String]
    public let tones: [String: String]
    public let moves: [MachineMove]

    public init(name: String, field: String = "", states: [String], finals: [String] = [], labels: [String: String] = [:],
                tones: [String: String] = [:], moves: [MachineMove]) {
        self.name = name
        self.field = field
        self.states = states
        self.finals = finals
        self.labels = labels
        self.tones = tones
        self.moves = moves
    }
}

extension Machine: Decodable {
    private enum Keys: String, CodingKey { case name, field, states, finals = "final", labels, tones, moves }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.name = c.string(.name, default: "")
        self.field = c.string(.field, default: "")
        self.states = c.strings(.states)
        self.finals = c.strings(.finals)
        self.labels = (try? c.decodeIfPresent([String: String].self, forKey: .labels)) ?? [:]
        self.tones = (try? c.decodeIfPresent([String: String].self, forKey: .tones)) ?? [:]
        self.moves = c.list(.moves, of: MachineMove.self)
    }
}

/// The whole file. `Machines.shared` is the app's copy, read once from the bundle; empty when the file is missing.
public struct Machines: Equatable, Sendable {
    public let version: Int
    public let machines: [Machine]

    public init(version: Int = 1, machines: [Machine]) {
        self.version = version
        self.machines = machines
    }

    /// Reads the file's bytes; nil when it is not the file.
    public static func decode(_ data: Data) -> Machines? {
        guard let m = try? JSONDecoder().decode(Machines.self, from: data) else { return nil }
        return m
    }

    /// `machines.json` from the bundle (the app ships it in Resources); empty when it is missing, so nothing changes.
    public static func load(bundle: Bundle = .main) -> Machines {
        guard let url = bundle.url(forResource: "machines", withExtension: "json"),
              let data = try? Data(contentsOf: url), let m = decode(data) else {
            return Machines(machines: [])
        }
        return m
    }

    public static let shared: Machines = Machines.load()

    public func machine(_ name: String) -> Machine? { machines.first { $0.name == name } }

    public var isEmpty: Bool { machines.isEmpty }

    public func has(_ name: String) -> Bool { machine(name) != nil }

    /// The state's words (`labels`); nil where the machine or state is unknown, so the caller keeps its own.
    public func label(_ name: String, _ state: String) -> String? {
        machine(name)?.labels[state]
    }

    /// The state's tone word ("owed", "working", "settled", "quiet", "late", "credit", "problem"); nil where unknown.
    public func tone(_ name: String, _ state: String) -> String? {
        machine(name)?.tones[state]
    }

    /// The moves out of `state`, optionally one event only (`"set"` is a person choosing the status). Empty where the
    /// machine is unknown: use `has(_:)` to tell "no moves" from "no file".
    public func movesFrom(_ name: String, _ state: String, event: String? = nil) -> [MachineMove] {
        guard let m = machine(name) else { return [] }
        return m.moves.filter { $0.starts(at: state) && (event == nil || $0.event == event) }
    }

    /// The states a person may choose from `state` (event "set"), in the machine's own order, de-duplicated. nil when
    /// the machine is unknown, so the caller keeps its own list.
    public func settable(_ name: String, from state: String) -> [String]? {
        guard let m = machine(name) else { return nil }
        let targets = Set(movesFrom(name, state, event: "set").map { $0.to })
        return m.states.filter { targets.contains($0) }
    }
}

extension Machines {
    /// What the old status menu offered when there is no file: never a bare "Refunded" (the server refuses it too).
    public static let fallbackOrderChoices = ["Pending", "In Progress", "Completed", "Cancelled"]

    /// What an order's status menu offers: the moves a person may make (`set`) from its status, plus its own, and never
    /// "Refunded" (Refund order is the only way there). An invoiced order is read-only: the server refuses any `set` on it
    /// (guard "not invoiced"), so it offers only the status it has. No file: the old list.
    public func orderStatusChoices(current: String, invoiced: Bool) -> [String] {
        if invoiced { return current.isEmpty ? [] : [current] }
        // A status the machine does not know (an old record) keeps the old list, so it can still be set right.
        let known = machine("Order")?.states.contains(current) ?? false
        var out = known ? (settable("Order", from: current) ?? Machines.fallbackOrderChoices) : Machines.fallbackOrderChoices
        out = out.filter { $0 != "Refunded" }
        if !current.isEmpty && !out.contains(current) { out.append(current) }
        return out
    }

    /// Whether a person may set an order from `current` to `to` (the menu's rule, for a single action).
    public func canSetOrder(from current: String, to: String, invoiced: Bool) -> Bool {
        orderStatusChoices(current: current, invoiced: invoiced).contains(to) && to != current
    }

    /// Whether a repair may be set from `current` to `to` by a person. No file: yes (the screens' own rules still hold).
    /// "Collected" also needs nothing owed; that check stays with the screen (`repairBalance`).
    public func canSetRepair(from current: String, to: String) -> Bool {
        guard let allowed = settable("Repair", from: current) else { return true }
        return allowed.contains(to)
    }
}

extension Machines: Decodable {
    private enum Keys: String, CodingKey { case version, machines }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.version = c.int(.version) ?? 1
        self.machines = c.list(.machines, of: Machine.self)
    }
}

/// A write the server refused as a move its machine does not allow: HTTP 409 with
/// `{ error, machine, from, to, allowed: [{ to, event }] }` (src/lib/machines/machine.ts `MoveRefused`).
public enum MachineRefusal {
    /// The server's own words, with the statuses a person could choose instead (event "set", in the state's words) when it
    /// names them. nil where the body is not a refusal with an `error`, so the caller says what it said before.
    public static func message(_ body: [String: Any], machines: Machines = Machines.shared) -> String? {
        guard let said = body["error"] as? String, !said.isEmpty else { return nil }
        guard let name = body["machine"] as? String, let allowed = body["allowed"] as? [[String: Any]] else { return said }
        var words: [String] = []
        for move in allowed {
            guard (move["event"] as? String) == "set", let to = move["to"] as? String else { continue }
            let word = machines.label(name, to) ?? to
            if !words.contains(word) { words.append(word) }
        }
        if words.isEmpty { return said }
        return said + " It can be set to " + words.joined(separator: ", ") + " instead."
    }
}
