import SwiftUI
import ImageIO

/// Controls the designer gained on the web (src/lib/social/editor.ts, editor-panels.tsx), shared by the two native
/// editors: the gradient over a photo, the zoom of a photo inside its frame, and the logo (monogram, a logo file).

enum ArtworkShade {
    /// SHADE_DEFAULT, key for key.
    static let standard = MarketingValue(["from": "#000000", "fromAlpha": 0, "to": "#000000", "toAlpha": 0.7, "angle": 180, "start": 0.4, "end": 1])
    /// SHADE_WAYS: the angle each arrow sends the fade toward (CSS degrees), and its name.
    static let ways: [(Int, String, String)] = [(180, "↓", "Down"), (0, "↑", "Up"), (90, "→", "Right"), (270, "←", "Left"), (135, "↘", "Down and right"), (225, "↙", "Down and left")]
}

/// A titled slider as the board designer draws them, for the editors that have no slider of their own.
struct ArtworkSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double = 1
    var format = "%.0f"
    var body: some View {
        let clamped = Binding(get: { min(range.upperBound, max(range.lowerBound, value)) }, set: { value = $0 })
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text(title); Spacer(); Text(String(format: format, value)).monospacedDigit().foregroundStyle(.secondary) }
            Slider(value: clamped, in: range, step: step) { Text(title) }
        }
    }
}

/// ShadeControls (editor-panels.tsx): a gradient over a photo, with direction, angle, two colours and opacities, and
/// where the fade runs. `shade` is the document's value (`.null` when off); `apply` gets the whole new value and a key
/// that lets the caller fold a slider's many steps into one undo.
struct ArtworkShadeControls: View {
    let shade: MarketingValue
    var title = "Gradient over the photo"
    let apply: (MarketingValue, String?) -> Void

    private var on: Bool { shade != .null }
    private func set(_ key: String, _ value: MarketingValue, folded: Bool = true) {
        var g = on ? shade : ArtworkShade.standard
        g[key] = value
        apply(g, folded ? key : nil)
    }
    private func number(_ key: String, scale: Double = 1) -> Binding<Double> {
        Binding(get: { shade.n(key) * scale }, set: { set(key, .number($0 / scale)) })
    }
    private func ink(_ key: String) -> Binding<Color> {
        // The web writes the colour input's own lowercase "#rrggbb".
        Binding(get: { Color(hex: shade.s(key)) ?? .black }, set: { set(key, .string(ArtworkProperties.hex($0).lowercased())) })
    }
    var body: some View {
        Toggle(title, isOn: Binding(get: { on }, set: { apply($0 ? ArtworkShade.standard : .null, nil) }))
        if on {
            Picker("Direction", selection: Binding(get: { Int(shade.n("angle").rounded()) }, set: { set("angle", .number(Double($0)), folded: false) })) {
                ForEach(ArtworkShade.ways, id: \.0) { way in Text(way.1).tag(way.0).accessibilityLabel(way.2) }
            }.pickerStyle(.segmented)
            ArtworkSlider(title: "Angle", value: number("angle"), range: 0...360, format: "%.0f°")
            ColorPicker("From", selection: ink("from"), supportsOpacity: false)
            ArtworkSlider(title: "From opacity", value: number("fromAlpha", scale: 100), range: 0...100, format: "%.0f%%")
            ColorPicker("To", selection: ink("to"), supportsOpacity: false)
            ArtworkSlider(title: "To opacity", value: number("toAlpha", scale: 100), range: 0...100, format: "%.0f%%")
            ArtworkSlider(title: "Fade starts", value: number("start", scale: 100), range: 0...100, format: "%.0f%%")
            ArtworkSlider(title: "Fade ends", value: number("end", scale: 100), range: 0...100, format: "%.0f%%")
        }
    }
}

