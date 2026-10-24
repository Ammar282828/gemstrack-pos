import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
import ERPCore
#if os(macOS)
import AppKit
typealias LabelFont = NSFont
#else
import UIKit
typealias LabelFont = UIFont
#endif

// How the tag designer draws a field as it will print (the canvas and every preview share this file).
//
// Sizes come from ERPCore `LabelGeometry`; this file only supplies what needs the system: real text widths (a
// condensed system font stands in for ZPL's font 0), and QR / Code 128 / PDF417 modules from CoreImage. The other
// symbologies (Code 39, EAN-13, UPC-A, Data Matrix) are drawn as a labelled pattern of the right size: the printer
// makes the real one.

// MARK: Symbols

/// A bar code as a grid of modules, true where dark.
struct LabelSymbolMatrix {
    let cols: Int
    let rows: Int
    let dark: [Bool]
    var isPlaceholder = false

    func isDark(_ c: Int, _ r: Int) -> Bool { dark[r * cols + c] }
}

enum LabelSymbols {
    private static let context = CIContext()
    private static var cache: [String: LabelSymbolMatrix] = [:]
    private static var misses: Set<String> = []

    private static func cached(_ key: String, _ make: () -> LabelSymbolMatrix?) -> LabelSymbolMatrix? {
        if let m = cache[key] { return m }
        if misses.contains(key) { return nil }
        if let m = make() {
            if cache.count > 300 { cache.removeAll() }
            cache[key] = m
            return m
        }
        if misses.count > 300 { misses.removeAll() }
        misses.insert(key)
        return nil
    }

    static func qr(_ data: String, correction: String) -> LabelSymbolMatrix? {
        guard !data.isEmpty else { return nil }
        return cached("qr|\(correction)|\(data)") {
            let f = CIFilter.qrCodeGenerator()
            f.message = Data(data.utf8)
            f.correctionLevel = correction
            return f.outputImage.flatMap(matrix)
        }
    }

    static func code128(_ data: String) -> LabelSymbolMatrix? {
        guard !data.isEmpty, let ascii = data.data(using: .ascii) else { return nil }
        return cached("c128|\(data)") {
            let f = CIFilter.code128BarcodeGenerator()
            f.message = ascii
            f.quietSpace = 0
            return f.outputImage.flatMap(matrix)
        }
    }

    static func pdf417(_ data: String) -> LabelSymbolMatrix? {
        guard !data.isEmpty else { return nil }
        return cached("pdf|\(data)") {
            let f = CIFilter.pdf417BarcodeGenerator()
            f.message = Data(data.utf8)
            return f.outputImage.flatMap(matrix)
        }
    }

    /// The matrix of whatever the field is, real where CoreImage can make it and a pattern otherwise.
    static func matrix(for f: LabelLayoutField) -> LabelSymbolMatrix {
        let data = f.data ?? ""
        if f.type == .qr {
            if let m = qr(data, correction: LabelGeometry.correction(f)) { return m }
            return pattern("qr", bytes: data.utf8.count, seed: data, correction: LabelGeometry.correction(f))
        }
        let sym = LabelGeometry.symbology(f)
        let real: LabelSymbolMatrix?
        switch sym {
        case "code128": real = code128(data)
        case "pdf417": real = pdf417(data)
        default: real = nil
        }
        return real ?? pattern(sym, bytes: data.utf8.count, seed: data, correction: "M")
    }

    /// A deterministic pattern of the symbology's estimated size.
    static func pattern(_ symbology: String, bytes: Int, seed: String, correction: String) -> LabelSymbolMatrix {
        var cols: Int, rows: Int
        if symbology == "qr" {
            cols = LabelGeometry.estimatedQRModules(bytes: bytes, correction: correction); rows = cols
        } else {
            let s = LabelGeometry.estimatedSymbol(symbology, bytes: bytes)
            cols = s.cols; rows = s.rows
        }
        var state: UInt32 = 2166136261
        for b in seed.utf8 { state = (state ^ UInt32(b)) &* 16777619 }
        func next() -> UInt32 { state = state &* 1664525 &+ 1013904223; return state >> 16 }
        var dark = [Bool](repeating: false, count: cols * rows)
        if rows == 1 {
            var c = 0, on = true
            while c < cols {
                let run = 1 + Int(next() % 3)
                for k in 0..<run where c + k < cols { dark[c + k] = on }
                c += run; on.toggle()
            }
        } else {
            for r in 0..<rows { for c in 0..<cols { dark[r * cols + c] = next() % 2 == 0 } }
            if symbology == "datamatrix" {
                for i in 0..<cols { dark[(rows - 1) * cols + i] = true; dark[i] = i % 2 == 0 }
                for i in 0..<rows { dark[i * cols] = true; dark[i * cols + cols - 1] = i % 2 == 1 }
            }
        }
        return LabelSymbolMatrix(cols: cols, rows: rows, dark: dark, isPlaceholder: symbology != "qr")
    }

