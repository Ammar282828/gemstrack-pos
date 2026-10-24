import SwiftUI
import UniformTypeIdentifiers
import ERPCore
#if os(macOS)
import AppKit
#endif

/// The designer's canvas: the label at its true proportions, every field drawn as it prints, with rulers in
/// millimetres, an optional grid, and the editing gestures.
///
/// - Click or tap selects; ⇧-click (iPhone: the "Select several" switch) adds; dragging on the background draws a
///   marquee (iPhone, in "Move the view" mode: pans). Dragging a field moves the selection and snaps to the grid, or
///   to the label's and the other fields' edges and centres. The handles resize the one selected field.
/// - Pinch or ⌘-scroll zooms, scroll pans (Mac). Arrow keys nudge a dot (⇧ ten), ⌫ removes.
/// - Everything that changes the layout goes through `LabelDesignerModel`.
struct LabelCanvas: View {
    let model: LabelDesignerModel
    /// ⌫ was pressed with fields selected: the screen asks first when there are many.
    var requestDelete: () -> Void = {}
    /// A file was dropped on the canvas (Mac: a Label LIVE design).
    var onDropFile: (URL) -> Void = { _ in }

    private enum Drag {
        case pan(start: CGSize)
        case move(origins: [String: (x: Int, y: Int)], start: LabelBox, key: String, others: [LabelBox], clicked: String, shift: Bool, moved: Bool)
        case resize(start: LabelLayoutField, handle: LabelHandle, box: LabelBox, key: String)
        case marquee(from: CGPoint, additive: Bool, base: Set<String>)
        case toggle
    }

    @State private var drag: Drag?
    @State private var marquee: LabelBox?
    @State private var guideX: Double?
    @State private var guideY: Double?
    @State private var pinchStart: CGFloat?
    @FocusState private var focused: Bool

