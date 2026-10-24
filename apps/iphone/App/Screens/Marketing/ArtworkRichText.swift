import SwiftUI

/// Designer v2 rich text and gradients (src/lib/social/editor.ts setRunStyle / normalizeRuns, gradient.ts;
/// panels/text-runs.tsx, gradient-editor.tsx). Runs index the words as written, in UTF-16 units like the web's string
/// offsets, so a design edited here and on the web styles the same letters.

// MARK: - Runs

enum ArtworkRuns {
    struct Piece { var from: Int; var to: Int; var style: [String: MarketingValue] }
    struct Token { let from: Int; let to: Int; let text: String; let word: Bool }

    /// tokenise (text-runs.tsx): the words and the gaps between them, with where each starts.
    static func tokens(_ text: String) -> [Token] {
        let ns = text as NSString
        func space(_ c: unichar) -> Bool { Unicode.Scalar(c).map { CharacterSet.whitespacesAndNewlines.contains($0) } ?? false }
        var out: [Token] = []
        var i = 0
        while i < ns.length {
            let isSpace = space(ns.character(at: i))
            var j = i + 1
            while j < ns.length && space(ns.character(at: j)) == isSpace { j += 1 }
            out.append(Token(from: i, to: j, text: ns.substring(with: NSRange(location: i, length: j - i)), word: !isSpace))
            i = j
        }
        return out
    }
    /// normalizeRuns: kept inside the words (0…len), without empty ones.
    static func normalize(_ runs: [MarketingValue], len: Int) -> [Piece] {
        var out: [Piece] = []
        for r in runs {
            guard r["from"] != .null, r["to"] != .null else { continue }
            let from = max(0, min(len, Int(r.n("from").rounded()))), to = max(0, min(len, Int(r.n("to").rounded())))
            guard to > from else { continue }
            var style = r.object
            style.removeValue(forKey: "from"); style.removeValue(forKey: "to")
            out.append(Piece(from: from, to: to, style: style))
        }
        return out
    }
    static func encode(_ p: Piece) -> MarketingValue {
        var o = p.style
        o["from"] = .number(Double(p.from)); o["to"] = .number(Double(p.to))
        return .object(o)
    }
    /// setRunStyle: characters `from`…`to` are styled, the runs cut at the edges, a nil patch value clears that key,
    /// and neighbours with the same style join.
    static func set(_ runs: [MarketingValue], from: Int, to: Int, patch: [String: MarketingValue?], len: Int) -> [MarketingValue] {
        let cur = normalize(runs, len: len)
        let a = max(0, min(len, from)), b = max(0, min(len, to))
        if b <= a { return cur.map(encode) }
        var cuts: Set<Int> = [0, len, a, b]
        for r in cur { cuts.insert(r.from); cuts.insert(r.to) }
        let pts = cuts.sorted()
        var pieces: [Piece] = []
        for i in 0..<max(0, pts.count - 1) {
            let f = pts[i], t = pts[i + 1]
            var style: [String: MarketingValue] = [:]
            for r in cur where r.from <= f && r.to >= t { for (k, v) in r.style { style[k] = v } }
            if f >= a && t <= b {
                for (k, v) in patch { if let v { style[k] = v } else { style.removeValue(forKey: k) } }
            }
            if !style.isEmpty {
                if let last = pieces.last, last.to == f, last.style == style { pieces[pieces.count - 1].to = t }
                else { pieces.append(Piece(from: f, to: t, style: style)) }
            }
        }
        return pieces.map(encode)
    }
    /// BOLD_OF / ITALIC_OF.
    static let boldOf = ["light": "regular", "regular": "bold", "bold": "regular", "montserrat": "montserrat-bold", "montserrat-bold": "montserrat"]
    static let italicOf = ["serif": "serif-italic", "serif-italic": "serif", "cormorant": "cormorant-italic", "cormorant-italic": "cormorant"]
}

