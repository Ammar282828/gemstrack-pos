import SwiftUI
import FirebaseFirestore
import ERPCore

// A piece's reference pictures (2026-10-30, owner: "more than one picture reference in orders … I should be able to
// open the reference images"): thumbnails wherever a piece shows them, and a full-screen viewer behind a tap — swipe
// between the piece's pictures, pinch or double-tap to zoom, Share (which also saves), swipe down to close. The web
// has the same in components/order/photo-lightbox.tsx; where the pictures live is lib/order-photos.ts.

/// One reference picture before it is read: inline (`uri`: a data address or a stock piece's address), in its own
/// document (`storedId`, `order_photos/<id>`), or new on this phone (`data`, a JPEG). `id` names it on screen.
struct PhotoSource: Identifiable, Hashable {
    let id: String
    var uri: String? = nil
    var storedId: String? = nil
    var data: Data? = nil
}

extension OrderItem {
    /// The piece's reference pictures in order: the first (as every older order has it), then photos 2...n.
    var photoSources: [PhotoSource] {
        var out: [PhotoSource] = []
        func tail(_ s: String) -> String { "\(s.utf8.count)-\(s.suffix(24))" }
        let first = (sampleImageDataUri ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !first.isEmpty {
            out.append(PhotoSource(id: "m-" + tail(first), uri: first))
        } else if let id = samplePhotoId, !id.isEmpty {
            out.append(PhotoSource(id: id, storedId: id))
        }
        for e in extraPhotos {
            if let uri = e.dataUri, !uri.isEmpty {
                out.append(PhotoSource(id: "x-" + tail(uri), uri: uri))
            } else if let id = e.id, !id.isEmpty {
                out.append(PhotoSource(id: id, storedId: id))
            }
        }
        return Array(out.prefix(NewOrderPieceDraft.maxPhotos))
    }
}

extension KarigarPortalJob {
    /// The piece's pictures as the portal hands them over, inline (the first, then photos 2...n).
    var photoSources: [PhotoSource] {
        var out: [PhotoSource] = []
        for (i, uri) in ([sampleImage ?? ""] + extraSampleImages).enumerated() where !uri.isEmpty {
            out.append(PhotoSource(id: "\(id)-\(i)-\(uri.utf8.count)", uri: uri))
        }
        return Array(out.prefix(NewOrderPieceDraft.maxPhotos))
    }
}

/// Reads a picture wherever it is kept, once: its document is fetched the first time and held for the session.
@MainActor
enum PieceGalleryStore {
    private static var documents: [String: String] = [:]

    /// The picture's address (a data address or a URL), or nil when it has none or cannot be read (the shop floor's
    /// accounts read no Firestore of their own; they are handed the pictures inline).
    static func uri(of source: PhotoSource) async -> String? {
        if let uri = source.uri, !uri.isEmpty { return uri }
        guard let id = source.storedId, !id.isEmpty else { return nil }
        if let hit = documents[id] { return hit }
        guard !House.isDemo, let db = Businesses.shared.firestore,
              let snapshot = try? await db.collection("order_photos").document(id).getDocument(),
              let uri = snapshot.data()?["dataUri"] as? String, !uri.isEmpty else { return nil }
        documents[id] = uri
        return uri
    }

    /// The picture itself, no larger than `maxPixel` on its long side.
    static func image(of source: PhotoSource, maxPixel: Int) async -> UIImage? {
        if let data = source.data { return UIImage(data: data) }
        guard let text = await uri(of: source) else { return nil }
        if text.hasPrefix("data:") {
            let key = source.id
            return await Task.detached(priority: .userInitiated) { () -> UIImage? in
                StockImageDecoder.image(text, key: key, maxPixel: maxPixel)
            }.value
        }
        guard let url = URL(string: text), let (bytes, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return UIImage(data: bytes)
    }
}

// MARK: Thumbnails

/// A small square of one picture; blank until it is read.
struct PhotoThumb: View {
    let source: PhotoSource
    var size: CGFloat = 64
    /// "+3" over the corner when more pictures follow.
    var more = 0

    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(.quaternary)
            .frame(width: size, height: size)
            .overlay {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
            }
            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                if more > 0 {
                    Text("+\(more)").font(.caption2.weight(.semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.black.opacity(0.6), in: .capsule)
                        .padding(4)
                }
            }
            .task(id: source.id) { image = await PieceGalleryStore.image(of: source, maxPixel: Int(size * 3)) }
    }
}

/// A piece's pictures as thumbnails; a tap opens the viewer on that one. `all` lays out every picture in a row (the
/// bench's card, the Mac's detail); otherwise the first leads with a "+n" for the rest (an order's piece row).
struct PieceGalleryRow: View {
    let sources: [PhotoSource]
    var title = ""
    var size: CGFloat = 64
    var all = false

    @State private var openAt: Int?

    private var opened: Binding<Bool> {
        Binding(get: { openAt != nil }, set: { if !$0 { openAt = nil } })
    }

