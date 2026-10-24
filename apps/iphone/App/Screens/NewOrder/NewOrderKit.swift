import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

// Three small controls the order form's views share, and the size box.

// MARK: Wide windows

/// A form column no wider than `maxWidth` on an iPad's wide window, centred in the room it is given (the editor side of
/// TransactionWorkspace, a pushed piece page). The margin goes into the safe area so a Form keeps scrolling edge to edge;
/// a phone and a compact iPad window are never touched.
private struct FormColumn: ViewModifier {
    var maxWidth: CGFloat
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        Group {
            if sizeClass.isPadLayout {
                content.safeAreaPadding(.horizontal, max(0, ((width - maxWidth) / 2).rounded()))
            } else {
                content
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    func formColumn(_ maxWidth: CGFloat = 680) -> some View { modifier(FormColumn(maxWidth: maxWidth)) }
}

// MARK: Controls

/// A quick choice (7d, 10d, 14d): a bordered chip (glass stays off list rows), the selected one prominent.
struct NewOrderChip: View {
    let title: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        if on {
            Button(title, action: action).buttonStyle(.borderedProminent)
        } else {
            Button(title, action: action).buttonStyle(.bordered)
        }
    }
}

/// A labelled number box: blank for 0, the decimal pad, figures lined up on the right. A sum of money
/// (`rupees`) takes the number pad and whole rupees only (owner, 2026-10-17: "there should be no decimals");
/// weights, rates and percentages keep their decimals.
struct NewOrderNumberRow: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var unit: String?
    var rupees = false

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField(title, text: rupees ? $text.wholeRupees : $text, prompt: Text(prompt))
                    .keyboardType(rupees ? .numberPad : .decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                if let unit {
                    Text(unit).foregroundStyle(.secondary)
                }
            }
        }
    }
}

extension View {
    /// Kept only until Stock's forms (outside this group) move to `keyboardDone()`; it is the kit's Done.
    func newOrderKeyboardDone() -> some View { keyboardDone() }
}

/// One size box: type it (an off-scale size is allowed), or pick from the scale.
struct NewOrderSizeField: View {
    let title: String
    let options: [String]
    @Binding var value: String

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField("Size", text: $value, prompt: Text("Optional"))
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                Menu {
                    Button("No size") { value = "" }
                    ForEach(options, id: \.self) { option in
                        Button(option) { value = option }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down").font(.footnote)
                }
            }
        }
    }
}