/// FONT_LABEL, in the web's order (the fifteen faces plus the six Designer v2 jewellery faces).
enum ArtworkFont {
    static let faces: [(id: String, label: String)] = [
        ("condensed", "Condensed (headline)"), ("light", "Light"), ("regular", "Regular"), ("bold", "Bold"),
        ("serif", "Didone"), ("serif-italic", "Didone italic"), ("futura", "Futura (stamp)"),
        ("cormorant", "Cormorant"), ("cormorant-italic", "Cormorant italic"), ("playfair", "Playfair"), ("script", "Script"),
        ("montserrat", "Montserrat"), ("montserrat-bold", "Montserrat bold"), ("cinzel", "Cinzel (capitals)"),
        ("cormorant-infant", "Cormorant Infant"), ("italiana", "Italiana"), ("jost", "Jost"), ("tenor", "Tenor Sans"), ("dm-serif", "DM Serif"), ("marcellus", "Marcellus"),
    ]
    static func label(_ id: String) -> String { faces.first { $0.id == id }?.label ?? ArtworkProperties.label(id) }
}

/// Wraps its children onto lines, for the word chips.
struct ArtworkFlow: Layout {
    var spacing: CGFloat = 6
    private func place(_ subviews: Subviews, width: CGFloat) -> (points: [CGPoint], size: CGSize) {
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        var points: [CGPoint] = []
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (points, CGSize(width: widest, height: y + rowHeight))
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        place(subviews, width: proposal.width ?? .infinity).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let laid = place(subviews, width: bounds.width)
        for (i, s) in subviews.enumerated() { s.place(at: CGPoint(x: bounds.minX + laid.points[i].x, y: bounds.minY + laid.points[i].y), proposal: .unspecified) }
    }
}

/// Mixed styles in one box: pick words, style them (face, bold, italic, underline, capitals, size, colour, foil), see
/// and remove the styled stretches; under it what applies to the whole text (gradient fill, bullets or numbers).
struct ArtworkRunsRows: View {
    @Binding var layer: MarketingValue
    /// The words as the runs index them: the bound field, or the layer's own text.
    let words: String
    var fold: ArtworkFold
    @State private var picked: Set<Int> = []
    @State private var customFoil = false

    private var length: Int { (words as NSString).length }
    private var wordTokens: [ArtworkRuns.Token] { ArtworkRuns.tokens(words).filter(\.word) }
    /// The stretches to style: runs of neighbouring picked words, or all of it when none are picked.
    private var spans: [(Int, Int)] {
        let ws = wordTokens
        let idx = picked.filter { $0 < ws.count }.sorted()
        guard let first = idx.first else { return [(0, length)] }
        var out: [(Int, Int)] = []
        var start = first, prev = first
        for i in idx.dropFirst() {
            if i == prev + 1 { prev = i } else { out.append((ws[start].from, ws[prev].to)); start = i; prev = i }
        }
        out.append((ws[start].from, ws[prev].to))
        return out
    }
    private var here: ArtworkRuns.Piece? {
        let f = spans.first?.0 ?? 0
        return ArtworkRuns.normalize(layer["runs"].array, len: length).first { $0.from <= f && $0.to > f }
    }
    private func apply(_ patch: [String: MarketingValue?], key: String? = nil) {
        guard length > 0 else { return }
        let body: () -> Void = {
            var runs = layer["runs"].array
            for s in spans { runs = ArtworkRuns.set(runs, from: s.0, to: s.1, patch: patch, len: length) }
            if runs.isEmpty { layer.artworkDrop("runs") } else { layer["runs"] = .array(runs) }
        }
        if let key { fold(key, body) } else { body() }
    }
    private func toggleWord(_ i: Int) { if picked.contains(i) { picked.remove(i) } else { picked.insert(i) } }

