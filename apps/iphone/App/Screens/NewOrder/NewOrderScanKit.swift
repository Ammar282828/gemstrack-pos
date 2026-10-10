import SwiftUI
import PhotosUI
import UIKit
import ERPCore

// What Read a slip (New order) and Read a written bill (New sale) share: the paper coming in (Apple's document
// scanner, or Photos for one that arrived on WhatsApp), the photos kept on screen beside what was read off them
// (a figure read off handwriting is worth checking against the handwriting), and a name offered, never decided.

// MARK: A photo of the paper

/// One photo of the paper: the JPEG the ERP's reader is sent (no side over 2200 px, as the scanner's pages),
/// the same made small enough to keep on an order as its reference picture (NewOrderPhotoCodec), and the picture shown.
struct PaperPhoto: Identifiable {
    let id = UUID()
    let jpeg: Data
    let small: Data
    let image: UIImage

    /// A page or photo made ready, off the main thread; nil when it cannot be read.
    static func make(_ picture: UIImage) async -> PaperPhoto? {
        await Task.detached(priority: .userInitiated) { () -> PaperPhoto? in
            let fitted = DocumentScanner.fitted(picture, longest: 2200)
            guard let jpeg = fitted.jpegData(compressionQuality: 0.82),
                  let small = NewOrderPhotoCodec.jpeg(from: fitted) else { return nil }
            return PaperPhoto(jpeg: jpeg, small: small, image: fitted)
        }.value
    }

    /// A page from Apple's scanner, already squared up and sized: sent as it is.
    static func make(page jpeg: Data) async -> PaperPhoto? {
        await Task.detached(priority: .userInitiated) { () -> PaperPhoto? in
            guard let image = UIImage(data: jpeg), let small = NewOrderPhotoCodec.jpeg(from: image) else { return nil }
            return PaperPhoto(jpeg: jpeg, small: small, image: image)
        }.value
    }

    /// What the reader is sent: `{ data, mimeType }`, base64 JPEG, as the browser sends it.
    var payload: [String: Any] { ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"] }
}

/// The two ways paper comes in: scanned (Apple's scanner squares the page and evens the light; the camera where
/// a phone has no scanner), or chosen from Photos. `room` is how many more photos may be added.
struct PaperPicker: View {
    let room: Int
    var scanTitle = "Scan"
    var disabled = false
    let add: ([PaperPhoto]) -> Void
    let problem: (String) -> Void

    @State private var library = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var loading = false

    var body: some View {
        HStack(spacing: 10) {
            Button { scan() } label: {
                Label(scanTitle, systemImage: "doc.viewfinder")
            }
            .buttonStyle(.glass)
            Button { library = true } label: {
                Label("From Photos", systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.glass)
            if loading { SkeletonLoading() }
        }
        .disabled(disabled || loading || room <= 0)
        .photosPicker(isPresented: $library, selection: $picked, maxSelectionCount: max(1, room), matching: .images)
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
    }

    private func scan() {
        if DocumentScanner.isSupported {
            Task {
                do {
                    let pages = try await DocumentScanner.scan()
                    await takePages(pages.map(\.jpeg))
                } catch let e as DocumentScanner.Failure {
                    if e.code != "cancelled" { problem(e.message) }
                } catch {
                    problem(error.localizedDescription)
                }
            }
        } else if UIImagePickerController.isSourceTypeAvailable(.camera) {
            camera = true
        } else {
            problem("This phone has no camera to scan with. Choose the photo from Photos.")
        }
    }

    private func load(_ items: [PhotosPickerItem]) async {
        loading = true
        defer { picked = [] }
        var images: [UIImage] = []
        for item in items {
            if let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) {
                images.append(image)
            }
        }
        if images.count < items.count { problem("Couldn't read \(items.count - images.count == 1 ? "one of those photos" : "some of those photos"). Try another.") }
        await take(images)
    }

    private func takePages(_ pages: [Data]) async {
        loading = true
        var out: [PaperPhoto] = []
        for page in pages.prefix(max(0, room)) {
            if let p = await PaperPhoto.make(page: page) { out.append(p) }
        }
        loading = false
        tooMany(pages.count)
        if !out.isEmpty { add(out) }
    }

