import SwiftUI

/// Competitor research calls the same server tools as the browser; only public account data is read.
struct StudioRivals: View {
    @State private var rows: [MarketingValue] = []
    @State private var found: [MarketingValue] = []
    @State private var brief = ""
    @State private var username = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var removing: MarketingValue?
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macOrder = [KeyPathComparator(\StudioMacRival.username)]
    @State private var macAdding = false
    @State private var macFinding = false
    #endif
    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }
    @ViewBuilder
    private var phoneBody: some View {
        Section {
            TextField("Search focus (optional)", text: $brief, axis: .vertical)
            Button("Find competitors") { action("Searching…") { found = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "find", "brief": brief])["found"].array } }
            TextField("@username or Instagram link", text: $username).textInputAutocapitalization(.never)
            Button("Add account") { add(MarketingValue(["username": username, "source": "owner"])) }.disabled(username.isEmpty)
            if let busy { SkeletonLoading(busy) }
        }.houseRows().task { if !House.isDemo { await load() } }.disabled(busy != nil).failureAlert($error)
        .confirmationDialog("Remove @\(removing?.s("username") ?? "") and its readings?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove account", role: .destructive) { if let item = removing { action("Removing…") { _ = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "remove", "username": item.s("username")]); await load() } } }
        }
        if !found.isEmpty {
            LedgerSection("Found") {
                ForEach(found, id: \.text) { item in
                    VStack(alignment: .leading, spacing: pt(6)) {
                        Text(item.s("name")).font(.headline); Text(item.s("why")).font(.subheadline).foregroundStyle(.secondary)
                        StudioLinks(value: item)
                        Button("Add @" + item.s("instagram")) { var payload = item; payload["username"] = item["instagram"]; payload["source"] = .string("search"); add(payload) }.disabled(item.s("instagram").isEmpty)
                    }.padding(.vertical, pt(5))
                }
            }
        }
        ForEach(rows, id: \.text) { item in
            Section {
                DisclosureGroup(item.s("name", item.s("username")) + " · @" + item.s("username")) {
                    StudioLinks(value: item)
                    if !item["profile"].s("picture").isEmpty { MarketingPhoto(path: item["profile"].s("picture")).frame(width: 80, height: 80).clipShape(Circle()) }
                    Text(item["profile"].s("bio")).font(.subheadline)
                    LabeledContent("Followers", value: String(Int(item["profile"].n("followers"))))
                    LabeledContent("Posts", value: String(Int(item["profile"].n("mediaCount"))))
                    Button("Look up / refresh account") { look(item, read: false) }
                    Button("Read their feed") { look(item, read: true) }
                    if !item.s("profileError").isEmpty { Text(item.s("profileError")).foregroundStyle(Tone.problem.color) }
                    DisclosureGroup("Recent posts") {
                        ForEach(item["profile"]["posts"].array.sorted { $0.n("rate") > $1.n("rate") }, id: \.text) { post in
                            VStack(alignment: .leading, spacing: pt(5)) {
                                MarketingPhoto(path: post.s("image")).frame(height: 200)
                                Text(post.s("caption")).font(.subheadline)
                                MarketingDetails(fields: post.object.filter { !["thumbnailUrl", "mediaUrl", "caption"].contains($0.key) }.mapValues(\.any))
                            }
                        }
                    }
                    if item["reading"] != .null { MarketingDetails(fields: item["reading"].object.mapValues(\.any)) }
                    Button("Remove account", role: .destructive) { removing = item }
                }
            }.houseRows().disabled(busy != nil)
        }
    }
    private func load() async { do { rows = try await MarketingRequest.get("/api/ads/studio/competitors")["competitors"].array } catch { self.error = error.localizedDescription } }
    private func action(_ title: String, _ work: @escaping () async throws -> Void) { Task { busy = title; error = nil; defer { busy = nil }; do { try await work() } catch { self.error = error.localizedDescription } } }
    private func add(_ item: MarketingValue) { action("Adding account…") { var body = item.object.mapValues(\.any); body["action"] = "add"; _ = try await MarketingRequest.send("/api/ads/studio/competitors", body); username = ""; await load() } }
    private func look(_ item: MarketingValue, read: Bool) { action(read ? "Reading the feed…" : "Looking up account…") { let path = "/api/ads/studio/competitors/" + AdsQuery.escape(item.s("username")); let r = read ? try await MarketingRequest.send(path) : try await MarketingRequest.get(path + "?fresh=1"); rows = rows.map { $0.s("username") == item.s("username") ? r["competitor"] : $0 } } }
}