    var body: some View {
        Group {
            if layer.n("curve") != 0 {
                Text("Bent text is drawn in one style. Set its Curve to 0 to style single words.").font(.footnote).foregroundStyle(Tone.owed.color)
            }
            if length == 0 {
                Text("Type some words first.").font(.footnote).foregroundStyle(.secondary)
            } else {
                HStack {
                    Text("Pick the words").font(.subheadline.weight(.semibold))
                    Spacer()
                    Button("All") { picked = Set(wordTokens.indices) }.buttonStyle(.borderless).frame(minHeight: 44)
                    Button("None") { picked = [] }.buttonStyle(.borderless).frame(minHeight: 44)
                }
                ArtworkFlow {
                    ForEach(Array(wordTokens.enumerated()), id: \.offset) { pair in
                        let on = picked.contains(pair.offset)
                        Button { toggleWord(pair.offset) } label: {
                            Text(pair.element.text).padding(.horizontal, 8).padding(.vertical, 5)
                                .background(on ? Theme.accent : Color(uiColor: .secondarySystemFill), in: Capsule())
                                .foregroundStyle(on ? Theme.onAccent : Color.primary)
                        }.buttonStyle(.borderless)
                    }
                }
                Text(picked.isEmpty ? "None picked: styles go on all of it." : "\(picked.count) picked. Tap a word to add or remove it.").font(.footnote).foregroundStyle(.secondary)
                styleRows
                stretches
            }
            whole
        }
        .onChange(of: words) { _, _ in picked = picked.filter { $0 < wordTokens.count } }
    }

    @ViewBuilder private var styleRows: some View {
        let face = here?.style["font"]?.string ?? layer.s("font", "regular")
        let boldOn = face == "bold" || face == "montserrat-bold", italicOn = face.hasSuffix("italic")
        Picker("Face", selection: Binding(get: { here?.style["font"]?.string ?? "__base" }, set: { v in apply(["font": v == "__base" ? nil : MarketingValue.string(v)]) })) {
            Text("Same as the rest").tag("__base")
            ForEach(ArtworkFont.faces, id: \.0) { Text($0.label).tag($0.id) }
        }
        HStack {
            Toggle("Bold", isOn: Binding(get: { boldOn }, set: { _ in
                guard let b = ArtworkRuns.boldOf[face] else { return }
                apply(["font": b == layer.s("font") ? nil : MarketingValue.string(b)])
            })).disabled(ArtworkRuns.boldOf[face] == nil && !boldOn)
            Toggle("Italic", isOn: Binding(get: { italicOn }, set: { _ in
                guard let i = ArtworkRuns.italicOf[face] else { return }
                apply(["font": i == layer.s("font") ? nil : MarketingValue.string(i)])
            })).disabled(ArtworkRuns.italicOf[face] == nil && !italicOn)
            Toggle("Underline", isOn: Binding(get: { here?.style["underline"]?.bool ?? false }, set: { on in apply(["underline": on ? MarketingValue.bool(true) : nil]) }))
            Toggle("Capitals", isOn: Binding(get: { here?.style["upper"]?.bool ?? false }, set: { on in apply(["upper": on ? MarketingValue.bool(true) : nil]) }))
        }.toggleStyle(.button).buttonStyle(.borderless)
        ArtworkSlider(title: "Size ×", value: Binding(get: { here?.style["size"]?.number ?? 1 }, set: { v in apply(["size": abs(v - 1) < 0.03 ? nil : MarketingValue.number(v)], key: "run-size") }), range: 0.4...3, step: 0.05, format: "%.2f×")
        ArtworkColour(title: "Colour", hex: here?.style["color"]?.string ?? layer.s("color", "#FFFFFF"), fallback: .white) { c in
            fold("run-colour") { apply(["color": MarketingValue.string(c), "gradient": nil]) }
        }
        if here?.style["color"] != nil { Button("Colour: same as the rest") { apply(["color": nil]) } }
        Menu("Foil") {
            ForEach(ArtworkGradients.foils, id: \.0) { f in Button(f.label) { apply(["gradient": f.gradient]) } }
            if here?.style["gradient"] != nil { Button("Remove foil", role: .destructive) { apply(["gradient": nil]); customFoil = false } }
        }
        if here?.style["gradient"] != nil {
            Toggle("Fine-tune the foil", isOn: $customFoil)
            if customFoil {
                ArtworkGradientRows(gradient: Binding(get: { here?.style["gradient"] ?? .null }, set: { g in apply(["gradient": g]) }), fold: fold)
            }
        }
        Button("Clear styles on the picked words") {
            apply(["font": nil, "color": nil, "size": nil, "upper": nil, "underline": nil, "gradient": nil])
        }
    }