    private let ruler: CGFloat = 18
    #if os(macOS)
    private let handleSize: CGFloat = 8
    private let handleReach: CGFloat = 8
    #else
    private let handleSize: CGFloat = 10
    private let handleReach: CGFloat = 16
    #endif

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let z = model.effectiveZoom(stage: size)
            let layout = model.layout
            let w = CGFloat(layout.widthDots), h = CGFloat(layout.heightDots)
            let origin = CGPoint(x: (size.width - w * z) / 2 + model.pan.width, y: (size.height - h * z) / 2 + model.pan.height)
            let fields = model.resolved
            ZStack(alignment: .topLeading) {
                Theme.ground
                Color.primary.opacity(0.05)
                paper(fields, z: z, w: w, h: h).offset(x: origin.x, y: origin.y)
                overlay(fields, z: z, origin: origin, size: size)
                    .allowsHitTesting(false)
                if model.showRulers { rulers(z: z, origin: origin, size: size).allowsHitTesting(false) }
                #if os(macOS)
                ScrollCatcher { loc, dx, dy, command in
                    if command { model.setZoom(model.currentZoom() * CGFloat(exp(Double(dy) * 0.01)), around: loc) }
                    else { model.pan = CGSize(width: model.pan.width + dx, height: model.pan.height + dy) }
                }
                .allowsHitTesting(false)
                #endif
            }
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
            .gesture(dragGesture(z: z, origin: origin, fields: fields))
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { v in
                        let base = pinchStart ?? z
                        pinchStart = base
                        model.setZoom(base * v.magnification, around: v.startLocation)
                    }
                    .onEnded { _ in pinchStart = nil }
            )
            .onAppear { model.stage = size }
            .onChange(of: size) { _, s in model.stage = s }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: [.down, .repeat]) { press in handleKey(press) }
        #if os(macOS)
        .onCopyCommand {
            LabelEditing.clipboardText(model.selectedFields).map { [NSItemProvider(object: $0 as NSString)] } ?? []
        }
        .onCutCommand {
            let text = LabelEditing.clipboardText(model.selectedFields)
            if text != nil { requestDelete() }
            return text.map { [NSItemProvider(object: $0 as NSString)] } ?? []
        }
        .onPasteCommand(of: [UTType.plainText]) { _ in model.paste() }
        .onDeleteCommand { requestDelete() }
        #endif
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            onDropFile(url)
            return true
        }
        .contextMenu { contextItems }
        .accessibilityLabel("Tag canvas")
    }

    // MARK: Layers of the picture

    private func paper(_ fields: [LabelLayoutField], z: CGFloat, w: CGFloat, h: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.white)
            if model.gridOn {
                let step = CGFloat(max(1, model.gridDots)) * z
                if step >= 4 {
                    Canvas { ctx, size in
                        var p = Path()
                        var x: CGFloat = 0
                        while x <= size.width { p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height)); x += step }
                        var y: CGFloat = 0
                        while y <= size.height { p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y)); y += step }
                        ctx.stroke(p, with: .color(Color.blue.opacity(0.18)), lineWidth: 0.5)
                    }
                    .frame(width: w * z, height: h * z)
                }
            }
            ForEach(fields, id: \.id) { f in
                let b = LabelGeometry.bounds(f, measure: model.measure)
                LabelFieldView(field: f, scale: z, faint: f.hidden)
                    .offset(x: CGFloat(b.x) * z, y: CGFloat(b.y) * z)
            }
        }
        .frame(width: w * z, height: h * z, alignment: .topLeading)
        .clipped()
        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
    }

    private func stageRect(_ b: LabelBox, z: CGFloat, origin: CGPoint) -> CGRect {
        CGRect(x: origin.x + CGFloat(b.x) * z, y: origin.y + CGFloat(b.y) * z, width: CGFloat(b.w) * z, height: CGFloat(b.h) * z)
    }

    /// Selection boxes, handles, snap guides and the marquee.
    private func overlay(_ fields: [LabelLayoutField], z: CGFloat, origin: CGPoint, size: CGSize) -> some View {
        let selected = fields.filter { model.selection.contains($0.id) }
        let measure = model.measure
        let accent = Theme.accent
        let boxes = fields.map { ($0, LabelGeometry.bounds($0, measure: measure)) }
        let single = selected.count == 1 && !model.readOnly ? selected.first : nil
        let w = CGFloat(model.layout.widthDots), h = CGFloat(model.layout.heightDots)
        return Canvas { ctx, _ in
            // Hidden and empty fields keep a faint outline so they can be found.
            for (f, b) in boxes where f.hidden || ((f.type == .text) && (f.data ?? "").isEmpty) {
                ctx.stroke(Path(stageRect(b, z: z, origin: origin)), with: .color(Color.gray.opacity(0.6)),
                           style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            for (f, b) in boxes where model.selection.contains(f.id) {
                let r = stageRect(b, z: z, origin: origin)
                ctx.stroke(Path(r), with: .color(f.locked ? Color.orange : accent),
                           style: StrokeStyle(lineWidth: 1.5, dash: f.locked ? [4, 3] : []))
            }
            if selected.count > 1, let u = LabelGeometry.union(selected, measure: measure) {
                ctx.stroke(Path(stageRect(u, z: z, origin: origin).insetBy(dx: -3, dy: -3)), with: .color(accent.opacity(0.7)),
                           style: StrokeStyle(lineWidth: 1, dash: [5, 3]))
            }
            if let f = single, !f.locked {
                let r = stageRect(LabelGeometry.bounds(f, measure: measure), z: z, origin: origin)
                for (_, p) in handlePoints(r) {
                    let hr = CGRect(x: p.x - handleSize / 2, y: p.y - handleSize / 2, width: handleSize, height: handleSize)
                    ctx.fill(Path(roundedRect: hr, cornerRadius: 2), with: .color(.white))
                    ctx.stroke(Path(roundedRect: hr, cornerRadius: 2), with: .color(accent), lineWidth: 1.5)
                }
            }
            if let gx = guideX {
                var p = Path()
                let x = origin.x + CGFloat(gx) * z
                p.move(to: CGPoint(x: x, y: origin.y - 6)); p.addLine(to: CGPoint(x: x, y: origin.y + h * z + 6))
                ctx.stroke(p, with: .color(.pink), lineWidth: 1)
            }
            if let gy = guideY {
                var p = Path()
                let y = origin.y + CGFloat(gy) * z
                p.move(to: CGPoint(x: origin.x - 6, y: y)); p.addLine(to: CGPoint(x: origin.x + w * z + 6, y: y))
                ctx.stroke(p, with: .color(.pink), lineWidth: 1)
            }
            if let m = marquee {
                let r = stageRect(m, z: z, origin: origin)
                ctx.fill(Path(r), with: .color(accent.opacity(0.12)))
                ctx.stroke(Path(r), with: .color(accent), lineWidth: 1)
            }
        }
        .frame(width: size.width, height: size.height)
    }

    private func handlePoints(_ r: CGRect) -> [(LabelHandle, CGPoint)] {
        [(.topLeft, CGPoint(x: r.minX, y: r.minY)), (.top, CGPoint(x: r.midX, y: r.minY)), (.topRight, CGPoint(x: r.maxX, y: r.minY)),
         (.right, CGPoint(x: r.maxX, y: r.midY)), (.bottomRight, CGPoint(x: r.maxX, y: r.maxY)), (.bottom, CGPoint(x: r.midX, y: r.maxY)),
         (.bottomLeft, CGPoint(x: r.minX, y: r.maxY)), (.left, CGPoint(x: r.minX, y: r.midY))]
    }

    // MARK: Rulers

    private func rulers(z: CGFloat, origin: CGPoint, size: CGSize) -> some View {
        let dpi = model.layout.dpi
        let perMM = CGFloat(LabelUnits.dotsPerMM(dpi: dpi)) * z
        let wMM = Int((Double(model.layout.widthDots) / LabelUnits.dotsPerMM(dpi: dpi)).rounded(.up))
        let hMM = Int((Double(model.layout.heightDots) / LabelUnits.dotsPerMM(dpi: dpi)).rounded(.up))
        let labelStep = [1, 2, 5, 10, 20, 50, 100].first { perMM * CGFloat($0) >= 28 } ?? 100
        let selection = LabelGeometry.union(model.resolved.filter { model.selection.contains($0.id) }, measure: model.measure)
        let r = ruler
        return Canvas { ctx, _ in
            let back = Color.primary.opacity(0.1)
            ctx.fill(Path(CGRect(x: 0, y: 0, width: size.width, height: r)), with: .color(back))
            ctx.fill(Path(CGRect(x: 0, y: 0, width: r, height: size.height)), with: .color(back))
            ctx.fill(Path(CGRect(x: 0, y: 0, width: r, height: r)), with: .color(back))
            if let s = selection {
                let tint = Theme.accent.opacity(0.35)
                let x0 = origin.x + CGFloat(s.x) * z, x1 = origin.x + CGFloat(s.maxX) * z
                let y0 = origin.y + CGFloat(s.y) * z, y1 = origin.y + CGFloat(s.maxY) * z
                ctx.fill(Path(CGRect(x: x0, y: 0, width: max(1, x1 - x0), height: r)), with: .color(tint))
                ctx.fill(Path(CGRect(x: 0, y: y0, width: r, height: max(1, y1 - y0))), with: .color(tint))
            }
            let ink = Color.primary.opacity(0.6)
            for mm in 0...max(0, wMM) {
                let x = origin.x + CGFloat(mm) * perMM
                guard x > r, x < size.width else { continue }
                if perMM < 4 && mm % labelStep != 0 { continue }
                let len: CGFloat = mm % 10 == 0 ? 9 : mm % 5 == 0 ? 6 : 3
                var p = Path()
                p.move(to: CGPoint(x: x, y: r)); p.addLine(to: CGPoint(x: x, y: r - len))
                ctx.stroke(p, with: .color(ink), lineWidth: 0.5)
                if mm % labelStep == 0 { ctx.draw(Text("\(mm)").font(.system(size: 8)).foregroundStyle(ink), at: CGPoint(x: x + 2, y: 1), anchor: .topLeading) }
            }
            for mm in 0...max(0, hMM) {
                let y = origin.y + CGFloat(mm) * perMM
                guard y > r, y < size.height else { continue }
                if perMM < 4 && mm % labelStep != 0 { continue }
                let len: CGFloat = mm % 10 == 0 ? 9 : mm % 5 == 0 ? 6 : 3
                var p = Path()
                p.move(to: CGPoint(x: r, y: y)); p.addLine(to: CGPoint(x: r - len, y: y))
                ctx.stroke(p, with: .color(ink), lineWidth: 0.5)
                if mm % labelStep == 0 { ctx.draw(Text("\(mm)").font(.system(size: 8)).foregroundStyle(ink), at: CGPoint(x: 1, y: y + 2), anchor: .topLeading) }
            }
        }
        .frame(width: size.width, height: size.height)
    }

    // MARK: Gestures

    private var shiftDown: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.shift) || model.multiSelect
        #else
        return model.multiSelect
        #endif
    }

    private func dots(_ p: CGPoint, z: CGFloat, origin: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - origin.x) / z, y: (p.y - origin.y) / z)
    }

    private func topField(at d: CGPoint, z: CGFloat, fields: [LabelLayoutField]) -> LabelLayoutField? {
        let slop = Double(5 / z)
        for f in fields.reversed() {
            let b = LabelGeometry.bounds(f, measure: model.measure).inset(by: -slop)
            if b.contains(x: Double(d.x), y: Double(d.y)) { return f }
        }
        return nil
    }

    private func dragGesture(z: CGFloat, origin: CGPoint, fields: [LabelLayoutField]) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if drag == nil { begin(v, z: z, origin: origin, fields: fields) }
                update(v, z: z, origin: origin, fields: fields)
            }
            .onEnded { v in
                finish(v, z: z, origin: origin)
            }
    }

    private func begin(_ v: DragGesture.Value, z: CGFloat, origin: CGPoint, fields: [LabelLayoutField]) {
        focused = true
        let p = v.startLocation
        let shift = shiftDown
        if model.panMode { drag = .pan(start: model.pan); return }
        let measure = model.measure
        // A handle of the one selected field.
        if !model.readOnly, model.selection.count == 1, let f = fields.first(where: { model.selection.contains($0.id) }), !f.locked,
           let original = model.layout.fields.first(where: { $0.id == f.id }) {
            let r = stageRect(LabelGeometry.bounds(f, measure: measure), z: z, origin: origin)
            if let hit = handlePoints(r).first(where: { hypot($0.1.x - p.x, $0.1.y - p.y) <= handleReach }) {
                drag = .resize(start: original, handle: hit.0, box: LabelGeometry.bounds(f, measure: measure), key: "resize-\(UUID().uuidString)")
                return
            }
        }
        let d = dots(p, z: z, origin: origin)
        if let f = topField(at: d, z: z, fields: fields) {
            if shift {
                model.toggleSelected(f.id)
                drag = .toggle
                return
            }
            if !model.selection.contains(f.id) { model.select([f.id]) }
            let movers = fields.filter { model.selection.contains($0.id) && !$0.locked }
            var origins: [String: (x: Int, y: Int)] = [:]
            for m in movers { origins[m.id] = (m.x, m.y) }
            let start = LabelGeometry.union(movers, measure: measure) ?? LabelGeometry.bounds(f, measure: measure)
            let others = fields.filter { !model.selection.contains($0.id) && !$0.hidden }.map { LabelGeometry.bounds($0, measure: measure) }
            drag = .move(origins: origins, start: start, key: "drag-\(UUID().uuidString)", others: others, clicked: f.id, shift: shift, moved: false)
        } else {
            let base = shift ? model.selection : []
            if !shift { model.clearSelection() }
            drag = .marquee(from: CGPoint(x: d.x, y: d.y), additive: shift, base: base)
        }
    }

    private func update(_ v: DragGesture.Value, z: CGFloat, origin: CGPoint, fields: [LabelLayoutField]) {
        guard let current = drag else { return }
        switch current {
        case .pan(let start):
            model.pan = CGSize(width: start.width + v.translation.width, height: start.height + v.translation.height)
        case .toggle:
            break
        case .move(let origins, let start, let key, let others, let clicked, let shift, let moved):
            if !moved && hypot(v.translation.width, v.translation.height) < 3 { return }
            let dx = Double(v.translation.width / z), dy = Double(v.translation.height / z)
            let snap = LabelEditing.snap(start.offset(dx: dx, dy: dy), others: others, label: model.labelBox,
                                         grid: model.gridOn ? model.gridDots : nil, threshold: Double(6 / z))
            guideX = snap.guideX; guideY = snap.guideY
            model.place(origins: origins, dx: Int((dx + snap.dx).rounded()), dy: Int((dy + snap.dy).rounded()), key: key)
            drag = .move(origins: origins, start: start, key: key, others: others, clicked: clicked, shift: shift, moved: true)
        case .resize(let start, let handle, let box, let key):
            let d = dots(v.location, z: z, origin: origin)
            var px = Double(d.x), py = Double(d.y)
            if model.gridOn, model.gridDots > 1 {
                let g = Double(model.gridDots)
                px = (px / g).rounded() * g; py = (py / g).rounded() * g
            }
            model.resize(start, handle: handle, to: handle.dragged(box, toX: px, y: py), key: key)
        case .marquee(let from, let additive, let base):
            let d = dots(v.location, z: z, origin: origin)
            let box = LabelBox.between(Double(from.x), Double(from.y), Double(d.x), Double(d.y))
            marquee = box
            let hit = fields.filter { LabelGeometry.bounds($0, measure: model.measure).intersects(box) }.map(\.id)
            model.select(additive ? base.union(hit) : Set(hit))
        }
    }

    private func finish(_ v: DragGesture.Value, z: CGFloat, origin: CGPoint) {
        if case .move(_, _, _, _, let clicked, let shift, let moved)? = drag, !moved, !shift {
            // A click on one of several selected fields picks just that one.
            model.select([clicked])
        }
        drag = nil
        marquee = nil
        guideX = nil; guideY = nil
    }

    // MARK: Keys

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        let big = press.modifiers.contains(.shift) ? 10 : 1
        switch press.key {
        case .leftArrow: model.nudge(dx: -big, dy: 0); return .handled
        case .rightArrow: model.nudge(dx: big, dy: 0); return .handled
        case .upArrow: model.nudge(dx: 0, dy: -big); return .handled
        case .downArrow: model.nudge(dx: 0, dy: big); return .handled
        case .delete, .deleteForward:
            if model.canEditSelection { requestDelete(); return .handled }
            return .ignored
        case .escape: model.clearSelection(); return .handled
        default:
            if press.modifiers.contains(.command), press.characters == "a" { model.selectAll(); return .handled }
            return .ignored
        }
    }

    @ViewBuilder
    private var contextItems: some View {
        if !model.readOnly {
            Button("Copy", systemImage: "doc.on.doc") { model.copySelection() }.disabled(model.selection.isEmpty)
            Button("Paste", systemImage: "doc.on.clipboard") { model.paste() }
            Button("Duplicate", systemImage: "plus.square.on.square") { model.duplicateSelection() }.disabled(model.selection.isEmpty)
            Divider()
            Button("Bring forward", systemImage: "square.2.layers.3d.top.filled") { model.order(.forward) }.disabled(model.selection.isEmpty)
            Button("Send back", systemImage: "square.2.layers.3d.bottom.filled") { model.order(.backward) }.disabled(model.selection.isEmpty)
            Button("Rotate 90°", systemImage: "rotate.right") { model.rotateSelection() }.disabled(model.selection.isEmpty)
            Divider()
            Button("Remove", systemImage: "trash", role: .destructive) { requestDelete() }.disabled(model.selection.isEmpty)
        }
    }
}

