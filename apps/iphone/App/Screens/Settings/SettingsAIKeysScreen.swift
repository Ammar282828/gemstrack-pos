import SwiftUI
import ERPCore

/// Settings → Connect an AI (`/settings/ai`, src/app/settings/ai/page.tsx, docs/features/ai-keys.md): a key for one AI
/// (ChatGPT, Claude, Gemini, Cursor) with a name, what it may do and when it stops; shown once, with the setup for each AI;
/// and every key with its last use and Revoke. The same routes as the web page (`/api/agent/keys`: GET the keys and the
/// scopes, POST a new key, DELETE ?id= to revoke), owners only. The Mac draws the keys as a table with a sheet to make one;
/// the iPhone as a form with swipe to revoke.
struct SettingsAIKeysScreen: View {
    var body: some View {
        AIKeysGate()
    }
}

private struct AIKeysGate: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            if session.isOwner {
                AIKeysPage()
            } else {
                NotAvailableState("Owners only", why: "Settings are the owners’.", symbol: "lock")
                    .navigationTitle("Connect an AI")
            }
        }
        .modifier(HouseGround())
    }
}

// MARK: Model

/// One thing a key may be allowed (the web's `ScopeRow`).
struct AIKeyScope: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let detail: String
    let byDefault: Bool

    private enum K: String, CodingKey { case id, label, detail, byDefault }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        label = c.string(.label, default: id)
        detail = c.string(.detail, default: "")
        byDefault = c.bool(.byDefault, default: false)
    }
}

/// A key as the list shows it (the web's `KeyRow`): never the key itself, only its last four characters.
struct AIKey: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let scopes: [String]
    let tail: String
    let createdBy: String
    let createdAt: String
    let expiresAt: String?
    let lastUsedAt: String?
    let calls: Int
    let connectors: Int

    private enum K: String, CodingKey { case id, label, scopes, tail, createdBy, createdAt, expiresAt, lastUsedAt, calls, connectors }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        label = c.string(.label, default: "AI")
        scopes = c.strings(.scopes)
        tail = c.string(.tail, default: "")
        createdBy = c.string(.createdBy, default: "")
        createdAt = c.string(.createdAt, default: "")
        expiresAt = c.string(.expiresAt)
        lastUsedAt = c.string(.lastUsedAt)
        calls = c.int(.calls) ?? 0
        connectors = c.int(.connectors) ?? 0
    }

    var expired: Bool {
        guard let expiresAt, let d = ERPDate.parse(expiresAt) else { return false }
        return d <= Date()
    }
}

private struct AIKeysAnswer: Decodable {
    let keys: [AIKey]
    let scopes: [AIKeyScope]
    /// 'locked' | 'open' | 'unknown': keys work only when the database's rules are locked.
    let rules: String

    private enum K: String, CodingKey { case keys, scopes, rules }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        keys = c.list(.keys, of: AIKey.self)
        scopes = c.list(.scopes, of: AIKeyScope.self)
        rules = c.string(.rules, default: "unknown")
    }
}

/// A key just made: the whole key, shown this once.
private struct AIFreshKey: Identifiable {
    let id = UUID()
    let key: String
    let info: AIKey
}

private struct AIExpiry: Identifiable, Hashable {
    let id: String
    let label: String
    let days: Int

    static let all = [
        AIExpiry(id: "never", label: "When you revoke it", days: 0),
        AIExpiry(id: "30", label: "In 30 days", days: 30),
        AIExpiry(id: "90", label: "In 90 days", days: 90),
        AIExpiry(id: "365", label: "In a year", days: 365),
    ]
}

private enum AIKind: String, CaseIterable, Identifiable {
    case claude = "Claude", chatgpt = "ChatGPT", gemini = "Gemini CLI", cursor = "Cursor"
    var id: Self { self }
}

// MARK: Page