    @ViewBuilder private var stretches: some View {
        let runs = ArtworkRuns.normalize(layer["runs"].array, len: length)
        if !runs.isEmpty {
            Text("Styled stretches · \(runs.count)").font(.subheadline.weight(.semibold))
            ForEach(Array(runs.enumerated()), id: \.offset) { pair in
                let r = pair.element
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text((words as NSString).substring(with: NSRange(location: r.from, length: r.to - r.from))).lineLimit(1)
                        Text(summary(r)).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { picked = Set(wordTokens.indices.filter { wordTokens[$0].from >= r.from && wordTokens[$0].to <= r.to }) } label: { Image(systemName: "scope") }.buttonStyle(.borderless).accessibilityLabel("Pick these words")
                    Button(role: .destructive) {
                        var all = ArtworkRuns.normalize(layer["runs"].array, len: length)
                        guard all.indices.contains(pair.offset) else { return }
                        all.remove(at: pair.offset)
                        if all.isEmpty { layer.artworkDrop("runs") } else { layer["runs"] = .array(all.map(ArtworkRuns.encode)) }
                    } label: { Image(systemName: "trash") }.buttonStyle(.borderless).accessibilityLabel("Remove this style")
                }
            }
        }
    }
    private func summary(_ r: ArtworkRuns.Piece) -> String {
        var parts: [String] = []
        if let f = r.style["font"]?.string { parts.append(ArtworkFont.label(f)) }
        if let s = r.style["size"]?.number { parts.append(String(format: "%.2f×", s)) }
        if let c = r.style["color"]?.string { parts.append(c) }
        if r.style["gradient"] != nil { parts.append("foil") }
        if r.style["upper"]?.bool == true { parts.append("capitals") }
        if r.style["underline"]?.bool == true { parts.append("underline") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var whole: some View {
        Text("The whole text").font(.subheadline.weight(.semibold))
        Toggle("Gradient fill (gold foil text)", isOn: Binding(get: { layer["fillGradient"] != .null }, set: { on in
            if on { layer["fillGradient"] = ArtworkGradients.foils[0].gradient } else { layer.artworkDrop("fillGradient") }
        }))
        if layer["fillGradient"] != .null {
            ArtworkGradientRows(gradient: Binding(get: { layer["fillGradient"] }, set: { layer["fillGradient"] = $0 }), fold: fold)
        }
        Picker("List", selection: Binding(get: { layer.s("list", "none") }, set: { v in
            if v == "none" { layer.artworkDrop("list") } else { layer["list"] = .string(v) }
        })) { Text("None").tag("none"); Text("Bullets").tag("bullet"); Text("Numbers").tag("number") }
        Text("A list puts a bullet or a number at every line break.").font(.footnote).foregroundStyle(.secondary)
    }
}

// MARK: - Gradients

struct ArtworkStop: Equatable { var at: Double; var color: String; var alpha: Double? }

enum ArtworkGradients {
    static func make(type: String = "linear", angle: Double, _ stops: [ArtworkStop]) -> MarketingValue {
        MarketingValue(["type": type, "angle": angle, "stops": stops.map { s -> [String: Any] in
            var o: [String: Any] = ["at": s.at, "color": s.color]
            if let a = s.alpha { o["alpha"] = a }
            return o
        }])
    }
    /// normalizeGradient: sorted by position, 0…1, at least two stops.
    static func stops(_ g: MarketingValue) -> [ArtworkStop] {
        var out = g["stops"].array.filter { $0["color"] != .null && $0["at"] != .null }.map {
            ArtworkStop(at: min(1, max(0, $0.n("at"))), color: $0.s("color"), alpha: $0["alpha"] == .null ? nil : min(1, max(0, $0.n("alpha"))))
        }
        out = out.enumerated().sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }.map(\.element)
        if out.isEmpty { return [ArtworkStop(at: 0, color: "#000000", alpha: nil), ArtworkStop(at: 1, color: "#ffffff", alpha: nil)] }
        if out.count == 1 { var s = out[0]; s.at = s.at < 1 ? 1 : 0; out.append(s); out.sort { $0.at < $1.at } }
        return out
    }
    private static func foil(_ stops: [(Double, String)]) -> MarketingValue { make(angle: 100, stops.map { ArtworkStop(at: $0.0, color: $0.1, alpha: nil) }) }
    static let gold = foil([(0, "#8C6A25"), (0.3, "#E9C979"), (0.5, "#FBEFC4"), (0.7, "#C9973F"), (1, "#7A5A1E")])
    static let rose = foil([(0, "#8E5B4B"), (0.35, "#EBB8A0"), (0.55, "#FBE3D4"), (0.8, "#C4856C"), (1, "#7C4A3C")])
    static let silver = foil([(0, "#7C7F86"), (0.3, "#E3E5EA"), (0.5, "#FAFAFC"), (0.72, "#B4B8C0"), (1, "#6E7178")])
    /// FOILS: the house's own first (gold and rose for a gold house, silver for a silver one: the descriptor's `metal`).
    static var foils: [(id: String, label: String, gradient: MarketingValue)] {
        let all = [("gold", "Gold foil", gold), ("rose", "Rose gold", rose), ("silver", "Silver foil", silver)]
        let ordered = House.metal == "silver" ? [all[2], all[1], all[0]] : all
        return ordered.map { (id: $0.0, label: $0.1, gradient: $0.2) }
    }
    static let others: [(id: String, label: String, gradient: MarketingValue)] = [
        ("dusk", "Dark fade", make(angle: 180, [ArtworkStop(at: 0, color: "#000000", alpha: nil), ArtworkStop(at: 1, color: "#1F4A2C", alpha: nil)])),
        ("glow", "Soft glow", make(type: "radial", angle: 0, [ArtworkStop(at: 0, color: "#FFE9B0", alpha: nil), ArtworkStop(at: 1, color: "#C9973F", alpha: 0)])),
        ("ivory", "Ivory", make(angle: 160, [ArtworkStop(at: 0, color: "#FBF6EC", alpha: nil), ArtworkStop(at: 1, color: "#E8D5B5", alpha: nil)])),
    ]
    /// Two "#rrggbb" mixed, for a stop added between its neighbours.
    static func mix(_ a: String, _ b: String, _ t: Double) -> String {
        guard let x = rgb(a), let y = rgb(b) else { return a }
        func c(_ p: Double, _ q: Double) -> Int { Int((p + (q - p) * t).rounded()) }
        return String(format: "#%02x%02x%02x", c(x.0, y.0), c(x.1, y.1), c(x.2, y.2))
    }
    private static func rgb(_ hex: String) -> (Double, Double, Double)? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return (Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255))
    }
}

