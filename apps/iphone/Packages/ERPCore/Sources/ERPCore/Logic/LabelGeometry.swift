// Where a tag's field sits on the canvas, and how big it is, in the printer's dots. Pure arithmetic (no drawing), so
// the designer's canvas, its handles, its alignment and its tests all read the one answer.
//
// The rules are Zpl.swift's: a field's x, y is the top-left of its ROTATED box (^FO); text, QR codes and barcodes turn
// about their own centre and their box swaps width and height at 90° and 270°; boxes, lines and ellipses never turn;
// a picture only turns half way (180°), in the same box. Text stacked without a width runs down at 0°, to the left at
// 90°, up at 180° and to the right at 270°, which is what turning the lines' own frame gives.
//
// What needs a real font or a bar code generator (the width of a word, the modules of a QR) is asked of `LabelMeasure`:
// the app supplies CoreText and CoreImage ones; `LabelMeasure.estimate` stands in for tests and for Linux.

import Foundation

/// A rectangle in dots, from the label's top-left.
public struct LabelBox: Hashable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x; self.y = y; self.w = w; self.h = h
    }

    public var maxX: Double { x + w }
    public var maxY: Double { y + h }
    public var midX: Double { x + w / 2 }
    public var midY: Double { y + h / 2 }

    public func union(_ o: LabelBox) -> LabelBox {
        let nx = min(x, o.x), ny = min(y, o.y)
        return LabelBox(x: nx, y: ny, w: max(maxX, o.maxX) - nx, h: max(maxY, o.maxY) - ny)
    }

    public func intersects(_ o: LabelBox) -> Bool { x < o.maxX && o.x < maxX && y < o.maxY && o.y < maxY }

    public func contains(x px: Double, y py: Double) -> Bool { px >= x && px <= maxX && py >= y && py <= maxY }

    public func offset(dx: Double, dy: Double) -> LabelBox { LabelBox(x: x + dx, y: y + dy, w: w, h: h) }

    /// The box with a margin added on every side (a hit area around a thin line).
    public func inset(by d: Double) -> LabelBox { LabelBox(x: x + d, y: y + d, w: w - 2 * d, h: h - 2 * d) }

    /// The rectangle two corners make, whichever way they were dragged.
    public static func between(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> LabelBox {
        LabelBox(x: min(ax, bx), y: min(ay, by), w: abs(ax - bx), h: abs(ay - by))
    }
}

/// What the geometry cannot know without a font or a bar code generator.
public struct LabelMeasure {
    /// The width of a line of text in dots at a font height in dots (bold included).
    public var advance: (_ text: String, _ fontDots: Double, _ bold: Bool) -> Double
    /// A QR code's modules a side for this data at this correction level (L, M, Q, H).
    public var qrModules: (_ data: String, _ correction: String) -> Int
    /// A bar code's size in modules: columns and rows (rows is 1 for a one-dimensional symbol).
    public var symbol: (_ symbology: String, _ data: String) -> (cols: Int, rows: Int)

    public init(advance: @escaping (String, Double, Bool) -> Double,
                qrModules: @escaping (String, String) -> Int,
                symbol: @escaping (String, String) -> (cols: Int, rows: Int)) {
        self.advance = advance; self.qrModules = qrModules; self.symbol = symbol
    }

    /// Good enough to lay a tag out without a font: ZPL's font 0 is about half as wide as it is tall.
    public static var estimate: LabelMeasure {
        LabelMeasure(
            advance: { text, fontDots, bold in Double(text.count) * fontDots * (bold ? 0.54 : 0.5) },
            qrModules: { data, correction in LabelGeometry.estimatedQRModules(bytes: data.utf8.count, correction: correction) },
            symbol: { symbology, data in LabelGeometry.estimatedSymbol(symbology, bytes: data.utf8.count) })
    }
}

/// One line of text in its field's own (unturned) frame.
public struct LabelTextLine: Hashable {
    public var text: String
    public var x: Double
    public var y: Double
    public var width: Double
}

/// Where a field is and how it is drawn: its content's size in its own frame, its box on the canvas, and the turn.
public struct LabelPlacement: Hashable {
    /// The content before turning, from (0, 0).
    public var local: LabelBox
    /// The box on the label (the rotated box, whose corner is the field's x, y).
    public var bounds: LabelBox
    /// Degrees clockwise the content is turned about its centre before it sits in `bounds`.
    public var turn: Int
}

public enum LabelGeometry {
    /// Dots under a one-dimensional bar code that its readable line takes (^BC … Y).
    public static let barcodeTextBand: Double = 20
    /// ZPL's font 0 is narrower than Helvetica at the same height: the drawing squeezes the real font by this.
    public static let condense: Double = 0.86
    /// The drawing's point size for a font height in dots (the cell holds ascent and descent; the letters are smaller).
    public static let pointPerDot: Double = 0.8

