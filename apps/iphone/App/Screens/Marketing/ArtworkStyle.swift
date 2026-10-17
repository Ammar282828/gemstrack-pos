import SwiftUI

/// Designer v2 controls for look: blend, opacity, shadow / glow / outline on shapes, photos, marks and QR codes, the
/// text effects, and the photo adjustments. They write exactly the web's fields and ranges
/// (src/lib/social/editor.ts, design.ts; panels/blend-fx.tsx, adjust.tsx, editor-panels.tsx EffectControls).
/// Every field is optional, so a document without them looks and saves as it did.

/// Runs a change and folds a slider's many steps into one undo (the editor's `fold`).
typealias ArtworkFold = (String, () -> Void) -> Void

extension MarketingValue {
    /// Removes a key (the web writes `undefined`, so the field is gone, not null).
    mutating func artworkDrop(_ key: String) { var o = object; o.removeValue(forKey: key); self = .object(o) }
}

/// A colour row that writes the web colour input's own lowercase "#rrggbb".
struct ArtworkColour: View {
    let title: String
    let hex: String
    var fallback: Color = .black
    let set: (String) -> Void
    var body: some View {
        ColorPicker(title, selection: Binding(get: { Color(hex: hex) ?? fallback }, set: { set(ArtworkProperties.hex($0).lowercased()) }), supportsOpacity: false)
    }
}

enum ArtworkFx {
    /// BLENDS (panels/blend-fx.tsx): the engine's nine composite operations, with the web's hint for each.
    static let blends: [(id: String, label: String, hint: String)] = [
        ("normal", "Normal", "Just on top"),
        ("multiply", "Multiply", "Darkens: a soft shadow under a cut-out piece"),
        ("screen", "Screen", "Lightens: glow, sparkle, gold light"),
        ("overlay", "Overlay", "Deepens contrast and colour"),
        ("soft-light", "Soft light", "A gentle wash of colour or light"),
        ("hard-light", "Hard light", "A strong wash"),
        ("color-dodge", "Colour dodge", "Bright, burning highlights"),
        ("darken", "Darken", "Keeps whichever is darker"),
        ("lighten", "Lighten", "Keeps whichever is lighter"),
    ]
    /// FX_DEFAULTS, key for key.
    static let defaults: [String: MarketingValue] = [
        "shadow": MarketingValue(["color": "#000000", "x": 0, "y": 12, "blur": 28, "alpha": 0.35]),
        "glow": MarketingValue(["color": "#FFD98A", "blur": 30, "alpha": 0.8]),
        "outline": MarketingValue(["color": "#FFFFFF", "width": 6]),
    ]
    /// EFFECTS (text), in the web's order.
    static let textEffects: [(id: String, label: String)] = [
        ("none", "None"), ("shadow", "Shadow"), ("lift", "Lift"), ("hollow", "Hollow"), ("outline", "Outline"),
        ("splice", "Splice"), ("echo", "Echo"), ("neon", "Neon"), ("glitch", "Glitch"),
    ]
    /// effectDefaults(kind, text colour), key for key.
    static func effectDefaults(_ kind: String, ink: String) -> MarketingValue {
        var e: [String: Any] = ["kind": kind, "color": "#000000", "offset": 30, "angle": 45, "blur": 20, "thickness": 40, "transparency": 50]
        let dark = ink.lowercased() == "#000000" || ink.lowercased() == "#111111"
        switch kind {
        case "lift": e["transparency"] = 40
        case "hollow": e["thickness"] = 35
        case "outline": e["color"] = dark ? "#FFFFFF" : "#111111"; e["thickness"] = 45
        case "splice": e["color"] = "#C9973F"; e["offset"] = 40; e["thickness"] = 35
        case "echo": e["color"] = ink; e["offset"] = 35
        case "neon": e["color"] = ink; e["blur"] = 50
        default: break
        }
        return MarketingValue(e)
    }
}

/// Blend, opacity, and (for anything that is not text) shadow, glow and outline: the web's Effects panel.
/// `layer` may be the first of several selected layers; the editor copies the result to the rest.
struct ArtworkEffectsRows: View {
    @Binding var layer: MarketingValue
    var fold: ArtworkFold
    private var isText: Bool { layer.s("kind") == "text" }

