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

/// Stored samples stay visible while editing; choosing or removing a photo is explicit.
struct NewOrderSampleField: View {
    @Binding var piece: NewOrderPieceDraft
    @State private var storedURI: String?
    @State private var failure: String?

    private var hasStored: Bool {
        !(piece.samplePhotoId ?? "").isEmpty || !(piece.sampleImageDataUri ?? "").isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(12)) {
            if piece.photo == nil && !piece.removePhoto && hasStored {
                if let uri = piece.sampleImageDataUri ?? storedURI, !uri.isEmpty {
                    StockImage(imageUrl: uri, name: piece.description, key: piece.id.uuidString, decodeDataURI: true)
                        .frame(maxHeight: 160).clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                } else if let failure {
                    Text(failure).font(.footnote).foregroundStyle(.secondary)
                } else { SkeletonLoading().frame(height: 80) }
                Button("Remove photo", systemImage: "trash", role: .destructive) { piece.removePhoto = true }
            }
            NewOrderPhotoField(data: Binding(
                get: { piece.photo },
                set: { piece.photo = $0; piece.removePhoto = $0 == nil }
            ))
        }
        .task(id: piece.samplePhotoId) {
            storedURI = nil; failure = nil
            guard let id = piece.samplePhotoId, !id.isEmpty, piece.sampleImageDataUri == nil else { return }
            guard !House.isDemo else { failure = "Sample photo preview unavailable in demo."; return }
            do {
                guard let db = await Businesses.shared.firestore else { failure = "Couldn't load the saved photo. It stays on the order unless removed."; return }
                let snapshot = try await db.collection("order_photos").document(id).getDocument()
                storedURI = snapshot.data()?["dataUri"] as? String
                if storedURI == nil { failure = "The saved photo is unavailable. It stays on the order unless removed." }
            } catch { failure = "Couldn't load the saved photo. It stays on the order unless removed." }
        }
    }
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
