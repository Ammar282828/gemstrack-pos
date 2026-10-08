import SwiftUI
import PhotosUI
import UIKit

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
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        let steps: [CGFloat] = [0.82, 0.7, 0.6, 0.5, 0.4]
        for quality in steps {
            if let data = small.jpegData(compressionQuality: quality), data.count <= budget { return data }
        }
        return small.jpegData(compressionQuality: 0.35)
    }
}

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

/// A piece's sample picture: shown, replaced from Photos or the camera, or removed.
struct NewOrderPhotoField: View {
    @Binding var data: Data?

    @State private var library = false
    @State private var picked: PhotosPickerItem?
    @State private var camera = false
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            preview
            HStack(spacing: 10) {
                Button { library = true } label: {
                    Label("Photos", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.glass)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { camera = true } label: {
                        Label("Camera", systemImage: "camera")
                    }
                    .buttonStyle(.glass)
                }
                if busy { ProgressView() }
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.red)
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
    }

    @ViewBuilder
    private var preview: some View {
        if let data, let image = UIImage(data: data) {
            HStack(alignment: .top) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 140)
                    .clipShape(.rect(cornerRadius: 12))
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
