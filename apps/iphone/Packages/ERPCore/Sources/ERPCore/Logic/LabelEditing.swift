// What the tag designer does to a layout, as pure functions on its fields, so each one is tested and the iPhone's and
// the Mac's designers (apps/iphone/App/Screens/Settings/LabelDesigner) share them: move, resize by a handle, turn,
// align, distribute, stack order, duplicate and paste, snap to the grid and to other fields, and the undo stack.
//
// Positions stay whole dots. A locked field is never moved, resized, turned or aligned. The array order of
// `LabelLayout.fields` is the paint order: the last one is on top.

import Foundation

public enum LabelHandle: CaseIterable, Hashable {
    case topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left

    public var movesLeft: Bool { self == .topLeft || self == .left || self == .bottomLeft }
    public var movesRight: Bool { self == .topRight || self == .right || self == .bottomRight }
    public var movesTop: Bool { self == .topLeft || self == .top || self == .topRight }
    public var movesBottom: Bool { self == .bottomLeft || self == .bottom || self == .bottomRight }
    public var horizontal: Bool { movesLeft || movesRight }
    public var vertical: Bool { movesTop || movesBottom }

    /// The box this handle drags to when the pointer is at (px, py): the opposite edges stay.
    public func dragged(_ b: LabelBox, toX px: Double, y py: Double) -> LabelBox {
        var l = b.x, r = b.maxX, t = b.y, bt = b.maxY
        if movesLeft { l = min(px, r - 1) }
        if movesRight { r = max(px, l + 1) }
        if movesTop { t = min(py, bt - 1) }
        if movesBottom { bt = max(py, t + 1) }
        return LabelBox(x: l, y: t, w: r - l, h: bt - t)
    }
}

public enum LabelAlign: CaseIterable, Hashable { case left, centre, right, top, middle, bottom }
public enum LabelOrder: Hashable { case forward, backward, front, back }
public enum LabelAxis: Hashable { case horizontal, vertical }

/// What the Add menu makes.
public enum LabelNewKind: Hashable {
    case text
    /// A text holding a placeholder token such as `{sku}`.
    case variable(String)
    case qr
    case barcode(String)
    case line, box, ellipse
    /// `{date:FORMAT}` as a text.
    case date(String)
    /// `{counter:START:STEP:PAD}` as a text.
    case counter(start: Int, step: Int, pad: Int)
}

/// How a snap moved a box, and the lines the designer draws to say what it caught.
public struct LabelSnap: Hashable {
    public var dx: Double = 0
    public var dy: Double = 0
    public var guideX: Double?
    public var guideY: Double?
}

public enum LabelEditing {
    static func dot(_ v: Double) -> Int { Int(min(32000, max(-32000, v.isFinite ? v.rounded() : 0))) }

    // MARK: Ids and new fields

    /// `field-<ms>` as the web names them, with a number after it when that one is taken.
    public static func newId(existing: Set<String>, now: Date = Date()) -> String {
        let base = "field-\(Int(now.timeIntervalSince1970 * 1000))"
        if !existing.contains(base) { return base }
        var n = 2
        while existing.contains("\(base)-\(n)") { n += 1 }
        return "\(base)-\(n)"
    }

    /// A new field of this kind, centred on the label.
    public static func make(_ kind: LabelNewKind, in layout: LabelLayout, measure: LabelMeasure, now: Date = Date()) -> LabelLayoutField {
        let id = newId(existing: Set(layout.fields.map(\.id)), now: now)
        var f: LabelLayoutField
        switch kind {
        case .text:
            f = LabelLayoutField(id: id, type: .text, data: "New text", fontSize: 24)
        case .variable(let token):
            f = LabelLayoutField(id: id, type: .text, data: token, fontSize: 24)
        case .date(let format):
            f = LabelLayoutField(id: id, type: .text, data: format.isEmpty ? "{date}" : "{date:\(format)}", fontSize: 24)
        case .counter(let start, let step, let pad):
            f = LabelLayoutField(id: id, type: .text, data: "{counter:\(start):\(step):\(pad)}", fontSize: 24)
        case .qr:
            f = LabelLayoutField(id: id, type: .qr, data: "{sku}", qrMagnification: 3, errorCorrection: "M")
        case .barcode(let symbology):
            f = LabelLayoutField(id: id, type: .barcode, data: "{sku}", symbology: symbology, height: 60, moduleWidth: 2, showText: true)
        case .line:
            f = LabelLayoutField(id: id, type: .line, width: 120, height: 2)
        case .box:
            f = LabelLayoutField(id: id, type: .box, width: 100, height: 60, thickness: 2, rounding: 0, fill: false)
        case .ellipse:
            f = LabelLayoutField(id: id, type: .ellipse, width: 100, height: 60, thickness: 2, fill: false)
        }
        return centred(f, in: layout, measure: measure)
    }