private struct AIKeysPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var keys: [AIKey]?
    @State private var scopes: [AIKeyScope] = []
    @State private var rules: String?
    @State private var problem: String?
    @State private var fresh: AIFreshKey?
    @State private var revoking: AIKey?
    @State private var note: Note?
    @State private var failure: String?
    @State private var making = false
    // The new key's form.
    @State private var label = ""
    @State private var picked: Set<String> = []
    @State private var expiry = AIExpiry.all[0]
    @State private var creating = false
    #if os(macOS)
    @State private var selection = Set<String>()
    @State private var showingMake = false
    @State private var showingHow = false
    #endif

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    // MARK: Shared

    fileprivate var pausedText: String? {
        switch rules {
        case "open"?: return "This shop’s database rules aren’t published yet, so anyone could forge a key. Publish firestore.rules in the Firebase console, then keys work at once."
        case "unknown"?: return "The database’s rules couldn’t be checked just now, so keys are refused until they can. Try again in a minute."
        default: return nil
        }
    }

    fileprivate func scopeLabel(_ id: String) -> String { scopes.first { $0.id == id }?.label ?? id }

    fileprivate func load() async {
        do {
            let a = try await ERPAPI.shared.get("/api/agent/keys", as: AIKeysAnswer.self)
            keys = a.keys
            scopes = a.scopes
            rules = a.rules
            if picked.isEmpty { picked = Set(a.scopes.filter(\.byDefault).map(\.id)) }
            problem = nil
        } catch {
            if keys == nil { keys = [] }
            problem = error.localizedDescription
        }
    }

    fileprivate func make() async -> Bool {
        creating = true
        defer { creating = false }
        var body: [String: Any] = [
            "label": label.trimmingCharacters(in: .whitespaces).isEmpty ? "AI" : label.trimmingCharacters(in: .whitespaces),
            "scopes": scopes.map(\.id).filter { picked.contains($0) },
        ]
        if expiry.days > 0 {
            body["expiresAt"] = ERPDate.iso(Date().addingTimeInterval(Double(expiry.days) * 86_400))
        }
        do {
            let out = try await ERPAPI.shared.send("/api/agent/keys", method: "POST", body)
            guard let key = out["key"] as? String, !key.isEmpty,
                  let info = out["info"].flatMap({ ERPDecode.model(AIKey.self, from: $0) }) else {
                failure = "The ERP did not send the key back. Look at the list: if it is there, revoke it and make another."
                return false
            }
            fresh = AIFreshKey(key: key, info: info)
            label = ""
            await load()
            return true
        } catch {
            failure = error.localizedDescription
            return false
        }
    }

    fileprivate func revoke(_ k: AIKey) async {
        do {
            try await ERPAPI.shared.send("/api/agent/keys?id=\(k.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? k.id)", method: "DELETE")
            if fresh?.info.id == k.id { fresh = nil }
            Note.show(Note(title: "\(k.label) can’t get in any more"), in: $note, reduce: reduceMotion)
            await load()
        } catch {
            failure = "Couldn’t revoke it: \(error.localizedDescription)"
        }
    }

    fileprivate func made(_ k: AIKey) -> String { k.createdAt.isEmpty ? "" : ShopDate.say(k.createdAt, withTime: true) }

    /// "Made 3 Oct · until 3 Nov · used 5 Oct · 12 calls · 1 connector signed in".
    fileprivate func line(_ k: AIKey) -> String {
        var parts = ["Made " + made(k)]
        if let e = k.expiresAt, !k.expired { parts.append("until " + ShopDate.say(e, withTime: false)) }
        if let used = k.lastUsedAt {
            parts.append("used " + ShopDate.say(used, withTime: true) + " · \(k.calls) call\(k.calls == 1 ? "" : "s")")
        } else {
            parts.append("not used yet")
        }
        if k.connectors > 0 { parts.append("\(k.connectors) connector\(k.connectors == 1 ? "" : "s") signed in") }
        return parts.joined(separator: " · ")
    }

    // MARK: iPhone

    @ViewBuilder
    private var phoneBody: some View {
        Form { Group {
            if let pausedText {
                Section {
                    Label(pausedText, systemImage: "pause.circle").foregroundStyle(Tone.owed.color)
                } header: { LedgerHeading(title: "AI keys are paused") }
            }
            if let fresh {
                Section {
                    AICopyBlock(text: fresh.key)
                    AIKeySetup(keyText: fresh.key, scopes: fresh.info.scopes)
                    Button("Done") { self.fresh = nil }
                } header: {
                    LedgerHeading(title: "\(fresh.info.label)’s key")
                } footer: {
                    Text("Shown only now: copy it into the AI. The ERP keeps only a fingerprint of it.")
                }
            }
            Section {
                TextField("Name it, like ChatGPT", text: $label)
                ForEach(scopes) { s in
                    Toggle(isOn: Binding(get: { picked.contains(s.id) }, set: { on in
                        if on { picked.insert(s.id) } else { picked.remove(s.id) }
                    })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label)
                            Text(s.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Picker("Stops working", selection: $expiry) {
                    ForEach(AIExpiry.all) { Text($0.label).tag($0) }
                }
                Button(creating ? "Making…" : "Make the key") { Task { _ = await make() } }
                    .disabled(creating || picked.isEmpty)
            } header: {
                LedgerHeading(title: "Make a key")
            } footer: {
                Text("One key for each AI, so you can see what each did and stop one without the others.")
            }
            Section {
                if let problem { Text(problem).foregroundStyle(Tone.problem.color) }
                if keys == nil { LoadingRow("Loading…") }
                if keys?.isEmpty == true, problem == nil { Text("No keys yet.").foregroundStyle(.secondary) }
                ForEach(keys ?? []) { k in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(k.label)  ··\(k.tail)").fontWeight(.medium)
                        Text(k.scopes.map(scopeLabel).joined(separator: ", ") + (k.expired ? " · Expired" : ""))
                            .font(.caption).foregroundStyle(.secondary)
                        Text(line(k)).font(.caption).foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        Button(role: .destructive) { revoking = k } label: { Label("Revoke", systemImage: "trash") }
                    }
                    .contextMenu {
                        Button(role: .destructive) { revoking = k } label: { Label("Revoke", systemImage: "trash") }
                    }
                }
            } header: {
                LedgerHeading(title: "Keys", count: keys?.count)
            } footer: {
                Text("What each AI did is in Settings → Activity, under its name. Posts it queues wait in Posts for your OK.")
            }
            if fresh == nil, keys?.isEmpty == false {
                Section {
                    AIKeySetup(keyText: "<key>", scopes: Array(Set((keys ?? []).flatMap(\.scopes))))
                } header: {
                    LedgerHeading(title: "How to connect")
                } footer: {
                    Text("Put the key you were shown where it says <key>. Lost it? Make a new one and revoke the old.")
                }
            }
            }
            .houseRows()
        }
        .navigationTitle("Connect an AI")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .noteToast($note)
        .failureAlert($failure, title: "Not done")
        .confirmDestructive(isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
                            title: "Revoke \(revoking?.label ?? "this")’s key?",
                            message: "It stops at once, with every connector signed in with it. What it already made stays.",
                            action: "Revoke") {
            if let k = revoking { Task { await revoke(k) } }
        }
        .task { await load() }
        .refreshable { await load() }
    }
}

