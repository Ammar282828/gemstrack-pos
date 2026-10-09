import SwiftUI
import UIKit
import ERPCore

// The pieces of New ad (AdsNewAd.swift) and the ad set designer (AdsAdSets.swift) that are views of their own:
// the post grid, a photo's row, the ad account's library, the website's pieces, a goal's row. The words New ad
// fills in for a website piece are the web's own (src/app/ads/new/page.tsx pieceText).

enum AdsNewAdWords {
    /// A website piece's first words: its name and weight, its facts, and the line the goal asks for.
    static func pieceText(_ p: PostPiece, goal: String, toSite: Bool) -> String {
        var first = p.name
        if let g = p.weightGrams, g > 0 { first += " — \(grams(g))g" }
        let facts = p.facts.joined(separator: " · ")
        let close = goal == "whatsapp" || goal == "instagram_dm" ? "Message us for today’s price." : (toSite ? "See it on the website." : "")
        var lines = [first]
        if !facts.isEmpty { lines.append(facts) }
        lines.append("")
        if !close.isEmpty { lines.append(close) }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 12.4 → "12.4", 12 → "12", as the web writes a number.
    static func grams(_ g: Double) -> String {
        g == g.rounded() ? String(Int(g)) : String(g)
    }

    /// The shop's WhatsApp channel link, the only place a channel ad can go (plan.ts isChannelLink).
    static func isChannelLink(_ s: String) -> Bool {
        s.trimmingCharacters(in: .whitespaces).range(of: #"^https://(www\.)?whatsapp\.com/channel/\S+"#, options: .regularExpression) != nil
    }

    /// A web address the button can open (plan.ts planProblems' own test).
    static func isWebLink(_ s: String) -> Bool {
        s.trimmingCharacters(in: .whitespaces).range(of: #"^https?://\S+\.\S+"#, options: .regularExpression) != nil
    }

    static func symbol(_ goal: String) -> String {
        switch goal {
        case "whatsapp": return "message"
        case "messages": return "bubble.left.and.bubble.right"
        case "instagram_dm": return "paperplane"
        case "website": return "cursorarrow.click"
        case "sales": return "bag"
        case "channel": return "dot.radiowaves.left.and.right"
        case "profile": return "person.crop.circle"
        case "engagement": return "heart"
        default: return "antenna.radiowaves.left.and.right"
        }
    }
}

/// Meta's previews, as a sheet's item.
struct AdsPreviewSet: Identifiable {
    let id = UUID()
    let previews: [AdsPreview]
}

/// A goal on the picker: its words, and a tick on the chosen one.
struct AdsGoalLabel: View {
    let goal: AdsGoal
    let chosen: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: AdsNewAdWords.symbol(goal.key))
                .foregroundStyle(chosen ? Theme.accent : Color.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(goal.label).foregroundStyle(.primary)
                Text(goal.hint).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if chosen { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
        }
    }
}

/// The house's recent Instagram posts and reels, to promote one as it is. One Meta won't boost is dimmed.
struct AdsMediaGrid: View {
    let media: [AdsMedia]
    let chosen: String?
    let pick: (AdsMedia) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 6) {
            ForEach(media) { (m: AdsMedia) in
                Button { pick(m) } label: { tile(m) }
                    .buttonStyle(.plain)
                    .disabled(m.boostable == false)
                    .accessibilityLabel(m.caption.isEmpty ? "Post" : m.caption)
            }
        }
        .padding(.vertical, 4)
    }

    private func tile(_ m: AdsMedia) -> some View {
        let on = chosen == m.id
        return StockImage(imageUrl: m.thumb, name: m.caption.isEmpty ? "Post" : m.caption, key: m.id)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 8))
            .overlay(alignment: .topLeading) {
                if let w = m.kindWord {
                    Text(w)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.6), in: .rect(cornerRadius: 4))
                        .padding(4)
                }
            }
            .overlay(alignment: .topTrailing) {
                if on {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Theme.accent)
                        .padding(4)
                }
            }
            .overlay {
                if on { RoundedRectangle(cornerRadius: 8).stroke(Theme.accent, lineWidth: 3) }
            }
            .opacity(m.boostable == false ? 0.4 : 1)
    }
}

/// The website's pieces as a grid; a tap adds the piece as a photo of the ad.
struct AdsPieceGrid: View {
    let pieces: [PostPiece]
    let full: Bool
    let pick: (PostPiece) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 8) {
            ForEach(pieces) { (p: PostPiece) in
                Button { pick(p) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        StockImage(imageUrl: p.thumb, name: p.name, key: p.id)
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(.rect(cornerRadius: 8))
                        Text(p.name).font(.caption2).lineLimit(2)
                    }
                }
                .buttonStyle(.plain)
                .disabled(full)
            }
        }
        .padding(.vertical, 4)
    }
}