    private var blend: Binding<String> {
        Binding(get: { layer.s("blend", "normal") }, set: { v in
            if v == "normal" { layer.artworkDrop("blend") } else { layer["blend"] = .string(v) }
        })
    }
    private func fx(_ name: String) -> MarketingValue { layer["layerFx"][name] }
    private func setFx(_ name: String, _ key: String, _ value: MarketingValue) {
        var all = layer["layerFx"]
        var one = all[name] == .null ? (ArtworkFx.defaults[name] ?? .null) : all[name]
        one[key] = value
        all[name] = one
        layer["layerFx"] = all
    }
    private func toggle(_ name: String) -> Binding<Bool> {
        Binding(get: { fx(name) != .null }, set: { on in
            var all = layer["layerFx"]
            if on { all[name] = ArtworkFx.defaults[name] ?? .null } else { all.artworkDrop(name) }
            if all.object.isEmpty { layer.artworkDrop("layerFx") } else { layer["layerFx"] = all }
        })
    }
    private func number(_ name: String, _ key: String, scale: Double = 1) -> Binding<Double> {
        Binding(get: { fx(name).n(key, ArtworkFx.defaults[name]?.n(key) ?? 0) * scale }, set: { v in
            fold("fx-\(name)-\(key)") { setFx(name, key, .number(v / scale)) }
        })
    }
    private func ink(_ name: String, _ title: String) -> some View {
        ArtworkColour(title: title, hex: fx(name).s("color", ArtworkFx.defaults[name]?.s("color") ?? "#000000")) { setFx(name, "color", .string($0)) }
    }

