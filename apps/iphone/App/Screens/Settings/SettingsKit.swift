import SwiftUI
import ERPCore

/// Saving from the settings screens: one call to the ERP (`updateSettings`), which keeps only the
/// fields the phone may change. A switch or a choice shows the new value at once and keeps it until
/// the book answers with the change (`settled`), so it never snaps back for the moment the round trip
/// takes; a refusal puts it back and says why. Switches and choices go through the Outbox (they return at once).
@MainActor
@Observable
final class SettingsWriter {
    var error: String?
    /// The business the screen was opened in: a change made as it closes (after a switch) still goes there.
    let business = House.business
    private(set) var on: [String: Bool] = [:]
    private(set) var chosen: [String: String] = [:]

    /// True when the ERP took it. `seq` is only here to make each save its own: the same switch turned on,
    /// off and on again within half a minute must not look like one change sent twice (ERPAPI names a
    /// write by its content).
    func save(_ patch: [String: Any]) async -> Bool {
        error = nil
        do {
            try await ERPAPI.shared.write("updateSettings", ["patch": patch, "seq": UUID().uuidString], business: business)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// Not money: queued in the Outbox and gone from the screen at once (a failure is said app-wide with Retry).
    /// `seq` makes each save its own, as `save` does.
    func queue(_ patch: [String: Any], label: String) {
        error = nil
        Outbox.shared.send(op: "updateSettings", fields: ["patch": patch, "seq": UUID().uuidString],
                           business: business, label: label)
    }

    private func label(_ key: String) -> String { "Setting " + key }

    /// A failed change is not shown any more: the stored value is true again.
    private func failed(_ key: String) -> Bool { Outbox.shared.status(of: label(key)) == .failed }

    func isOn(_ key: String, _ stored: Bool) -> Bool {
        if failed(key) { return stored }
        return on[key] ?? stored
    }

    func set(_ key: String, _ value: Bool) {
        on[key] = value
        queue([key: value], label: label(key))
    }

    func pick(_ key: String, _ stored: String) -> String {
        if failed(key) { return stored }
        return chosen[key] ?? stored
    }

    func choose(_ key: String, _ value: String) {
        chosen[key] = value
        queue([key: value], label: label(key))
    }

    /// The book has answered: what it holds is true again.
    func settled() {
        on = [:]
        chosen = [:]
    }
}

/// The page every settings screen stands on: owners only, the settings document read live, the
/// screen drawn from it once it has arrived.
struct SettingsGate<Content: View>: View {
    let title: String
    private let content: (Settings) -> Content
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    init(title: String, @ViewBuilder content: @escaping (Settings) -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        Group {
            if session.isOwner {
                // A passing read error keeps the form that has already arrived; only no document at all is a failure.
                ShelfState(loaded: book.settings.loaded, error: book.settings.value == nil ? book.settings.error : nil) {
                    if let s = book.settings.value ?? Settings.blank {
                        content(s).macSettingsPage()
                    } else {
                        SkeletonLoading().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            } else {
                NotAvailableState("Owners only", why: "Settings are the owners’.", symbol: "lock")
            }
        }
        // The house's ground for every settings form, in this one place (the rows are Theme.card).
        .modifier(HouseGround())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { book.settings.need() }
    }
}

extension Settings {
    /// A shop with no settings document yet reads as every field unset (the model is lenient: `{}` decodes).
    static let blank: Settings? = try? JSONDecoder().decode(Settings.self, from: Data("{}".utf8))
}

/// A row's icon the way the iPhone's Settings draws it: a white symbol on a small coloured square.
struct SettingsIcon: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.subheadline.weight(.semibold))
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .foregroundStyle(color == Theme.accent ? Theme.onAccent : .white)
            .frame(width: 29, height: 29)
            .background(color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

/// A row that opens another place, with its icon.
struct SettingsLinkRow: View {
    let title: String
    let symbol: String
    let color: Color
    let path: String

    var body: some View {
        NavigationLink(value: Route(path: path)) {
            Label { Text(title) } icon: { SettingsIcon(symbol: symbol, color: color) }
        }
    }
}

/// A switch that saves when it is turned.
struct SettingToggle: View {
    let title: String
    var detail: String?
    let key: String
    let stored: Bool
    let writer: SettingsWriter

    var body: some View {
        Toggle(isOn: Binding(get: { writer.isOn(key, stored) }, set: { writer.set(key, $0) })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

/// Files in and out of the settings screens: an import's file picked in Files (`.fileImporter`), and a file the
/// ERP made (a backup, a tag's CSV) handed to the share sheet, where it can be saved to Files or sent.
enum SettingsFiles {
    /// The picked file's text. Files hands over a file outside the app, readable only while it says so.
    static func text(at url: URL) throws -> String {
        let open = url.startAccessingSecurityScopedResource()
        defer { if open { url.stopAccessingSecurityScopedResource() } }
        return String(decoding: try Data(contentsOf: url), as: UTF8.self)
    }

    /// The file written under its own name in the phone's temporary folder, for `ShareLink(item:)`.
    static func save(_ data: Data, named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("erp-settings", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "..", with: "-")
        let url = dir.appendingPathComponent(safe.isEmpty ? "file" : safe)
        try data.write(to: url, options: .atomic)
        return url
    }
}

/// A settings screen that is not drawn from the settings document: owners only, as every settings page is.
struct SettingsOwnersOnly<Content: View>: View {
    let title: String
    private let content: () -> Content
    @Environment(Session.self) private var session

    init(title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        Group {
            if session.isOwner {
                content().macSettingsPage()
            } else {
                NotAvailableState("Owners only", why: "Settings are the owners’.", symbol: "lock")
                    .navigationTitle(title)
            }
        }
        .modifier(HouseGround())
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension View {
    /// What went wrong with the last save, said in an alert where the person is looking (rule 16), not in red at the foot.
    func settingsFailure(_ writer: SettingsWriter) -> some View {
        failureAlert(Binding(get: { writer.error }, set: { writer.error = $0 }), title: "Not saved")
    }
}