// MARK: The key's setup for each AI

/// Claude, ChatGPT, Gemini and Cursor: what to paste where, with the key (or `<key>`) filled in. The addresses are this
/// business's own ERP.
private struct AIKeySetup: View {
    let keyText: String
    let scopes: [String]
    @State private var kind = AIKind.claude

    private var base: String { House.serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
    private var mcp: String { base + "/api/agent/mcp" }
    private var openapi: String { base + "/api/agent/openapi.json?scopes=" + scopes.joined(separator: ",") }
    private var name: String {
        let slug = House.storeName.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
            .split(separator: "-").joined(separator: "-")
        return (slug.isEmpty ? "shop" : slug) + "-erp"
    }

    private func json(_ field: String) -> String {
        """
        {
          "mcpServers": {
            "\(name)": {
              "\(field)": "\(mcp)",
              "headers": { "Authorization": "Bearer \(keyText)" }
            }
          }
        }
        """
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("AI", selection: $kind) {
                ForEach(AIKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            switch kind {
            case .claude:
                Text("claude.ai or the Claude app: Settings → Connectors → Add custom connector. Paste this address, press Connect, and paste the key on the ERP’s page that opens.")
                AICopyBlock(text: mcp)
                Text("Claude Code (a terminal):")
                AICopyBlock(text: "claude mcp add --transport http \(name) \(mcp) --header \"Authorization: Bearer \(keyText)\"")
            case .chatgpt:
                Text("A connector (ChatGPT → Settings → Apps & Connectors → Advanced → Developer mode, then Create): the MCP server address below, authentication OAuth; paste the key on the ERP’s page that opens.")
                AICopyBlock(text: mcp)
                Text("A custom GPT: Configure → Actions → Create new action → Import from URL, then Authentication → API key → Bearer, and paste the key. In its instructions: “Call get_guide first.”")
                AICopyBlock(text: openapi)
                AICopyBlock(text: keyText, caption: "The key, for the GPT’s API key box")
            case .gemini:
                Text("Add this to ~/.gemini/settings.json (merge it with what is there):")
                AICopyBlock(text: json("httpUrl"))
            case .cursor:
                Text("Add this to ~/.cursor/mcp.json (or the project’s .cursor/mcp.json):")
                AICopyBlock(text: json("url"))
            }
            Text("Then ask it, for example: “Make a story and a post of our newest emerald ring and queue it for the community.” It waits in Posts for your OK.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .font(.subheadline)
    }
}

/// Text to copy: monospaced, selectable, with a Copy button.
private struct AICopyBlock: View {
    let text: String
    var caption: String?
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let caption { Text(caption).font(.footnote).foregroundStyle(.secondary) }
            HStack(alignment: .top, spacing: 8) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .help("Copy")
                .accessibilityLabel("Copy")
            }
            .padding(10)
            .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}

// MARK: Mac

#if os(macOS)
extension AIKeysPage {
    /// The keys as a table (name, what it may do, made, stops, last used, calls), Make a key… in the toolbar (⌘N is the
    /// app's, so ⌥⌘N here), Revoke on the right-click menu and the Delete key, and the setup for each AI in a sheet.
    @ViewBuilder
    fileprivate var macBody: some View {
        VStack(spacing: 0) {
            if let pausedText {
                Label(pausedText, systemImage: "pause.circle")
                    .foregroundStyle(Tone.owed.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.vertical, 10)
                Divider()
            }
            Table(keys ?? [], selection: $selection) {
                TableColumn("Name") { (k: AIKey) in
                    HStack(spacing: 6) {
                        Text(k.label).fontWeight(.medium)
                        Text("··\(k.tail)").foregroundStyle(.secondary).monospaced()
                        if k.expired { Pill("Expired", tone: .late) }
                    }
                }
                TableColumn("May") { (k: AIKey) in
                    Text(k.scopes.map(scopeLabel).joined(separator: ", ")).foregroundStyle(.secondary).lineLimit(2)
                }
                TableColumn("Made") { (k: AIKey) in Text(made(k)).foregroundStyle(.secondary) }
                TableColumn("Stops") { (k: AIKey) in
                    Text(k.expiresAt.map { ShopDate.say($0, withTime: false) } ?? "When revoked").foregroundStyle(.secondary)
                }
                TableColumn("Last used") { (k: AIKey) in
                    Text(k.lastUsedAt.map { ShopDate.say($0, withTime: true) } ?? "Not yet").foregroundStyle(.secondary)
                }
                TableColumn("Calls") { (k: AIKey) in
                    Text("\(k.calls)").monospacedDigit().foregroundStyle(.secondary)
                }
                TableColumn("Connectors") { (k: AIKey) in
                    Text(k.connectors == 0 ? "" : "\(k.connectors) signed in").foregroundStyle(.secondary)
                }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if !ids.isEmpty {
                    Button("Revoke…", systemImage: "trash", role: .destructive) { revoking = (keys ?? []).first { ids.contains($0.id) } }
                }
            }
            .onDeleteCommand { revoking = (keys ?? []).first { selection.contains($0.id) } }
            .overlay {
                if keys == nil {
                    ProgressView()
                } else if keys?.isEmpty == true {
                    if let problem {
                        EmptyState("Couldn’t read the keys", symbol: "exclamationmark.icloud", message: problem,
                                   action: (title: "Try again", run: { Task { await load() } }))
                    } else {
                        EmptyState("No keys yet", symbol: "key",
                                   message: "Make one key for each AI, so you can see what each did and stop one without the others.",
                                   action: (title: "Make a key…", run: { showingMake = true }))
                    }
                }
            }
            Divider()
            Text("What each AI did is in Settings → Activity, under its name. Posts it queues wait in Posts for your OK.")
                .font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.vertical, 8)
        }
        .background(Theme.ground)
        .navigationTitle("Connect an AI")
        .navigationSubtitle("Let ChatGPT, Claude, Gemini or Cursor work in the ERP, only as far as you allow")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showingMake = true } label: { Label("Make a key", systemImage: "plus") }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                    .help("Make a key for an AI")
            }
            ToolbarItem(placement: .automatic) {
                Button { showingHow = true } label: { Label("How to connect", systemImage: "questionmark.circle") }
                    .help("What to paste into each AI")
            }
            ToolbarItem(placement: .automatic) {
                Button { revoking = (keys ?? []).first { selection.contains($0.id) } } label: { Label("Revoke", systemImage: "trash") }
                    .disabled(selection.isEmpty)
                    .help("Revoke the selected key")
            }
        }
        .noteToast($note)
        .failureAlert($failure, title: "Not done")
        .confirmDestructive(isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
                            title: "Revoke \(revoking?.label ?? "this")’s key?",
                            message: "It stops at once, with every connector signed in with it. What it already made stays.",
                            action: "Revoke") {
            if let k = revoking { Task { await revoke(k) } }
        }
        .sheet(isPresented: $showingMake) { makeSheet }
        .sheet(item: $fresh) { f in freshSheet(f) }
        .sheet(isPresented: $showingHow) { howSheet }
        .task { await load() }
    }

    private var makeSheet: some View {
        VStack(spacing: 0) {
            Text("Make a key").font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 16)
            Form {
                Section {
                    TextField("Name", text: $label, prompt: Text("ChatGPT"))
                } footer: {
                    Text("One key for each AI, so you can see what each did and stop one without the others.")
                }
                Section("It may") {
                    ForEach(scopes) { s in
                        Toggle(isOn: Binding(get: { picked.contains(s.id) }, set: { on in
                            if on { picked.insert(s.id) } else { picked.remove(s.id) }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.label)
                                Text(s.detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    Picker("Stops working", selection: $expiry) {
                        ForEach(AIExpiry.all) { Text($0.label).tag($0) }
                    }
                }
            }
            .formStyle(.grouped)
            .onSubmit { if !picked.isEmpty { Task { if await make() { showingMake = false } } } }
            MacSheetFooter(confirm: "Make the key", busy: creating, disabled: picked.isEmpty,
                           onCancel: { showingMake = false },
                           onConfirm: { Task { if await make() { showingMake = false } } })
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 520)
    }

    /// The key, once, with the setup for each AI.
    private func freshSheet(_ f: AIFreshKey) -> some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    AICopyBlock(text: f.key)
                } header: {
                    Text("\(f.info.label)’s key")
                } footer: {
                    Text("Shown only now: copy it into the AI. The ERP keeps only a fingerprint of it.")
                }
                Section("Set it up") { AIKeySetup(keyText: f.key, scopes: f.info.scopes) }
            }
            .formStyle(.grouped)
            MacSheetFooter(confirm: "Done", cancel: "Close", onCancel: { fresh = nil }, onConfirm: { fresh = nil })
        }
        .frame(minWidth: 620, idealWidth: 660, minHeight: 560)
    }

    private var howSheet: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    AIKeySetup(keyText: "<key>", scopes: Array(Set((keys ?? []).flatMap(\.scopes))))
                } header: {
                    Text("How to connect")
                } footer: {
                    Text("Put the key you were shown where it says <key>. Lost it? Make a new one and revoke the old.")
                }
            }
            .formStyle(.grouped)
            MacSheetFooter(confirm: "Done", cancel: "Close", onCancel: { showingHow = false }, onConfirm: { showingHow = false })
        }
        .frame(minWidth: 620, idealWidth: 660, minHeight: 480)
    }
}
#endif