    var body: some View {
        Picker("Blend", selection: blend) { ForEach(ArtworkFx.blends, id: \.0) { Text($0.label).tag($0.id) } }
        if let hint = ArtworkFx.blends.first(where: { $0.id == layer.s("blend", "normal") })?.hint, layer.s("blend", "normal") != "normal" {
            Text(hint + ".").font(.footnote).foregroundStyle(.secondary)
        }
        // The web's slider is "Transparency" 0…95%; opacity is kept 0.05…1.
        ArtworkSlider(title: "Opacity", value: Binding(get: { layer.n("opacity", 1) * 100 }, set: { v in fold("opacity") { layer["opacity"] = .number(v.rounded() / 100) } }), range: 5...100, step: 1, format: "%.0f%%")
        if !isText {
            Toggle("Shadow", isOn: toggle("shadow"))
            if fx("shadow") != .null {
                ink("shadow", "Shadow colour")
                ArtworkSlider(title: "Across", value: number("shadow", "x"), range: -100...100, format: "%.0f")
                ArtworkSlider(title: "Down", value: number("shadow", "y"), range: -100...100, format: "%.0f")
                ArtworkSlider(title: "Blur", value: number("shadow", "blur"), range: 0...120, format: "%.0f")
                ArtworkSlider(title: "Strength", value: number("shadow", "alpha", scale: 100), range: 0...100, format: "%.0f%%")
            }
            Toggle("Glow", isOn: toggle("glow"))
            if fx("glow") != .null {
                ink("glow", "Glow colour")
                ArtworkSlider(title: "Spread", value: number("glow", "blur"), range: 0...160, format: "%.0f")
                ArtworkSlider(title: "Strength", value: number("glow", "alpha", scale: 100), range: 0...100, format: "%.0f%%")
            }
            Toggle("Outline", isOn: toggle("outline"))
            if fx("outline") != .null {
                ink("outline", "Outline colour")
                ArtworkSlider(title: "Thickness", value: number("outline", "width"), range: 1...60, format: "%.0f")
            }
            if layer.s("kind") == "image", layer["shadow"].bool, layer["layerFx"] != .null {
                Text("An effect here replaces the photo’s plain Shadow switch.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// A text layer's own effect (shadow, lift, hollow, outline, splice, echo, neon, glitch) with only the parameters the
/// kind uses, in the web's ranges.
struct ArtworkTextEffectRows: View {
    @Binding var layer: MarketingValue
    var fold: ArtworkFold
    private var kind: String { layer["effect"].s("kind", "none") }
    private func uses(_ key: String) -> Bool {
        switch key {
        case "offset": return ["shadow", "splice", "echo", "glitch"].contains(kind)
        case "angle": return ["shadow", "splice", "echo"].contains(kind)
        case "blur": return ["shadow", "neon"].contains(kind)
        case "thickness": return ["hollow", "outline", "splice"].contains(kind)
        case "transparency": return ["shadow", "lift"].contains(kind)
        default: return ["shadow", "outline", "splice", "echo", "neon"].contains(kind)
        }
    }
    private func set(_ key: String, _ value: MarketingValue) {
        var e = layer["effect"]
        e[key] = value
        layer["effect"] = e
        layer["shadow"] = .bool(false)
    }
    private func number(_ key: String) -> Binding<Double> {
        Binding(get: { layer["effect"].n(key) }, set: { v in fold("effect-\(key)") { set(key, .number(v)) } })
    }
    var body: some View {
        Picker("Text effect", selection: Binding(get: { kind }, set: { k in
            if k == "none" { layer.artworkDrop("effect") }
            else { layer["effect"] = ArtworkFx.effectDefaults(k, ink: layer.s("color", "#FFFFFF")); layer["shadow"] = .bool(false) }
        })) { ForEach(ArtworkFx.textEffects, id: \.0) { Text($0.label).tag($0.id) } }
        if kind != "none" {
            if uses("offset") { ArtworkSlider(title: "Offset", value: number("offset"), range: 0...100) }
            if uses("angle") { ArtworkSlider(title: "Direction", value: number("angle"), range: -180...180, format: "%.0f°") }
            if uses("blur") { ArtworkSlider(title: kind == "neon" ? "Glow" : "Blur", value: number("blur"), range: 0...100) }
            if uses("thickness") { ArtworkSlider(title: "Thickness", value: number("thickness"), range: 1...100) }
            if uses("transparency") { ArtworkSlider(title: kind == "lift" ? "Softness" : "Transparency", value: number("transparency"), range: 0...100) }
            if uses("color") { ArtworkColour(title: "Effect colour", hex: layer["effect"].s("color", "#000000")) { c in fold("effect-color") { set("color", .string(c)) } } }
        }
    }
}

/// Photo adjustments (panels/adjust.tsx): a filter, three quick fixes for jewellery shots, and every slider the engine
/// has, grouped Light / Colour / Detail. `adjust` is `.null` while off; sliders that were never touched stay absent.
struct ArtworkAdjustRows: View {
    @Binding var adjust: MarketingValue
    let filters: [MarketingValue]
    var fold: ArtworkFold
    @State private var open = false

    private static let groups: [(title: String, sliders: [(key: String, label: String, min: Double, max: Double)])] = [
        ("Light", [("brightness", "Brightness", -100, 100), ("contrast", "Contrast", -100, 100), ("highlights", "Highlights", -100, 100), ("shadows", "Shadows", -100, 100), ("fade", "Fade", 0, 100)]),
        ("Colour", [("saturation", "Saturation", -100, 100), ("warmth", "Warmth", -100, 100), ("tint", "Tint", -100, 100), ("hue", "Hue", -100, 100)]),
        ("Detail", [("sharpen", "Sharpen", 0, 100), ("blur", "Blur", 0, 100), ("grain", "Grain", 0, 100), ("vignette", "Vignette", 0, 100)]),
    ]
    /// QUICK_FIXES: they set these fields over whatever is there.
    private static let quick: [(label: String, patch: [String: Double])] = [
        ("Tame glare", ["highlights": -55, "shadows": 25]),
        ("Sparkle", ["sharpen": 55, "contrast": 12, "highlights": -15]),
        ("Warm gold", ["warmth": 22, "saturation": 10, "tint": 4]),
    ]
    /// NO_ADJUST: the six keys the web always writes.
    static let none = MarketingValue(["brightness": 0, "contrast": 0, "saturation": 0, "warmth": 0, "fade": 0, "vignette": 0])

    private func put(_ key: String, _ value: Double) {
        var a = adjust == .null ? Self.none : adjust
        a[key] = .number(value)
        adjust = a
    }
    var body: some View {
        Menu("Choose filter") { ForEach(filters, id: \.text) { f in Button(f.s("label")) { adjust = f["adjust"] } } }
        HStack {
            ForEach(Self.quick, id: \.0) { q in
                Button(q.label) {
                    var a = adjust == .null ? Self.none : adjust
                    for (k, v) in q.patch { a[k] = .number(v) }
                    adjust = a
                }.buttonStyle(.bordered).controlSize(.small)
            }
        }
        if adjust == .null {
            Button("Adjust by hand") { adjust = Self.none; open = true }
        } else {
            DisclosureGroup("Fine-tune with sliders", isExpanded: $open) {
                ForEach(Self.groups, id: \.0) { group in
                    Text(group.title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(group.sliders, id: \.0) { s in
                        ArtworkSlider(title: s.label, value: Binding(get: { adjust.n(s.key) }, set: { v in fold("adj-\(s.key)") { put(s.key, v) } }), range: s.min...s.max, format: "%.0f")
                    }
                }
                Button("Reset everything") { adjust = Self.none }
            }
        }
    }
}