    /// A picture field (the bitmap is made by the app from the chosen file), centred.
    public static func makePicture(bitmap: String, width: Int, height: Int, dither: String, threshold: Double, source: String?,
                                   in layout: LabelLayout, measure: LabelMeasure, now: Date = Date()) -> LabelLayoutField {
        let id = newId(existing: Set(layout.fields.map(\.id)), now: now)
        let f = LabelLayoutField(id: id, type: .image, width: width, height: height, bitmap: bitmap, dither: dither, threshold: threshold, source: source)
        return centred(f, in: layout, measure: measure)
    }

    static func centred(_ f: LabelLayoutField, in layout: LabelLayout, measure: LabelMeasure) -> LabelLayoutField {
        var r = f
        r.x = 0; r.y = 0
        let b = LabelGeometry.bounds(r, measure: measure)
        r.x = max(0, dot((Double(layout.widthDots) - b.w) / 2))
        r.y = max(0, dot((Double(layout.heightDots) - b.h) / 2))
        return r
    }

    // MARK: Moving

    /// These fields moved by whole dots; a locked one stays.
    public static func moved(_ fields: [LabelLayoutField], ids: Set<String>, dx: Int, dy: Int) -> [LabelLayoutField] {
        fields.map { f in
            guard ids.contains(f.id), !f.locked else { return f }
            var r = f
            r.x += dx; r.y += dy
            return r
        }
    }

    /// The fields set to a new corner (a drag's result); `origins` is where each started.
    public static func placed(_ fields: [LabelLayoutField], origins: [String: (x: Int, y: Int)], dx: Int, dy: Int) -> [LabelLayoutField] {
        fields.map { f in
            guard let o = origins[f.id], !f.locked else { return f }
            var r = f
            r.x = o.x + dx; r.y = o.y + dy
            return r
        }
    }

    // MARK: Resizing

    /// The field after its handle was dragged so the box became `nb`. A text takes a width (sideways) and a font size
    /// (up and down); a QR code its magnification; a bar code its module width and height; a box, line, ellipse and
    /// picture their width and height. The opposite edge stays where it was.
    public static func resized(_ f: LabelLayoutField, handle: LabelHandle, to nb: LabelBox, measure: LabelMeasure) -> LabelLayoutField {
        guard !f.locked else { return f }
        var r = f
        let sideways = LabelGeometry.turnsBox(f.type) && (f.rotation == 90 || f.rotation == 270)
        let localW = sideways ? nb.h : nb.w
        let localH = sideways ? nb.w : nb.h
        // The handle's sides in the field's own frame (a turned field's top is another side of the label).
        let content = LabelGeometry.contentSize(f, measure: measure)

        switch f.type {
        case .line, .box, .ellipse, .image:
            r.width = max(1, dot(nb.w))
            r.height = max(1, dot(nb.h))
        case .text:
            let fs = LabelGeometry.fontDots(f)
            let ratio = content.h > 0 ? localH / content.h : 1
            let verticalInFrame = sideways ? handle.horizontal : handle.vertical
            let horizontalInFrame = sideways ? handle.vertical : handle.horizontal
            if verticalInFrame, abs(ratio - 1) > 0.02 { r.fontSize = min(600, max(4, dot(fs * ratio))) }
            if horizontalInFrame {
                let w = max(8, dot(localW))
                // Still as wide as the text itself and no width set: it stays a free-running line.
                if !(f.width == nil && abs(Double(w) - content.w) < 1.5) { r.width = w }
            }
        case .qr:
            let modules = max(1, measure.qrModules(f.data ?? "", LabelGeometry.correction(f)))
            let side = max(localW, localH)
            r.qrMagnification = min(10, max(1, dot(side / Double(modules))))
        case .barcode:
            let sym = LabelGeometry.symbology(f)
            let s = measure.symbol(sym, f.data ?? "")
            let horizontalInFrame = sideways ? handle.vertical : handle.horizontal
            let verticalInFrame = sideways ? handle.horizontal : handle.vertical
            if horizontalInFrame { r.moduleWidth = min(10, max(1, dot(localW / Double(max(1, s.cols))))) }
            if verticalInFrame {
                if LabelGeometry.isLinear(sym) {
                    let bar = localH - (f.showText == true ? LabelGeometry.barcodeTextBand : 0)
                    r.height = max(4, dot(bar))
                } else if sym == "pdf417" {
                    r.height = max(1, dot(localH / Double(max(1, s.rows))))
                } else if !horizontalInFrame {
                    r.moduleWidth = min(10, max(1, dot(localH / Double(max(1, s.rows)))))
                }
            }
        }
        let after = LabelGeometry.bounds(r, measure: measure)
        r.x = dot(handle.movesLeft ? nb.maxX - after.w : nb.x)
        r.y = dot(handle.movesTop ? nb.maxY - after.h : nb.y)
        return r
    }

