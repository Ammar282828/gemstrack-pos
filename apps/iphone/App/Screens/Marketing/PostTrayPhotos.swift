import SwiftUI
import UIKit
import PhotosUI
import ERPCore

// A tray card's photos (src/app/posts/piece-photos.tsx, 2026-10-23: "send multiple pics of a product together with one
// description"): the piece's lead and its own other photographs to start with, more from the website or this phone, each
// movable and removable. The one caption goes under the first on WhatsApp and once on an Instagram carousel (Album).

/// One photo of the piece, in the order it goes.
struct PostAlbumPhoto: Identifiable {
    enum Kind {
        /// The card's own: as the site shows it, with the weight, or its design.
        case lead
        /// The piece's own n-th photograph, n from 2 (`photo=n` of the image route).
        case angle(Int)
        /// Another website piece's photograph, by its id.
        case site(String)
        /// This phone's, as a JPEG.
        case device(Data)
    }

    let id: String
    let kind: Kind
    /// The website's small picture, when it has one.
    let thumb: String?
    /// This phone's own picture.
    let image: UIImage?
    let label: String

    /// What a card starts with: the hero photo alone (owner, 2026-10-23); the piece's others are offered on the card.
    static func start(_ p: PostPiece) -> [PostAlbumPhoto] {
        [PostAlbumPhoto(id: "lead", kind: .lead, thumb: p.thumb, image: nil, label: p.name)]
    }

    /// The piece's own n-th photograph (n from 2), as it joins the card.
    static func own(_ p: PostPiece, _ i: Int) -> PostAlbumPhoto {
        PostAlbumPhoto(id: "angle-\(i + 2)", kind: .angle(i + 2), thumb: p.photos[i].thumb, image: nil, label: "\(p.name), photo \(i + 2)")
    }

    var isLead: Bool {
        if case .lead = kind { return true }
        return false
    }

    var pieceID: String? {
        if case .site(let id) = kind { return id }
        return nil
    }
}

/// The strip on the card: the photos in order, ‹ › to move one, × to take it out, and more to add.
struct PostAlbumStrip: View {
    @Bindable var card: PostTrayCard
    let model: PostTrayModel
    let siteName: String
    let locked: Bool
    let onSay: ([Note]) -> Void

    @State private var choosing = false
    @State private var chosen: [PhotosPickerItem] = []
    @State private var reading = false

