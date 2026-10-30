import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif
import FirebaseFirestore
import ERPCore
#if os(macOS)
import UniformTypeIdentifiers
#endif

/// A piece's reference pictures (components/shared/sample-image-input.tsx `SampleImagesInput`): up to eight, picked
/// several at a time from Photos or taken with the camera one after another, each shrunk as the single one always was.
/// The first stays the piece's main picture (`photo` / `samplePhotoId`, which older apps read); the rest are `extras`.
/// Stored pictures stay visible while editing; adding or removing one is explicit. A tap opens them full screen.
struct NewOrderSampleField: View {
    @Binding var piece: NewOrderPieceDraft

    @State private var library = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var importing = false
    @State private var busy = false
    @State private var problem: String?
    @State private var openAt: Int?

    private var hasStoredFirst: Bool {
        !(piece.samplePhotoId ?? "").isEmpty || !(piece.sampleImageDataUri ?? "").isEmpty
    }
    private var hasFirst: Bool { piece.photo != nil || (!piece.removePhoto && hasStoredFirst) }
    private var count: Int { (hasFirst ? 1 : 0) + piece.extras.count }
    private var room: Int { max(NewOrderPieceDraft.maxPhotos - count, 0) }

    /// Every picture in order, as the viewer and the thumbnails read them.
    private var sources: [PhotoSource] {
        var out: [PhotoSource] = []
        if let photo = piece.photo {
            out.append(PhotoSource(id: "new-\(piece.id.uuidString)", data: photo))
        } else if !piece.removePhoto, let uri = piece.sampleImageDataUri, !uri.isEmpty {
            out.append(PhotoSource(id: "main-\(piece.id.uuidString)-\(uri.utf8.count)", uri: uri))
        } else if !piece.removePhoto, let id = piece.samplePhotoId, !id.isEmpty {
            out.append(PhotoSource(id: id, storedId: id))
        }
        for e in piece.extras {
            if let id = e.storedId, !id.isEmpty { out.append(PhotoSource(id: id, storedId: id)) }
            else if let data = e.data { out.append(PhotoSource(id: "new-\(e.id.uuidString)", data: data)) }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            let list = sources
            if !list.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: pt(10)) {
                        ForEach(Array(list.enumerated()), id: \.element.id) { i, source in
                            tile(source, at: i, of: list.count)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            if room > 0 {
                HStack(spacing: pt(10)) {
                    Button { library = true } label: {
                        Label(list.isEmpty ? "Photos" : "Add photos", systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(.bordered)
                    #if os(macOS)
                    Button { importing = true } label: {
                        Label("Choose files…", systemImage: "folder")
                    }
                    .buttonStyle(.bordered)
                    #else
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { camera = true } label: {
                            Label("Camera", systemImage: "camera")
                        }
                        .buttonStyle(.bordered)
                    }
                    #endif
                    if busy { SkeletonLoading() }
                }
            } else {
                Text("A piece takes up to \(NewOrderPieceDraft.maxPhotos) reference pictures.").font(.footnote).foregroundStyle(.secondary)
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(Tone.problem.color)
            }
        }
        .photosPicker(isPresented: $library, selection: $picked, maxSelectionCount: max(room, 1), matching: .images)
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            Task { await load(items) }
        }
        .fullScreenCover(isPresented: $camera) {
            NewOrderCamera { image in
                camera = false
                if let image { Task { await take([image]) } }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: Binding(get: { openAt != nil }, set: { if !$0 { openAt = nil } })) {
            PhotoViewer(photos: sources, title: piece.description, index: openAt ?? 0)
        }
        #if os(macOS)
        // Picture files chosen, or dropped on the field (the Mac's stand-in for the camera).
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await loadFiles(urls) } }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !urls.isEmpty else { return false }
            Task { await loadFiles(urls) }
            return true
        }
        #endif
    }

    // MARK: A picture in the row

    private func tile(_ source: PhotoSource, at i: Int, of total: Int) -> some View {
        let offset = hasFirst ? 1 : 0
        let isExtra = i >= offset
        let extraAt = i - offset
        return Button { openAt = i } label: { PhotoThumb(source: source, size: 84) }
            .buttonStyle(.plain)
            .accessibilityLabel("Reference photo \(i + 1) of \(total)")
            .overlay(alignment: .topTrailing) {
                Menu {
                    if isExtra && extraAt > 0 { Button("Move earlier", systemImage: "arrow.left") { move(extraAt, by: -1) } }
                    if isExtra && extraAt < piece.extras.count - 1 { Button("Move later", systemImage: "arrow.right") { move(extraAt, by: 1) } }
                    Button("Remove", systemImage: "trash", role: .destructive) { remove(i) }
                } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.55))
                        .font(.title3)
                        .padding(3)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .accessibilityLabel("Photo \(i + 1) options")
            }
    }

    private func move(_ at: Int, by: Int) {
        let to = at + by
        guard piece.extras.indices.contains(at), piece.extras.indices.contains(to) else { return }
        piece.extras.swapAt(at, to)
    }

    private func remove(_ i: Int) {
        if hasFirst && i == 0 {
            // Taken off the piece altogether; the ERP makes the next picture the main one when the order is saved.
            piece.photo = nil
            piece.removePhoto = true
        } else {
            let at = i - (hasFirst ? 1 : 0)
            if piece.extras.indices.contains(at) { piece.extras.remove(at: at) }
        }
    }

    // MARK: Taking pictures in

    /// New pictures: the first fills an empty main slot, the rest follow; no more than the piece takes.
    private func add(_ jpegs: [Data]) {
        var rest = Array(jpegs.prefix(room))
        if !hasFirst, !rest.isEmpty {
            piece.photo = rest.removeFirst()
            piece.removePhoto = false
        }
        for data in rest where piece.extras.count + (hasFirst ? 1 : 0) < NewOrderPieceDraft.maxPhotos {
            piece.extras.append(NewOrderExtraPhoto(data: data))
        }
        if jpegs.count > room { problem = "A piece takes up to \(NewOrderPieceDraft.maxPhotos) pictures; the rest were left out." }
    }

    private func load(_ items: [PhotosPickerItem]) async {
        busy = true
        problem = nil
        defer { picked = [] }
        var images: [UIImage] = []
        for item in items {
            if let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) { images.append(image) }
        }
        if images.count < items.count { problem = "Couldn't read some of those photos." }
        await take(images)
    }

    private func take(_ images: [UIImage]) async {
        busy = true
        var jpegs: [Data] = []
        for image in images {
            if let jpeg = await Task.detached(priority: .userInitiated, operation: { NewOrderPhotoCodec.jpeg(from: image) }).value { jpegs.append(jpeg) }
        }
        busy = false
        if jpegs.isEmpty { problem = "Couldn't use that photo." } else { add(jpegs) }
    }

    #if os(macOS)
    private func loadFiles(_ urls: [URL]) async {
        busy = true
        problem = nil
        let images = urls.compactMap { NewOrderPhotoCodec.macPicture(at: $0) }
        if images.count < urls.count { problem = "Couldn't read some of those files as photos." }
        await take(images)
    }
    #endif
}

