import SwiftUI

struct StudioLibrary: View {
    @Bindable var model: StudioModel
    @State private var answer = MarketingValue.null
    @State private var rows: [MarketingValue] = []
    @State private var assessState = MarketingValue.null
    @State private var q = ""
    @State private var placement = "portrait"
    @State private var source = "all"
    @State private var filter = "all"
    @State private var collection = ""
    @State private var sort = "newest"
    @State private var opened: StudioAssetChoice?
    @State private var driveLink = ""
    private var queryKey: String { [model.part, q, placement, source, filter, collection, sort].joined(separator: "|") }
    var body: some View {
        List {
            Section {
                Picker("Photos", selection: $model.part) { Text("Best for ads").tag("picks"); Text("Every photo").tag("library") }
                Picker("Placement", selection: $placement) { Text("Feed · 4:5").tag("portrait"); Text("Feed · 1:1").tag("square"); Text("Stories · 9:16").tag("story") }
                DisclosureGroup("Filters") {
                    Picker("Source", selection: $source) { Text("All").tag("all"); Text("Website").tag("site"); Text("Drive").tag("drive"); Text("Uploads").tag("upload") }
                    Picker("Assessment", selection: $filter) { ForEach(["all", "unassessed", "assessed", "fixable", "risky"], id: \.self) { Text(ArtworkProperties.label($0)).tag($0) } }
                    Picker("Collection", selection: $collection) { Text("All").tag(""); ForEach(answer["collections"].array, id: \.text) { Text($0.s("name") + " · " + String(Int($0.n("count")))).tag($0.s("name")) } }
                    Picker("Sort", selection: $sort) { Text("Newest first").tag("newest"); Text("Best score first").tag("score") }
                }
            }.houseRows()
            if !rows.isEmpty {
                Section {
                    ForEach(rows, id: \.text) { item in
                        Button { opened = StudioAssetChoice(item: item) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                MarketingPhoto(path: item.s("thumb")).frame(width: 92, height: 92).clipShape(.rect(cornerRadius: 10))
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.s("name")).foregroundStyle(.primary)
                                    Text(item.s("collection")).font(.caption).foregroundStyle(.secondary)
                                    if item["adScore"] != .null { Text("Ad score · \(Int(item.n("adScore")))").font(.caption).foregroundStyle(Theme.accent) }
                                    else { Text("Not assessed").font(.caption).foregroundStyle(.secondary) }
                                    if item["usedInAds"].bool { Text("Used in an ad").font(.caption).foregroundStyle(.secondary) }
                                }
                            }.padding(.vertical, 5)
                        }
                    }
                    if rows.count < Int(answer.n("total")) { Button("Show more") { Task { await load(more: true) } } }
                }.houseRows()
            } else { Section { Text("No photos match these filters.").foregroundStyle(.secondary) }.houseRows() }
            assessment
            drive
        }
        .searchable(text: $q, prompt: "Name, subject or collection")
        .task(id: queryKey) { if !House.isDemo { do { try await Task.sleep(for: .milliseconds(250)); await load() } catch {} } }
        .refreshable { await load(fresh: true) }
        .sheet(item: $opened) { choice in StudioAssetSheet(item: choice.item, placement: placement, model: model) { await load() } }
    }
    private var assessment: some View {
        LedgerSection("Assessment", collapsible: true) {
            MarketingDetails(fields: answer["counts"].object.mapValues(\.any))
            Button("Assess unassessed photos") { assess(["next": true]) }
            Button("Assess this page") { assess(["ids": rows.map { $0.s("id") }]) }
            Toggle("Assess in the background", isOn: Binding(get: { assessState["background"].bool }, set: { assess(["background": $0]) }))
            MarketingDetails(fields: assessState.object.filter { $0.key != "background" }.mapValues(\.any))
        }
    }
    private var drive: some View {
        LedgerSection("Google Drive", collapsible: true) {
            let details = answer["drive"]
            if !details.s("account").isEmpty {
                Text(details.s("account")).textSelection(.enabled)
                Button("Copy sharing address") { UIPasteboard.general.string = details.s("account") }
                Text("Share the photo folders with this address as Viewer, without notifying.").font(.footnote).foregroundStyle(.secondary)
            }
            TextField("Folder link", text: $driveLink).keyboardType(.URL).textInputAutocapitalization(.never)
            Button("Add folder") { Task { await model.run("Adding Drive folder…") { _ = try await MarketingRequest.send("/api/ads/studio/drive", ["link": driveLink]); driveLink = "" }; await load(fresh: true) } }.disabled(driveLink.isEmpty)
            ForEach(details["roots"].array, id: \.text) { folder in
                HStack { Text(folder.s("name")); Spacer(); Button("Unlink", role: .destructive) { Task { await model.run("Unlinking folder…") { _ = try await MarketingRequest.send("/api/ads/studio/drive?id=" + AdsQuery.escape(folder.s("id")), method: "DELETE") }; await load(fresh: true) } } }
            }
            MarketingDetails(fields: details.object.filter { !["roots", "account"].contains($0.key) }.mapValues(\.any))
            if let url = URL(string: details.s("enableUrl")), url.scheme == "https" { Link("Enable Drive API", destination: url) }
            if !answer.s("siteError").isEmpty { Text(answer.s("siteError")).foregroundStyle(.red) }
            Button("Check again") { Task { await load(fresh: true) } }
        }
    }
    private func load(more: Bool = false, fresh: Bool = false) async {
        let params = ["view": model.part == "picks" ? "picks" : "all", "placement": placement, "source": source, "filter": filter, "collection": collection, "q": q, "sort": sort, "offset": more ? String(rows.count) : "0", "limit": "60", "fresh": fresh ? "1" : "0"]
        let path = "/api/ads/studio/library?" + params.sorted { $0.key < $1.key }.map { $0.key + "=" + AdsQuery.escape($0.value) }.joined(separator: "&")
        do {
            let r = try await MarketingRequest.get(path); guard !Task.isCancelled else { return }
            answer = r; rows = more ? rows + r["items"].array : r["items"].array
            assessState = try await MarketingRequest.get("/api/ads/studio/assess")
        } catch { if !Task.isCancelled { model.error = error.localizedDescription } }
    }
    private func assess(_ body: [String: Any]) { Task { await model.run("Assessing photos…") { assessState = try await MarketingRequest.send("/api/ads/studio/assess", body) }; await load() } }
}

