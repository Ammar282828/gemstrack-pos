import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Connect an agent (board.tsx AgentDialog): a key for Claude Code, or any MCP client, to work on the Studio's
/// boards over /api/studio/mcp. The server keeps only the key's hash, so a new key is shown once, here, and
/// forgotten when the sheet closes.
struct StudioAgentSettings: View {
    @Environment(\.dismiss) private var dismiss
    @State private var keys: [MarketingValue]?
    @State private var fresh: String?
    @State private var making = false
    @State private var problem: String?
    @State private var site = ""
    @State private var siteName = ""
    @State private var copied = false
    @State private var revoking: MarketingValue?

    /// The connection's name in Claude Code: the website's name and "-studio" ("taheri-studio"), as board.tsx
    /// builds it from the site's name (/api/app/website `siteName`), so web and phone show the same.
    private var name: String {
        if !siteName.isEmpty {
            return (siteName.split(separator: ".", omittingEmptySubsequences: false).first.map(String.init) ?? "shop").lowercased() + "-studio"
        }
        let host = URL(string: site)?.host?.replacingOccurrences(of: "www.", with: "") ?? ""
        return ((host.split(separator: ".").first).map(String.init) ?? House.id).lowercased() + "-studio"
    }
    private var command: String {
        guard let fresh else { return "" }
        let origin = House.serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "claude mcp add --transport http \(name) \(origin)/api/studio/mcp --header \"Authorization: Bearer \(fresh)\""
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Claude Code (or any MCP client) can read your style, search the photo library, put designs on a board, look at them and leave notes — within the house’s rules.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if fresh != nil {
                        Text("Run this once in a terminal. The key is shown only now.").font(.subheadline.weight(.medium))
                        Text(command).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .privacySensitive()
                        Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                            // The key leaves the clipboard after ten minutes (time enough to paste it on the Mac).
                            SecretPasteboard.copy(command, minutes: 10)
                            copied = true
                        }
                        .buttonStyle(.bordered)
                        Text("Then ask Claude, for example: “Fill the Eid board with six ring ads from the studio.” Keep the board open on a phone or the web: it lays out and draws what the agent adds.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button(making ? "Making a key…" : "Make a key", systemImage: "key") { Task { await make() } }
                            .buttonStyle(.bordered).disabled(making || House.isDemo)
                        if House.isDemo { Text("The demo can’t make keys.").font(.footnote).foregroundStyle(.secondary) }
                    }
                } header: { LedgerHeading(title: "Connect an agent") }.houseRows()

                Section {
                    if let keys {
                        if keys.isEmpty { Text("No keys yet.").foregroundStyle(.secondary) }
                        ForEach(keys.map { $0.s("tail") }, id: \.self) { tail in
                            let k = keys.first { $0.s("tail") == tail } ?? .null
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(k.s("label", "Claude Code") + " ··" + tail)
                                    Text(line(k)).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Revoke", role: .destructive) { revoking = k }.buttonStyle(.borderless)
                            }
                        }
                    } else if !House.isDemo {
                        SkeletonLoading("Loading the keys")
                    }
                } header: { LedgerHeading(title: "Keys") }.houseRows()
            }
            .modifier(HouseGround())
            .failureAlert($problem)
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
            .navigationTitle("Agent").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Revoke this key? An agent using it stops at once.", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
                Button("Revoke key", role: .destructive) { if let k = revoking { Task { await revoke(k.s("tail")) } } }
            }
        }
        .presentationSizing(.form)
        #if os(macOS)
        .formStyle(.grouped)
        .frame(minWidth: 520, idealWidth: 580, minHeight: 460)
        #endif
        .task { await load() }
        .onDisappear { fresh = nil; copied = false }
    }

    private func line(_ k: MarketingValue) -> String {
        let made = ERPDateText.day(k.s("at"))
        let used = k.s("last").isEmpty ? "not used yet" : "used " + ERPDateText.moment(k.s("last"))
        return "made \(made) · \(used)"
    }

    private func load() async {
        if House.isDemo { keys = []; return }
        do { keys = try await MarketingRequest.get("/api/ads/studio/agent-keys")["keys"].array } catch { keys = []; problem = error.localizedDescription }
        if site.isEmpty, let w = try? await MarketingRequest.get("/api/app/website") { site = w.s("site"); siteName = w.s("siteName") }
    }

    private func make() async {
        making = true; problem = nil; defer { making = false }
        do {
            fresh = try await MarketingRequest.send("/api/ads/studio/agent-keys", ["label": "Claude Code"]).s("key")
            await load()
        } catch { problem = error.localizedDescription }
    }

    private func revoke(_ tail: String) async {
        do { _ = try await MarketingRequest.send("/api/ads/studio/agent-keys?tail=" + AdsQuery.escape(tail), method: "DELETE"); await load() }
        catch { problem = error.localizedDescription }
    }
}

/// An ISO time as the agent-keys list says it, in Karachi.
private enum ERPDateText {
    static func day(_ iso: String) -> String {
        guard let d = ISO8601DateFormatter.flexible(iso) else { return "—" }
        return ShopDate.stamp(d)
    }
    static func moment(_ iso: String) -> String {
        guard let d = ISO8601DateFormatter.flexible(iso) else { return "—" }
        return ShopDate.stamp(d, withTime: true)
    }
}

private extension ISO8601DateFormatter {
    static func flexible(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