// The sample picture of a piece (components/shared/sample-image-input.tsx): from the library or the
// camera, made small enough to carry, and sent inside the order as a data URI. createOrder moves it
// to its own document (`order_photos/<id>`) in the same commit (lib/order-photos.ts), so the order
// itself stays light.

enum NewOrderPhotoCodec {
    /// Longest edge after shrinking: the picture is shown at 96 px on the order page, so this is generous.
    static let longestEdge: CGFloat = 1000
    /// A budget, not a limit: these photos are read by every screen that reads orders.
    static let budget = 120 * 1024

    /// The picture shrunk and re-encoded until it fits the budget (the web steps the quality down the same way).
    static func jpeg(from image: UIImage) -> Data? {
        let side = max(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let scale = min(1, longestEdge / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        #if os(macOS)
        guard let small = macScaled(image, to: size) else { return nil }
        #else
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        #endif
        let steps: [CGFloat] = [0.82, 0.7, 0.6, 0.5, 0.4]
        for quality in steps {
            if let data = small.jpegData(compressionQuality: quality), data.count <= budget { return data }
        }
        return small.jpegData(compressionQuality: 0.35)
    }
}

#if os(macOS)
extension NewOrderPhotoCodec {
    /// What UIGraphicsImageRenderer does on the phone: the picture redrawn at `size` (one pixel to a point), on white so
    /// a picture with see-through parts still makes a JPEG.
    nonisolated static func macScaled(_ image: UIImage, to size: CGSize) -> UIImage? {
        guard let cg = image.cgImage, size.width >= 1, size.height >= 1,
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
                                  bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        let rect = CGRect(origin: .zero, size: CGSize(width: Int(size.width), height: Int(size.height)))
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(rect)
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: rect)
        return ctx.makeImage().map { UIImage(cgImage: $0) }
    }

    /// The picture no longer than `longest` on its long side (DocumentScanner.fitted, for the Mac).
    nonisolated static func macFitted(_ image: UIImage, longest: CGFloat) -> UIImage {
        let side = max(image.size.width, image.size.height)
        guard side > longest else { return image }
        let scale = longest / side
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        return macScaled(image, to: size) ?? image
    }

    /// The picture inside a file the person chose or dropped, nil when it is not one.
    nonisolated static func macPicture(at url: URL) -> UIImage? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }
}

