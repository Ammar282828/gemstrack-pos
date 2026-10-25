import SwiftUI

/// The board designer's canvas: the engine's picture with a box over every layer. Tap to choose, drag to move
/// (snapping to the page's edges and centre and to the other layers, with a guide drawn), the corner to resize,
/// the knob above to turn. What is drawn is always the shared engine's picture, so it is what is posted.
struct StudioBoardCanvas: View {
    let image: UIImage?
    let boxes: [MarketingValue]
    let layers: [MarketingValue]
    let frameSize: CGSize
    @Binding var selected: String?
    /// Live changes while a finger is down; `ended` commits the gesture as one step of undo.
    let changed: ([MarketingValue]) -> Void
    let ended: () -> Void
    let began: () -> Void
    var openText: (String) -> Void = { _ in }
    /// The framed picture whose photo is being moved inside its frame (a drag slides it, a pinch zooms it), if any.
    var cropping: String?
    /// A layer's picture size in pixels, for the maths of moving the photo inside the frame.
    var naturalSize: (MarketingValue) -> CGSize? = { _ in nil }
    @State private var start: [MarketingValue]?
    @State private var startBox: CGRect = .zero
    @State private var live: CGRect?
    @State private var liveAngle: Double?
    @State private var guides: [Guide] = []
    /// While the photo is moved in its frame, a drag and a pinch can run together: each keeps its part here.
    @State private var liveZoom: Double?
    @State private var livePan: CGSize = .zero

    struct Guide: Hashable { let vertical: Bool; let at: Double }

    var body: some View {
        GeometryReader { g in
            let scale = g.size.width / max(1, frameSize.width)
            ZStack(alignment: .topLeading) {
                if let image {
                    Image(uiImage: image).resizable().frame(width: g.size.width, height: g.size.height)
                        .contentShape(Rectangle())
                        .onTapGesture { selected = nil }
                        .accessibilityHidden(true)
                } else {
                    SkeletonLoading("Drawing").frame(width: g.size.width, height: g.size.height)
                }
                // The chosen layer last, so its handles sit above whatever it overlaps.
                ForEach(order, id: \.self) { id in
                    if let b = boxes.first(where: { $0.s("id") == id }), let l = layers.first(where: { $0.s("id") == id }), !l["hidden"].bool {
                        box(l, rect: id == selected ? (live ?? Self.rect(b)) : Self.rect(b), scale: scale)
                    }
                }
                ForEach(guides, id: \.self) { guide in
                    // A guide laid over any photograph must stand out from it, so it keeps the one hue the shop's pictures and
                    // accent never use (the designer's snapped line is the same pink).
                    Rectangle().fill(Color.pink)
                        .frame(width: guide.vertical ? 1 : g.size.width, height: guide.vertical ? g.size.height : 1)
                        .offset(x: guide.vertical ? guide.at * scale : 0, y: guide.vertical ? 0 : guide.at * scale)
                        .allowsHitTesting(false)
                }
            }
            .coordinateSpace(.named("board-canvas"))
            .motion(selected)
            // A tick when a drag meets a guide (the state is the guides themselves, set as the snap engages).
            .sensoryFeedback(.alignment, trigger: guides) { old, new in !new.isEmpty && new != old }
        }
        .aspectRatio(frameSize.width / max(1, frameSize.height), contentMode: .fit)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Design")
    }

    private var order: [String] {
        let ids = layers.map { $0.s("id") }
        guard let selected, ids.contains(selected) else { return ids }
        return ids.filter { $0 != selected } + [selected]
    }

    static func rect(_ b: MarketingValue) -> CGRect { CGRect(x: b.n("x"), y: b.n("y"), width: b.n("w"), height: b.n("h")) }