    // MARK: Turning

    /// A quarter turn (90 clockwise, -90 back) about the box's centre. Boxes, lines and ellipses swap width and height
    /// (they never turn on the printer); a picture goes between 0 and half a turn.
    public static func rotated(_ f: LabelLayoutField, by degrees: Int = 90, measure: LabelMeasure) -> LabelLayoutField {
        guard !f.locked else { return f }
        var r = f
        let old = LabelGeometry.bounds(f, measure: measure)
        switch f.type {
        case .text, .qr, .barcode:
            r.rotation = (((f.rotation + degrees) % 360) + 360) % 360
            let nb = LabelGeometry.bounds(r, measure: measure)
            r.x = dot(old.midX - nb.w / 2)
            r.y = dot(old.midY - nb.h / 2)
        case .image:
            r.rotation = f.rotation == 180 ? 0 : 180
        case .line, .box, .ellipse:
            let s = LabelGeometry.shapeSize(f)
            r.width = Int(s.h); r.height = Int(s.w)
            r.x = dot(old.midX - s.h / 2)
            r.y = dot(old.midY - s.w / 2)
        }
        return r
    }

    // MARK: Aligning

    /// The selected fields lined up to the selection's edge (or `within`, the label, for a lone field).
    public static func aligned(_ fields: [LabelLayoutField], ids: Set<String>, edge: LabelAlign, within: LabelBox? = nil, measure: LabelMeasure) -> [LabelLayoutField] {
        let chosen = fields.filter { ids.contains($0.id) }
        guard let reference = within ?? LabelGeometry.union(chosen, measure: measure) else { return fields }
        return fields.map { f in
            guard ids.contains(f.id), !f.locked else { return f }
            let b = LabelGeometry.bounds(f, measure: measure)
            var r = f
            switch edge {
            case .left: r.x += dot(reference.x - b.x)
            case .centre: r.x += dot(reference.midX - b.midX)
            case .right: r.x += dot(reference.maxX - b.maxX)
            case .top: r.y += dot(reference.y - b.y)
            case .middle: r.y += dot(reference.midY - b.midY)
            case .bottom: r.y += dot(reference.maxY - b.maxY)
            }
            return r
        }
    }