/// The Mac has no camera to open over the screen: this sheet takes the place of Apple's camera wherever a screen asks
/// for one. A picture comes from a file (Finder, or File › Import from iPhone for a Continuity Camera shot) or is
/// dropped on it, and goes back by the same `onDone` as a photo taken on the phone.
struct NewOrderCamera: View {
    /// The picture chosen, or nil when it was cancelled.
    let onDone: (UIImage?) -> Void

    @State private var choosing = false
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "photo.badge.plus").font(.title2).foregroundStyle(.secondary)
            Text("Choose a photo").font(.headline)
            Text("Pick a picture from your Mac, or drop one here.")
                .font(.subheadline).foregroundStyle(.secondary)
            if let problem { Text(problem).font(.footnote).foregroundStyle(Tone.problem.color) }
            HStack(spacing: 10) {
                Button("Cancel") { onDone(nil) }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button("Choose a photo…") { choosing = true }
                    .buttonStyle(.houseProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .multilineTextAlignment(.center)
        .padding(28)
        .frame(minWidth: 380, minHeight: 240)
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { take(url) }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            take(url)
            return true
        }
    }

    private func take(_ url: URL) {
        if let image = NewOrderPhotoCodec.macPicture(at: url) {
            onDone(image)
        } else {
            problem = "Couldn't read that file as a photo. Try another."
        }
    }
}
#else
/// Apple's camera, for a photo of the customer's sample or a design.
struct NewOrderCamera: UIViewControllerRepresentable {
    /// The picture taken, or nil when it was cancelled.
    let onDone: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void

        init(_ onDone: @escaping (UIImage?) -> Void) { self.onDone = onDone }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onDone(nil)
        }
    }
}
#endif

/// A piece's sample picture: shown, replaced from Photos or the camera, or removed.
struct NewOrderPhotoField: View {
    @Binding var data: Data?

    @State private var library = false
    @State private var picked: PhotosPickerItem?
    @State private var camera = false
    @State private var importing = false
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            preview
            HStack(spacing: pt(10)) {
                Button { library = true } label: {
                    Label("Photos", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.bordered)
                #if os(macOS)
                Button { importing = true } label: {
                    Label("Choose a file…", systemImage: "folder")
                }
                .buttonStyle(.bordered)
                #else
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { camera = true } label: {
                        Label("Camera", systemImage: "camera")
                    }
                    .buttonStyle(.bordered)
                }
                #endif
                if busy { SkeletonLoading() }
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(Tone.problem.color)
            }
        }
        .photosPicker(isPresented: $library, selection: $picked, matching: .images)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
        .fullScreenCover(isPresented: $camera) {
            NewOrderCamera { image in
                camera = false
                if let image { Task { await take(image) } }
            }
            .ignoresSafeArea()
        }
        #if os(macOS)
        // A picture file chosen, or dropped on the field (the Mac's stand-in for the camera).
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { Task { await loadFile(url) } }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            Task { await loadFile(url) }
            return true
        }
        #endif
    }

    #if os(macOS)
    private func loadFile(_ url: URL) async {
        busy = true
        problem = nil
        guard let image = NewOrderPhotoCodec.macPicture(at: url) else {
            busy = false
            problem = "Couldn't read that file as a photo. Try another."
            return
        }
        await take(image)
    }
    #endif

    @ViewBuilder
    private var preview: some View {
        if let data, let image = UIImage(data: data) {
            HStack(alignment: .top) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 140)
                    .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                Spacer(minLength: 8)
                Button(role: .destructive) { self.data = nil } label: {
                    Label("Remove photo", systemImage: "trash")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
            }
        }
    }

    private func load(_ item: PhotosPickerItem) async {
        busy = true
        problem = nil
        defer { picked = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            busy = false
            problem = "Couldn't read that photo. Try another."
            return
        }
        await take(image)
    }

    private func take(_ image: UIImage) async {
        busy = true
        let jpeg = await Task.detached(priority: .userInitiated) { NewOrderPhotoCodec.jpeg(from: image) }.value
        busy = false
        if let jpeg {
            data = jpeg
            problem = nil
        } else {
            problem = "Couldn't use that photo."
        }
    }
}
