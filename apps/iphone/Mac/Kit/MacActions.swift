#if os(macOS)
import SwiftUI

// An action declared once (docs/features/mac-design.md, rule 3): a record's menu in the menu bar, its toolbar buttons and
// its right-click menu are all drawn from the same `MacAction`s, so they never disagree about what can be done, what it is
// called or which key does it.

/// One thing that can be done to a record (or a list): its words, symbol, key, and what it does.
struct MacAction: Identifiable {
    let id: String
    var title: String
    var symbol: String?
    /// The key, shown and answered in the menu bar's record menu and the right-click menu; toolbar buttons show it in
    /// their help instead, so the key has one owner.
    var shortcut: KeyboardShortcut?
    var role: ButtonRole?
    var enabled: Bool
    /// The record's next step: the default button where actions are drawn as buttons (the inspector, a footer).
    var isDefault: Bool
    var perform: () -> Void

    init(_ title: String, symbol: String? = nil, shortcut: KeyboardShortcut? = nil, role: ButtonRole? = nil,
         enabled: Bool = true, isDefault: Bool = false, id: String? = nil, perform: @escaping () -> Void) {
        self.id = id ?? title
        self.title = title
        self.symbol = symbol
        self.shortcut = shortcut
        self.role = role
        self.enabled = enabled
        self.isDefault = isDefault
        self.perform = perform
    }

    /// "Take Payment (⌥⌘P)": a toolbar button's help names its key.
    var help: String {
        guard let shortcut else { return title }
        return "\(title) (\(MacAction.describe(shortcut)))"
    }

    static func describe(_ s: KeyboardShortcut) -> String {
        var out = ""
        if s.modifiers.contains(.control) { out += "⌃" }
        if s.modifiers.contains(.option) { out += "⌥" }
        if s.modifiers.contains(.shift) { out += "⇧" }
        if s.modifiers.contains(.command) { out += "⌘" }
        switch s.key {
        case .return: out += "↩"
        case .delete: out += "⌫"
        case .escape: out += "⎋"
        case .upArrow: out += "↑"
        case .downArrow: out += "↓"
        case .leftArrow: out += "←"
        case .rightArrow: out += "→"
        case .space: out += "Space"
        default: out += String(s.key.character).uppercased()
        }
        return out
    }
}

/// A menu item. In the menu bar it carries its key and dims when it cannot act; in a right-click menu (`context`) it has no
/// key (the menu bar owns it) and is left out when it cannot act, as a Finder context menu shows only what applies.
struct MacActionMenuItem: View {
    let action: MacAction
    var context: Bool = false
    var body: some View {
        if action.enabled || !context {
            Button(role: action.role, action: action.perform) {
                if let symbol = action.symbol { Label(action.title, systemImage: symbol) } else { Text(action.title) }
            }
            .keyboardShortcut(context ? nil : action.shortcut)
            .disabled(!action.enabled)
        }
    }
}

/// Groups of actions as menu items, a divider between groups: a record's menu in the menu bar (`context: false`, every
/// action, dimmed when it cannot act) and a right-click menu (`context: true`, the default: only the actions that apply,
/// at most three groups, the rest in one More submenu).
struct MacActionItems: View {
    let groups: [[MacAction]]
    var context: Bool = true
    /// The groups a right-click menu shows: the disabled left out, the empty groups dropped.
    private var applicable: [[MacAction]] {
        groups.map { (group: [MacAction]) -> [MacAction] in group.filter { (a: MacAction) -> Bool in a.enabled } }
            .filter { (group: [MacAction]) -> Bool in !group.isEmpty }
    }
    private var top: [[MacAction]] { context ? Array(applicable.prefix(3)) : groups }
    private var rest: [[MacAction]] { context ? Array(applicable.dropFirst(3)) : [] }
    var body: some View {
        ForEach(Array(top.enumerated()), id: \.offset) { i, group in
            if i > 0 { Divider() }
            ForEach(group) { MacActionMenuItem(action: $0, context: context) }
        }
        if !rest.isEmpty {
            Divider()
            Menu("More") {
                ForEach(Array(rest.enumerated()), id: \.offset) { i, group in
                    if i > 0 { Divider() }
                    ForEach(group) { MacActionMenuItem(action: $0, context: true) }
                }
            }
        }
    }
}

/// A toolbar button for an action: no key of its own (the menu bar answers it), the key named in the help.
struct MacToolbarAction: View {
    let action: MacAction
    var body: some View {
        Button(role: action.role, action: action.perform) {
            Label(action.title, systemImage: action.symbol ?? "circle")
        }
        .disabled(!action.enabled)
        .help(action.help)
    }
}

