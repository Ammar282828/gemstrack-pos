import SwiftUI

/// Designer v2 snapping, guides, the grid and "match the first one picked" (src/lib/social/design.ts snapLines /
/// snapBox, guides.ts, panels/guides.tsx, position.tsx). Guides and the grid belong to the document
/// (`meta.guides.x / y`, `meta.grid`), so they are saved with it and snap on the web too; whether snapping is on
/// belongs to this device. Equal-spacing chips (spacingSnap) are not drawn natively.

struct ArtworkBox: Equatable {
    var x: Double, y: Double, w: Double, h: Double
    init(x: Double, y: Double, w: Double, h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
    /// A box from the engine's `boxes` answer.
    init(_ v: MarketingValue) { self.init(x: v.n("x"), y: v.n("y"), w: v.n("w"), h: v.n("h")) }
    static func union(_ boxes: [ArtworkBox]) -> ArtworkBox? {
        guard let first = boxes.first else { return nil }
        let x0 = boxes.map(\.x).min() ?? first.x, y0 = boxes.map(\.y).min() ?? first.y
        let x1 = boxes.map { $0.x + $0.w }.max() ?? first.x, y1 = boxes.map { $0.y + $0.h }.max() ?? first.y
        return ArtworkBox(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }
}

enum ArtworkSnap {
    struct Lines { var xs: [Double]; var ys: [Double] }
    struct Nudge { var dx = 0.0, dy = 0.0; var v: Double?; var h: Double? }

    /// snapLines: the page's centre and margins, the edges and centres of everything else, a grid, the user's guides.
    static func lines(width: Double, height: Double, margin: Double, others: [ArtworkBox], grid: Double, guideX: [Double], guideY: [Double]) -> Lines {
        var xs = [width / 2, margin, width - margin], ys = [height / 2, margin, height - margin]
        for b in others { xs += [b.x, b.x + b.w / 2, b.x + b.w]; ys += [b.y, b.y + b.h / 2, b.y + b.h] }
        if grid >= 4 {
            var x = grid; while x < width && xs.count < 600 { xs.append(x); x += grid }
            var y = grid; while y < height && ys.count < 600 { ys.append(y); y += grid }
        }
        xs += guideX; ys += guideY
        return Lines(xs: xs, ys: ys)
    }
    /// snapBox: the nudge that brings the nearest of a box's edges or centre onto a line within `threshold`, per axis.
    static func snap(_ b: ArtworkBox, _ lines: Lines, threshold: Double) -> Nudge {
        func best(_ edges: [Double], _ targets: [Double]) -> (d: Double, at: Double?) {
            var d = Double.infinity, at: Double?
            for e in edges { for t in targets where abs(t - e) < abs(d) && abs(t - e) <= threshold { d = t - e; at = t } }
            return (at == nil ? 0 : d, at)
        }
        let x = best([b.x, b.x + b.w / 2, b.x + b.w], lines.xs), y = best([b.y, b.y + b.h / 2, b.y + b.h], lines.ys)
        return Nudge(dx: x.d, dy: y.d, v: x.at, h: y.at)
    }
    /// The page's margin for snapping: 96 on a story, 45 on a square (story-editor.tsx).
    static func margin(height: Double) -> Double { height < 1400 ? 45 : 96 }

    static let gridSizes = [10, 20, 30, 40, 60, 90, 120]
    static let maxGuides = 40
    static func guides(_ doc: MarketingValue, _ axis: String) -> [Double] {
        let length = doc["frame"].n(axis == "x" ? "w" : "h", axis == "x" ? 1080 : 1920)
        return Set(doc["meta"]["guides"][axis].array.map { $0.number.rounded() }.filter { $0 > 0 && $0 < length }).sorted()
    }
    static func grid(_ doc: MarketingValue) -> Double { doc["meta"].n("grid") }
}

/// The user's guides and the grid, drawn over the page, and the line a drag has snapped to.
struct ArtworkGuideOverlay: View {
    let width: Double
    let scale: Double
    let guideX: [Double]
    let guideY: [Double]
    let grid: Double
    var snapX: Double?
    var snapY: Double?
    private let guide = Color(red: 0.02, green: 0.71, blue: 0.83)
    var body: some View {
        Canvas { ctx, size in
            func line(_ a: CGPoint, _ b: CGPoint, _ color: Color, _ w: CGFloat = 1) {
                var p = Path(); p.move(to: a); p.addLine(to: b)
                ctx.stroke(p, with: .color(color), lineWidth: w)
            }
            if grid * scale >= 3 {
                var x = grid
                while x * scale < size.width { line(CGPoint(x: x * scale, y: 0), CGPoint(x: x * scale, y: size.height), guide.opacity(0.28), 0.5); x += grid }
                var y = grid
                while y * scale < size.height { line(CGPoint(x: 0, y: y * scale), CGPoint(x: size.width, y: y * scale), guide.opacity(0.28), 0.5); y += grid }
            }
            for x in guideX { line(CGPoint(x: x * scale, y: 0), CGPoint(x: x * scale, y: size.height), guide) }
            for y in guideY { line(CGPoint(x: 0, y: y * scale), CGPoint(x: size.width, y: y * scale), guide) }
            if let x = snapX { line(CGPoint(x: x * scale, y: 0), CGPoint(x: x * scale, y: size.height), .pink, 1.5) }
            if let y = snapY { line(CGPoint(x: 0, y: y * scale), CGPoint(x: size.width, y: y * scale), .pink, 1.5) }
        }.allowsHitTesting(false)
    }
}

/// Guides and grid controls (panels/guides.tsx): snapping on or off, the grid and its size, and the guide lines.
struct ArtworkGuideRows: View {
    @Binding var doc: MarketingValue
    @AppStorage("artwork.snap") private var snapping = true
    @State private var position = ""
    @State private var axis = "x"

    private func write(_ change: (inout MarketingValue) -> Void) { var d = doc; change(&d); doc = d }
    private func setGuides(_ axis: String, _ values: [Double]) {
        write { d in
            var g = d["meta"]["guides"]
            g[axis] = .array(values.map { MarketingValue.number($0) })
            d["meta"]["guides"] = g
        }
    }
    var body: some View {
        Toggle("Snap while moving", isOn: $snapping)
        Toggle("Grid that things snap to", isOn: Binding(get: { ArtworkSnap.grid(doc) > 0 }, set: { on in
            write { d in var meta = d["meta"]; if on { meta["grid"] = .number(60) } else { meta.artworkDrop("grid") }; d["meta"] = meta }
        }))
        if ArtworkSnap.grid(doc) > 0 {
            Picker("Grid every", selection: Binding(get: { Int(ArtworkSnap.grid(doc)) }, set: { g in write { $0["meta"]["grid"] = .number(Double(g)) } })) {
                ForEach(ArtworkSnap.gridSizes, id: \.self) { Text("\($0) px").tag($0) }
                if !ArtworkSnap.gridSizes.contains(Int(ArtworkSnap.grid(doc))) { Text("\(Int(ArtworkSnap.grid(doc))) px").tag(Int(ArtworkSnap.grid(doc))) }
            }
        }
        ForEach(["x", "y"], id: \.self) { a in
            let values = ArtworkSnap.guides(doc, a)
            ForEach(values, id: \.self) { v in
                HStack {
                    Image(systemName: a == "x" ? "arrow.left.and.right" : "arrow.up.and.down")
                    Text(a == "x" ? "Across \(Int(v))" : "Down \(Int(v))")
                    Spacer()
                    Button(role: .destructive) { setGuides(a, values.filter { $0 != v }) } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).accessibilityLabel("Remove this guide")
                }
            }
        }
        HStack {
            Picker("Guide", selection: $axis) { Text("Across").tag("x"); Text("Down").tag("y") }.pickerStyle(.segmented)
            TextField("px", text: $position).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 70)
            Button("Add") {
                let length = doc["frame"].n(axis == "x" ? "w" : "h", axis == "x" ? 1080 : 1920)
                guard let v = Double(position)?.rounded(), v > 0, v < length else { return }
                let all = ArtworkSnap.guides(doc, "x") + ArtworkSnap.guides(doc, "y")
                guard all.count < ArtworkSnap.maxGuides else { return }
                setGuides(axis, Set(ArtworkSnap.guides(doc, axis) + [v]).sorted())
                position = ""
            }.buttonStyle(.borderless)
        }
        Text("Things you move snap to the guides, the grid, the page’s middle and margins and each other. Guides are for you: they are not in the picture you post.").font(.footnote).foregroundStyle(.secondary)
    }
}