struct StudioAssetChoice: Identifiable { let id = UUID(); var item: MarketingValue }
struct StudioAssetSheet: View {
    @State var item: MarketingValue
    let placement: String
    @Bindable var model: StudioModel
    let changed: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var share: MarketingFileShare?
    var body: some View {
        NavigationStack {
            List {
                Section {
                    MarketingPhoto(path: "/api/ads/studio/image?id=" + AdsQuery.escape(item.s("id")) + "&size=1200").frame(height: 300)
                    Text(item.s("name")).font(.headline)
                    Text(item.s("specs")).font(.subheadline).foregroundStyle(.secondary)
                    Button("Make an ad with it") { Task { await model.choose(item); if model.error == nil { dismiss() } } }.buttonStyle(.houseProminent)
                    Button("Share original") { Task { await model.run("Preparing photo…") { let data = try await ERPAPI.shared.data("/api/ads/studio/image?id=" + AdsQuery.escape(item.s("id")) + "&size=2400"); let url = FileManager.default.temporaryDirectory.appendingPathComponent("photo-\(UUID().uuidString).jpg"); try data.write(to: url); share = MarketingFileShare(items: [url]) } } }
                    Button(item["assessment"] == .null ? "Assess photo" : "Assess again") { Task { await assess() } }
                }.houseRows()
                LedgerSection("Assessment") { MarketingDetails(fields: item["assessment"].object.mapValues(\.any)) }
                LedgerSection("Photo tools") {
                    Text("Open in Make for crop, all photo shapes, retouching, lighting and new settings.").font(.footnote).foregroundStyle(.secondary)
                    ForEach([("crop-tighter", "Crop tighter"), ("extend-portrait", "Extend to 4:5"), ("extend-story", "Extend to 9:16"), ("clear-labels", "Clear old labels"), ("retouch", "Retouch"), ("enhance", "Enhance light"), ("restage", "New setting")], id: \.0) { key, label in
                        Button(label) { Task { await model.choose(item, preferOriginal: false); if model.error == nil {
                            if key == "extend-portrait" || key == "extend-story" { await model.imageAI("reframe", params: ["aspect": key == "extend-story" ? "9:16" : "4:5", "tidy": true]) }
                            else if key == "clear-labels" { await model.imageAI("enhance", params: ["tidy": true]) }
                            else if ["retouch", "enhance"].contains(key) { await model.imageAI(key) }
                            dismiss()
                        } } }
                    }
                }
                if let url = URL(string: item.s("page")), url.scheme == "https" { Section { Link("View on the website", destination: url) }.houseRows() }
            }.modifier(HouseGround()).navigationTitle("Photo").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $share) { MarketingShareSheet(items: $0.items) }.websiteBusy(model.busy)
        }
    }
    private func assess() async {
        await model.run("Assessing photo…") {
            _ = try await MarketingRequest.send("/api/ads/studio/assess", ["ids": [item.s("id")], "force": true, "budgetMs": 90000])
            let r = try await MarketingRequest.get("/api/ads/studio/library?view=all&placement=" + placement + "&id=" + AdsQuery.escape(item.s("id")))
            if let next = r["items"].array.first { item = next }; await changed()
        }
    }
}