    /// CoreImage's picture as modules: cropped to the dark part and squeezed to one sample a module (its smallest run).
    private static func matrix(_ ci: CIImage) -> LabelSymbolMatrix? {
        guard let cg = context.createCGImage(ci, from: ci.extent) else { return nil }
        let w = cg.width, h = cg.height
        guard w > 0, h > 0, w * h <= 4_000_000 else { return nil }
        var px = [UInt8](repeating: 255, count: w * h)
        var drawn = false
        px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            drawn = true
        }
        guard drawn else { return nil }
        var minX = w, maxX = -1, minY = h, maxY = -1
        for y in 0..<h { for x in 0..<w where px[y * w + x] < 128 {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        } }
        guard maxX >= minX, maxY >= minY else { return nil }
        let cw = maxX - minX + 1, ch = maxY - minY + 1
        func dark(_ x: Int, _ y: Int) -> Bool { px[(minY + y) * w + minX + x] < 128 }
        var unitX = cw
        for y in 0..<ch {
            var run = 1
            for x in 1..<max(1, cw) {
                if dark(x, y) == dark(x - 1, y) { run += 1 } else { unitX = min(unitX, run); run = 1 }
            }
        }
        var unitY = ch
        for x in 0..<cw {
            var run = 1
            for y in 1..<max(1, ch) {
                if dark(x, y) == dark(x, y - 1) { run += 1 } else { unitY = min(unitY, run); run = 1 }
            }
        }
        let cols = max(1, Int((Double(cw) / Double(unitX)).rounded())), rows = max(1, Int((Double(ch) / Double(unitY)).rounded()))
        var out = [Bool](repeating: false, count: cols * rows)
        for r in 0..<rows {
            for c in 0..<cols {
                let sx = min(cw - 1, Int((Double(c) + 0.5) * Double(cw) / Double(cols)))
                let sy = min(ch - 1, Int((Double(r) + 0.5) * Double(ch) / Double(rows)))
                out[r * cols + c] = dark(sx, sy)
            }
        }
        return LabelSymbolMatrix(cols: cols, rows: rows, dark: out)
    }
}

// MARK: Measuring

enum LabelMeasurer {
    private static var widths: [String: Double] = [:]

    private static func advance(_ text: String, _ fontDots: Double, _ bold: Bool) -> Double {
        if text.isEmpty { return 0 }
        let key = "\(fontDots)|\(bold)|\(text)"
        if let w = widths[key] { return w }
        let font = LabelFont.monospacedDigitSystemFont(ofSize: CGFloat(fontDots * LabelGeometry.pointPerDot), weight: bold ? .bold : .regular)
        let w = Double((text as NSString).size(withAttributes: [.font: font]).width) * LabelGeometry.condense
        if widths.count > 6000 { widths.removeAll() }
        widths[key] = w
        return w
    }

    /// Real text widths and CoreImage symbol sizes; the estimate where a symbol cannot be made.
    static let measure = LabelMeasure(
        advance: { text, fontDots, bold in advance(text, fontDots, bold) },
        qrModules: { data, correction in
            LabelSymbols.qr(data, correction: correction)?.cols ?? LabelGeometry.estimatedQRModules(bytes: data.utf8.count, correction: correction)
        },
        symbol: { symbology, data in
            let real: LabelSymbolMatrix?
            switch symbology {
            case "code128": real = LabelSymbols.code128(data)
            case "pdf417": real = LabelSymbols.pdf417(data)
            default: real = nil
            }
            if let real { return (real.cols, real.rows) }
            return LabelGeometry.estimatedSymbol(symbology, bytes: data.utf8.count)
        })
}