    private func tooMany(_ count: Int) {
        if count > room && room > 0 {
            problem("Only the first \(room == 1 ? "one was" : "\(room) were") added: \(room == 1 ? "one photo" : "\(room) photos") at most.")
        }
    }

    private func take(_ images: [UIImage]) async {
        loading = true
        var out: [PaperPhoto] = []
        for image in images.prefix(max(0, room)) {
            if let p = await PaperPhoto.make(image) { out.append(p) }
        }
        loading = false
        tooMany(images.count)
        if !out.isEmpty { add(out) }
    }
}

/// The photos, large enough to check a figure against, numbered when there are several. Tap one to see it whole.
struct PaperPhotoStrip: View {
    let photos: [PaperPhoto]
    /// Nil while reading: the set being read is not changed under it.
    let remove: ((UUID) -> Void)?

    @State private var shown: PaperPhoto?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { i, p in
                    Button { shown = p } label: {
                        Image(uiImage: p.image)
                            .resizable()
                            .scaledToFit()
                            .frame(height: 260)
                            .clipShape(.rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Photo \(i + 1) of the paper")
                    .overlay(alignment: .topLeading) {
                        if photos.count > 1 {
                            Text("\(i + 1)")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(.regularMaterial, in: .capsule)
                                .padding(6)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        if let remove {
                            Button(role: .destructive) { remove(p.id) } label: {
                                Image(systemName: "xmark")
                                    .font(.caption.weight(.bold))
                                    .padding(7)
                                    .background(.regularMaterial, in: .capsule)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove photo \(i + 1)")
                            .padding(6)
                        }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .sheet(item: $shown) { p in
            NavigationStack {
                ScrollView {
                    Image(uiImage: p.image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                }
                .navigationTitle("The paper")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { shown = nil } }
                }
            }
            .presentationDetents([.large])
        }
    }
}

// MARK: A name off the paper

/// A name read off the paper, offered rather than decided (order-scanner.tsx `NamePick`): a clear winner shown as
/// matched, and still changeable; anything short of that a list to choose from; nobody close, said so.
struct PaperNamePick: View {
    let label: String
    let guess: PaperNameGuess
    /// What to do when nobody in the book sounds like it.
    let nobody: String
    let pick: (PaperRankedName?) -> Void

    var body: some View {
        Section {
            if let pinned = guess.pinned {
                HStack(spacing: 10) {
                    Label(pinned.name, systemImage: "checkmark.circle.fill")
                    Spacer(minLength: 8)
                    Button("Not them") { pick(nil) }
                        .buttonStyle(.borderless)
                }
            } else if !guess.candidates.isEmpty {
                ForEach(guess.candidates, id: \.id) { c in
                    Button { pick(c) } label: {
                        Label(c.name, systemImage: "person.crop.circle")
                    }
                }
            } else {
                Text(nobody).foregroundStyle(.secondary)
            }
        } header: {
            Text(label)
        } footer: {
            if guess.pinned != nil {
                Text("Read as “\(guess.heard)”: matched in the book.")
            } else if !guess.candidates.isEmpty {
                Text("Read as “\(guess.heard)”. Which one?")
            } else {
                Text("Read as “\(guess.heard)”.")
            }
        }
    }
}

// MARK: Asking the reader

@MainActor
enum PaperReader {
    /// The ERP's reader, as the signed-in owner: the same route the browser's scanner calls. It waits out the AI's
    /// rate limit before answering, so it is given five minutes rather than one.
    static func ask(_ path: String, _ body: [String: Any]) async throws -> Data {
        try await ERPAPI.shared.data(path, method: "POST", json: body, timeout: 300)
    }

    /// What went wrong, in words: the ERP's own when it said something ("Not available on this account.").
    static func words(_ error: Error) -> String {
        if let e = error as? ERPAPI.Failure { return e.message }
        return error.localizedDescription
    }
}