/// One photo of a new ad: on its way to Meta, refused, or ready; in a carousel, its own headline and link and
/// its place in the order.
struct AdsPhotoRow: View {
    @Binding var photo: AdsPhoto
    /// More than one photo: a carousel.
    let carousel: Bool
    /// Each card may open its own page (website ads).
    let ownLinks: Bool
    let first: Bool
    let last: Bool
    let move: (Int) -> Void
    let remove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            thumb
                .frame(width: 56, height: 56)
                .clipShape(.rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 6) { state }
            Spacer(minLength: 4)
            if carousel {
                VStack(spacing: 8) {
                    Button { move(-1) } label: { Image(systemName: "chevron.up") }
                        .buttonStyle(.borderless)
                        .disabled(first)
                        .accessibilityLabel("Earlier")
                    Button { move(1) } label: { Image(systemName: "chevron.down") }
                        .buttonStyle(.borderless)
                        .disabled(last)
                        .accessibilityLabel("Later")
                }
            }
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove the photo")
        }
    }

    @ViewBuilder
    private var state: some View {
        if photo.uploading {
            HStack(spacing: 6) {
                ProgressView()
                Text("Sending to Meta…")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        } else if let e = photo.error {
            Text(e).font(.caption).foregroundStyle(.red)
        } else if carousel {
            TextField("Card headline", text: $photo.headline)
            if ownLinks {
                TextField("Card link (optional)", text: $photo.link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        } else {
            Text("Ready").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var thumb: some View {
        if let d = photo.preview, let img = UIImage(data: d) {
            Image(uiImage: img).resizable().scaledToFill()
        } else {
            StockImage(imageUrl: photo.thumb ?? photo.url, name: photo.headline.isEmpty ? "Photo" : photo.headline, key: photo.key)
        }
    }
}

/// Every picture in the ad account's Ads Manager library (/api/ads/library), to use again without uploading.
struct AdsLibrarySheet: View {
    /// The hashes the ad already has.
    let chosen: Set<String>
    /// How many more the ad can take (ten at most).
    let room: Int
    let pick: (AdsLibraryImage) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var images: [AdsLibraryImage]?
    @State private var after: String?
    @State private var problem: String?
    @State private var busy = false
    @State private var added: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Every picture in this ad account's Ads Manager library: tap one to use it again.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let problem {
                        Text(problem).foregroundStyle(.red)
                        Button("Try again") { Task { await load(nil) } }.buttonStyle(.glass)
                    }
                    grid
                }
                .padding(16)
            }
            .modifier(HouseGround())
            .navigationTitle("Ad account photos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { if images == nil { await load(nil) } }
        }
    }

    @ViewBuilder
    private var grid: some View {
        if let images {
            if images.isEmpty {
                ContentUnavailableView("The library is empty so far", systemImage: "photo.on.rectangle")
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], spacing: 6) {
                ForEach(images) { (img: AdsLibraryImage) in tile(img) }
            }
            if let after {
                Button(busy ? "Reading…" : "More") { Task { await load(after) } }
                    .buttonStyle(.glass)
                    .disabled(busy)
                    .frame(maxWidth: .infinity)
            }
        } else if problem == nil {
            MarketingReading(text: "Reading the library…")
        }
    }

    private func tile(_ img: AdsLibraryImage) -> some View {
        let used = chosen.contains(img.hash) || added.contains(img.hash)
        return Button {
            added.insert(img.hash)
            pick(img)
        } label: {
            StockImage(imageUrl: img.thumb, name: img.name.isEmpty ? "Photo" : img.name, key: img.hash)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 8))
                .overlay(alignment: .topTrailing) {
                    if used {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent).padding(4)
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(used || added.count >= room)
    }

    private func load(_ cursor: String?) async {
        busy = true
        defer { busy = false }
        do {
            let a = try await AdsAPI.library(after: cursor)
            images = (cursor == nil ? [] : (images ?? [])) + a.images
            after = a.after
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// The last audience, budget and goal, on this phone (the web keeps them per device too: `taheri_ads_last`).
struct AdsLastChoice: Decodable {
    let audience: AdsAudience?
    let amount: Double?
    let budgetKind: String?
    /// Present: the days chosen, nil for "until I stop it". Absent: never chosen.
    let hasDays: Bool
    let days: Int?
    let goal: String?

    private static let key = "ads.newAd.last"

    private enum K: String, CodingKey { case audience, amount, budgetKind, days, goal }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        audience = c.object(.audience, of: AdsAudience.self)
        amount = c.double(.amount)
        budgetKind = c.string(.budgetKind)
        hasDays = c.contains(.days)
        days = c.int(.days)
        goal = c.string(.goal)
    }

    static func read() -> AdsLastChoice? {
        guard let d = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(AdsLastChoice.self, from: d)
    }

    static func keep(audience: AdsAudience, amount: Double, budgetKind: String, days: Int?, goal: String) {
        var o: [String: Any] = [:]
        o["audience"] = audience.json
        o["amount"] = amount
        o["budgetKind"] = budgetKind
        o["days"] = AdsJSON.orNull(days)
        o["goal"] = goal
        guard let d = try? JSONSerialization.data(withJSONObject: o) else { return }
        UserDefaults.standard.set(d, forKey: key)
    }
}