    var body: some View {
        if !sources.isEmpty {
            Group {
                if all && sources.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: pt(8)) {
                            ForEach(Array(sources.enumerated()), id: \.element.id) { i, s in
                                Button { openAt = i } label: { PhotoThumb(source: s, size: size) }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Reference photo \(i + 1) of \(sources.count)")
                            }
                        }
                    }
                } else {
                    Button { openAt = 0 } label: { PhotoThumb(source: sources[0], size: size, more: sources.count - 1) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(sources.count > 1 ? "Reference photos, \(sources.count)" : "Reference photo")
                }
            }
            .fullScreenCover(isPresented: opened) {
                PhotoViewer(photos: sources, title: title, index: openAt ?? 0)
            }
        }
    }
}

/// A piece of an order: its pictures, leading its row.
struct OrderPiecePhotos: View {
    let item: OrderItem
    var size: CGFloat = 64
    var all = false

    var body: some View {
        PieceGalleryRow(sources: item.photoSources, title: item.description, size: size, all: all)
    }
}

// MARK: The viewer

struct PhotoViewer: View {
    let photos: [PhotoSource]
    var title = ""
    @State var index: Int

    @State private var loaded: [String: UIImage] = [:]
    @Environment(\.dismiss) private var dismiss

    init(photos: [PhotoSource], title: String = "", index: Int = 0) {
        self.photos = photos
        self.title = title
        _index = State(initialValue: min(max(index, 0), max(photos.count - 1, 0)))
    }

    private func step(_ by: Int) {
        let next = index + by
        if photos.indices.contains(next) { index = next }
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if photos.indices.contains(index) {
                let source = photos[index]
                PhotoPage(source: source, image: loaded[source.id], label: title.isEmpty ? "Reference photo" : title,
                          onLoaded: { loaded[source.id] = $0 }, onSwipe: step, onClose: { dismiss() })
                    .id(source.id)
            }
        }
        .overlay(alignment: .top) { bar }
        .preferredColorScheme(.dark)
        #if os(macOS)
        .frame(minWidth: 640, minHeight: 520)
        .focusable()
        .onKeyPress(.leftArrow) { step(-1); return .handled }
        .onKeyPress(.rightArrow) { step(1); return .handled }
        #endif
    }

    private var bar: some View {
        HStack(spacing: pt(12)) {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.title2).symbolRenderingMode(.palette).foregroundStyle(.white, .white.opacity(0.25))
            }
            .accessibilityLabel("Close")
            Spacer()
            if photos.count > 1 {
                if index > 0 { Button { step(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous photo") }
                Text("\(index + 1) of \(photos.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.white)
                if index < photos.count - 1 { Button { step(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("Next photo") }
            }
            Spacer()
            if photos.indices.contains(index), let image = loaded[photos[index].id] {
                ShareLink(item: Image(uiImage: image), preview: SharePreview(title.isEmpty ? "Reference photo" : title, image: Image(uiImage: image))) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share or save")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .padding(.horizontal, pt(16)).padding(.vertical, pt(10))
    }
}

/// One picture, zoomable: pinch, double-tap, drag when zoomed; at rest a sideways drag turns the page and a drag down closes.
private struct PhotoPage: View {
    let source: PhotoSource
    let image: UIImage?
    let label: String
    let onLoaded: (UIImage) -> Void
    let onSwipe: (Int) -> Void
    let onClose: () -> Void

    @State private var scale: CGFloat = 1
    @State private var scaleBase: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var offsetBase: CGSize = .zero
    @State private var failed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(pinch)
                    .simultaneousGesture(drag)
                    .onTapGesture(count: 2) {
                        Motion.run(Motion.enter, reduce: reduceMotion) {
                            if scale > 1 { reset() } else { scale = 2.5; scaleBase = 2.5 }
                        }
                    }
                    .accessibilityLabel(label)
            } else if failed {
                Text("This photo could not be loaded.").font(.subheadline).foregroundStyle(.white.opacity(0.7))
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            guard image == nil else { return }
            if let loadedImage = await PieceGalleryStore.image(of: source, maxPixel: 2400) { onLoaded(loadedImage) } else { failed = true }
        }
    }

    private func reset() {
        scale = 1; scaleBase = 1; offset = .zero; offsetBase = .zero
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { (v: MagnifyGesture.Value) in scale = min(6, max(1, scaleBase * v.magnification)) }
            .onEnded { _ in
                scaleBase = scale
                if scale <= 1.01 { Motion.run(Motion.enter, reduce: reduceMotion) { reset() } }
            }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { (v: DragGesture.Value) in
                if scale > 1 {
                    offset = CGSize(width: offsetBase.width + v.translation.width, height: offsetBase.height + v.translation.height)
                } else if v.translation.height > 0 && abs(v.translation.height) > abs(v.translation.width) {
                    offset = CGSize(width: 0, height: v.translation.height)
                }
            }
            .onEnded { (v: DragGesture.Value) in
                if scale > 1 {
                    offsetBase = offset
                    return
                }
                let across = v.translation.width
                let down = v.translation.height
                if down > 110 && abs(down) > abs(across) {
                    onClose()
                } else if abs(across) > 60 && abs(across) > abs(down) {
                    onSwipe(across < 0 ? 1 : -1)
                }
                Motion.run(Motion.enter, reduce: reduceMotion) { offset = .zero }
            }
    }
}