/// The gradient editor: linear at any angle or radial, two to eight stops, each with colour, position and opacity.
struct ArtworkGradientRows: View {
    @Binding var gradient: MarketingValue
    var fold: ArtworkFold
    @State private var sel = 0

    private static let ways: [(Int, String)] = [(180, "↓ Down"), (0, "↑ Up"), (90, "→ Right"), (270, "← Left"), (135, "↘"), (225, "↙"), (45, "↗"), (315, "↖")]
    private var stops: [ArtworkStop] { ArtworkGradients.stops(gradient) }
    private var type: String { gradient.s("type") == "radial" ? "radial" : "linear" }
    private var angle: Double { gradient.n("angle", 180) }
    private var at: Int { min(sel, stops.count - 1) }
    private func put(type: String? = nil, angle: Double? = nil, stops: [ArtworkStop]? = nil) {
        gradient = ArtworkGradients.make(type: type ?? self.type, angle: angle ?? self.angle, stops ?? self.stops)
    }
    private func color(_ s: ArtworkStop) -> Color { (Color(hex: s.color) ?? .white).opacity(s.alpha ?? 1) }
    private var swatch: some View {
        let all = stops.map { Gradient.Stop(color: color($0), location: $0.at) }
        let rad = angle * .pi / 180
        let start = UnitPoint(x: 0.5 - sin(rad) / 2, y: 0.5 + cos(rad) / 2), end = UnitPoint(x: 0.5 + sin(rad) / 2, y: 0.5 - cos(rad) / 2)
        return Group {
            if type == "radial" { RadialGradient(stops: all, center: .center, startRadius: 0, endRadius: 80) }
            else { LinearGradient(stops: all, startPoint: start, endPoint: end) }
        }.frame(height: 44).clipShape(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).stroke(Color.secondary.opacity(0.4)))
    }
    private func setPosition(_ v: Double) {
        var list = stops
        let i = at
        list[i].at = (v * 100).rounded() / 100
        let order = list.enumerated().sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }
        sel = order.firstIndex { $0.offset == i } ?? 0
        put(stops: order.map(\.element))
    }
    private func setStop(_ change: (inout ArtworkStop) -> Void) {
        var list = stops
        change(&list[at])
        put(stops: list)
    }
    private func addStop(_ position: Double) {
        guard stops.count < 8 else { return }
        var list = stops
        let t = min(1, max(0, (position * 100).rounded() / 100))
        let before = list.last { $0.at <= t } ?? list[0], after = list.first { $0.at >= t } ?? list[list.count - 1]
        let span = after.at - before.at
        let colour = ArtworkGradients.mix(before.color, after.color, span > 0 ? (t - before.at) / span : 0)
        list.append(ArtworkStop(at: t, color: colour, alpha: nil))
        list.sort { $0.at < $1.at }
        sel = list.firstIndex { $0.at == t && $0.color == colour } ?? 0
        put(stops: list)
    }

    var body: some View {
        swatch
        Menu("Presets") {
            ForEach(ArtworkGradients.foils + ArtworkGradients.others, id: \.0) { p in Button(p.label) { gradient = p.gradient; sel = 0 } }
        }
        Picker("Kind", selection: Binding(get: { type }, set: { put(type: $0) })) { Text("Linear").tag("linear"); Text("Radial").tag("radial") }.pickerStyle(.segmented)
        if type == "linear" {
            Picker("Direction", selection: Binding(get: { Int(angle.rounded()) }, set: { put(angle: Double($0)) })) {
                ForEach(Self.ways, id: \.0) { Text($0.1).tag($0.0) }
                if !Self.ways.contains(where: { $0.0 == Int(angle.rounded()) }) { Text("Custom").tag(Int(angle.rounded())) }
            }
            ArtworkSlider(title: "Angle", value: Binding(get: { angle }, set: { v in fold("g-angle") { put(angle: v.rounded()) } }), range: 0...360, format: "%.0f°")
        }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(Array(stops.enumerated()), id: \.offset) { pair in
                    Button { sel = pair.offset } label: {
                        Circle().fill(color(pair.element)).frame(width: 30, height: 30)
                            .overlay(Circle().stroke(pair.offset == at ? Theme.accent : Color.secondary.opacity(0.5), lineWidth: pair.offset == at ? 3 : 1))
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.borderless).accessibilityLabel("Stop \(pair.offset + 1)")
                }
            }.padding(.vertical, 2)
        }
        Text("Stop \(at + 1) of \(stops.count)").font(.footnote).foregroundStyle(.secondary)
        ArtworkColour(title: "Stop colour", hex: stops[at].color, fallback: .white) { c in fold("g-colour") { setStop { $0.color = c } } }
        ArtworkSlider(title: "Position", value: Binding(get: { stops[at].at * 100 }, set: { v in fold("g-pos") { setPosition(v / 100) } }), range: 0...100, format: "%.0f%%")
        ArtworkSlider(title: "Opacity", value: Binding(get: { (stops[at].alpha ?? 1) * 100 }, set: { v in fold("g-alpha") { setStop { $0.alpha = v >= 100 ? nil : v / 100 } } }), range: 0...100, format: "%.0f%%")
        HStack {
            Button("Add stop") { let s = stops[at]; addStop(s.at < 0.85 ? s.at + 0.15 : s.at - 0.15) }.disabled(stops.count >= 8)
            Button("Remove stop", role: .destructive) { var list = stops; list.remove(at: at); sel = 0; put(stops: list) }.disabled(stops.count <= 2)
            Button("Reverse") { put(stops: stops.reversed().map { ArtworkStop(at: ((1 - $0.at) * 100).rounded() / 100, color: $0.color, alpha: $0.alpha) }); sel = 0 }
        }.buttonStyle(.bordered).controlSize(.small)
    }
}