    @ViewBuilder private func box(_ l: MarketingValue, rect: CGRect, scale: Double) -> some View {
        let id = l.s("id"), chosen = id == selected, locked = l["locked"].bool
        let w = max(24, rect.width * scale), h = max(24, rect.height * scale)
        let angle = chosen ? (liveAngle ?? l.n("rotate")) : l.n("rotate")
        Rectangle().fill(Color.clear).contentShape(Rectangle())
            .overlay {
                if chosen && cropping == id { Rectangle().fill(Theme.accent.opacity(0.14)) }
                if chosen {
                    // A light edge under the house's colour, so the outline reads on a dark design and a light one.
                    Rectangle().strokeBorder(.white.opacity(0.9), lineWidth: 4)
                        .overlay(Rectangle().strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 2, dash: locked ? [6, 4] : [])).padding(1))
                }
            }
            // Handles sit just outside the box, so they never cover the words or the line above them.
            .overlay(alignment: .bottomTrailing) {
                #if os(macOS)
                if chosen && !locked { handle("arrow.up.left.and.arrow.down.right").offset(x: 10, y: 10).gesture(resize(l, scale: scale)).accessibilityLabel("Resize") }
                #else
                if chosen && !locked { handle("arrow.up.left.and.arrow.down.right").offset(x: 22, y: 22).gesture(resize(l, scale: scale)).accessibilityLabel("Resize") }
                #endif
            }
            .overlay(alignment: .top) {
                #if os(macOS)
                if chosen && !locked { handle("arrow.clockwise").offset(y: -26).gesture(rotate(l, scale: scale)).accessibilityLabel("Turn") }
                #else
                if chosen && !locked { handle("arrow.clockwise").offset(y: -52).gesture(rotate(l, scale: scale)).accessibilityLabel("Turn") }
                #endif
            }
            .frame(width: w, height: h)
            .rotationEffect(.degrees(angle))
            .position(x: rect.midX * scale, y: rect.midY * scale)
            .onTapGesture(count: 2) { selected = id; if l.s("kind") == "text" { openText(id) } }
            .onTapGesture { selected = id }
            .gesture(move(l, scale: scale))
            .simultaneousGesture(zoomInFrame(l))
            .accessibilityElement()
            .accessibilityLabel(Self.name(l))
            .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { selected = id }
    }

    private func handle(_ symbol: String) -> some View {
        #if os(macOS)
        // A pointer's handle: a small knob with a hairline edge and a little room around it to land on.
        Image(systemName: symbol).font(.system(size: 7, weight: .bold)).foregroundStyle(Theme.onAccent)
            .frame(width: 12, height: 12).background(Theme.accent, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 1))
            .frame(width: 20, height: 20).contentShape(Rectangle())
        #else
        Image(systemName: symbol).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.onAccent)
            .frame(width: 28, height: 28).background(Theme.accent, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 1.5))
            .frame(width: 44, height: 44).contentShape(Rectangle())
        #endif
    }

    private func layer(_ id: String) -> MarketingValue? { (start ?? layers).first { $0.s("id") == id } }
    private func boxOf(_ id: String) -> CGRect { boxes.first { $0.s("id") == id }.map(Self.rect) ?? .zero }

    private func begin(_ l: MarketingValue) {
        guard start == nil else { return }
        start = layers; startBox = boxOf(l.s("id")); began()
    }
    private func finish() {
        start = nil; live = nil; liveAngle = nil; guides = []; liveZoom = nil; livePan = .zero
        ended()
    }

    private func move(_ l: MarketingValue, scale: Double) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named("board-canvas"))
            .onChanged { v in
                let id = l.s("id")
                if selected != id { selected = id }
                guard !l["locked"].bool else { return }
                begin(l)
                guard let start else { return }
                if isCropping(l) {
                    // panInFrame: the frame stays and the photo slides under it.
                    livePan = CGSize(width: v.translation.width / scale, height: v.translation.height / scale)
                    changed(start.map { $0.s("id") == id ? cropped($0) : $0 })
                    return
                }
                var dx = v.translation.width / scale, dy = v.translation.height / scale
                let moved = startBox.offsetBy(dx: dx, dy: dy)
                let snap = snapping(moved, excluding: id, slop: 8 / scale)
                dx += snap.dx; dy += snap.dy; guides = snap.guides
                live = startBox.offsetBy(dx: dx, dy: dy)
                changed(start.map { s in
                    guard s.s("id") == id else { return s }
                    var n = s; n["x"] = .number(s.n("x") + dx); n["y"] = .number(s.n("y") + dy)
                    if s.s("kind") == "text" { n["flow"] = .null }
                    return n
                })
            }
            .onEnded { _ in if start != nil { finish() } }
    }

    private func isCropping(_ l: MarketingValue) -> Bool { cropping == l.s("id") && l.s("kind") == "image" && l["h"] != .null && !l["locked"].bool }

    /// The layer with the drag's and the pinch's parts both applied (panInFrame, with the pinch's iz).
    private func cropped(_ s: MarketingValue) -> MarketingValue {
        var n = s
        if let liveZoom { n["iz"] = .number(liveZoom) }
        let crop = ArtworkPixels.panned(n, natural: naturalSize(s), fx0: s.n("fx", 0.5), fy0: s.n("fy", 0.5), dx: livePan.width, dy: livePan.height)
        n["fx"] = .number(crop.fx); n["fy"] = .number(crop.fy)
        return n
    }

    /// Pinching the chosen frame zooms the photo inside it (iz, 1 to 4), then re-clamps the crop as the page does.
    private func zoomInFrame(_ l: MarketingValue) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                guard isCropping(l) else { return }
                begin(l)
                guard let start, let s = start.first(where: { $0.s("id") == l.s("id") }) else { return }
                liveZoom = (min(4, max(1, s.n("iz", 1) * Double(v.magnification))) * 100).rounded() / 100
                changed(start.map { $0.s("id") == s.s("id") ? cropped($0) : $0 })
            }
            .onEnded { _ in if start != nil && cropping != nil { finish() } }
    }

    private func resize(_ l: MarketingValue, scale: Double) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named("board-canvas"))
            .onChanged { v in
                begin(l)
                guard let start, let s = start.first(where: { $0.s("id") == l.s("id") }) else { return }
                let c = CGPoint(x: startBox.midX * scale, y: startBox.midY * scale)
                let d0 = max(10, hypot(v.startLocation.x - c.x, v.startLocation.y - c.y)), d1 = hypot(v.location.x - c.x, v.location.y - c.y)
                let k = min(8, max(0.1, d1 / d0))
                live = CGRect(x: startBox.midX - startBox.width * k / 2, y: startBox.midY - startBox.height * k / 2, width: startBox.width * k, height: startBox.height * k)
                let scaled = Self.scaled(s, k)
                changed(start.map { $0.s("id") == s.s("id") ? scaled : $0 })
            }
            .onEnded { _ in if start != nil { finish() } }
    }

    private func rotate(_ l: MarketingValue, scale: Double) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named("board-canvas"))
            .onChanged { v in
                begin(l)
                guard let start, let s = start.first(where: { $0.s("id") == l.s("id") }) else { return }
                let c = CGPoint(x: startBox.midX * scale, y: startBox.midY * scale)
                let a0 = atan2(v.startLocation.y - c.y, v.startLocation.x - c.x), a1 = atan2(v.location.y - c.y, v.location.x - c.x)
                var deg = s.n("rotate") + (a1 - a0) * 180 / .pi
                deg = (deg + 540).truncatingRemainder(dividingBy: 360) - 180
                // Square to the page within a few degrees, as a guide would.
                for target in [-180.0, -90, -45, 0, 45, 90, 180] where abs(deg - target) < 4 { deg = target == -180 ? 180 : target }
                liveAngle = deg
                changed(start.map { x in var n = x; if x.s("id") == s.s("id") { n["rotate"] = .number(deg.rounded()) }; return n })
            }
            .onEnded { _ in if start != nil { finish() } }
    }

    /// The nudge that lines a moved box up with the page's edges and centre or another layer's, and the guides.
    private func snapping(_ r: CGRect, excluding id: String, slop: Double) -> (dx: Double, dy: Double, guides: [Guide]) {
        var xs: [Double] = [0, frameSize.width / 2, frameSize.width], ys: [Double] = [0, frameSize.height / 2, frameSize.height]
        for b in boxes where b.s("id") != id {
            let o = Self.rect(b)
            if layers.first(where: { $0.s("id") == b.s("id") })?["hidden"].bool == true { continue }
            xs += [o.minX, o.midX, o.maxX]; ys += [o.minY, o.midY, o.maxY]
        }
        func best(_ own: [Double], _ targets: [Double]) -> (Double, Double)? {
            var found: (Double, Double)?
            for a in own { for t in targets where abs(t - a) < slop && abs(t - a) < abs(found?.0 ?? .infinity) { found = (t - a, t) } }
            return found
        }
        var out: (dx: Double, dy: Double, guides: [Guide]) = (0, 0, [])
        if let x = best([r.minX, r.midX, r.maxX], xs) { out.dx = x.0; out.guides.append(Guide(vertical: true, at: x.1)) }
        if let y = best([r.minY, r.midY, r.maxY], ys) { out.dy = y.0; out.guides.append(Guide(vertical: false, at: y.1)) }
        return out
    }

    /// A layer grown or shrunk around its own anchor (editor.ts scaleLayer, line for line).
    static func scaled(_ l: MarketingValue, _ k: Double) -> MarketingValue {
        func c(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }
        var n = l
        switch l.s("kind") {
        case "text":
            n["size"] = .number(c((l.n("size", 80) * k).rounded(), 12, 600)); n["width"] = .number(c((l.n("width", 888) * k).rounded(), 80, 2400))
            if l["box"] != .null { n["box"]["pad"] = .number((l["box"].n("pad") * k).rounded()); n["box"]["radius"] = .number((l["box"].n("radius") * k).rounded()) }
        case "wordmark": n["width"] = .number(c((l.n("width", 300) * k).rounded(), 60, 1080))
        case "image":
            n["w"] = .number(c((l.n("w", 380) * k).rounded(), 40, 2400))
            if l["h"] != .null { n["h"] = .number(c((l.n("h") * k).rounded(), 40, 3000)) }
        default:
            n["w"] = .number((l.n("w") * k).rounded()); n["h"] = .number((l.n("h") * k).rounded())
            n["stroke"] = .number(c((l.n("stroke", 4) * k.squareRoot()).rounded(), 1, 60))
        }
        return n
    }

    static func name(_ l: MarketingValue) -> String {
        if !l.s("name").isEmpty { return l.s("name") }
        if !l.s("bind").isEmpty { return ["kicker": "Small line", "headline": "Headline", "weight": "Specs", "details": "Call to action"][l.s("bind")] ?? ArtworkProperties.label(l.s("bind")) }
        switch l.s("kind") {
        case "text": return l.s("text").isEmpty ? "Text" : String(l.s("text").prefix(40))
        case "wordmark": return "Logo"
        case "image": return l.s("photoId") == "photo" ? "Photo inset" : "Picture"
        default: return ArtworkProperties.label(l.s("shape", l.s("kind")))
        }
    }
}