    /// Three or more fields spaced so the gaps between them are equal, the outer two staying.
    public static func distributed(_ fields: [LabelLayoutField], ids: Set<String>, axis: LabelAxis, measure: LabelMeasure) -> [LabelLayoutField] {
        let chosen = fields.filter { ids.contains($0.id) }
        guard chosen.count >= 3 else { return fields }
        let boxes = chosen.map { (id: $0.id, box: LabelGeometry.bounds($0, measure: measure)) }
        let sorted = boxes.sorted { axis == .horizontal ? $0.box.midX < $1.box.midX : $0.box.midY < $1.box.midY }
        let first = sorted.first!.box, last = sorted.last!.box
        let span = axis == .horizontal ? last.maxX - first.x : last.maxY - first.y
        let total = sorted.reduce(0.0) { $0 + (axis == .horizontal ? $1.box.w : $1.box.h) }
        let gap = (span - total) / Double(sorted.count - 1)
        var target: [String: Double] = [:]
        var cursor = axis == .horizontal ? first.x : first.y
        for item in sorted {
            target[item.id] = cursor
            cursor += (axis == .horizontal ? item.box.w : item.box.h) + gap
        }
        let current = Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0.box) })
        return fields.map { f in
            guard let to = target[f.id], let b = current[f.id], !f.locked else { return f }
            var r = f
            if axis == .horizontal { r.x += dot(to - b.x) } else { r.y += dot(to - b.y) }
            return r
        }
    }

    // MARK: Stack order

    public static func reordered(_ fields: [LabelLayoutField], ids: Set<String>, _ order: LabelOrder) -> [LabelLayoutField] {
        var a = fields
        switch order {
        case .front:
            return a.filter { !ids.contains($0.id) } + a.filter { ids.contains($0.id) }
        case .back:
            return a.filter { ids.contains($0.id) } + a.filter { !ids.contains($0.id) }
        case .forward:
            guard a.count > 1 else { return a }
            var i = a.count - 2
            while i >= 0 {
                if ids.contains(a[i].id), !ids.contains(a[i + 1].id) { a.swapAt(i, i + 1) }
                i -= 1
            }
            return a
        case .backward:
            guard a.count > 1 else { return a }
            for i in 1..<a.count where ids.contains(a[i].id) && !ids.contains(a[i - 1].id) { a.swapAt(i, i - 1) }
            return a
        }
    }

    /// A list with these positions moved to `destination` (the offset in the list as it was, as `onMove` gives it).
    public static func moveItems<T>(_ items: [T], from: IndexSet, to destination: Int) -> [T] {
        let moving = from.sorted().filter { $0 >= 0 && $0 < items.count }.map { items[$0] }
        var rest: [T] = []
        for (i, item) in items.enumerated() where !from.contains(i) { rest.append(item) }
        let before = from.filter { $0 < destination }.count
        let at = min(rest.count, max(0, destination - before))
        rest.insert(contentsOf: moving, at: at)
        return rest
    }

    /// The layers list shows the top field first; this applies its drag to the paint order.
    public static func reorderedByLayerList(_ fields: [LabelLayoutField], from: IndexSet, to destination: Int) -> [LabelLayoutField] {
        Array(moveItems(Array(fields.reversed()), from: from, to: destination).reversed())
    }

    // MARK: Copies

    /// Copies of these fields placed on top, moved by `offset` dots, with new ids; returns the new ids.
    public static func inserting(_ copies: [LabelLayoutField], into fields: [LabelLayoutField], offset: Int = 10, now: Date = Date()) -> (fields: [LabelLayoutField], ids: [String]) {
        var all = fields
        var taken = Set(fields.map(\.id))
        var ids: [String] = []
        for c in copies {
            var n = c
            n.id = newId(existing: taken, now: now)
            taken.insert(n.id)
            n.x += offset; n.y += offset
            n.locked = false
            all.append(n)
            ids.append(n.id)
        }
        return (all, ids)
    }

    public static func duplicated(_ fields: [LabelLayoutField], ids: Set<String>, offset: Int = 10, now: Date = Date()) -> (fields: [LabelLayoutField], ids: [String]) {
        inserting(fields.filter { ids.contains($0.id) }, into: fields, offset: offset, now: now)
    }

    public static func removed(_ fields: [LabelLayoutField], ids: Set<String>) -> [LabelLayoutField] {
        fields.filter { !ids.contains($0.id) || $0.locked }
    }

    // MARK: Clipboard

    public static let clipboardPrefix = "erp-label-fields:"

    /// Fields as text for the pasteboard (so a paste works across windows and devices).
    public static func clipboardText(_ fields: [LabelLayoutField]) -> String? {
        guard !fields.isEmpty, let data = try? JSONEncoder().encode(fields) else { return nil }
        return clipboardPrefix + String(decoding: data, as: UTF8.self)
    }

    public static func fields(fromClipboard text: String?) -> [LabelLayoutField] {
        guard let text, text.hasPrefix(clipboardPrefix) else { return [] }
        let body = String(text.dropFirst(clipboardPrefix.count))
        return (try? JSONDecoder().decode([LabelLayoutField].self, from: Data(body.utf8))) ?? []
    }

    // MARK: Snapping

    /// How far a box being dragged must move to sit on the grid, or else on the label's edges and centre and on the
    /// other fields' edges and centres (within `threshold` dots).
    public static func snap(_ box: LabelBox, others: [LabelBox], label: LabelBox, grid: Int?, threshold: Double) -> LabelSnap {
        var s = LabelSnap()
        if let g = grid, g > 1 {
            let gd = Double(g)
            s.dx = (box.x / gd).rounded() * gd - box.x
            s.dy = (box.y / gd).rounded() * gd - box.y
            return s
        }
        var xs: [Double] = [label.x, label.midX, label.maxX]
        var ys: [Double] = [label.y, label.midY, label.maxY]
        for o in others { xs += [o.x, o.midX, o.maxX]; ys += [o.y, o.midY, o.maxY] }
        var bestX = threshold + 1, bestY = threshold + 1
        for mine in [box.x, box.midX, box.maxX] {
            for t in xs where abs(t - mine) < bestX && abs(t - mine) <= threshold {
                bestX = abs(t - mine); s.dx = t - mine; s.guideX = t
            }
        }
        for mine in [box.y, box.midY, box.maxY] {
            for t in ys where abs(t - mine) < bestY && abs(t - mine) <= threshold {
                bestY = abs(t - mine); s.dy = t - mine; s.guideY = t
            }
        }
        return s
    }

    /// A value held to the grid (a size or a typed number); no grid leaves it.
    public static func snapped(_ v: Int, grid: Int?) -> Int {
        guard let g = grid, g > 1 else { return v }
        return Int((Double(v) / Double(g)).rounded()) * g
    }

    // MARK: Pictures

    /// A bitmap (1 bit a pixel, base64) scaled to another size by nearest dots; nil when it cannot be read.
    public static func resampledBitmap(_ bitmap: String, fromWidth fw: Int, fromHeight fh: Int, toWidth tw: Int, toHeight th: Int) -> String? {
        guard fw > 0, fh > 0, tw > 0, th > 0, let src = LabelBitmap.bytes(bitmap, width: fw, height: fh) else { return nil }
        let sb = LabelBitmap.bytesPerRow(fw), tb = LabelBitmap.bytesPerRow(tw)
        var out = [UInt8](repeating: 0, count: tb * th)
        for y in 0..<th {
            let sy = min(fh - 1, y * fh / th)
            for x in 0..<tw {
                let sx = min(fw - 1, x * fw / tw)
                if (src[sy * sb + (sx >> 3)] >> UInt8(7 - (sx & 7))) & 1 == 1 { out[y * tb + (x >> 3)] |= UInt8(0x80 >> (x & 7)) }
            }
        }
        return LabelBitmap.base64Encode(out)
    }

    /// The pixels of a bitmap, row by row, true where black.
    public static func pixels(_ bitmap: String, width: Int, height: Int) -> [Bool]? {
        guard width > 0, height > 0, let src = LabelBitmap.bytes(bitmap, width: width, height: height) else { return nil }
        let bpr = LabelBitmap.bytesPerRow(width)
        var out = [Bool](repeating: false, count: width * height)
        for y in 0..<height { for x in 0..<width { out[y * width + x] = (src[y * bpr + (x >> 3)] >> UInt8(7 - (x & 7))) & 1 == 1 } }
        return out
    }
}

