import SwiftUI
import UIKit
import ERPCore

// Three small controls the order form's views share, and the size box.

// MARK: Controls

/// A quick choice (7d, 10d, 14d): a glass chip, the selected one prominent.
struct NewOrderChip: View {
    let title: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        if on {
            Button(title, action: action).buttonStyle(.houseProminent)
        } else {
            Button(title, action: action).buttonStyle(.glass)
        }
    }
}

/// A labelled number box: blank for 0, the decimal pad, figures lined up on the right.
struct NewOrderNumberRow: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var unit: String?

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField(title, text: $text, prompt: Text(prompt))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                if let unit {
                    Text(unit).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// The decimal pad has no Return key, so every screen with number boxes carries a Done above the keyboard.
struct NewOrderKeyboardDone: ViewModifier {
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
            }
        }
    }
}

extension View {
    func newOrderKeyboardDone() -> some View { modifier(NewOrderKeyboardDone()) }
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