    var body: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(card.album) { (x: PostAlbumPhoto) in tile(x) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .listRowInsets(EdgeInsets())
            if !ownLeft.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("More of this piece:").font(.subheadline).foregroundStyle(.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(ownLeft, id: \.self) { (i: Int) in
                                Button { addOwn([i]) } label: {
                                    StockImage(imageUrl: card.piece.photos[i].thumb, name: "\(card.piece.name), photo \(i + 2)", key: card.id + "|own\(i)")
                                        .frame(width: 56, height: 56)
                                        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Add photo \(i + 2) of this piece")
                            }
                        }
                    }
                    if ownLeft.count > 1 {
                        Button("Add all \(ownLeft.count)") { addOwn(ownLeft) }.buttonStyle(.borderless)
                    }
                }
                .disabled(locked || card.album.count >= Album.max)
            }
            PhotosPicker(selection: $chosen, maxSelectionCount: Swift.max(1, Album.max - card.album.count), matching: .images) {
                Label(reading ? "Reading the photos…" : "Add from this phone", systemImage: "photo.on.rectangle")
            }
            .disabled(locked || reading || card.album.count >= Album.max)
            Button { choosing = true } label: { Label("Add from \(siteName)", systemImage: "globe") }
                .disabled(locked || card.album.count >= Album.max)
        } header: {
            LedgerHeading(title: "Photos")
        } footer: {
            Text(footer)
        }
        .onChange(of: chosen) { _, items in
            guard !items.isEmpty else { return }
            Task { await read(items) }
        }
        .sheet(isPresented: $choosing) {
            PostAlbumSitePicker(card: card, model: model, onSay: onSay)
                .presentationSizing(.page)
        }
    }

    /// The piece's own photos not on the card yet (indexes into `piece.photos`).
    private var ownLeft: [Int] {
        card.piece.photos.indices.filter { (i: Int) in !card.album.contains { (x: PostAlbumPhoto) in x.id == "angle-\(i + 2)" } }
    }

    private func addOwn(_ indexes: [Int]) {
        for i in indexes {
            if card.album.count >= Album.max {
                onSay([Note(title: "\(Album.max) photos at most", detail: "Take some out first, or send this piece twice.", failed: true)])
                return
            }
            card.album.append(PostAlbumPhoto.own(card.piece, i))
        }
    }

    private var footer: String {
        let n = card.album.count
        var lines = [n > 1 ? "\(Album.photosLabel(n)) go in this order, the caption under the first. The story takes the first." : "One photo. Add more to send them together under one caption."]
        if model.toInstagram && n > Album.igCarouselMax { lines.append("Instagram takes the first \(Album.igCarouselMax).") }
        return lines.joined(separator: " ")
    }

    private func tile(_ x: PostAlbumPhoto) -> some View {
        let number = (card.album.firstIndex { (y: PostAlbumPhoto) in y.id == x.id } ?? 0) + 1
        return VStack(spacing: 4) {
            picture(x)
                .frame(width: 84, height: 84)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Text("\(number)").font(.caption2.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Theme.accent, in: .capsule)
                        .padding(3)
                }
                .draggable(x.id)
                .dropDestination(for: String.self) { (ids: [String], _) in
                    guard let moving = ids.first, !locked else { return false }
                    model.reorder(card, moving: moving, before: x.id)
                    return true
                }
                .accessibilityLabel("Photo \(number): \(x.label)")
            HStack(spacing: 0) {
                Button { model.move(card, x.id, by: -1) } label: { Image(systemName: "chevron.left") }
                    .disabled(number == 1)
                    .accessibilityLabel("Move earlier")
                if x.isLead {
                    Color.clear.frame(width: 44, height: 44)
                } else {
                    Button(role: .destructive) { model.remove(card, x.id) } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Take photo \(number) out")
                }
                Button { model.move(card, x.id, by: 1) } label: { Image(systemName: "chevron.right") }
                    .disabled(number == card.album.count)
                    .accessibilityLabel("Move later")
            }
            .buttonStyle(.borderless)
            .frame(width: 132)
            .disabled(locked)
        }
        .frame(width: 132)
    }

    @ViewBuilder
    private func picture(_ x: PostAlbumPhoto) -> some View {
        if let image = x.image {
            Image(uiImage: image).resizable().scaledToFill()
        } else if x.isLead, let preview = card.preview {
            Image(uiImage: preview).resizable().scaledToFill()
        } else {
            StockImage(imageUrl: x.thumb, name: x.label, key: card.id + "|" + x.id)
        }
    }

    /// The phone's choices, as JPEGs the length of a photo WhatsApp takes.
    private func read(_ items: [PhotosPickerItem]) async {
        reading = true
        defer { reading = false; chosen = [] }
        var jpegs: [Data] = []
        var failed = 0
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = AdsPhotoCodec.jpeg(from: image) {
                jpegs.append(jpeg)
            } else {
                failed += 1
            }
        }
        if let why = model.addDevice(card, jpegs) { onSay([Note(title: why, detail: "Take some out first, or send this piece twice.", failed: true)]) }
        if failed > 0 { onSay([Note(title: "Couldn't read \(Album.photosLabel(failed))", failed: true)]) }
    }
}

/// Another website piece's photograph for the card: tap to add, tap again to take it out.
struct PostAlbumSitePicker: View {
    let card: PostTrayCard
    let model: PostTrayModel
    let onSay: ([Note]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    private var store: PostsStore { PostsStore.shared }

    private var shown: [PostPiece] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        let open = store.pieces.filter { (p: PostPiece) in p.id != card.id }
        let matching = open.filter { (p: PostPiece) in
            if words.isEmpty { return true }
            let text = "\(p.name) \(p.collection) \(p.facts.joined(separator: " "))".lowercased()
            return words.allSatisfy { (w: String) in text.contains(w) }
        }
        return Array(matching.prefix(80))
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                ForEach(shown) { (p: PostPiece) in
                    Button {
                        if let why = model.toggleSite(card, p) { onSay([Note(title: why, failed: true)]) }
                    } label: {
                        HStack(spacing: 12) {
                            StockImage(imageUrl: p.thumb, name: p.name, key: p.id)
                                .frame(width: 52, height: 52)
                                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name)
                                if !p.collection.isEmpty { Text(p.collection).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 6)
                            if let n = position(p) {
                                Text("\(n)").font(.caption.weight(.semibold)).monospacedDigit()
                                    .foregroundStyle(Theme.onAccent)
                                    .frame(minWidth: 24, minHeight: 24)
                                    .background(Theme.accent, in: .circle)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .overlay {
                if shown.isEmpty { ContentUnavailableView.search(text: search) }
            }
            .scrollDismissesKeyboard(.interactively)
            .searchable(text: $search, prompt: "Search: ruby, kara, jhumka…")
            .navigationTitle("Add a photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    /// Its place among the card's photos, when it is one of them.
    private func position(_ p: PostPiece) -> Int? {
        card.album.firstIndex { (x: PostAlbumPhoto) in x.pieceID == p.id }.map { (i: Int) in i + 1 }
    }
}