/// The pixel size of a picture without decoding it (an SVG has none: nil).
enum ArtworkPixels {
    static func size(_ data: Data) -> CGSize? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let p = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? Double, let h = p[kCGImagePropertyPixelHeight] as? Double, w > 0, h > 0 else { return nil }
        return CGSize(width: w, height: h)
    }
    /// panInFrame (editor.ts) line for line: the crop (fx, fy) after the photo is dragged (dx, dy) page px from
    /// (fx0, fy0), clamped so it always covers the frame. `natural` is the picture's own size, nil when unknown.
    static func panned(_ l: MarketingValue, natural: CGSize?, fx0: Double, fy0: Double, dx: Double, dy: Double) -> (fx: Double, fy: Double) {
        let w = l.n("w")
        let ratio = (natural.map { $0.width > 0 ? $0.height / $0.width : 1 }) ?? 1
        let h = l["h"] == .null ? w * ratio : l.n("h")
        let iw = (natural?.width ?? 0) > 0 ? natural!.width : w, ih = (natural?.height ?? 0) > 0 ? natural!.height : h
        let s = max(w / iw, h / ih) * max(1, l.n("iz", 1))
        let spareX = iw * s - w, spareY = ih * s - h
        func cl(_ v: Double) -> Double { (min(1, max(0, v)) * 1000).rounded() / 1000 }
        return (spareX > 0.5 ? cl(fx0 - dx / spareX) : 0.5, spareY > 0.5 ? cl(fy0 - dy / spareY) : 0.5)
    }
}

/// The logo layers the web adds (editor.ts newMonogram, newUploadLayer).
enum ArtworkLogo {
    private static func newID(_ kind: String) -> String { kind + "-" + String(UUID().uuidString.prefix(6)).lowercased() }

    /// newMonogram, key for key: the tall "t", top right.
    static func monogram(ink: String) -> MarketingValue {
        MarketingValue(["id": newID("t"), "kind": "wordmark", "mark": "t", "x": 930, "y": 140, "width": 60, "color": ink, "autoColor": false, "rotate": 0, "opacity": 1])
    }
    /// The web picks white ink on a dark palette and near-black on a light one; here the background decides.
    static func ink(for doc: MarketingValue) -> String {
        if !doc["bg"].s("photoId").isEmpty { return "#FFFFFF" }
        guard let c = Color(hex: doc["bg"].s("color")) else { return "#111111" }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.299 * r + 0.587 * g + 0.114 * b < 0.5 ? "#FFFFFF" : "#111111"
    }

    /// newUploadLayer: an ordinary image layer holding the file as a data: URL, at most 600 wide, centred.
    /// nil when the file is neither a PNG nor an SVG.
    static func uploadLayer(_ data: Data, frame: CGSize) -> MarketingValue? {
        let mime: String, natural: CGSize
        if data.count >= 8, [UInt8](data.prefix(4)) == [0x89, 0x50, 0x4E, 0x47] {
            guard let size = ArtworkPixels.size(data) else { return nil }
            mime = "image/png"; natural = size
        } else if let text = String(data: data, encoding: .utf8), text.range(of: "<svg", options: .caseInsensitive) != nil {
            mime = "image/svg+xml"; natural = svgSize(text)
        } else { return nil }
        let w = min(600, natural.width > 0 ? natural.width : 600), h = w * (natural.width > 0 ? natural.height / natural.width : 1)
        return MarketingValue(["id": newID("upload"), "kind": "image", "photoId": "", "src": "data:\(mime);base64," + data.base64EncodedString(),
                               "x": Double((frame.width / 2 - w / 2).rounded()), "y": Double((frame.height * 0.45 - h / 2).rounded()), "w": Double(w),
                               "radius": 0, "border": NSNull(), "shadow": false, "rotate": 0, "opacity": 1, "name": "Logo file"])
    }
    /// An SVG's own size: its width and height, else its viewBox; 600 × 600 when it says neither.
    static func svgSize(_ text: String) -> CGSize {
        func first(_ pattern: String) -> String? {
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
                  let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), m.numberOfRanges > 1,
                  let r = Range(m.range(at: 1), in: text) else { return nil }
            return String(text[r])
        }
        if let w = first(#"<svg[^>]*?\swidth\s*=\s*["']\s*([0-9.]+)"#).flatMap(Double.init), let h = first(#"<svg[^>]*?\sheight\s*=\s*["']\s*([0-9.]+)"#).flatMap(Double.init), w > 0, h > 0 {
            return CGSize(width: w, height: h)
        }
        if let box = first(#"<svg[^>]*?viewBox\s*=\s*["']([^"']+)["']"#) {
            let n = box.components(separatedBy: CharacterSet(charactersIn: "0123456789.-").inverted).compactMap(Double.init)
            if n.count == 4, n[2] > 0, n[3] > 0 { return CGSize(width: n[2], height: n[3]) }
        }
        return CGSize(width: 600, height: 600)
    }
}
