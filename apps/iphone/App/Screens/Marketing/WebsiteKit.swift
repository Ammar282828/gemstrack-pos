import SwiftUI
import UIKit
import ImageIO
import Observation
import FirebaseAuth
import FirebaseCore
import ERPCore

// What the Website screens share (Add photos, Edit a piece, Photo weights, Investments): a form with files
// to the ERP's routes that take one, a photograph's own bytes, the house's website settings, and the set of
// the day. Nothing here writes to the website itself: every change goes through the same ERP route the web
// page calls, which holds the site's secret (CONVENTIONS.md: the phone never talks to the site).

// MARK: A form with files

/// A multipart form to the ERP, as the web pages send theirs with FormData: Add photos' photograph, Edit a
/// piece's words, Investments' cards, the AI's retouch. Only to this house's own ERP, as the signed-in person,
/// on the same terms as ERPAPI (no cookie, no cache, no redirect off the host).
@MainActor
enum WebsiteForm {
    struct File {
        /// The form's field ("file", "image", "square").
        let field: String
        /// The part's own file name. Plain ASCII: the name the site keeps travels in its own field.
        let name: String
        let type: String
        let data: Data
    }

    static func send(_ path: String, fields: [(String, String)], files: [File] = [], timeout: TimeInterval = 120) async throws -> Data {
        if House.isDemo || FirebaseApp.app() == nil { throw ERPAPI.Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        guard let url = URL(string: path, relativeTo: House.serverURL)?.absoluteURL,
              url.scheme == "https", url.host == House.serverURL.host else {
            throw ERPAPI.Failure(status: 0, message: "Not an address of this ERP.")
        }
        let boundary = "erp-form-" + UUID().uuidString
        var body = Data()
        for (name, value) in fields {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
            body.append(Data(value.utf8))
            body.append(Data("\r\n".utf8))
        }
        for f in files {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(f.field)\"; filename=\"\(f.name)\"\r\nContent-Type: \(f.type)\r\n\r\n".utf8))
            body.append(f.data)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let token = try? await Auth.auth().currentUser?.getIDToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await session.data(for: request, delegate: StayOnHost.shared)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw ERPAPI.Failure(status: status, message: said ?? "The ERP answered \(status).")
        }
        return data
    }

    /// The answer read as the route's JSON.
    static func json<T: Decodable>(_ path: String, fields: [(String, String)], files: [File] = [], timeout: TimeInterval = 120, as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(path, fields: fields, files: files, timeout: timeout))
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()

    /// A dictionary as the JSON text a form field carries (Edit a piece's `words`).
    static func text(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let d = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: d, as: UTF8.self)
    }
}

// MARK: A photograph's bytes

/// A photograph as the phone has it: the bytes Photos hands over, sent as they are when the ERP takes them
/// (JPEG, PNG, WebP, HEIC: the photos route turns HEIC into JPEG itself, as for the web), otherwise made a JPEG.
enum WebsitePhoto {
    struct Kind: Equatable {
        let ext: String
        let mime: String
    }

    /// What the bytes are, from their first few (a photo from Photos carries no file name).
    static func kind(of data: Data) -> Kind? {
        let b = [UInt8](data.prefix(16))
        guard b.count >= 12 else { return nil }
        if b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF { return Kind(ext: "jpg", mime: "image/jpeg") }
        if b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 { return Kind(ext: "png", mime: "image/png") }
        let riff = String(decoding: b[0..<4], as: UTF8.self)
        let webp = String(decoding: b[8..<12], as: UTF8.self)
        if riff == "RIFF" && webp == "WEBP" { return Kind(ext: "webp", mime: "image/webp") }
        let ftyp = String(decoding: b[4..<8], as: UTF8.self)
        let brand = String(decoding: b[8..<12], as: UTF8.self)
        if ftyp == "ftyp" && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"].contains(brand) {
            return Kind(ext: "heic", mime: "image/heic")
        }
        return nil
    }

    /// The picture made a JPEG no longer than `longestEdge` on its long side (the web steps quality the same way).
    static func jpeg(_ image: UIImage, longestEdge: CGFloat = 4032, quality: CGFloat = 0.9) -> Data? {
        let side = max(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let scale = min(1, longestEdge / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return drawn.jpegData(compressionQuality: quality)
    }

    /// The bytes ready for the ERP: as they are when it takes them, else a JPEG made from them.
    static func prepared(_ data: Data) -> (data: Data, kind: Kind)? {
        if let k = kind(of: data) { return (data, k) }
        guard let image = UIImage(data: data), let jpeg = jpeg(image) else { return nil }
        return (jpeg, Kind(ext: "jpg", mime: "image/jpeg"))
    }

    /// A JPEG of any photo the phone can read (HEIC included), for the routes that read only JPEG and PNG
    /// (the AI, Investments' cards).
    static func jpegCopy(_ data: Data, longestEdge: CGFloat = 3000) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        return jpeg(image, longestEdge: longestEdge, quality: 0.92)
    }

    /// A small copy to show (ImageIO decodes at that size, so a 48-megapixel photo never sits whole in memory).
    static func thumbnail(_ data: Data, maxPixel: Int = 400) -> UIImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// "4.2 MB", "820 KB" (the web's prettyBytes).
    static func size(_ n: Int) -> String {
        n > 1_048_576 ? String(format: "%.1f MB", Double(n) / 1_048_576) : "\(Int((Double(n) / 1024).rounded())) KB"
    }
}