// MARK: Pictures

enum LabelBitmapImage {
    private static var cache: [String: CGImage] = [:]

    /// The 1-bit bitmap as a picture whose black dots are black and whose white dots are clear.
    static func make(_ bitmap: String, width: Int, height: Int) -> CGImage? {
        guard width > 0, height > 0, width * height <= 4_000_000 else { return nil }
        let key = "\(width)x\(height)|\(bitmap.count)|\(bitmap.hashValue)"
        if let c = cache[key] { return c }
        guard let px = LabelEditing.pixels(bitmap, width: width, height: height) else { return nil }
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        for i in 0..<(width * height) where px[i] { rgba[i * 4 + 3] = 255 }
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                               space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return nil }
        if cache.count > 40 { cache.removeAll() }
        cache[key] = cg
        return cg
    }
}

// MARK: One field

/// A field drawn as it prints, in a box the size of its rotated bounds (`scale` points a dot). The caller puts the
/// box at the bounds' corner. White is not ink: the label under it shows through.
struct LabelFieldView: View {
    let field: LabelLayoutField
    let scale: CGFloat
    /// A hidden field: the designer shows it faintly, the printer skips it.
    var faint = false

    var body: some View {
        let p = LabelGeometry.placement(field, measure: LabelMeasurer.measure)
        content(p.local)
            .frame(width: CGFloat(p.local.w) * scale, height: CGFloat(p.local.h) * scale, alignment: .topLeading)
            .rotationEffect(.degrees(Double(p.turn)))
            .frame(width: CGFloat(p.bounds.w) * scale, height: CGFloat(p.bounds.h) * scale)
            .opacity(faint ? 0.3 : 1)
    }

    @ViewBuilder
    private func content(_ local: LabelBox) -> some View {
        switch field.type {
        case .text: textView
        case .qr, .barcode: symbolView(local)
        case .line, .box, .ellipse: shapeView(local)
        case .image: imageView(local)
        }
    }

    private var textView: some View {
        let t = LabelGeometry.textLines(field, measure: LabelMeasurer.measure)
        let fs = CGFloat(LabelGeometry.fontDots(field))
        let pt = CGFloat(LabelGeometry.pointSize(field)) * scale
        let s = scale
        return ZStack(alignment: .topLeading) {
            ForEach(Array(t.lines.enumerated()), id: \.offset) { _, line in
                Text(line.text)
                    .font(.system(size: max(1, pt), weight: field.bold == true ? .bold : .regular).monospacedDigit())
                    .foregroundStyle(Color.black)
                    .lineLimit(1)
                    .fixedSize()
                    .scaleEffect(x: CGFloat(LabelGeometry.condense), y: 1, anchor: .topLeading)
                    .frame(width: CGFloat(line.width) * s, height: fs * s, alignment: .topLeading)
                    .offset(x: CGFloat(line.x) * s, y: CGFloat(line.y) * s)
            }
        }
    }

