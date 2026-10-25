#if os(macOS)
import SwiftUI
import Observation

// What the Website places share on the Mac (docs/features/mac-design.md, "Marketing › Website"): a piece as a table row, and the
// line between Edit a piece's table and the inspector's form, so ⌘S and the toolbar can save what the inspector holds.

/// One piece of Edit a piece as a table row: Name, Collection, Weight and Status (Hidden, New photo, Words changed…).
struct MacWebsitePieceRow: Identifiable {
    let piece: WebsiteEditPiece
    var id: String { piece.id }
    var name: String { piece.words.name.isEmpty ? "A piece" : piece.words.name }
    var collection: String { piece.collection }
    var weight: Double { piece.weightGrams ?? 0 }
    var weightText: String { piece.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) + " g" } ?? "" }

    /// What was changed here, in words; hidden says the most.
    var status: String {
        if piece.hidden { return "Hidden" }
        var parts: [String] = []
        if piece.photoEdited { parts.append("New photo") }
        if piece.wordsChanged { parts.append("Words changed") }
        if piece.change?.weightGrams != nil { parts.append("Weight") }
        return parts.joined(separator: " · ")
    }

    var tone: Tone { piece.hidden ? .quiet : .working }
    /// Hidden first, then what was changed here, then the pieces as the site built them.
    var rank: Int { piece.hidden ? 0 : (piece.changed ? 1 : 2) }
}

/// Edit a piece's table and its inspector's form meet here. The form tells the table whether it holds a change worth saving and
/// how to save it; the table's Save to the Website (⌘S) and its guard against leaving a piece with unsaved words ask it.
@MainActor @Observable
final class MacWebsiteEditBridge {
    /// The piece whose form has registered (a form that goes away only clears what it registered itself).
    var owner = ""
    var canSave = false
    var dirty = false
    var save: (() -> Void)?

    func clear(_ id: String) {
        guard owner == id else { return }
        owner = ""
        canSave = false
        dirty = false
        save = nil
    }
}
#endif