// MARK: The house's website

/// /api/app/website: the house's website and which of its screens it has (lib/store-config.ts).
struct WebsiteSettings: Decodable, Equatable {
    let site: String
    let siteName: String
    /// A set of the day on the home page (taheri.shop; the Mina catalogue has none).
    let featured: Bool
    let weights: Bool
    let edit: Bool
    let investments: Bool

    private enum K: String, CodingKey { case site, siteName, featured, weights, edit, investments }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        site = c.string(.site, default: "")
        siteName = c.string(.siteName, default: "the website")
        featured = c.bool(.featured, default: false)
        weights = c.bool(.weights, default: false)
        edit = c.bool(.edit, default: false)
        investments = c.bool(.investments, default: false)
    }
}

/// The set of the day (`app_settings/website_featured`, /api/website/featured).
struct WebsiteFeatured: Decodable, Equatable {
    let key: String
    let note: String
    let collection: String
    let file: String
    let thumb: String

    private enum K: String, CodingKey { case key, note, collection, file, thumb }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        note = c.string(.note, default: "")
        collection = c.string(.collection, default: "")
        file = c.string(.file, default: "")
        thumb = c.string(.thumb, default: "")
    }
}

private struct WebsiteFeaturedAnswer: Decodable {
    let featured: WebsiteFeatured?
    private enum K: String, CodingKey { case featured }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let f = c.object(.featured, of: WebsiteFeatured.self)
        featured = (f?.key.isEmpty ?? true) ? nil : f
    }
}

/// The house's website settings and its set of the day, read once for every Website screen, as the web keeps
/// one state per page for the set of the day (components/website/set-of-the-day.tsx).
@MainActor
@Observable
final class WebsiteStore {
    static let shared = WebsiteStore()

    private(set) var settings: WebsiteSettings?
    /// False until the set of the day has been read; then `featured` is it, or nil for none.
    private(set) var featuredRead = false
    private(set) var featured: WebsiteFeatured?

    var siteName: String { settings?.siteName ?? "the website" }
    var hasFeatured: Bool { settings?.featured ?? false }

    /// The settings once; the set of the day again on every screen that opens (another device may have changed it).
    func loadSettings() async {
        if settings == nil, let s = try? await ERPAPI.shared.get("/api/app/website", as: WebsiteSettings.self) { settings = s }
        if hasFeatured { await loadFeatured() }
    }

    func loadFeatured() async {
        guard hasFeatured else { return }
        if let a = try? await ERPAPI.shared.get("/api/website/featured", as: WebsiteFeaturedAnswer.self) {
            featured = a.featured
            featuredRead = true
        }
    }

    /// Feature a piece (Category/Collection/file); `note` is the line under it on the home page.
    func feature(_ key: String, note: String? = nil) async throws {
        var body: [String: Any] = ["key": key]
        if let note { body["note"] = note }
        let d = try await ERPAPI.shared.data("/api/website/featured", method: "PUT", json: body)
        featured = (try? JSONDecoder().decode(WebsiteFeaturedAnswer.self, from: d))?.featured
        featuredRead = true
    }

    func clearFeatured() async throws {
        _ = try await ERPAPI.shared.send("/api/website/featured", method: "DELETE")
        featured = nil
        featuredRead = true
    }

    /// The same piece whatever its file ending (the site keeps a .webp of every upload): set-of-the-day.tsx `sameFeaturedKey`.
    static func sameKey(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b, !a.isEmpty, !b.isEmpty else { return false }
        return stem(a) == stem(b)
    }

    private static func stem(_ key: String) -> String {
        guard let dot = key.lastIndex(of: "."), !key[dot...].contains("/") else { return key }
        return String(key[..<dot])
    }
}

// MARK: The set of the day

/// Feature this piece today, or take it down if it already is (set-of-the-day.tsx `FeatureToggle`). The set
/// of the day leads the website's home page for everyone, so each change says so before it is made.
struct WebsiteFeatureButton: View {
    /// The piece's key on the site (Category/Collection/file).
    let key: String
    /// What the counter calls it ("DSC09213", the file).
    let name: String

    private var store: WebsiteStore { WebsiteStore.shared }
    @State private var asking = false
    @State private var busy = false
    @State private var failure: String?