/// "Match the first one picked" (position.tsx): the others take its size or its place.
enum ArtworkMatch {
    static let hows: [(id: String, label: String)] = [("width", "Width"), ("height", "Height"), ("both", "Size"), ("x", "Left edge"), ("y", "Top edge"), ("position", "Place")]

    static func apply(_ how: String, reference: String, layers: [MarketingValue], selected: Set<String>, boxes: [String: ArtworkBox]) -> [MarketingValue] {
        guard let ref = boxes[reference] else { return layers }
        return layers.map { l -> MarketingValue in
            let id = l.s("id")
            guard id != reference, selected.contains(id), !l["locked"].bool, let b = boxes[id] else { return l }
            var n = l
            if ["x", "position"].contains(how) { n["x"] = .number(l.n("x") + ref.x - b.x) }
            if ["y", "position"].contains(how) { n["y"] = .number(l.n("y") + ref.y - b.y) }
            if ["x", "y", "position"].contains(how), l.s("kind") == "text" { n.artworkDrop("flow") }
            let kx = ["width", "both"].contains(how) && b.w > 0 ? ref.w / b.w : 1
            let ky = ["height", "both"].contains(how) && b.h > 0 ? ref.h / b.h : 1
            guard kx != 1 || ky != 1 else { return n }
            func rounded(_ v: Double) -> Double { v.rounded() }
            switch l.s("kind") {
            case "text":
                // The web sizes a text by its line width (and by its height, scaling the letters).
                if kx != 1 { n["width"] = .number(min(2400, max(80, rounded(l.n("width") * kx)))) }
                n.artworkDrop("flow")
            case "wordmark":
                n["width"] = .number(min(1080, max(20, rounded(l.n("width") * (kx != 1 ? kx : ky)))))
            case "qr":
                n["w"] = .number(min(2400, max(20, rounded(l.n("w") * (abs(kx - 1) >= abs(ky - 1) ? kx : ky)))))
            case "image":
                if l["h"] != .null { n["w"] = .number(min(2400, max(20, rounded(l.n("w") * kx)))); n["h"] = .number(min(3000, max(20, rounded(l.n("h") * ky)))) }
                else { n["w"] = .number(min(2400, max(20, rounded(l.n("w") * (abs(kx - 1) >= abs(ky - 1) ? kx : ky))))) }
            default:
                // Shapes and lines keep their direction (a negative width or height).
                n["w"] = .number(rounded(l.n("w") * kx)); n["h"] = .number(rounded(l.n("h") * ky))
            }
            return n
        }
    }
}
