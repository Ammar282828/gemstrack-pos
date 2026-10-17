import SwiftUI

/// Saved › In the ad account (saved-shelf.tsx AccountAds; owner and marketing): the ads already running in Meta, any of which can be kept in a
/// folder through the Saved ads route, as ever. GET /api/ads/campaigns?range=maximum, then POST /api/ads/studio/saved { fromAd, folder }.
struct DesignAccountAds: View {
    let folders: [DesignFolder]
    let onKept: () -> Void

    private struct Ad: Identifiable {
        let id: String
        let name: String
        let image: String
        let status: String
        let place: String
    }

    @State private var ads: [Ad]?
    @State private var error: String?
    /// A refused Keep: said in an alert, not in place of the list.
    @State private var problem: String?
    @State private var q = ""
    @State private var to = ""
    @State private var busy: String?
    @State private var kept = 0

    private var shown: [Ad] {
        let words = q.lowercased().split(separator: " ").map(String.init)
        return (ads ?? []).filter { a in
            let hay = "\(a.name) \(a.place)".lowercased()
            return words.allSatisfy { hay.contains($0) }
        }
    }

    var body: some View {
        Group {
            Section {
                TextField("Find an ad", text: $q).textInputAutocapitalization(.never)
                Picker("Keep into", selection: $to) {
                    Text("Unfiled").tag("")
                    ForEach(folders) { Text($0.name).tag($0.id) }
                }
            }.houseRows()
            if let error {
                Section { ErrorState(error) { self.error = nil; Task { await load() } } }.listRowBackground(Color.clear)
            } else if ads == nil {
                Section { SkeletonLoading("Reading the ad account") }.houseRows()
            } else if shown.isEmpty {
                Section {
                    ContentUnavailableView("No ads", systemImage: "megaphone", description: Text("The ad account has none that match."))
                }.listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(shown) { a in
                        HStack(spacing: 12) {
                            Group {
                                if a.image.isEmpty { Rectangle().fill(Theme.ground) } else { MarketingPhoto(path: a.image) }
                            }
                            .frame(width: 52, height: 52).background(Theme.ground).clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                Text(a.place).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                Text(a.status == "ACTIVE" ? "Running" : a.status.lowercased().replacingOccurrences(of: "_", with: " ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Button { Task { await keep(a) } } label: {
                                if busy == a.id { ProgressView() } else { Image(systemName: "square.and.arrow.down") }
                            }
                            .buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44).disabled(busy != nil).accessibilityLabel("Keep in a folder")
                        }
                    }
                }.houseRows()
            }
        }
        .task { await load() }
        .savedFeedback(trigger: kept)
        .failureAlert($problem, title: "Could not keep it")
    }

    private func load() async {
        guard ads == nil else { return }
        do {
            let r = try await MarketingRequest.get("/api/ads/campaigns?range=maximum")
            ads = r["campaigns"].array.flatMap { c in
                c["adsets"].array.flatMap { s in
                    s["ads"].array.map { a in
                        Ad(id: a.s("id"), name: a.s("name"), image: a.s("image").isEmpty ? a.s("thumbnail") : a.s("image"), status: a.s("effectiveStatus"), place: "\(c.s("name")) › \(s.s("name"))")
                    }
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    private func keep(_ a: Ad) async {
        busy = a.id
        defer { busy = nil }
        do {
            var body: [String: Any] = ["fromAd": a.id]
            body["folder"] = to.isEmpty ? NSNull() : to
            _ = try await MarketingRequest.send("/api/ads/studio/saved", body)
            kept += 1
            onKept()
        } catch { problem = error.localizedDescription }
    }
}