#if os(macOS)
/// A competitor's account as a row of the table.
struct StudioMacRival: Identifiable {
    let id: String
    let username: String
    let name: String
    let followers: Double
    let posts: Double
    let source: String
    let value: MarketingValue

    init(_ v: MarketingValue) {
        id = v.s("username")
        username = v.s("username")
        name = v.s("name", v.s("username"))
        followers = v["profile"].n("followers")
        posts = v["profile"].n("mediaCount")
        source = v.s("source")
        value = v
    }
}

// MARK: - The Mac's Competitors: the accounts as a table with the picked one in the inspector; Add and Find are the
// toolbar's and short sheets (docs/features/mac-design.md, "Ads").

extension StudioRivals {
    @ViewBuilder
    var macBody: some View {
        let list = rows.map(StudioMacRival.init).sorted(using: macOrder)
        let picked = list.filter { (r: StudioMacRival) in macPicked.contains(r.id) }
        Table(list, selection: $macPicked, sortOrder: $macOrder) {
            TableColumn("Account", value: \.username) { (r: StudioMacRival) in
                VStack(alignment: .leading, spacing: 0) {
                    Text("@" + r.username).lineLimit(1)
                    if r.name != r.username { Text(r.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            .width(min: 160, ideal: 260)
            TableColumn("Followers", value: \.followers) { (r: StudioMacRival) in
                Text(r.followers > 0 ? AdsFormat.compact(r.followers) : "").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Posts", value: \.posts) { (r: StudioMacRival) in
                Text(r.posts > 0 ? AdsFormat.compact(r.posts) : "").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 80)
            TableColumn("Added", value: \.source) { (r: StudioMacRival) in Text(r.source == "owner" ? "By you" : (r.source == "search" ? "From a search" : r.source)) }
                .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let hit = list.filter { (r: StudioMacRival) in ids.contains(r.id) }
            MacActionItems(groups: macActions(hit))
        }
        .overlay {
            if rows.isEmpty { ContentUnavailableView("No Competitors Yet", systemImage: "binoculars", description: Text("Add an account, or find some.")) }
        }
        .macInspector { macInspectorPanel(picked) }
        .macRefresh { Task { await load() } }
        .macRecordMenu(MacRecordMenu(title: "Competitor", groups: macActions(picked)))
        .macSummaryBar(["\(rows.count) account\(rows.count == 1 ? "" : "s")"])
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                MacToolbarAction(action: macAddAction)
                MacToolbarAction(action: macFindAction)
            }
        }
        .task { if !House.isDemo { await load() } }
        .disabled(busy != nil)
        .failureAlert($error)
        .sheet(isPresented: $macAdding) { macAddSheet }
        .sheet(isPresented: $macFinding) { macFindSheet }
        .confirmationDialog("Remove @\(removing?.s("username") ?? "") and its readings?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove Account", role: .destructive) {
                if let item = removing { action("Removing…") { _ = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "remove", "username": item.s("username")]); await load() } }
            }
        }
    }

    private var macAddAction: MacAction {
        MacAction("Add Account…", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command])) { macAdding = true }
    }

    private var macFindAction: MacAction {
        MacAction("Find Competitors…", symbol: "magnifyingglass") { macFinding = true }
    }

    private func macActions(_ picked: [StudioMacRival]) -> [[MacAction]] {
        let one: StudioMacRival? = picked.count == 1 ? picked[0] : nil
        let lookUp = MacAction("Look Up Again", symbol: "arrow.clockwise", enabled: one != nil && busy == nil) {
            if let r = one { look(r.value, read: false) }
        }
        let read = MacAction("Read Their Feed", symbol: "square.grid.2x2", enabled: one != nil && busy == nil) {
            if let r = one { look(r.value, read: true) }
        }
        let remove = MacAction("Remove…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: one != nil && busy == nil) {
            if let r = one { removing = r.value }
        }
        return [[lookUp, read], [remove], [macAddAction, macFindAction]]
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ picked: [StudioMacRival]) -> some View {
        if picked.count == 1, let r = picked.first {
            let item = r.value
            let actions = macActions(picked)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    MacInspectorHeader(title: r.name, subtitle: "@" + r.username, actions: [actions[0][0], actions[0][1]])
                    HStack(spacing: 14) { StudioLinks(value: item) }.font(.callout)
                    if !item["profile"].s("picture").isEmpty {
                        MarketingPhoto(path: item["profile"].s("picture")).frame(width: 80, height: 80).clipShape(Circle())
                    }
                    if !item["profile"].s("bio").isEmpty { Text(item["profile"].s("bio")) }
                    MacFigures([MacFigure("Followers", AdsFormat.count(r.followers)), MacFigure("Posts", AdsFormat.count(r.posts))])
                    if !item.s("profileError").isEmpty { Text(item.s("profileError")).foregroundStyle(Tone.problem.color) }
                    DisclosureGroup("Recent Posts") {
                        ForEach(item["profile"]["posts"].array.sorted { $0.n("rate") > $1.n("rate") }, id: \.text) { (post: MarketingValue) in
                            VStack(alignment: .leading, spacing: 5) {
                                MarketingPhoto(path: post.s("image")).frame(height: 160)
                                Text(post.s("caption")).font(.callout)
                                MarketingDetails(fields: post.object.filter { !["thumbnailUrl", "mediaUrl", "caption"].contains($0.key) }.mapValues(\.any))
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    if item["reading"] != .null {
                        DisclosureGroup("What Their Feed Shows") { MarketingDetails(fields: item["reading"].object.mapValues(\.any)) }
                    }
                }
                .padding(16)
            }
        } else {
            MacInspectorEmpty(title: macPicked.count > 1 ? "\(macPicked.count) Selected" : "No Account Selected",
                              detail: "Click an account to see its profile and recent posts.")
        }
    }

    // MARK: Add and find

    private var macAddSheet: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("@username or Instagram link", text: $username)
                        .autocorrectionDisabled()
                }
            }
            .formStyle(.grouped)
            AdsMacSheetFooter(title: "Add Account", disabled: username.trimmingCharacters(in: .whitespaces).isEmpty, cancel: { macAdding = false }) {
                macAdding = false
                add(MarketingValue(["username": username, "source": "owner"]))
            }
        }
        .frame(width: 440, height: 180)
    }

    private var macFindSheet: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Search focus (optional)", text: $brief, axis: .vertical)
                        .lineLimit(1...3)
                }
                if !found.isEmpty {
                    Section("Found") {
                        ForEach(found, id: \.text) { (item: MarketingValue) in
                            HStack(alignment: .top, spacing: 8) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.s("name")).fontWeight(.medium)
                                    Text(item.s("why")).font(.callout).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                Button("Add @" + item.s("instagram")) {
                                    var payload = item
                                    payload["username"] = item["instagram"]
                                    payload["source"] = .string("search")
                                    add(payload)
                                }
                                .disabled(item.s("instagram").isEmpty)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            AdsMacSheetFooter(title: found.isEmpty ? "Find Competitors" : "Find Again", disabled: busy != nil, cancelTitle: "Done", cancel: { macFinding = false }) {
                action("Searching…") {
                    found = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "find", "brief": brief])["found"].array
                }
            }
        }
        .frame(width: 520, height: 460)
    }
}
#endif

