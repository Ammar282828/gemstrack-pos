import SwiftUI
import WebKit
import ERPCore

/// The campaign menu and ad review use the same account-scoped routes as the ERP.
struct AdsObjectScreen: View {
    let path: String
    @State private var response: [String: Any]?
    @State private var failure: String?
    @State private var busy = false
    @State private var name = ""
    @State private var hasEnd = false
    @State private var end = Date().addingTimeInterval(7 * 86_400)
    @State private var confirming: String?
    @State private var audience: AdsAudience?
    @State private var audienceSheet = false
    @State private var budgeting: AdsBudgetTarget?
    @State private var format = 0
    @Environment(\.dismiss) private var dismiss

    private var id: String { AdsQuery.value("id", in: path) ?? "" }
    private var level: String { AdsQuery.value("level", in: path) ?? "ad" }
    private var object: [String: Any] { response?[level] as? [String: Any] ?? [:] }
    private var currency: String { response?["currency"] as? String ?? "PKR" }
    private var previews: [[String: Any]] { response?["previews"] as? [[String: Any]] ?? [] }
    private var totalBudget: Bool { number((response?["budget"] as? [String: Any])?["lifetime"]) > 0 }
    private func number(_ value: Any?) -> Double { (value as? NSNumber)?.doubleValue ?? Double(value as? String ?? "") ?? 0 }

    var body: some View {
        Group {
            if response != nil { form }
            else if let failure { ContentUnavailableView("Couldn't load this \(level)", systemImage: "megaphone", description: Text(failure)) }
            else { SkeletonLoading().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .modifier(HouseGround()).navigationTitle(name.isEmpty ? "Ad details" : name).navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $audienceSheet) {
            if let audience {
                AdsAudienceSheet(title: "Audience and placements", draft: audience, goal: object["optimization_goal"] as? String ?? "CONVERSATIONS", positions: []) { edited in
                    Task { await act("targeting", ["draft": edited.json]) }
                }
            }
        }
        .sheet(item: $budgeting) { target in AdsBudgetSheet(target: target) { await load() } }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if let action = confirming {
                Button(confirmTitle, role: action == "delete" ? .destructive : nil) {
                    confirming = nil
                    Task { await act(action == "activate" ? "status" : action, action == "activate" ? ["status": "ACTIVE"] : [:]) }
                }
            }
        } message: { Text(confirmMessage) }
    }

    private var confirmTitle: String {
        ["activate": "Run it", "duplicate": "Duplicate (paused)", "archive": "Archive", "delete": "Delete permanently"][confirming ?? ""] ?? "Confirm"
    }
    private var confirmMessage: String {
        switch confirming {
        case "activate": return "\(name) will start spending its budget."
        case "duplicate": return "Make a paused copy, including everything under this \(level)."
        case "archive": return "Stop this \(level) and everything under it. It stays available under Show archived."
        case "delete": return "Stop this \(level) and everything under it permanently. This cannot be undone."
        default: return ""
        }
    }

