import SwiftUI

/// Competitor research calls the same server tools as the browser; only public account data is read.
struct StudioRivals: View {
    @State private var rows: [MarketingValue] = []
    @State private var found: [MarketingValue] = []
    @State private var brief = ""
    @State private var username = ""
    @State private var busy: String?
    @State private var error: String?
    var body: some View {
        Section {
            TextField("Search focus (optional)", text: $brief, axis: .vertical)
            Button("Find competitors") { action("Searching…") { found = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "find", "brief": brief])["found"].array } }
            TextField("@username or Instagram link", text: $username).textInputAutocapitalization(.never)
            Button("Add account") { add(MarketingValue(["username": username, "source": "owner"])) }.disabled(username.isEmpty)
            if let busy { SkeletonLoading(busy) }; if let error { Text(error).foregroundStyle(.red) }
        }.houseRows().task { if !House.isDemo { await load() } }.disabled(busy != nil)
        if !found.isEmpty {
            LedgerSection("Found") {
                ForEach(found, id: \.text) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.s("name")).font(.headline); Text(item.s("why")).font(.subheadline).foregroundStyle(.secondary)
                        StudioLinks(value: item)
                        Button("Add @" + item.s("instagram")) { var payload = item; payload["username"] = item["instagram"]; payload["source"] = .string("search"); add(payload) }.disabled(item.s("instagram").isEmpty)
                    }.padding(.vertical, 5)
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
                    if !item.s("profileError").isEmpty { Text(item.s("profileError")).foregroundStyle(.red) }
                    DisclosureGroup("Recent posts") {
                        ForEach(item["profile"]["posts"].array.sorted { $0.n("rate") > $1.n("rate") }, id: \.text) { post in
                            VStack(alignment: .leading, spacing: 5) {
                                MarketingPhoto(path: post.s("image")).frame(height: 200)
                                Text(post.s("caption")).font(.subheadline)
                                MarketingDetails(fields: post.object.filter { !["thumbnailUrl", "mediaUrl", "caption"].contains($0.key) }.mapValues(\.any))
                            }
                        }
                    }
                    if item["reading"] != .null { MarketingDetails(fields: item["reading"].object.mapValues(\.any)) }
                    Button("Remove account", role: .destructive) { action("Removing…") { _ = try await MarketingRequest.send("/api/ads/studio/competitors", ["action": "remove", "username": item.s("username")]); await load() } }
                }
            }.houseRows().disabled(busy != nil)
        }
    }
    private func load() async { do { rows = try await MarketingRequest.get("/api/ads/studio/competitors")["competitors"].array } catch { self.error = error.localizedDescription } }
    private func action(_ title: String, _ work: @escaping () async throws -> Void) { Task { busy = title; error = nil; defer { busy = nil }; do { try await work() } catch { self.error = error.localizedDescription } } }
    private func add(_ item: MarketingValue) { action("Adding account…") { var body = item.object.mapValues(\.any); body["action"] = "add"; _ = try await MarketingRequest.send("/api/ads/studio/competitors", body); username = ""; await load() } }
    private func look(_ item: MarketingValue, read: Bool) { action(read ? "Reading the feed…" : "Looking up account…") { let path = "/api/ads/studio/competitors/" + AdsQuery.escape(item.s("username")); let r = read ? try await MarketingRequest.send(path) : try await MarketingRequest.get(path + "?fresh=1"); rows = rows.map { $0.s("username") == item.s("username") ? r["competitor"] : $0 } } }
}

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
                            HStack(spacing: 12) { StockImage(imageUrl: item.s("thumb"), name: item.s("name"), key: item.s("id"), decodeDataURI: true).frame(width: 90, height: 90); VStack(alignment: .leading, spacing: 4) { Text(item.s("name")).foregroundStyle(.primary); Text(item.s("format")).font(.caption).foregroundStyle(.secondary) } }
                        }
                    }
                    if items.isEmpty { Text("No saved designs here.").foregroundStyle(.secondary) }
                }.houseRows()
            }
        }
        .task { if !House.isDemo { await load() } }
        .task(id: view) { if view == "account", !House.isDemo { await loadAccount() } }
        .refreshable { await load() }
        .sheet(item: $selected) { choice in detail(choice.item) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
        .confirmationDialog("Delete “\(deleting?.s("name") ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let item = deleting { if item.s("deleteKind") != "folder" { mutate("/api/ads/studio/saved?id=" + AdsQuery.escape(item.s("id")), method: "DELETE") } else { mutate("/api/ads/studio/saved/folders?id=" + AdsQuery.escape(item.s("folder")), method: "DELETE") }; deleting = nil; selected = nil } }
        }
    }
    @ViewBuilder private var accountRows: some View {
        Section {
            ForEach(account, id: \.text) { ad in
                VStack(alignment: .leading, spacing: 8) {
                    Text(ad.s("name")).font(.headline)
                    Text(ad.s("effective_status")).font(.caption).foregroundStyle(.secondary)
                    NavigationLink("Ad details", value: Route(path: "/ads/object?id=" + ad.s("id") + "&kind=ad"))
                    Menu("Keep in a folder") {
                        Button("Unfiled") { mutate("/api/ads/studio/saved", ["fromAd": ad.s("id")]) }
                        ForEach(data["folders"].array, id: \.text) { f in Button(f.s("name")) { mutate("/api/ads/studio/saved", ["fromAd": ad.s("id"), "folder": f.s("id")]) } }
                    }
                }.padding(.vertical, 5)
            }
        }.houseRows()
    }
    private func detail(_ item: MarketingValue) -> some View {
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
                    Button("Delete design", role: .destructive) { deleting = item; selected = nil }
                }.houseRows()
                LedgerSection("Words and settings", collapsible: true) { MarketingDetails(fields: item.object.filter { $0.key != "thumb" }.mapValues(\.any)) }
                if let error = model.error { Section { Text(error).foregroundStyle(.red) }.houseRows() }
            }.modifier(HouseGround()).navigationTitle(item.s("name")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { selected = nil } } }.websiteBusy(model.busy)
        }
    }
    private func load() async { do { data = try await MarketingRequest.get("/api/ads/studio/saved") } catch { model.error = error.localizedDescription } }
    private func loadAccount() async {
        await model.run("Loading ad account…") {
            let r = try await MarketingRequest.get("/api/ads/campaigns?range=maximum")
            account = r["campaigns"].array.flatMap { $0["adsets"].array }.flatMap { $0["ads"].array }
        }
    }
    private func mutate(_ path: String, _ body: [String: Any] = [:], method: String = "POST") { Task { await model.run("Saving…") { _ = try await MarketingRequest.send(path, body, method: method); await load() } } }
}
