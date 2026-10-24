import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Keeps the editor's documents intact across phones and the web, including fields added by either.
indirect enum MarketingValue: Codable, Equatable {
    case object([String: MarketingValue]), array([MarketingValue]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: MarketingValue].self) { self = .object(v) }
        else { self = .array((try? c.decode([MarketingValue].self)) ?? []) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    init(_ value: Any) {
        switch value {
        case let v as [String: Any]: self = .object(v.mapValues(MarketingValue.init))
        case let v as [Any]: self = .array(v.map(MarketingValue.init))
        case let v as String: self = .string(v)
        case let v as NSNumber: self = CFGetTypeID(v) == CFBooleanGetTypeID() ? .bool(v.boolValue) : .number(v.doubleValue)
        default: self = .null
        }
    }
    var object: [String: MarketingValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [MarketingValue] { if case .array(let v) = self { return v }; return [] }
    var string: String { if case .string(let v) = self { return v }; return "" }
    var number: Double { if case .number(let v) = self { return v }; return Double(string) ?? 0 }
    var bool: Bool { if case .bool(let v) = self { return v }; return false }
    var any: Any {
        switch self {
        case .object(let v): return v.mapValues(\.any)
        case .array(let v): return v.map(\.any)
        case .string(let v): return v
        case .number(let v): return v
        case .bool(let v): return v
        case .null: return NSNull()
        }
    }
    subscript(_ key: String) -> MarketingValue {
        get { object[key] ?? .null }
        set { var v = object; v[key] = newValue; self = .object(v) }
    }
    func n(_ key: String, _ fallback: Double = 0) -> Double { self[key] == .null ? fallback : self[key].number }
    func s(_ key: String, _ fallback: String = "") -> String { self[key] == .null ? fallback : self[key].string }
    var data: Data { let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys; return (try? encoder.encode(self)) ?? Data() }
    var text: String { String(decoding: data, as: UTF8.self) }
}

@MainActor
enum MarketingRequest {
    static func get(_ path: String) async throws -> MarketingValue {
        try JSONDecoder().decode(MarketingValue.self, from: await ERPAPI.shared.data(path))
    }
    static func send(_ path: String, _ body: [String: Any] = [:], method: String = "POST") async throws -> MarketingValue {
        try JSONDecoder().decode(MarketingValue.self, from: await ERPAPI.shared.data(path, method: method, json: body, timeout: 240))
    }
    static func ai(_ op: String, images: [Data], params: [String: Any]) async throws -> MarketingValue {
        try JSONDecoder().decode(MarketingValue.self, from: await WebsiteForm.send("/api/website/post/ai", fields: [("op", op), ("params", WebsiteForm.text(params))], files: images.enumerated().map { i, d in
            WebsiteForm.File(field: "image", name: "image-\(i).jpg", type: "image/jpeg", data: WebsitePhoto.jpegCopy(d) ?? d)
        }, timeout: 240))
    }
}

struct MarketingFileShare: Identifiable {
    let id = UUID()
    let items: [Any]
}

/// A picture redrawn at `size` pixels (scale 1), the one place photos are shrunk before they are sent. The phone draws
/// with its renderer; the Mac draws the same bitmap with Core Graphics (white under a transparent picture, as a JPEG has no clear).
enum MarketingScale {
    static func image(_ image: UIImage, to size: CGSize) -> UIImage {
        #if os(iOS)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        #else
        let w = max(1, Int(size.width.rounded())), h = max(1, Int(size.height.rounded()))
        guard let source = image.cgImage,
              let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: w, height: h))
        context.interpolationQuality = .high
        context.draw(source, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let drawn = context.makeImage() else { return image }
        return UIImage(cgImage: drawn)
        #endif
    }
}

/// The platform's way to put a UIKit or AppKit view (the web view) into SwiftUI; each screen supplies the matching make/update pair.
#if os(iOS)
typealias MarketingWebRepresentable = UIViewRepresentable
#else
typealias MarketingWebRepresentable = NSViewRepresentable
#endif

/// Whether this device can take a photo for the piece: a phone can; the Mac chooses a file instead (Photos or Files).
enum MarketingCamera {
    static var available: Bool {
        #if os(iOS)
        UIImagePickerController.isSourceTypeAvailable(.camera)
        #else
        false
        #endif
    }
}

#if os(iOS)
struct MarketingShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    var completion: ((Bool) -> Void)? = nil
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, _ in completion?(completed) }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#else
/// The Mac's share menu, in a small sheet: the system's own list of places (Mail, Messages, AirDrop, Save…).
/// It is shown as a button that opens the picker, since a Mac has no sheet of activities to present.
struct MarketingShareSheet: View {
    let items: [Any]
    var completion: ((Bool) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 14) {
            Text("Share").font(.headline)
            MacShareButton(items: items) { completed in completion?(completed); dismiss() }
            Button("Cancel", role: .cancel) { completion?(false); dismiss() }
        }
        .padding(24).frame(minWidth: 260)
    }
}

/// An NSSharingServicePicker anchored on its own button.
private struct MacShareButton: NSViewRepresentable {
    let items: [Any]
    let done: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    func makeNSView(context: Context) -> NSButton {
        let button = NSButton(title: "Choose where to send it…", target: context.coordinator, action: #selector(Coordinator.pick(_:)))
        button.bezelStyle = .rounded
        return button
    }
    func updateNSView(_ button: NSButton, context: Context) { context.coordinator.items = items; context.coordinator.done = done }
    final class Coordinator: NSObject, NSSharingServicePickerDelegate {
        var items: [Any] = []
        var done: (Bool) -> Void
        init(done: @escaping (Bool) -> Void) { self.done = done }
        @objc func pick(_ sender: NSButton) {
            let picker = NSSharingServicePicker(items: items)
            picker.delegate = self
            picker.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
        }
        func sharingServicePicker(_ picker: NSSharingServicePicker, didChoose service: NSSharingService?) {
            done(service != nil)
        }
    }
}
#endif

/// Server images use the same authenticated, house-bound transport as the rest of the app.
struct MarketingPhoto: View {
    let path: String
    @State private var image: UIImage?
    @State private var problem: String?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if let problem { Label(problem, systemImage: "photo.badge.exclamationmark").font(.caption) }
            else { SkeletonLoading() }
        }
        .task(id: path) {
            image = nil; problem = nil
            do {
                let data: Data
                if path.hasPrefix("/api/") { data = try await ERPAPI.shared.data(path) }
                else if let url = URL(string: path), url.scheme == "https" { data = try await URLSession.shared.data(from: url).0 }
                else { throw ERPAPI.Failure(status: 0, message: "The picture has no usable address.") }
                guard let made = WebsitePhoto.thumbnail(data, maxPixel: 1200) else { throw ERPAPI.Failure(status: 0, message: "The picture could not be read.") }
                image = made
            } catch { problem = error.localizedDescription }
        }
    }
}