    private var form: some View {
        Form {
            if let failure { Section { Text(failure).foregroundStyle(.red) }.houseRows() }
            if busy { Section { SkeletonLoading("Saving…") }.houseRows() }
            LedgerSection("Status") {
                AdsStatusBadge(status: object["effective_status"] as? String ?? "")
                Button(object["status"] as? String == "ACTIVE" ? "Pause" : "Run") {
                    if object["status"] as? String == "ACTIVE" { Task { await act("status", ["status": "PAUSED"]) } }
                    else { confirming = "activate" }
                }.disabled(busy)
            }
            if level == "ad" { previewSection }
            LedgerSection("Name") {
                TextField("Name", text: $name, axis: .vertical).lineLimit(1...4)
                Button("Save name") { Task { await act("rename", ["name": name.trimmingCharacters(in: .whitespacesAndNewlines)]) } }
                    .disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name == object["name"] as? String)
            }
            if level != "ad" {
                LedgerSection("Budget and schedule") {
                    if let budget = response?["budget"] as? [String: Any], number(budget["daily"]) > 0 || number(budget["lifetime"]) > 0 {
                        Button("Change budget", systemImage: "banknote") {
                            budgeting = AdsBudgetTarget(level: level, id: id, name: name,
                                daily: number(budget["daily"]) > 0 ? number(budget["daily"]) : nil,
                                lifetime: number(budget["lifetime"]) > 0 ? number(budget["lifetime"]) : nil,
                                end: object[level == "campaign" ? "stop_time" : "end_time"] as? String, currency: currency)
                        }
                    }
                    Toggle("End date", isOn: $hasEnd).disabled(totalBudget)
                    if hasEnd || totalBudget { DatePicker("Stops", selection: $end, in: Date()...) }
                    Button("Save schedule") { Task { await act("schedule", ["end": hasEnd || totalBudget ? ERPDate.iso(end) as Any : NSNull()]) } }.disabled(busy)
                    if totalBudget { Text("A total budget needs an end date. Meta spreads the budget up to it.").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            if level == "adset" {
                LedgerSection("Audience and placements") {
                    Button("Edit audience and placements", systemImage: "person.2") { audienceSheet = true }.disabled(audience == nil || busy)
                    MarketingDetails(fields: object["targeting"] as? [String: Any] ?? [:])
                }
            }
            LedgerSection("Make from this") {
                if level == "ad" {
                    NavigationLink("Make one like this", value: Route(path: "/ads/new?from=\(AdsQuery.escape(id))"))
                    NavigationLink("Into new ad sets", value: Route(path: "/ads/adset?ads=\(AdsQuery.escape(id))"))
                } else if level == "campaign" {
                    NavigationLink("Add ad sets", value: Route(path: "/ads/adset?campaign=\(AdsQuery.escape(id))"))
                } else {
                    NavigationLink("Copy and change", value: Route(path: "/ads/adset?from=\(AdsQuery.escape(id))"))
                }
                Button("Duplicate (paused)", systemImage: "doc.on.doc") { confirming = "duplicate" }.disabled(busy)
            }
            LedgerSection("Details and review notes", collapsible: true) { MarketingDetails(fields: object) }
            LedgerSection("Manage") {
                Button("Archive", systemImage: "archivebox") { confirming = "archive" }.disabled(busy)
                Button("Delete permanently", role: .destructive) { confirming = "delete" }.disabled(busy)
            }
        }
        .refreshable { await load() }
    }

    private var previewSection: some View {
        LedgerSection("Preview") {
            if !previews.isEmpty {
                Picker("Placement", selection: $format) {
                    ForEach(Array(previews.enumerated()), id: \.offset) { i, p in Text((p["format"] as? String ?? "Preview").replacingOccurrences(of: "_", with: " ").capitalized).tag(i) }
                }
                if format < previews.count, let html = previews[format]["html"] as? String,
                   let url = MetaAdPreview.url(in: html) {
                    MetaAdPreview(url: url).frame(height: (previews[format]["format"] as? String ?? "").contains("STORY") ? 620 : 520)
                }
            } else { Text("Meta hasn't returned a preview yet.").foregroundStyle(.secondary) }
            if let creative = object["creative"] as? [String: Any] {
                if let image = creative["image_url"] as? String ?? creative["thumbnail_url"] as? String {
                    StockImage(imageUrl: image, name: name, key: id).aspectRatio(contentMode: .fit)
                }
                if let text = creative["body"] as? String { Text(text).fixedSize(horizontal: false, vertical: true) }
                if let title = creative["title"] as? String { Text(title).font(.headline) }
                if let link = creative["instagram_permalink_url"] as? String, let url = URL(string: link), url.scheme == "https" { Link("On Instagram", destination: url) }
            }
        }
    }

    private func load() async {
        do {
            let data = try await ERPAPI.shared.data("/api/ads/object/\(AdsQuery.escape(id))?level=\(level)")
            response = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            name = object["name"] as? String ?? ""
            let value = object[level == "campaign" ? "stop_time" : "end_time"] as? String
            hasEnd = ERPDate.parse(value) != nil
            end = ERPDate.parse(value) ?? Date().addingTimeInterval(7 * 86_400)
            if let raw = response?["audience"] as? [String: Any] { audience = try JSONDecoder().decode(AdsAudience.self, from: JSONSerialization.data(withJSONObject: raw)) }
            failure = nil
        } catch { failure = error.localizedDescription }
    }
    private func act(_ action: String, _ fields: [String: Any]) async {
        guard !busy else { return }; busy = true; failure = nil
        defer { busy = false }
        do {
            var body = fields; body["action"] = action; body["level"] = level
            _ = try await ERPAPI.shared.send("/api/ads/object/\(AdsQuery.escape(id))", body)
            if action == "delete" || action == "archive" { dismiss() } else { await load() }
        } catch { failure = error.localizedDescription }
    }
}

/// Full Meta feedback stays readable without raw JSON or a browser page.
struct MarketingDetails: View {
    let fields: [String: Any]
    var body: some View {
        ForEach(fields.keys.sorted(), id: \.self) { key in
            item(key, value: fields[key] ?? NSNull())
        }
    }
    private func item(_ key: String, value: Any) -> AnyView {
        let title = key.replacingOccurrences(of: "_", with: " ").capitalized
        if let object = value as? [String: Any] {
            return AnyView(DisclosureGroup(title) { MarketingDetails(fields: object) })
        }
        if let array = value as? [Any] {
            return AnyView(DisclosureGroup(title) {
                ForEach(Array(array.enumerated()), id: \.offset) { index, value in item("\(index + 1)", value: value) }
            })
        }
        if value is NSNull { return AnyView(EmptyView()) }
        return AnyView(VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(String(describing: value)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.padding(.vertical, 3))
    }
}

/// Meta's actual ad iframe, only for preview media; all ERP controls remain native.
struct MetaAdPreview: UIViewRepresentable {
    let url: URL
    static func url(in html: String) -> URL? {
        guard let range = html.range(of: #"src="([^"]+)""#, options: .regularExpression) else { return nil }
        let text = String(html[range]).dropFirst(5).dropLast().replacingOccurrences(of: "&amp;", with: "&")
        guard let url = URL(string: text), url.scheme == "https", let host = url.host,
              host == "facebook.com" || host.hasSuffix(".facebook.com") else { return nil }
        return url
    }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.load(URLRequest(url: url)); return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { if view.url != url { view.load(URLRequest(url: url)) } }
}
