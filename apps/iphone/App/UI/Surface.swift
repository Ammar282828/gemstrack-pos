import SwiftUI
import UIKit

// Rule 16's pieces (CONVENTIONS.md): what every screen does the same way, so no screen solves it on its own.
// The bottom bar, the failure and empty states, asking before a delete, the taps, the keyboard's Done.

// MARK: The one primary action

/// The bottom bar of a page or sheet whose job is one action (Save, Send, Take payment): a glass bar on the
/// control layer, the action prominent and full width, a line above it for what it will do (the balance).
/// Use it through `.actionBar(primary:secondary:summary:)`.
struct ActionBar: View {
    struct Action {
        var title: String
        var systemImage: String?
        var role: ButtonRole?
        var isBusy: Bool
        var isDisabled: Bool
        var action: () -> Void

        init(_ title: String, systemImage: String? = nil, role: ButtonRole? = nil,
             isBusy: Bool = false, isDisabled: Bool = false, action: @escaping () -> Void) {
            self.title = title
            self.systemImage = systemImage
            self.role = role
            self.isBusy = isBusy
            self.isDisabled = isDisabled
            self.action = action
        }
    }

    let primary: Action
    var secondary: [Action] = []
    var summary: String?

    var body: some View {
        VStack(spacing: 8) {
            if let summary, !summary.isEmpty {
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Two glass controls side by side share one container, so they blend and sample together.
            GlassEffectContainer(spacing: 10) {
                AdaptiveStack(spacing: 10, alignment: .center) {
                    ForEach(Array(secondary.enumerated()), id: \.offset) { _, item in
                        Button(role: item.role, action: item.action) { label(item, wide: false) }
                            .buttonStyle(.glass)
                            .controlSize(.large)
                            .disabled(item.isDisabled || item.isBusy || primary.isBusy)
                    }
                    // The width goes on the label: on the button the glass kept its own size and the
                    // action sat as a small pill in the middle of the bar.
                    Button(role: primary.role, action: primary.action) { label(primary, wide: true) }
                        .buttonStyle(.houseProminent)
                        .controlSize(.large)
                        .disabled(primary.isDisabled || primary.isBusy)
                }
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
        .motion(primary.isBusy)
    }

    private func label(_ item: Action, wide: Bool) -> some View {
        HStack(spacing: 8) {
            if item.isBusy {
                ProgressView()
            } else if let symbol = item.systemImage {
                Image(systemName: symbol).contentTransition(.symbolEffect(.replace))
            }
            Text(item.title)
        }
        .frame(maxWidth: wide ? .infinity : nil)
    }
}

extension View {
    /// The page's one primary action, pinned at the foot where it never scrolls away (rule 16).
    func actionBar(primary: ActionBar.Action, secondary: [ActionBar.Action] = [], summary: String? = nil) -> some View {
        safeAreaBar(edge: .bottom, spacing: 0) {
            ActionBar(primary: primary, secondary: secondary, summary: summary)
        }
    }
}

// MARK: Failed, empty, loading

/// A page that could not load: the ERP's words and a way to try again. Put it as an overlay of the page.
struct ErrorState: View {
    let message: String
    var retry: (() -> Void)?

    init(_ message: String, retry: (() -> Void)? = nil) {
        self.message = message
        self.retry = retry
    }

    var body: some View {
        ContentUnavailableView {
            Label("Couldn't load this", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            if let retry {
                Button("Try again", action: retry).buttonStyle(.bordered)
            }
        }
    }
}

/// Nothing here yet: the system's own empty state, as an overlay of the list (never a row inside it).
struct EmptyState: View {
    let title: String
    let symbol: String
    var message: String?
    var action: (title: String, run: () -> Void)?

    init(_ title: String, symbol: String, message: String? = nil, action: (title: String, run: () -> Void)? = nil) {
        self.title = title
        self.symbol = symbol
        self.message = message
        self.action = action
    }

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            if let message { Text(message) }
        } actions: {
            if let action {
                Button(action.title, action: action.run).buttonStyle(.bordered)
            }
        }
    }
}

/// Working on it, small: a list row's or an overlay's spinner with its words.
struct LoadingRow: View {
    let label: String
    init(_ label: String) { self.label = label }

    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text(label).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Asking first

extension View {
    /// Every delete, remove, sign out or clear asks first; confirming gives the warning tap.
    func confirmDestructive(isPresented: Binding<Bool>, title: String, message: String? = nil,
                            action: String, perform: @escaping () -> Void) -> some View {
        modifier(ConfirmDestructive(isPresented: isPresented, title: title, message: message,
                                    action: action, perform: perform))
    }
}

private struct ConfirmDestructive: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let message: String?
    let action: String
    let perform: () -> Void
    /// Bumped on the confirming tap only, so the warning is felt once per confirmed step.
    @State private var confirmed = 0

    func body(content: Content) -> some View {
        content
            .confirmationDialog(title, isPresented: $isPresented, titleVisibility: .visible) {
                Button(action, role: .destructive) {
                    confirmed += 1
                    perform()
                }
            } message: {
                if let message { Text(message) }
            }
            .destructiveFeedback(trigger: confirmed)
    }
}

// MARK: Feel

extension View {
    /// A save, tick, toggle or send went through: the success tap when `trigger` changes (on the event, never per keystroke).
    func savedFeedback<T: Equatable>(trigger: T) -> some View {
        sensoryFeedback(.success, trigger: trigger)
    }

    /// Something was refused: the error tap when `trigger` changes.
    func refusedFeedback<T: Equatable>(trigger: T) -> some View {
        sensoryFeedback(.error, trigger: trigger)
    }

    /// A filter, segment or step changed: the light selection tick.
    func selectionFeedback<T: Equatable>(trigger: T) -> some View {
        sensoryFeedback(.selection, trigger: trigger)
    }
}

// MARK: The keyboard's Done

private struct KeyboardDone: ViewModifier {
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
    /// The number pad has no Return key: a Done above the keyboard.
    func keyboardDone() -> some View { modifier(KeyboardDone()) }
}

// MARK: Label and value

/// Side by side at ordinary sizes, stacked and left-aligned at accessibility sizes.
struct AdaptiveStack<Content: View>: View {
    var spacing: CGFloat = 12
    var alignment: VerticalAlignment = .firstTextBaseline
    @ViewBuilder let content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: alignment, spacing: spacing))
        layout { content() }
    }
}

extension View {
    /// A person's name: Roman-Urdu spellings ("Hamza", "Tayyab") are not for autocorrect to rewrite, and the name
    /// keys the hisaab, the invoice and the WhatsApp copy.
    func personName() -> some View {
        autocorrectionDisabled()
            .textInputAutocapitalization(.words)
            .textContentType(.name)
    }

    /// A phone number box.
    func phoneNumber() -> some View {
        keyboardType(.phonePad).textContentType(.telephoneNumber)
    }
}
