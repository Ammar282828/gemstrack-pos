import SwiftUI

/// Designer v2 QR layers (editor.ts newQr / QrLayer, panels/qr.tsx): `value`, `w` (square), `fg`, `bg` (null leaves the
/// quiet zone clear), `quiet` 0…8 modules. The bundled engine draws them; this writes the same fields.
enum ArtworkQR {
    /// QR_MIN (lib/design/safe.ts): below it a phone cannot scan the code.
    static let minimum = 120.0
    /// newQr: 300 wide, on white, centred.
    static func layer(_ value: String, frame: CGSize) -> MarketingValue {
        let w = min(300, frame.width - 160)
        return MarketingValue(["id": "qr-" + String(UUID().uuidString.prefix(6)).lowercased(), "kind": "qr", "role": "cta",
                               "x": Double((frame.width / 2 - w / 2).rounded()), "y": Double((frame.height * 0.45 - w / 2).rounded()), "w": Double(w),
                               "value": value, "fg": "#111111", "bg": "#FFFFFF", "quiet": 4, "rotate": 0, "opacity": 1])
    }
    /// Nothing is drawn for no words or more than a code can hold (the engine returns no matrix).
    static func problem(_ value: String) -> String? {
        if value.isEmpty { return "Nothing to encode yet, so nothing is drawn." }
        if value.utf8.count > 2000 { return "That is too long to fit in a QR code here, so nothing is drawn." }
        return nil
    }
}

/// The controls of a QR code on the page: what it says, its size, its two colours and its quiet edge.
struct ArtworkQRRows: View {
    @Binding var layer: MarketingValue
    var fold: ArtworkFold
    var body: some View {
        TextField("Says", text: Binding(get: { layer.s("value") }, set: { v in fold("qrvalue") { layer["value"] = .string(v) } }), axis: .vertical)
            .lineLimit(1...4).textInputAutocapitalization(.never).autocorrectionDisabled()
        if let problem = ArtworkQR.problem(layer.s("value")) { Text(problem).font(.footnote).foregroundStyle(Tone.problem.color) }
        // hasStrings does not ask iOS for the clipboard (reading it would show the "pasted from" notice); the tap does.
        if UIPasteboard.general.hasStrings {
            Button("Paste a link or words") { if let copied = UIPasteboard.general.string, !copied.isEmpty { layer["value"] = .string(copied) } }
        }
        ArtworkSlider(title: "Size", value: Binding(get: { layer.n("w", 300) }, set: { v in fold("qrw") { layer["w"] = .number(v) } }), range: ArtworkQR.minimum...1000, step: 4, format: "%.0f px")
        if layer.n("w", 300) < ArtworkQR.minimum + 40 {
            Text("Small codes are hard to scan from a phone screen; \(Int(ArtworkQR.minimum) + 40) px or more is safer.").font(.footnote).foregroundStyle(Tone.owed.color)
        }
        ArtworkColour(title: "Dark parts", hex: layer.s("fg", "#111111")) { c in fold("qrfg") { layer["fg"] = .string(c) } }
        Toggle("Light square behind it", isOn: Binding(get: { layer["bg"] != .null }, set: { layer["bg"] = $0 ? .string("#FFFFFF") : .null }))
        if layer["bg"] != .null {
            ArtworkColour(title: "Behind", hex: layer.s("bg", "#FFFFFF"), fallback: .white) { c in fold("qrbg") { layer["bg"] = .string(c) } }
        }
        ArtworkSlider(title: "Quiet edge", value: Binding(get: { layer.n("quiet", 4) }, set: { v in fold("qrq") { layer["quiet"] = .number(v) } }), range: 0...8, format: "%.0f")
        Text("Keep a light border round the code (4 modules is the standard) and a strong contrast between dark and light so every phone reads it. The code stays square.").font(.footnote).foregroundStyle(.secondary)
    }
}
