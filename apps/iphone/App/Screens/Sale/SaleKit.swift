import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

// The small pieces New sale, the edit sheet and Scan a tag share.

/// A label with a number typed at its right edge. Zero is blank, as the sale's fields show it
/// (decisions.md "Number fields"). A sum of money (`rupees`) takes the number pad and whole rupees only
/// (owner, 2026-10-17: "there should be no decimals"); weights, rates and percentages keep their decimals.
struct SaleNumberField: View {
    let label: String
    @Binding var text: String
    var prompt = "0"
    var decimal = true
    var rupees = false

    var body: some View {
        LabeledContent(label) {
            TextField(prompt, text: rupees ? $text.wholeRupees : $text)
                .keyboardType(decimal && !rupees ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }
}

enum SaleKeyboard {
    /// Puts the number pad away (it has no Return key).
    static func dismiss() {
        _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

/// Where the sale links to.
enum SaleLinks {
    static let newSale = Route(path: "/invoices/new")
    /// The sale in progress: a piece was put on it (SaleDraftStore.add), so the sale opens on it rather than blank.
    static let continueSale = Route(path: "/invoices/new?resume=1")
    /// The ERP's own pages, for what the phone does not do: reading a written bill (the AI scanner), and
    /// putting a new piece in stock ("New piece"). Editing an invoice is its `/edit` page.
    /// New sale with the AI bill reader open over it (SaleScanScreen).
    static let readBill = Route(path: "/invoices/new?scan=bill")
    static let newPiece = Route(path: "/products/add")

    /// A piece's page, which is the ERP's (`/products/<sku>`).
    static func piece(_ sku: String) -> Route {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return Route(path: "/products/" + (sku.addingPercentEncoding(withAllowedCharacters: allowed) ?? sku))
    }

    static func invoice(_ id: String) -> Route {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return Route(path: "/invoices/" + (id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id))
    }
}

/// "yyyy-MM-dd", the form the ERP keeps a delivery's expected date in.
enum SaleDates {
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = ERPDate.pickerCalendar
        f.timeZone = ERPDate.pickerCalendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ d: Date) -> String { day.string(from: d) }
    static func date(_ s: String) -> Date? { s.isEmpty ? nil : day.date(from: s) }
}

/// New sale's Scan: the camera stays open so several tags can be read one after another, and says
/// what became of the last one.
struct SaleScanSheet: View {
    /// Takes the code, does what it does to the sale, and answers in a sentence and whether a piece went on.
    let handle: (String) -> (said: String, added: Bool)

    @Environment(\.dismiss) private var dismiss
    @State private var said = ""
    /// A piece put on the sale is a success; a tag with nothing to add is a warning.
    @State private var added = 0
    @State private var missed = 0

    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0

    private var wide: Bool { sizeClass.isPadLayout && width >= 700 }

    private var camera: some View {
        TagScanner(height: wide ? 520 : 300) { code in
            let result = handle(code)
            said = result.said
            if result.added { added += 1 } else { missed += 1 }
        }
    }

    @ViewBuilder
    private var saidCard: some View {
        if !said.isEmpty {
            #if os(macOS)
            // What the last tag did, in plain words under the scanner: no card.
            Text(said)
                .font(.callout.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
            #else
            Text(said)
                .font(.subheadline.weight(.medium))
                .ledgerCard(padding: 14)
            #endif
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if wide {
                    // Landscape on an iPad: the camera large, what the last tag did at its side.
                    HStack(alignment: .top, spacing: pt(20)) {
                        camera.frame(maxWidth: .infinity)
                        saidCard.frame(width: 300)
                    }
                    .padding(pt(20))
                } else {
                    VStack(spacing: pt(16)) {
                        camera
                        saidCard
                    }
                    .padding(pt(16))
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .navigationTitle("Scan a tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
            .sensoryFeedback(.success, trigger: added)
            .sensoryFeedback(.warning, trigger: missed)
        }
        #if os(macOS)
        // A Mac sheet the scanner's box and its answer fit in.
        .frame(minWidth: 640, idealWidth: 720, minHeight: 440)
        #endif
    }
}