/// A row of push buttons for a record's main actions (the inspector's head, a record window's head); the default one
/// is prominent.
struct MacActionButtons: View {
    let actions: [MacAction]
    var body: some View {
        HStack(spacing: 8) {
            ForEach(actions) { a in
                if a.isDefault {
                    Button(role: a.role, action: a.perform) { Text(a.title) }
                        .buttonStyle(.borderedProminent)
                        .disabled(!a.enabled)
                        .help(a.help)
                } else {
                    Button(role: a.role, action: a.perform) { Text(a.title) }
                        .buttonStyle(.bordered)
                        .disabled(!a.enabled)
                        .help(a.help)
                }
            }
        }
        .controlSize(.regular)
    }
}

// MARK: - The record's menu in the menu bar

/// What the menu bar's record menu shows: its title ("Invoice", "Order", "Customer") and its groups of actions. The place
/// in front publishes it (`.macRecordMenu`), with its actions disabled while nothing is picked, as Mail's Message menu is.
struct MacRecordMenu {
    var title: String
    var groups: [[MacAction]]
}

private struct MacRecordMenuKey: FocusedValueKey { typealias Value = MacRecordMenu }

extension FocusedValues {
    var macRecordMenu: MacRecordMenu? {
        get { self[MacRecordMenuKey.self] }
        set { self[MacRecordMenuKey.self] = newValue }
    }
}

extension View {
    /// Publishes the place's record menu for the menu bar. Only the place's root view calls it (a list, a record window's
    /// page), once.
    func macRecordMenu(_ menu: MacRecordMenu?) -> some View {
        focusedSceneValue(\.macRecordMenu, menu)
    }
}

// MARK: - The place's filters (View menu)

/// One value a filter can take ("" is any: "Anyone", "Every Source").
struct MacViewFilterOption: Hashable {
    let value: String
    let title: String
}

/// One of the place's filters, its toolbar Filter menu's picker mirrored as a submenu of View: Taken By, Payment, Source,
/// Sort By. HIG ("Use the menu bar to give people easy access to all the commands they need"; the toolbar is a shortcut to
/// some): the design audit of 2026-11-15, docs/features/mac-design-audit.md.
struct MacViewFilter {
    let title: String
    let options: [MacViewFilterOption]
    let selected: String
    let choose: (String) -> Void
}

extension MacViewFilter {
    /// A filter over a list of words, with "" first as `any` ("Anyone") when it has one.
    init(_ title: String, any: String?, values: [String], selected: String, choose: @escaping (String) -> Void) {
        let first: [MacViewFilterOption] = any.map { [MacViewFilterOption(value: "", title: $0)] } ?? []
        self.init(title: title, options: first + values.map { MacViewFilterOption(value: $0, title: $0) },
                  selected: selected, choose: choose)
    }
}

private struct MacViewFiltersKey: FocusedValueKey { typealias Value = [MacViewFilter] }

extension FocusedValues {
    var macViewFilters: [MacViewFilter]? {
        get { self[MacViewFiltersKey.self] }
        set { self[MacViewFiltersKey.self] = newValue }
    }
}

extension View {
    /// Publishes the place's filters for the View menu. The place's root view calls it, beside its record menu.
    func macViewFilters(_ filters: [MacViewFilter]) -> some View {
        focusedSceneValue(\.macViewFilters, filters)
    }
}

// MARK: - Refresh (⌘R) and Find (⌘F)

/// What View › Refresh does for the place in front: re-ask what the place reads from the ERP or Meta. Places that read
/// only the books (which are live) need none; the shell then wakes the server polls.
struct MacRefreshAction {
    let run: () -> Void
}

private struct MacRefreshKey: FocusedValueKey { typealias Value = MacRefreshAction }

extension FocusedValues {
    var macRefresh: MacRefreshAction? {
        get { self[MacRefreshKey.self] }
        set { self[MacRefreshKey.self] = newValue }
    }
}

extension View {
    func macRefresh(_ run: @escaping () -> Void) -> some View {
        focusedSceneValue(\.macRefresh, MacRefreshAction(run: run))
    }
}

/// Edit › Find (⌘F) asks the list in front for its search field.
@MainActor @Observable
final class MacFind {
    static let shared = MacFind()
    /// Goes up on every ⌘F; a list's field takes the keyboard when it changes.
    private(set) var asks = 0
    func ask() { asks += 1 }
}

private struct MacSearchable: ViewModifier {
    @Binding var text: String
    let prompt: String
    @FocusState private var focused: Bool
    @State private var find = MacFind.shared

    func body(content: Content) -> some View {
        content
            .searchable(text: $text, placement: .toolbar, prompt: prompt)
            .searchFocused($focused)
            .onChange(of: find.asks) { _, _ in focused = true }
    }
}

extension View {
    /// The list's search field in the toolbar, which ⌘F (Edit › Find) gives the keyboard.
    func macSearchable(text: Binding<String>, prompt: String) -> some View {
        modifier(MacSearchable(text: text, prompt: prompt))
    }
}
#endif
