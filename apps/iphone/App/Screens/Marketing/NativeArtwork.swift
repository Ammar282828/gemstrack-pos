import SwiftUI
import WebKit
import Observation

/// The shared drawing engine runs locally, without a website or network. Screens and editing controls are native.
@MainActor
@Observable
final class NativeArtwork: NSObject, WKNavigationDelegate {
    private let web: WKWebView
    @ObservationIgnored private var pending: [CheckedContinuation<Void, Error>] = []
    private var loaded = false
    private var loadError: Error?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1080, height: 1920), configuration: config)
        super.init()
        web.navigationDelegate = self
        web.isInspectable = false
        guard let url = Bundle.main.url(forResource: "design-\(House.id)", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else {
            loadError = ERPAPI.Failure(status: 0, message: "The artwork tools are missing from this build.")
            return
        }
        let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"
        web.loadHTMLString("<!doctype html><meta http-equiv='Content-Security-Policy' content=\"\(policy)\"><script>\(script.replacingOccurrences(of: "</script", with: "<\\/script"))</script>", baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        let all = pending; pending = []
        for p in all { p.resume() }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail(ERPAPI.Failure(status: 0, message: "The artwork renderer stopped. Close and reopen the design to retry."))
    }
    private func fail(_ error: Error) {
        loadError = error
        let all = pending; pending = []
        for p in all { p.resume(throwing: error) }
    }
    func run(doc: MarketingValue, photos: [String: Data], fields: [String: String], options: [String: Any] = [:]) async throws -> MarketingValue {
        if let loadError { throw loadError }
        if !loaded { try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in pending.append(c) } }
        try Task.checkCancellation()
        var input = options
        input["doc"] = doc == .null ? NSNull() : doc.any
        input["photos"] = photos.mapValues { data in "data:\(WebsitePhoto.kind(of: data)?.mime ?? "image/jpeg");base64,\(data.base64EncodedString())" }
        input["fields"] = fields
        input["house"] = House.id
        let result = try await web.callAsyncJavaScript("try { return await window.nativeDesign(input); } catch (error) { return {nativeError: String(error)}; }", arguments: ["input": input], in: nil, contentWorld: .page)
        let answer = MarketingValue(result ?? NSNull())
        if !answer.s("nativeError").isEmpty { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn: " + answer.s("nativeError")) }
        return answer
    }
    nonisolated static func blank(photo: String? = nil, height: Double = 1920) -> MarketingValue {
        var doc = MarketingValue(["bg": ["photoId": photo as Any? ?? NSNull(), "placement": ["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5], "dim": 0, "gradient": "none", "color": "#EDE6DA"], "layers": [], "frame": ["w": 1080, "h": height]])
        if height == 1080 { doc["placements"] = .object([:]) }
        return doc
    }
    static func image(_ response: MarketingValue) -> UIImage? {
        guard let data = Data(base64Encoded: response["image"].string) else { return nil }
        return UIImage(data: data)
    }
}

/// Every editable field remains in the document; importing an old design doesn't discard its layer settings.
struct ArtworkProperties: View {
    @Binding var value: MarketingValue
    let keys: [String]
    var body: some View {
        ForEach(keys, id: \.self) { key in
            property(key)
        }
    }
    @ViewBuilder private func property(_ key: String) -> some View {
        let field = Binding<MarketingValue>(get: { value[key] }, set: { value[key] = $0 })
        switch value[key] {
        case .bool:
            Toggle(Self.label(key), isOn: Binding(get: { field.wrappedValue.bool }, set: { field.wrappedValue = .bool($0) }))
        case .number:
            LabeledContent(Self.label(key)) {
                TextField(Self.label(key), value: Binding(get: { field.wrappedValue.number }, set: { field.wrappedValue = .number($0) }), format: .number)
                    .keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing)
            }
        case .string:
            if Self.choices[key] != nil {
                Picker(Self.label(key), selection: Binding(get: { field.wrappedValue.string }, set: { field.wrappedValue = .string($0) })) {
                    ForEach(Self.choices[key] ?? [], id: \.self) { Text(Self.label($0)).tag($0) }
                }
            } else if key.lowercased().contains("color") || ["fill", "fill2", "border"].contains(key) {
                ColorPicker(Self.label(key), selection: Binding(get: { Color(hex: field.wrappedValue.string) ?? .white }, set: { field.wrappedValue = .string(Self.hex($0)) }), supportsOpacity: false)
            } else {
                TextField(Self.label(key), text: Binding(get: { field.wrappedValue.string }, set: { field.wrappedValue = .string($0) }), axis: .vertical)
                    .lineLimit(1...8)
            }
        case .object:
            DisclosureGroup(Self.label(key)) { ArtworkProperties(value: field, keys: value[key].object.keys.sorted()) }
        default: EmptyView()
        }
    }
    static func label(_ value: String) -> String {
        let names = ["x": "Across", "y": "Down", "w": "Width", "h": "Height", "fx": "Photo focus across", "fy": "Photo focus down", "flipX": "Mirror across", "flipY": "Mirror down", "photoId": "Photo", "rotate": "Rotation", "autoColor": "Choose ink from the photo", "fit": "Fit the words", "upper": "Capitals", "spacing": "Letter spacing", "lineHeight": "Line spacing", "stroke": "Outline width", "fill2": "Gradient end", "focusX": "Focus across", "focusY": "Focus down"]
        if let name = names[value] { return name }
        let words = value.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).replacingOccurrences(of: "-", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
    static let choices: [String: [String]] = [
        "font": ["condensed", "light", "regular", "bold", "serif", "serif-italic", "futura", "cormorant", "cormorant-italic", "playfair", "script", "montserrat", "montserrat-bold", "cinzel"],
        "align": ["left", "center", "right"], "gradient": ["none", "top", "bottom", "both"], "mode": ["fill", "fit"], "dash": ["solid", "dash", "dot"],
        "mask": ["rounded", "ellipse", "arch", "heart", "star", "hexagon", "diamond", "sparkle", "gem", "pill"],
    ]
    static func hex(_ color: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}

/// Shared between designs so a copied layer can be carried from a story to a post.
@MainActor @Observable
final class ArtworkClipboard {
    static let shared = ArtworkClipboard()
    var layers: [MarketingValue] = []
    var frame = MarketingValue(["w": 1080, "h": 1920])
    var photos: [String: Data] = [:]
}
