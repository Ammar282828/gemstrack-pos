import Foundation
import ERPCore

/// Stand-in for App/Config/House.swift: only what the New order and New sale logic reads, switchable so
/// one run writes both houses' cases.
enum House {
    static var id = "taheri"
    static var metal: String { id == "mina" ? "silver" : "gold" }
    static var margin: MarginSettings { id == "mina" ? .mina : .taheri }
}

/// Stand-in for Config/Business.swift's helper: the per-business settings key the stores use.
func BizKey(_ base: String, _ id: String? = nil) -> String { base + "." + (id ?? House.id) }

/// Stand-in for Data/WorkDraftSync.swift's pin: the business a write that outlives its screen belongs to.
enum BusinessSwitchPin {
    static func id(within window: TimeInterval = 2) -> String { House.id }
}
