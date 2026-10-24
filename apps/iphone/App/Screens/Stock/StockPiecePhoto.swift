import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// A piece's photo, added, changed or taken off from the phone (the product form's Photo, product-form.tsx).
/// The web uploads it to Firebase Storage from the browser; the phone has no Storage SDK, so the photograph goes to
/// the ERP (/api/app/product-photo), which stores it in the same place and records its address on the piece
/// (`setProductPhoto`, lib/writes/products.ts). The ERP makes a HEIC a JPEG and brings it to size; the phone only
/// shrinks it first so a camera's full picture is not sent over a shop's line.
///
/// Saved at once, on its own, as the web's upload is: the form's Save never sends the photo, so what is typed in the
/// form and the photo never overwrite each other. Owners only, as Stock is.
struct StockPiecePhotoField: View {
    let sku: String
    let name: String
    /// The photo on file, as the products shelf has it (owners' shelf is live, so it follows a save by itself).
    let imageUrl: String?

    @State private var library = false
    @State private var picked: PhotosPickerItem?
    @State private var camera = false
    @State private var confirmRemove = false
    @State private var busy: Busy?
    @State private var failure: String?
    /// What the ERP answered with, shown until the shelf brings the same ("" for taken off).
    @State private var answered: String?
    @State private var tick = 0

    private enum Busy { case reading, sending, removing }

    private var shown: String? { StockKit.filled(answered ?? imageUrl) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let shown {
                StockImage(imageUrl: shown, name: name, key: shown, decodeDataURI: true)
                    .frame(width: 120, height: 120)
                    .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            }
            if let busy {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView().progressViewStyle(.linear).tint(Theme.accent)
                    Text(words(busy)).font(.footnote).foregroundStyle(.secondary)
                }
            }
            AdaptiveStack(spacing: 10, alignment: .center) {
                Button { library = true } label: {
                    Label(shown == nil ? "Add from Photos" : "Photos", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.bordered)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { camera = true } label: {
                        Label("Camera", systemImage: "camera")
                    }
                    .buttonStyle(.bordered)
                }
                if shown != nil {
                    Button(role: .destructive) { confirmRemove = true } label: {
                        Label("Remove photo", systemImage: "trash")
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Remove photo")
                }
            }
            .disabled(busy != nil)
        }
        .photosPicker(isPresented: $library, selection: $picked, matching: .images)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
        .onChange(of: imageUrl) { _, now in
            // The shelf has caught up with what was saved here: it speaks for itself again.
            if let answered, StockKit.filled(answered) == StockKit.filled(now) { self.answered = nil }
        }
        .fullScreenCover(isPresented: $camera) {
            NewOrderCamera { (image: UIImage?) in
                camera = false
                if let image { Task { await send(image) } }
            }
            .ignoresSafeArea()
        }
        .confirmDestructive(isPresented: $confirmRemove, title: "Remove the photo of \(name)?",
                            message: "The piece keeps everything else. A new photo can be added at any time.",
                            action: "Remove photo") { Task { await remove() } }
        .failureAlert($failure, title: "The photo wasn't saved")
        .sensoryFeedback(.success, trigger: tick)
    }

    private func words(_ b: Busy) -> String {
        switch b {
        case .reading: return "Reading the photo…"
        case .sending: return "Uploading the photo…"
        case .removing: return "Removing the photo…"
        }
    }

    private func load(_ item: PhotosPickerItem) async {
        busy = .reading
        defer { picked = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            busy = nil
            failure = "Couldn't read that photo. Try another."
            return
        }
        await send(image)
    }

    private func send(_ image: UIImage) async {
        busy = .reading
        let jpeg = await Task.detached(priority: .userInitiated) { StockPhotoCodec.jpeg(from: image) }.value
        guard let jpeg else {
            busy = nil
            failure = "Couldn't use that photo."
            return
        }
        busy = .sending
        await post(fields: [("sku", sku)], files: [WebsiteForm.File(field: "file", name: "\(sku).jpg", type: "image/jpeg", data: jpeg)])
    }

    private func remove() async {
        busy = .removing
        await post(fields: [("sku", sku), ("remove", "1")], files: [])
    }

    private func post(fields: [(String, String)], files: [WebsiteForm.File]) async {
        defer { busy = nil }
        do {
            let data = try await WebsiteForm.send("/api/app/product-photo", fields: fields, files: files, timeout: 120)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            answered = json["imageUrl"] as? String ?? ""
            tick += 1
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// The photograph made a JPEG of a sensible size before it travels. The ERP brings it to its own size (2000 px) and
/// turns it upright; this only keeps a 48-megapixel picture from being sent whole.
enum StockPhotoCodec {
    static let longestEdge: CGFloat = 2400

    static func jpeg(from image: UIImage) -> Data? {
        let side = max(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let scale = min(1, longestEdge / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        // Drawn upright, so the ERP needs no orientation tag to show it the right way round.
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return small.jpegData(compressionQuality: 0.88)
    }
}