// MARK: Undo and redo

/// A simple stack of layouts. A run of the same kind of change (a drag, a nudge, typing in one box) within a second of
/// the last is one step.
public struct LabelHistory {
    public private(set) var past: [LabelLayout] = []
    public private(set) var future: [LabelLayout] = []
    private var lastKey: String?
    private var lastAt: Date = .distantPast

    public static let limit = 100

    public init() {}

    public var canUndo: Bool { !past.isEmpty }
    public var canRedo: Bool { !future.isEmpty }

    /// Note that `before` is about to change.
    public mutating func record(before: LabelLayout, key: String? = nil, now: Date = Date()) {
        if let key, key == lastKey, now.timeIntervalSince(lastAt) < 1, !past.isEmpty {
            lastAt = now
            future.removeAll()
            return
        }
        past.append(before)
        if past.count > Self.limit { past.removeFirst(past.count - Self.limit) }
        future.removeAll()
        lastKey = key
        lastAt = now
    }

    public mutating func undo(current: LabelLayout) -> LabelLayout? {
        guard let previous = past.popLast() else { return nil }
        future.append(current)
        lastKey = nil
        return previous
    }

    public mutating func redo(current: LabelLayout) -> LabelLayout? {
        guard let next = future.popLast() else { return nil }
        past.append(current)
        lastKey = nil
        return next
    }

    public mutating func clear() {
        past.removeAll(); future.removeAll(); lastKey = nil
    }
}