    private func symbolView(_ local: LabelBox) -> some View {
        let m = LabelSymbols.matrix(for: field)
        let sym = field.type == .qr ? "qr" : LabelGeometry.symbology(field)
        let linear = field.type == .barcode && LabelGeometry.isLinear(sym)
        let band = linear && field.showText == true ? LabelGeometry.barcodeTextBand : 0
        let s = scale
        let w = CGFloat(local.w) * s, h = CGFloat(local.h) * s
        let barsH = CGFloat(local.h - band) * s
        return ZStack(alignment: .top) {
            Canvas { ctx, _ in
                let cw = w / CGFloat(m.cols), ch = barsH / CGFloat(m.rows)
                var path = Path()
                for r in 0..<m.rows {
                    var c = 0
                    while c < m.cols {
                        if m.isDark(c, r) {
                            var end = c
                            while end < m.cols && m.isDark(end, r) { end += 1 }
                            path.addRect(CGRect(x: CGFloat(c) * cw, y: CGFloat(r) * ch, width: CGFloat(end - c) * cw + 0.25, height: ch + 0.25))
                            c = end
                        } else { c += 1 }
                    }
                }
                ctx.fill(path, with: .color(.black))
            }
            .frame(width: w, height: barsH)
            .frame(maxHeight: .infinity, alignment: .top)
            if band > 0 {
                Text(field.data ?? "")
                    .font(.system(size: max(1, CGFloat(band) * 0.7 * s), design: .monospaced))
                    .foregroundStyle(Color.black)
                    .lineLimit(1).minimumScaleFactor(0.2)
                    .frame(width: w, height: CGFloat(band) * s)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
            if m.isPlaceholder {
                Text(Self.symbologyName(sym))
                    .font(.system(size: max(5, min(11, w / 8)), weight: .semibold))
                    .foregroundStyle(Color.black)
                    .padding(.horizontal, 3)
                    .background(Color.white.opacity(0.85), in: Capsule())
                    .frame(maxHeight: barsH, alignment: .center)
            }
        }
        .frame(width: w, height: h)
    }

    static func symbologyName(_ s: String) -> String {
        switch s {
        case "code39": return "Code 39"
        case "ean13": return "EAN-13"
        case "upca": return "UPC-A"
        case "datamatrix": return "Data Matrix"
        case "pdf417": return "PDF417"
        default: return "Code 128"
        }
    }

    private func shapeView(_ local: LabelBox) -> some View {
        let f = field
        let s = scale
        let w = CGFloat(local.w) * s, h = CGFloat(local.h) * s
        return Canvas { ctx, _ in
            let edge = min(local.w, local.h)
            let rect = CGRect(x: 0, y: 0, width: w, height: h)
            let t: Double = f.type == .line || f.fill == true ? edge : Double(max(1, f.thickness ?? 2))
            let solid = t * 2 >= edge
            let radius = f.type == .box ? CGFloat(min(8, max(0, f.rounding ?? 0))) / 8 * CGFloat(edge) / 2 * s : 0
            func shape(_ r: CGRect, _ rad: CGFloat) -> Path {
                f.type == .ellipse ? Path(ellipseIn: r) : Path(roundedRect: r, cornerRadius: max(0, rad))
            }
            if solid {
                ctx.fill(shape(rect, radius), with: .color(.black))
            } else {
                let inset = CGFloat(t) * s / 2
                ctx.stroke(shape(rect.insetBy(dx: inset, dy: inset), radius - inset), with: .color(.black), lineWidth: CGFloat(t) * s)
            }
        }
        .frame(width: w, height: h)
    }

    @ViewBuilder
    private func imageView(_ local: LabelBox) -> some View {
        let w = Int(local.w), h = Int(local.h)
        if let bmp = field.bitmap, !bmp.isEmpty, let cg = LabelBitmapImage.make(bmp, width: w, height: h) {
            Image(decorative: cg, scale: 1).resizable().interpolation(.none)
        } else {
            Rectangle().stroke(Color.gray, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                .overlay(Image(systemName: "photo").foregroundStyle(Color.gray))
        }
    }
}

// MARK: The whole tag

/// The label drawn small and still: a white tag with every visible field where its dots put it. Used by the print
/// job sheet and the designer's preview. `fields` are already filled (`Zpl.resolveFields`).
struct LabelTagPreview: View {
    let layout: LabelLayout
    let fields: [LabelLayoutField]

    /// The tag with the pieces' values worked into its fields, as label `labelIndex` of a job prints.
    init(layout: LabelLayout, pieces: [LabelValues], labelIndex: Int = 0, now: Date = Date(), counterStart: Int? = nil) {
        self.layout = layout
        self.fields = Zpl.resolveFields(layout, pieces: pieces, labelIndex: labelIndex, now: now, counterStart: counterStart)
    }

    init(layout: LabelLayout, fields: [LabelLayoutField]) {
        self.layout = layout
        self.fields = fields
    }

    var body: some View {
        let w = CGFloat(max(1, layout.widthDots)), h = CGFloat(max(1, layout.heightDots))
        GeometryReader { geo in
            let k = geo.size.width / w
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.white)
                ForEach(fields.filter { !$0.hidden }, id: \.id) { f in
                    let b = LabelGeometry.bounds(f, measure: LabelMeasurer.measure)
                    LabelFieldView(field: f, scale: k)
                        .offset(x: CGFloat(b.x) * k, y: CGFloat(b.y) * k)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Color.gray.opacity(0.4)))
        }
        .aspectRatio(w / h, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Preview of the tag")
    }
}