// MARK: Zoom

extension LabelDesignerModel {
    func currentZoom() -> CGFloat { effectiveZoom(stage: stage) }

    /// Zoom to `z` points a dot, keeping the point `p` of the view (the middle if none) over the same dot.
    func setZoom(_ z: CGFloat, around p: CGPoint? = nil) {
        let old = currentZoom()
        let nz = min(16, max(0.1, z))
        let w = CGFloat(layout.widthDots), h = CGFloat(layout.heightDots)
        let c = p ?? CGPoint(x: stage.width / 2, y: stage.height / 2)
        let ox = (stage.width - w * old) / 2 + pan.width, oy = (stage.height - h * old) / 2 + pan.height
        let dx = (c.x - ox) / old, dy = (c.y - oy) / old
        zoom = nz
        pan = CGSize(width: c.x - dx * nz - (stage.width - w * nz) / 2, height: c.y - dy * nz - (stage.height - h * nz) / 2)
    }

    func zoomIn() { setZoom(currentZoom() * 1.25) }
    func zoomOut() { setZoom(currentZoom() / 1.25) }
    func zoomFit() { zoom = nil; pan = .zero }
    func zoomPercent(_ pct: Int) { setZoom(CGFloat(pct) / 100) }
    var zoomText: String { "\(Int((currentZoom() * 100).rounded()))%" }
}

