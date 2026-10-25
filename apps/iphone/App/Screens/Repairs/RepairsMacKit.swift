#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Repairs (docs/features/mac-design.md, "Repairs"): the place, a ticket's inspector and window, and the new-repair
// document are in Mac/Places/Repairs/ (MacRepairsPlace, MacRepairsTicket, MacRepairsModel); the form is RepairsForm's Mac body.

/// "/repairs?id=REP-000012": a ticket's own address (its window, its receipt).
func repairsTicketPath(_ id: String) -> String {
    "/repairs?id=" + (id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+#"))) ?? id)
}
#endif
