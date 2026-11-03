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

/// What the shop calls the device in its hand in a sentence ("kept on this phone", "kept on this Mac").
enum OrderDevice {
    static var word: String {
        #if os(macOS)
        return "Mac"
        #else
        return "phone"
        #endif
    }
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
            HStack(spacing: pt(4)) {
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
            HStack(spacing: pt(6)) {
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

// MARK: Keystrokes

/// A section that is drawn again only when what it reads changes (`key`), not at every key typed in another field. The
/// content still writes through the bindings it captured. Use as `Sliced(key) { … }.equatable()`.
struct Sliced<Key: Equatable, Content: View>: View, Equatable {
    let key: Key
    let content: () -> Content

    init(_ key: Key, @ViewBuilder content: @escaping () -> Content) {
        self.key = key
        self.content = content
    }

    static func == (lhs: Sliced<Key, Content>, rhs: Sliced<Key, Content>) -> Bool { lhs.key == rhs.key }

    var body: some View { content() }
}

/// A text box that keeps what is typed in its own state and hands it to the form about 250 ms after the last key (at
/// once on Return, when focus leaves, and when the box goes away), so the form does not redraw at every key. A change
/// made from outside (a suggestion tapped) replaces what is typed.
struct DebouncedTextField: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var lines: ClosedRange<Int> = 1...1

    @State private var typed = ""
    @State private var started = false
    @State private var pending: Task<Void, Never>?
    @FocusState private var focused: Bool

    var body: some View {
        TextField(title, text: $typed, prompt: Text(prompt), axis: .vertical)
            .lineLimit(lines)
            .focused($focused)
            .onAppear {
                typed = text
                started = true
            }
            .onChange(of: typed) { _, now in
                guard started, now != text else { return }
                pending?.cancel()
                pending = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    if !Task.isCancelled { commit() }
                }
            }
            .onChange(of: text) { _, now in
                // The form changed it (a chip, a pick): what is shown follows, and nothing typed is left waiting.
                if now != typed {
                    pending?.cancel()
                    typed = now
                }
            }
            .onChange(of: focused) { _, now in if !now { commit() } }
            .onSubmit { commit() }
            .onDisappear { commit() }
    }

    private func commit() {
        pending?.cancel()
        if text != typed { text = typed }
    }
}