    var body: some View {
        if store.hasFeatured {
            let on = WebsiteStore.sameKey(store.featured?.key, key)
            Button { asking = true } label: {
                HStack {
                    Label(on ? "Set of the day: on the home page" : "Feature today", systemImage: on ? "star.fill" : "star")
                    if busy { Spacer(); ProgressView() }
                }
            }
            .disabled(busy || !store.featuredRead)
            .confirmationDialog(on ? "Take it off the home page?" : "Lead the home page with it?", isPresented: $asking, titleVisibility: .visible) {
                Button(on ? "Take it off" : "Feature today", role: on ? .destructive : nil) { Task { await toggle(on) } }
            } message: {
                Text(words(on))
            }
            .alert("The set of the day didn't change", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private func words(_ on: Bool) -> String {
        if on {
            return "\(store.siteName)'s home page stops leading with \(name), for everyone who opens it. Nothing takes its place until another piece is featured."
        }
        let instead = store.featured.map { (f: WebsiteFeatured) in ", in place of \(f.file)" } ?? ""
        return "\(name) becomes the set of the day: the first piece on \(store.siteName)'s home page, for everyone who opens it\(instead)."
    }

    private func toggle(_ on: Bool) async {
        busy = true
        defer { busy = false }
        do {
            if on { try await store.clearFeatured() } else { try await store.feature(key) }
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// What the home page leads with now, with the line under it and a way to take it down
/// (set-of-the-day.tsx `SetOfTheDayCard`). Nothing where the house's website has no set of the day.
struct WebsiteSetOfTheDay: View {
    /// The line under it can be changed here (Photo weights); elsewhere only what it is.
    var withNote = true

    private var store: WebsiteStore { WebsiteStore.shared }
    @State private var note = ""
    @State private var asking: Asking?
    @State private var busy = false
    @State private var failure: String?

    enum Asking: Identifiable {
        case note
        case remove
        var id: Int { self == .note ? 0 : 1 }
    }

    var body: some View {
        if store.hasFeatured {
            Section {
                if !store.featuredRead {
                    MarketingReading(text: "Reading the set of the day…")
                } else if let f = store.featured {
                    HStack(spacing: 12) {
                        StockImage(imageUrl: f.thumb, name: f.file, key: f.key)
                            .frame(width: 52, height: 52)
                            .clipShape(.rect(cornerRadius: 10))
                        TwoLine(title: f.file, subtitle: f.collection)
                        if busy { ProgressView() }
                    }
                    if withNote {
                        TextField("A line about it (optional)", text: $note)
                            .submitLabel(.done)
                            .onSubmit { if note != f.note { asking = .note } }
                        if note != f.note {
                            Button("Put this line on the home page") { asking = .note }
                        }
                    }
                    Button(role: .destructive) { asking = .remove } label: {
                        Label("Take it off the home page", systemImage: "star.slash")
                    }
                    .disabled(busy)
                } else {
                    Label("Nothing is the set of the day. Feature a photo to lead the home page with it.", systemImage: "star")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Set of the day · on the home page")
            }
            .onAppear { note = store.featured?.note ?? "" }
            .onChange(of: store.featured?.note) { _, now in note = now ?? "" }
            .confirmationDialog(asking == .remove ? "Take it off the home page?" : "Change the line on the home page?",
                                isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (a: Asking) in
                if a == .remove {
                    Button("Take it off", role: .destructive) { Task { await remove() } }
                } else {
                    Button("Put it on the home page") { Task { await saveNote() } }
                }
            } message: { (a: Asking) in
                if a == .remove {
                    Text("\(store.siteName)'s home page stops leading with \(store.featured?.file ?? "it"), for everyone who opens it.")
                } else {
                    Text(note.trimmingCharacters(in: .whitespaces).isEmpty
                         ? "The line under the set of the day on \(store.siteName)'s home page is taken away."
                         : "Under the set of the day on \(store.siteName)'s home page, for everyone: “\(note.trimmingCharacters(in: .whitespaces))”")
                }
            }
            .alert("The set of the day didn't change", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
        }
    }

    private var askingShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { (on: Bool) in if !on { asking = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private func saveNote() async {
        guard let f = store.featured else { return }
        busy = true
        defer { busy = false }
        do { try await store.feature(f.key, note: String(note.prefix(160))) } catch { failure = error.localizedDescription }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do { try await store.clearFeatured() } catch { failure = error.localizedDescription }
    }
}

// MARK: Small shared pieces

/// "12.5", "3" (a weight as the counter typed it: no trailing zeros).
enum WebsiteNumber {
    static func grams(_ v: Double) -> String {
        var s = String(format: "%.3f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// What the counter typed, as grams the site takes (more than 0, under 5,000), or nil.
    static func parse(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !t.isEmpty, let v = Double(t), v > 0, v < 5000 else { return nil }
        return v
    }

    /// A key or a name, escaped whole for a query (a site key is a path: "Rings/DSC0912.webp").
    static func query(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }
}

/// The busy veil every Website screen shows while the ERP works (PostQueueSheet's).
struct WebsiteBusy: ViewModifier {
    let doing: String?

    func body(content: Content) -> some View {
        content
            .disabled(doing != nil)
            .overlay { if let doing { ProgressView(doing).padding(20).glassEffect(.regular, in: .rect(cornerRadius: 18)) } }
    }
}

extension View {
    func websiteBusy(_ doing: String?) -> some View { modifier(WebsiteBusy(doing: doing)) }
}