// MARK: ⌘-scroll and scroll on the Mac

#if os(macOS)
/// Watches scroll-wheel events over its own area (SwiftUI has no hook for them) and passes them on; it never takes
/// clicks. A scroll with ⌘ zooms, a plain scroll pans.
private struct ScrollCatcher: NSViewRepresentable {
    var handle: (_ location: CGPoint, _ dx: CGFloat, _ dy: CGFloat, _ command: Bool) -> Void

    func makeNSView(context: Context) -> CatcherView {
        let v = CatcherView()
        v.handle = handle
        return v
    }

    func updateNSView(_ view: CatcherView, context: Context) { view.handle = handle }

    final class CatcherView: NSView {
        var handle: (CGPoint, CGFloat, CGFloat, Bool) -> Void = { _, _, _, _ in }
        private var monitor: Any?

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] e in
                guard let self, let w = self.window, e.window === w else { return e }
                let p = self.convert(e.locationInWindow, from: nil)
                guard self.bounds.contains(p) else { return e }
                let k: CGFloat = e.hasPreciseScrollingDeltas ? 1 : 8
                let loc = CGPoint(x: p.x, y: self.isFlipped ? p.y : self.bounds.height - p.y)
                self.handle(loc, e.scrollingDeltaX * k, e.scrollingDeltaY * k, e.modifierFlags.contains(.command))
                return nil
            }
        }

        deinit { if let m = monitor { NSEvent.removeMonitor(m) } }
    }
}
#endif