    // MARK: Sizes a field has

    /// A text's font height in dots (20 when unset, as Zpl does).
    public static func fontDots(_ f: LabelLayoutField) -> Double {
        guard let v = f.fontSize, v >= 1 else { return 20 }
        return Double(min(32000, v))
    }

    public static func symbology(_ f: LabelLayoutField) -> String {
        switch f.symbology {
        case "code39", "ean13", "upca", "datamatrix", "pdf417": return f.symbology!
        default: return "code128"
        }
    }

    public static func isLinear(_ symbology: String) -> Bool { ["code128", "code39", "ean13", "upca"].contains(symbology) }

    public static func qrMagnification(_ f: LabelLayoutField) -> Int { f.qrMagnification == nil ? 2 : min(10, max(1, f.qrMagnification!)) }

    public static func moduleWidth(_ f: LabelLayoutField) -> Int { min(10, max(1, f.moduleWidth ?? 2)) }

    public static func barHeight(_ f: LabelLayoutField) -> Int { (f.height ?? 0) >= 1 ? min(32000, f.height!) : 40 }

    public static func correction(_ f: LabelLayoutField) -> String {
        f.errorCorrection == "L" || f.errorCorrection == "Q" || f.errorCorrection == "H" ? f.errorCorrection! : "M"
    }

    /// The size of a box, line, ellipse or picture (1 at the least).
    public static func shapeSize(_ f: LabelLayoutField) -> (w: Double, h: Double) {
        (Double(max(1, min(32000, f.width ?? 1))), Double(max(1, min(32000, f.height ?? 1))))
    }