struct StudioLinks: View {
    let value: MarketingValue
    var body: some View {
        ForEach([("instagram", "Instagram"), ("adLibrary", "Their live ads"), ("website", "Website")], id: \.0) { key, title in
            if let url = URL(string: value.s(key)), url.scheme == "https" { Link(title, destination: url) }
        }
    }
}

struct StudioSaved: View {
    @Bindable var model: StudioModel
    @State private var data = MarketingValue.null
    @State private var view = "all"
    @State private var folderName = ""
    @State private var rename = ""
    @State private var account: [MarketingValue] = []
    @State private var selected: StudioAssetChoice?
    @State private var share: MarketingFileShare?
    @State private var deleting: MarketingValue?
    private var folder: MarketingValue { data["folders"].array.first { $0.s("id") == view } ?? .null }
    private var items: [MarketingValue] { data["items"].array.filter { view == "all" || (view == "unfiled" ? $0.s("folder").isEmpty : $0.s("folder") == view) } }
    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }
    @ViewBuilder
    private var phoneBody: some View {
        List {
            Section {
                Picker("Folder", selection: $view) {
                    Text("All").tag("all"); Text("Unfiled").tag("unfiled"); Text("In the ad account").tag("account")
                    ForEach(data["folders"].array, id: \.text) { Text($0.s("name")).tag($0.s("id")) }
                }
                DisclosureGroup("Manage folders") {
                    TextField("New folder name", text: $folderName)
                    Button("Create folder") { mutate("/api/ads/studio/saved/folders", ["name": folderName]); folderName = "" }.disabled(folderName.isEmpty)
                    if folder != .null {
                        TextField("Rename folder", text: $rename)
                        Button("Rename") { mutate("/api/ads/studio/saved/folders", ["id": folder.s("id"), "name": rename], method: "PATCH") }.disabled(rename.isEmpty)
                        Button("Delete folder", role: .destructive) { deleting = MarketingValue(["deleteKind": "folder", "folder": folder.s("id"), "name": folder.s("name")]) }
                        Text("Designs inside a deleted folder stay unfiled.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }.houseRows()
            if view == "account" { accountRows }
            else {
                Section {
                    ForEach(items, id: \.text) { item in
                        Button { selected = StudioAssetChoice(item: item) } label: {
                            HStack(spacing: pt(12)) { StockImage(imageUrl: item.s("thumb"), name: item.s("name"), key: item.s("id"), decodeDataURI: true).frame(width: 90, height: 90); VStack(alignment: .leading, spacing: pt(4)) { Text(item.s("name")).foregroundStyle(.primary); Text(item.s("format")).font(.caption).foregroundStyle(.secondary) } }
                        }
                    }
                    if items.isEmpty { Text("No saved designs here.").foregroundStyle(.secondary) }
                }.houseRows()
            }
        }
        .task { if !House.isDemo { await load() } }
        .task(id: view) { if view == "account", !House.isDemo { await loadAccount() } }
        .refreshable { await load() }
        .sheet(item: $selected) { choice in detail(choice.item).presentationSizing(.page) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
        // From the detail sheet the question is asked in the sheet (below); here only for the list's own deletes.
        .confirmationDialog("Delete “\(deleting?.s("name") ?? "")”?", isPresented: Binding(get: { deleting != nil && selected == nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let item = deleting { if item.s("deleteKind") != "folder" { mutate("/api/ads/studio/saved?id=" + AdsQuery.escape(item.s("id")), method: "DELETE") } else { mutate("/api/ads/studio/saved/folders?id=" + AdsQuery.escape(item.s("folder")), method: "DELETE") }; deleting = nil; selected = nil } }
        }
    }
    @ViewBuilder var accountRows: some View {
        Section {
            if account.isEmpty { Text("No ads in the account.").foregroundStyle(.secondary) }
            ForEach(account, id: \.text) { ad in
                VStack(alignment: .leading, spacing: pt(8)) {
                    Text(ad.s("name")).font(.headline)
                    // Running, the expected state, says nothing (CONVENTIONS rule 15).
                    if AdsStatusWords.of(ad.s("effective_status")).tone != .good {
                        Text(ad.s("effective_status")).font(.caption).foregroundStyle(.secondary)
                    }
                    NavigationLink("Ad details", value: Route(path: "/ads/object?id=" + ad.s("id") + "&kind=ad"))
                    Menu("Keep in a folder") {
                        Button("Unfiled") { mutate("/api/ads/studio/saved", ["fromAd": ad.s("id")]) }
                        ForEach(data["folders"].array, id: \.text) { f in Button(f.s("name")) { mutate("/api/ads/studio/saved", ["fromAd": ad.s("id"), "folder": f.s("id")]) } }
                    }
                }.padding(.vertical, pt(5))
            }
        }.houseRows()
    }
    func detail(_ item: MarketingValue) -> some View {
        NavigationStack {
            List {
                Section {
                    MarketingPhoto(path: "/api/ads/studio/saved/" + item.s("id") + "?key=image").frame(height: 360)
                    Button("Open in Make") { Task { await model.restore(item); if model.error == nil { selected = nil } } }
                        .disabled(item["parts"].n("photo") == 0 || item["parts"].n("doc") == 0)
                    Button("Share or save image") { Task { await model.run("Preparing image…") { let bytes = try await ERPAPI.shared.data("/api/ads/studio/saved/" + item.s("id") + "?key=image"); let url = FileManager.default.temporaryDirectory.appendingPathComponent("saved-ad-\(UUID().uuidString).jpg"); try bytes.write(to: url); share = MarketingFileShare(items: [url]); selected = nil } } }
                    TextField("Name", text: Binding(get: { selected?.item.s("name") ?? item.s("name") }, set: { selected?.item["name"] = .string($0) }))
                    Button("Save name") { mutate("/api/ads/studio/saved", ["id": item.s("id"), "name": selected?.item.s("name") ?? item.s("name")], method: "PATCH") }
                    Menu("Move to folder") {
                        Button("Unfiled") { mutate("/api/ads/studio/saved", ["id": item.s("id"), "folder": NSNull()], method: "PATCH") }
                        ForEach(data["folders"].array, id: \.text) { f in Button(f.s("name")) { mutate("/api/ads/studio/saved", ["id": item.s("id"), "folder": f.s("id")], method: "PATCH") } }
                    }
                    Button("Delete design", role: .destructive) { deleting = item }
                }.houseRows()
                LedgerSection("Words and settings", collapsible: true) { MarketingDetails(fields: item.object.filter { $0.key != "thumb" }.mapValues(\.any)) }
            }.modifier(HouseGround()).navigationTitle(item.s("name")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { selected = nil } } }.websiteBusy(model.busy).failureAlert($model.error)
            .confirmationDialog("Delete “\(item.s("name"))”?", isPresented: Binding(get: { deleting != nil && selected != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete design", role: .destructive) { mutate("/api/ads/studio/saved?id=" + AdsQuery.escape(item.s("id")), method: "DELETE"); deleting = nil; selected = nil }
            }
        }
    }
    func load() async { do { data = try await MarketingRequest.get("/api/ads/studio/saved") } catch { model.error = error.localizedDescription } }
    func loadAccount() async {
        await model.run("Loading ad account…") {
            let r = try await MarketingRequest.get("/api/ads/campaigns?range=maximum")
            account = r["campaigns"].array.flatMap { $0["adsets"].array }.flatMap { $0["ads"].array }
        }
    }
    func mutate(_ path: String, _ body: [String: Any] = [:], method: String = "POST") { Task { await model.run("Saving…") { _ = try await MarketingRequest.send(path, body, method: method); await load() } } }
}

#if os(macOS)
extension StudioSaved {
    /// The folders down the left like a sidebar, the saved designs as a grid of cards, right-click on each.
    @ViewBuilder
    var macBody: some View {
        MacTwoPane(sideWidth: 260) {
            List(selection: $view) {
                Section {
                    Label("All", systemImage: "square.grid.2x2").tag("all")
                    Label("Unfiled", systemImage: "tray").tag("unfiled")
                    Label("In the ad account", systemImage: "megaphone").tag("account")
                    ForEach(data["folders"].array, id: \.text) { f in
                        Label(f.s("name"), systemImage: "folder").tag(f.s("id"))
                    }
                } header: { LedgerHeading(title: "Folders") }
                Section {
                    TextField("New folder name", text: $folderName)
                    Button("Create folder") { mutate("/api/ads/studio/saved/folders", ["name": folderName]); folderName = "" }.disabled(folderName.isEmpty)
                    if folder != .null {
                        TextField("Rename folder", text: $rename)
                        Button("Rename") { mutate("/api/ads/studio/saved/folders", ["id": folder.s("id"), "name": rename], method: "PATCH") }.disabled(rename.isEmpty)
                        Button("Delete folder…", role: .destructive) { deleting = MarketingValue(["deleteKind": "folder", "folder": folder.s("id"), "name": folder.s("name")]) }
                        Text("Designs inside a deleted folder stay unfiled.").font(.footnote).foregroundStyle(.secondary)
                    }
                } header: { LedgerHeading(title: "Manage") }
            }
            .listStyle(.sidebar)
        } main: {
            if view == "account" {
                List { Group { accountRows }.houseRows() }.listStyle(.inset)
            } else {
                ScrollView {
                    if items.isEmpty {
                        ContentUnavailableView("No saved designs here", systemImage: "folder").padding(40)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 14, alignment: .top)], spacing: 14) {
                            ForEach(items, id: \.text) { item in
                                Button { selected = StudioAssetChoice(item: item) } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        StockImage(imageUrl: item.s("thumb"), name: item.s("name"), key: item.s("id"), decodeDataURI: true)
                                            .aspectRatio(1, contentMode: .fit)
                                            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                                        Text(item.s("name")).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                                        Text(item.s("format")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    .ledgerCard(padding: 10)
                                }
                                .buttonStyle(.plain)
                                .pointerHover()
                                .contextMenu {
                                    Button("Open", systemImage: "arrow.up.forward.square") { selected = StudioAssetChoice(item: item) }
                                    Button("Open in Make", systemImage: "wand.and.stars") { Task { await model.restore(item) } }
                                        .disabled(item["parts"].n("photo") == 0 || item["parts"].n("doc") == 0)
                                    Menu("Move to folder", systemImage: "folder") {
                                        Button("Unfiled") { mutate("/api/ads/studio/saved", ["id": item.s("id"), "folder": NSNull()], method: "PATCH") }
                                        ForEach(data["folders"].array, id: \.text) { f in
                                            Button(f.s("name")) { mutate("/api/ads/studio/saved", ["id": item.s("id"), "folder": f.s("id")], method: "PATCH") }
                                        }
                                    }
                                    Button("Copy the name", systemImage: "doc.on.doc") { MacClipboard.copy(item.s("name")) }
                                    Divider()
                                    Button("Delete design…", systemImage: "trash", role: .destructive) { deleting = item }
                                }
                            }
                        }
                        .padding(20)
                    }
                }
            }
        }
        .navigationSubtitle(view == "account" ? "In the ad account" : "\(items.count) saved")
        .task { if !House.isDemo { await load() } }
        .task(id: view) { if view == "account", !House.isDemo { await loadAccount() } }
        .sheet(item: $selected) { choice in detail(choice.item).presentationSizing(.page).frame(minWidth: 560, minHeight: 640) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
        .confirmationDialog("Delete “\(deleting?.s("name") ?? "")”?", isPresented: Binding(get: { deleting != nil && selected == nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let item = deleting { if item.s("deleteKind") != "folder" { mutate("/api/ads/studio/saved?id=" + AdsQuery.escape(item.s("id")), method: "DELETE") } else { mutate("/api/ads/studio/saved/folders?id=" + AdsQuery.escape(item.s("folder")), method: "DELETE") }; deleting = nil; selected = nil } }
        }
    }
}
#endif