    /// A QR code's version-by-capacity estimate (byte mode), used only where nothing can generate one.
    public static func estimatedQRModules(bytes: Int, correction: String) -> Int {
        // Byte-mode capacity of versions 1…10 at L, M, Q, H.
        let caps: [String: [Int]] = [
            "L": [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
            "M": [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
            "Q": [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
            "H": [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
        ]
        let row = caps[correction] ?? caps["M"]!
        let version = (row.firstIndex { bytes <= $0 } ?? 9) + 1
        return 17 + 4 * version
    }

    /// A bar code's size in modules without a generator: Code 128 is 11 modules a character and 35 over, and so on.
    public static func estimatedSymbol(_ symbology: String, bytes: Int) -> (cols: Int, rows: Int) {
        let n = max(1, bytes)
        switch symbology {
        case "code39": return (13 * (n + 2) - 1, 1)
        case "ean13": return (95, 1)
        case "upca": return (95, 1)
        case "datamatrix":
            let side = max(10, 2 * Int(Double(n).squareRoot().rounded(.up)) + 8)
            return (side, side)
        case "pdf417": return (99 + 17 * Int((Double(n) / 6).rounded(.up)), max(3, n / 12 + 3))
        default: return (11 * n + 35, 1)
        }
    }

    // MARK: Text

    /// The lines a text field prints: wrapped to its width (and held to its lines) or one to a new line, laid out in the
    /// field's own frame. `width` and `height` are the block's.
    public static func textLines(_ f: LabelLayoutField, measure: LabelMeasure) -> (lines: [LabelTextLine], width: Double, height: Double) {
        let fs = fontDots(f)
        let bold = f.bold == true
        let spacing = Double(min(9999, max(-9999, f.lineSpacing ?? 0)))
        let pitch = fs + spacing
        let raw = (f.data ?? "").replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let paragraphs = raw.components(separatedBy: "\n")
        func adv(_ s: String) -> Double { measure.advance(s, fs, bold) }

        if let w = f.width, w >= 1 {
            let blockW = Double(min(32000, w))
            var wrapped: [String] = []
            for p in paragraphs { wrapped.append(contentsOf: wrap(p, within: blockW, advance: adv)) }
            let limit = (f.lines ?? 0) >= 1 ? min(9999, f.lines!) : paragraphs.count
            let shown = Array(wrapped.prefix(max(1, limit)))
            var out: [LabelTextLine] = []
            for (i, s) in shown.enumerated() {
                let lw = adv(s)
                let x: Double = f.align == "C" ? (blockW - lw) / 2 : f.align == "R" ? blockW - lw : 0
                out.append(LabelTextLine(text: s, x: x, y: Double(i) * pitch, width: lw))
            }
            let rows = max(1, limit)
            return (out, blockW, fs + Double(rows - 1) * max(0, pitch))
        }
        var out: [LabelTextLine] = []
        var widest = 0.0
        for (i, s) in paragraphs.enumerated() {
            let lw = adv(s)
            widest = max(widest, lw)
            out.append(LabelTextLine(text: s, x: 0, y: Double(i) * pitch, width: lw))
        }
        return (out, widest, fs + Double(max(0, paragraphs.count - 1)) * max(0, pitch))
    }

    /// Greedy word wrap; a word wider than the block is broken by letters.
    static func wrap(_ paragraph: String, within width: Double, advance: (String) -> Double) -> [String] {
        if paragraph.isEmpty { return [""] }
        var lines: [String] = []
        var current = ""
        func flush() { lines.append(current); current = "" }
        for word in paragraph.split(separator: " ", omittingEmptySubsequences: false).map(String.init) {
            let trial = current.isEmpty ? word : current + " " + word
            if advance(trial) <= width { current = trial; continue }
            if !current.isEmpty { flush() }
            if advance(word) <= width { current = word; continue }
            // A single word too wide for the block: letters until it would overflow.
            for ch in word {
                let next = current + String(ch)
                if advance(next) > width, !current.isEmpty { flush(); current = String(ch) } else { current = next }
            }
        }
        if !current.isEmpty || lines.isEmpty { lines.append(current) }
        return lines
    }

    // MARK: Placement

    /// The field's content size in its own frame.
    public static func contentSize(_ f: LabelLayoutField, measure: LabelMeasure) -> (w: Double, h: Double) {
        switch f.type {
        case .text:
            let t = textLines(f, measure: measure)
            return (max(t.width, 4), max(t.height, 4))
        case .qr:
            let modules = measure.qrModules(f.data ?? "", correction(f))
            let side = Double(max(1, modules) * qrMagnification(f))
            return (side, side)
        case .barcode:
            let sym = symbology(f)
            let s = measure.symbol(sym, f.data ?? "")
            let m = Double(moduleWidth(f))
            let h = Double(barHeight(f))
            if isLinear(sym) { return (Double(max(1, s.cols)) * m, h + (f.showText == true ? barcodeTextBand : 0)) }
            if sym == "pdf417" { return (Double(max(1, s.cols)) * m, Double(max(1, s.rows)) * h) }
            return (Double(max(1, s.cols)) * m, Double(max(1, s.rows)) * m)
        case .line, .box, .ellipse, .image:
            return shapeSize(f)
        }
    }

    /// Whether the field's rotation turns its box (text, QR and bar codes).
    public static func turnsBox(_ type: LabelFieldType) -> Bool { type == .text || type == .qr || type == .barcode }

    public static func placement(_ f: LabelLayoutField, measure: LabelMeasure) -> LabelPlacement {
        let c = contentSize(f, measure: measure)
        let local = LabelBox(x: 0, y: 0, w: c.w, h: c.h)
        let x = Double(f.x), y = Double(f.y)
        switch f.type {
        case .text, .qr, .barcode:
            let sideways = f.rotation == 90 || f.rotation == 270
            let turn = [90, 180, 270].contains(f.rotation) ? f.rotation : 0
            return LabelPlacement(local: local, bounds: LabelBox(x: x, y: y, w: sideways ? c.h : c.w, h: sideways ? c.w : c.h), turn: turn)
        case .image:
            // Only half a turn is printed (Zpl rotates the bitmap, never the box).
            return LabelPlacement(local: local, bounds: LabelBox(x: x, y: y, w: c.w, h: c.h), turn: f.rotation == 180 ? 180 : 0)
        case .line, .box, .ellipse:
            return LabelPlacement(local: local, bounds: LabelBox(x: x, y: y, w: c.w, h: c.h), turn: 0)
        }
    }

    public static func bounds(_ f: LabelLayoutField, measure: LabelMeasure) -> LabelBox { placement(f, measure: measure).bounds }

    /// The box all of these fields cover, nil for none.
    public static func union(_ fields: [LabelLayoutField], measure: LabelMeasure) -> LabelBox? {
        fields.map { bounds($0, measure: measure) }.reduce(nil as LabelBox?) { acc, b in acc.map { $0.union(b) } ?? b }
    }

    /// A text's line cell: the drawing's font point size for the field.
    public static func pointSize(_ f: LabelLayoutField) -> Double { fontDots(f) * pointPerDot }
}

// MARK: Units

public enum LabelUnits {
    public static func dotsPerMM(dpi: Int?) -> Double { Double(dpi ?? 203) / 25.4 }

    /// 84 mm at 203 dpi → 671 dots (whole dots, halves up).
    public static func dots(mm: Double, dpi: Int?) -> Int { Int((mm * dotsPerMM(dpi: dpi)).rounded()) }

    public static func mm(dots: Double, dpi: Int?) -> Double { dots / dotsPerMM(dpi: dpi) }

    /// "84.0" / "3.25": a millimetre figure to one place, no needless noughts past it.
    public static func mmText(dots: Double, dpi: Int?) -> String {
        let v = (mm(dots: dots, dpi: dpi) * 10).rounded() / 10
        return v == v.rounded() ? String(Int(v)) : String(v)
    }

    public static let dpiChoices = [203, 300, 600]
}
