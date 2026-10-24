// Ported from src/lib/label-lsc.ts (tests: LabelLSCTests, label-lsc.test.ts).
//
// Label LIVE (label.live) designs → the ERP's tag layout. A design is a `.lsc` file (JSON): `labelConfig` has the
// label's size and dpi, `canvasRecord.objects[i]` what each object is (its type, and for text and barcodes the text
// with its `{VARIABLES}`), `canvasRecord.fabricRep.objects[i]` where it sits (fabric.js 5: dots from the label's
// CENTRE, each object's own origin, scale and angle).
//
// Only geometry and the variables' NAMES are read: never `dataImport`, a variable's `value`, a path or the window
// (`ui`). What cannot be drawn on a tag (a slanted line, an unknown element) is left out.
//
// Pictures are PNG data URLs, decoded here by `PNG` (a small pure-Swift inflate: Foundation has no ImageIO on Linux, and
// the same code gives the same bits as the web). A picture that is not a PNG goes to `imageDecoder`, which the app can
// supply from UIImage / NSImage; without one it is left out.

import Foundation

public enum LabelLSC {
    /// A design as a layout; nil when the data is not one.
    public static func importDesign(_ data: Data, id: String? = nil, name: String? = nil, imageDecoder: ((Data) -> DecodedImage?)? = nil) -> LabelLayout? {
        guard let root = try? JSONDecoder().decode(J.self, from: data) else { return nil }
        return importDesign(root, id: id, name: name, imageDecoder: imageDecoder)
    }

    /// The same from the file's text.
    public static func importDesign(json: String, id: String? = nil, name: String? = nil, imageDecoder: ((Data) -> DecodedImage?)? = nil) -> LabelLayout? {
        importDesign(Data(json.utf8), id: id, name: name, imageDecoder: imageDecoder)
    }

    // MARK: JSON

    private enum J: Decodable {
        case null, bool(Bool), number(Double), string(String), array([J]), object([String: J])

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let d = try? c.decode(Double.self) { self = .number(d) }
            else if let s = try? c.decode(String.self) { self = .string(s) }
            else if let a = try? c.decode([J].self) { self = .array(a) }
            else { self = .object(try c.decode([String: J].self)) }
        }

        var object: [String: J]? { if case .object(let o) = self { return o }; return nil }
        var array: [J] { if case .array(let a) = self { return a }; return [] }
        var isNull: Bool { if case .null = self { return true }; return false }
        /// The JavaScript `str`: a string, else "".
        var str: String { if case .string(let s) = self { return s }; return "" }
        func num(_ dflt: Double = 0) -> Double {
            switch self {
            case .number(let d): return d.isFinite ? d : dflt
            case .string(let s):
                let t = JS.trim(s)
                if t.isEmpty { return dflt }
                let v = JS.toNumber(t)
                return v.isFinite ? v : dflt
            default: return dflt
            }
        }
        subscript(_ key: String) -> J {
            if case .object(let o) = self { return o[key] ?? .null }
            return .null
        }
        var isTrue: Bool { if case .bool(true) = self { return true }; return false }
        var isFalse: Bool { if case .bool(false) = self { return true }; return false }
        var isNumber: Double? { if case .number(let d) = self { return d }; return nil }
    }

    // MARK: Geometry

    private struct Box { var x: Double; var y: Double; var w: Double; var h: Double; var turn: Int; var cx: Double; var cy: Double }

    private static func ri(_ d: Double) -> Int { d.isFinite ? Int(min(1e9, max(-1e9, JS.round(d)))) : 0 }
    private static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }

    /// Where a fabric object sits on the label: the corner of its rotated box, from the label's top-left, and its own size.
    private static func boxOf(_ fo: J, _ W: Double, _ H: Double, _ width: Double, _ height: Double) -> Box {
        let w = width * abs(fo["scaleX"].num(1)), h = height * abs(fo["scaleY"].num(1))
        let ox = fo["originX"].str == "center" ? 0.5 : fo["originX"].str == "right" ? 1.0 : 0.0
        let oy = fo["originY"].str == "center" ? 0.5 : fo["originY"].str == "bottom" ? 1.0 : 0.0
        let q = Int(JS.round(clamp(fo["angle"].num(), -1e9, 1e9) / 90))
        let quarter = ((q % 4) + 4) % 4
        let turn = quarter * 90
        let c = [1.0, 0.0, -1.0, 0.0][quarter], s = [0.0, 1.0, 0.0, -1.0][quarter]
        func rx(_ px: Double, _ py: Double) -> Double { px * c - py * s }
        func ry(_ px: Double, _ py: Double) -> Double { px * s + py * c }
        // Fabric turns an object about its origin point, so the origin stays put: the object's own top-left is found from it.
        let tlx = fo["left"].num() - rx(ox * w, oy * h), tly = fo["top"].num() - ry(ox * w, oy * h)
        let xs = [0, rx(w, 0), rx(0, h), rx(w, h)].map { tlx + $0 }
        let ys = [0, ry(w, 0), ry(0, h), ry(w, h)].map { tly + $0 }
        let minX = xs.min()!, minY = ys.min()!, maxX = xs.max()!, maxY = ys.max()!
        let sideways = turn == 90 || turn == 270
        return Box(x: minX + W / 2, y: minY + H / 2, w: sideways ? h : w, h: sideways ? w : h, turn: turn,
                   cx: (minX + maxX) / 2 + W / 2, cy: (minY + maxY) / 2 + H / 2)
    }

    private static let white: Set<String> = ["#fff", "#ffffff", "white", "rgb(255,255,255)", "rgb(255, 255, 255)"]

    private static func invisible(_ color: J, _ labelFill: String) -> Bool {
        guard case .string(let raw) = color else { return true }
        let c = JS.trim(raw).lowercased()
        return c.isEmpty || c == "transparent" || c == "none" || c == labelFill || white.contains(c)
    }

    private static let symbologies = ["code128": "code128", "gs1128": "code128", "code39": "code39", "ean13": "ean13", "upca": "upca", "datamatrix": "datamatrix", "pdf417": "pdf417"]
    private static let letterTurn = ["N": 0, "R": 90, "I": 180, "B": 270]
    /// The largest source text a picture may keep (see lib/writes/label-layout.ts).
    private static let maxSource = 64 * 1024

    /// JavaScript's `a ?? b`: the first unless it is missing or null.
    private static func coalesce(_ a: J, _ b: J) -> J { a.isNull ? b : a }

    private static func crlf(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        let v = Array(s.unicodeScalars)
        var i = 0
        while i < v.count {
            if v[i] == "\r" { out.append("\n"); if i + 1 < v.count, v[i + 1] == "\n" { i += 1 } } else { out.append(v[i]) }
            i += 1
        }
        return String(out)
    }

    // MARK: The import

    private static func importDesign(_ root: J, id: String?, name: String?, imageDecoder: ((Data) -> DecodedImage?)?) -> LabelLayout? {
        guard root.object != nil, let lc = root["labelConfig"].object != nil ? root["labelConfig"] : nil,
              let cr = root["canvasRecord"].object != nil ? root["canvasRecord"] : nil else { return nil }

        let dpiRaw = lc["dpi"].num(203)
        let dpi = dpiRaw > 0 ? dpiRaw : 203
        func toDots(_ m: J) -> Double {
            var v: Double
            if case .string(let s) = m, !s.isEmpty { v = JS.parseFloat(s) } else { v = JS.parseFloat(JS.number(m.num())) }
            if !v.isFinite { return .nan }
            v = lc["metric"].isFalse ? v * dpi : (v * dpi) / 25.4
            return max(1, JS.round(v))
        }
        let W = toDots(lc["widthMeasure"]), H = toDots(lc["heightMeasure"])
        guard W.isFinite, H.isFinite else { return nil }

        let objects = cr["objects"].array
        let fabric = cr["fabricRep"]["objects"].array
        let labelFill = JS.trim(cr["fill"].str).lowercased()
        func decode(_ url: String) -> DecodedImage? {
            if let png = PNG.decodeDataURL(url) { return png }
            guard let imageDecoder, let bytes = PNG.dataURLBytes(url) else { return nil }
            return imageDecoder(Data(bytes))
        }

        var names = Set<String>()
        for v in cr["variables"].array where v.object != nil {
            if case .string(let n) = v["name"] { names.insert(n) }
        }

        var fields: [LabelLayoutField] = []
        var centres: [(Double, Double)] = []
        for i in 0..<min(objects.count, fabric.count) {
            let rec = objects[i], fo = fabric[i]
            guard rec.object != nil, fo.object != nil else { continue }
            let cfg = rec["config"]
            let kind = rec["type"].str
            func base(_ b: Box, _ type: LabelFieldType, _ label: String) -> LabelLayoutField {
                var f = LabelLayoutField(id: "lsc-\(i + 1)", type: type, x: ri(b.x), y: ri(b.y), name: label)
                if rec["hideOnPrint"].isTrue || fo["hideOnPrint"].isTrue || fo["visible"].isFalse { f.hidden = true }
                return f
            }
            let widthOf = fo["width"].num(), heightOf = fo["height"].num()
            func push(_ f: LabelLayoutField, _ b: Box) { fields.append(f); centres.append((b.cx, b.cy)) }

            if kind == "ELEMENT_TEXT" {
                let data = crlf(cfg["text"].str)
                let b = boxOf(fo, W, H, widthOf, heightOf)
                let scaleY = abs(fo["scaleY"].num(1))
                let fs = max(1, ri(fo["fontSize"].num(20) * scaleY))
                var f = base(b, .text, "Text")
                f.data = data
                f.fontSize = fs
                f.width = max(1, ri(widthOf * abs(fo["scaleX"].num(1))))
                f.lines = Zpl.splitScalars(data, "\n").count
                let pitch = ri(fo["fontSize"].num(20) * fo["lineHeight"].num(1) * 1.13 * scaleY)
                if pitch - fs != 0 { f.lineSpacing = pitch - fs }
                let own = fo["textAlign"].str
                let align = own.isEmpty ? cfg["textAlign"].str : own
                if align == "center" { f.align = "C" } else if align == "right" { f.align = "R" }
                if b.turn != 0 { f.rotation = b.turn }
                push(f, b)
            } else if kind == "ELEMENT_BARCODE" {
                let bcid = cfg["bcid"].str.lowercased()
                let b = boxOf(fo, W, H, widthOf, heightOf)
                let turn = (b.turn + (letterTurn[cfg["rotate"].str] ?? 0)) % 360
                let data = crlf(cfg["text"].str)
                let scale = cfg["scale"].num(0)
                if bcid == "qrcode" || bcid == "microqrcode" {
                    var f = base(b, .qr, "QR code")
                    f.data = data
                    f.qrMagnification = scale >= 1 && scale <= 10 ? ri(scale) : Int(clamp(JS.round(b.w / 21), 1, 10))
                    let inner = cfg["opts"].object != nil ? cfg["opts"] : J.object([:])
                    let own = inner["eclevel"].str
                    let ec = (own.isEmpty ? cfg["eclevel"].str : own).uppercased()
                    f.errorCorrection = ec == "L" || ec == "Q" || ec == "H" ? ec : "M"
                    if turn != 0 { f.rotation = turn }
                    push(f, b)
                } else if let symbology = symbologies[bcid] {
                    var f = base(b, .barcode, "Barcode")
                    f.data = data
                    f.symbology = symbology
                    f.height = max(1, ri(turn == 90 || turn == 270 ? b.w : b.h))
                    f.moduleWidth = Int(clamp(JS.round(scale != 0 ? scale : 2), 1, 10))
                    let inner = cfg["opts"].object != nil ? cfg["opts"] : J.object([:])
                    if cfg["includetext"].isTrue || inner["includetext"].isTrue { f.showText = true }
                    if turn != 0 { f.rotation = turn }
                    push(f, b)
                }
            } else if kind == "ELEMENT_IMAGE" {
                let src = fo["src"].str
                guard !src.isEmpty, let img = decode(src) else { continue }
                let b = boxOf(fo, W, H, widthOf, heightOf)
                // The picture is made at its drawn size in its own orientation, then turned a quarter at a time for 90° and 270°.
                let drawnW = max(1, ri(widthOf * abs(fo["scaleX"].num(1)))), drawnH = max(1, ri(heightOf * abs(fo["scaleY"].num(1))))
                let kindId = cfg["kindId"].str
                let dither: LabelBitmap.Dither = kindId.contains("ATKINSON") ? .atkinson : kindId.contains("FLOYD") ? .floyd : .threshold
                var bitmap = LabelBitmap.fromRaster(img.rgba, sourceWidth: img.width, sourceHeight: img.height, width: drawnW, height: drawnH,
                                                    dither: dither, brightness: cfg["brightness"].isNumber ?? 0)
                var w = drawnW, h = drawnH
                if b.turn == 90 || b.turn == 270, let bytes = LabelBitmap.bytes(bitmap, width: drawnW, height: drawnH) {
                    let r = LabelBitmap.rotate(bytes, width: drawnW, height: drawnH, turns: b.turn == 90 ? 1 : 3)
                    bitmap = LabelBitmap.base64Encode(r.bytes)
                    w = r.width; h = r.height
                }
                var f = base(b, .image, "Picture")
                f.width = w
                f.height = h
                f.bitmap = bitmap
                f.dither = dither.rawValue
                if b.turn == 180 { f.rotation = 180 }
                if src.utf16.count <= maxSource { f.source = src }
                push(f, b)
            } else if kind == "ELEMENT_SHAPE_LINE" {
                if invisible(coalesce(cfg["stroke"], fo["stroke"]), labelFill) { continue }
                // Straight lines only: a horizontal or a vertical one becomes a filled bar of its stroke's width, around the line's centre.
                let b = boxOf(fo, W, H, widthOf, heightOf)
                let thick = max(1, ri(cfg["strokeWidth"].num(fo["strokeWidth"].num(1))))
                let horizontal = b.h < 0.5, vertical = b.w < 0.5
                if horizontal == vertical { continue }
                let bw = max(1, ri(horizontal ? b.w : Double(thick))), bh = max(1, ri(horizontal ? Double(thick) : b.h))
                var f = base(b, .line, "Line")
                f.x = ri(b.cx - Double(bw) / 2)
                f.y = ri(b.cy - Double(bh) / 2)
                f.width = bw
                f.height = bh
                push(f, b)
            } else if kind == "ELEMENT_SHAPE_RECT" || kind == "ELEMENT_SHAPE_ELLIPSE" || kind == "ELEMENT_SHAPE_CIRCLE" {
                let fillShown = !invisible(coalesce(cfg["fill"], fo["fill"]), labelFill)
                let strokeShown = !invisible(coalesce(cfg["stroke"], fo["stroke"]), labelFill) && cfg["strokeWidth"].num(fo["strokeWidth"].num(0)) > 0
                if !fillShown && !strokeShown { continue }
                let rx = fo["rx"].num(), ry = fo["ry"].num(), radius = fo["radius"].num()
                let isRect = kind == "ELEMENT_SHAPE_RECT"
                let ew = isRect ? widthOf : (widthOf != 0 ? widthOf : (rx * 2 != 0 ? rx * 2 : radius * 2))
                let eh = isRect ? heightOf : (heightOf != 0 ? heightOf : (ry * 2 != 0 ? ry * 2 : radius * 2))
                let b = boxOf(fo, W, H, ew, eh)
                var f = base(b, isRect ? .box : .ellipse, isRect ? "Box" : "Ellipse")
                f.width = max(1, ri(b.w))
                f.height = max(1, ri(b.h))
                if fillShown { f.fill = true } else { f.thickness = max(1, ri(cfg["strokeWidth"].num(fo["strokeWidth"].num(1)))) }
                if isRect && fo["rx"].num() > 0 {
                    let ratio = JS.round(fo["rx"].num() / (min(ew, eh) / 2) * 8)
                    f.rounding = ratio.isInfinite ? 8 : Int(clamp(ratio, 0, 8))
                }
                push(f, b)
            }
        }

        // A design of several tags names its variables `X_1`, `X_2`: the highest number is how many pieces a label takes.
        var tagsSeen = Set<Int>()
        for n in names {
            let s = Array(n.unicodeScalars)
            // `_(\d{1,2})$`: one or two digits after an underscore (three digits do not match).
            for width in [2, 1] where s.count > width && s[s.count - 1 - width] == "_" && (1...width).allSatisfy({ s[s.count - $0].value >= 48 && s[s.count - $0].value <= 57 }) {
                if let v = Int(String(String.UnicodeScalarView(s[(s.count - width)...]))), v > 0 { tagsSeen.insert(v) }
                break
            }
        }
        let tags = tagsSeen.count >= 2 ? min(12, tagsSeen.max()!) : 1

        // A QR or barcode whose text is one `{name}` that is not a variable of the design is a sample left in the file
        // (it would print the braces): it takes the SKU of the nearest text's tag instead.
        for k in fields.indices {
            let f = fields[k]
            guard f.type == .qr || f.type == .barcode, let data = f.data else { continue }
            let d = Array(data.unicodeScalars)
            guard d.count >= 2, d.first == "{", d.last == "}", !d[1..<(d.count - 1)].contains(where: { $0 == "{" || $0 == "}" }) else { continue }
            if names.contains(String(String.UnicodeScalarView(d[1..<(d.count - 1)]))) { continue }
            var tag = 0, best = Double.infinity
            for j in fields.indices where fields[j].type == .text {
                guard let n = firstTagNumber(fields[j].data ?? "") else { continue }
                let dist = pow(centres[j].0 - centres[k].0, 2) + pow(centres[j].1 - centres[k].1, 2)
                if dist < best { best = dist; tag = n }
            }
            fields[k].data = tags > 1 && tag > 0 ? "{SKU_\(tag)}" : "{sku}"
        }

        var layout = LabelLayout(id: id ?? "lsc-import", name: name ?? "Imported design", widthDots: ri(W), heightDots: ri(H),
                                 dpi: [203.0, 300.0, 600.0].contains(dpi) ? Int(dpi) : 203, fields: fields)
        if tags > 1 { layout.tags = tags }
        let pc = lc["printerConfig"]
        var printer = LabelPrinterSettings()
        let thermal = pc["THERMAL_MODE"].str.uppercased()
        if thermal.hasSuffix("TRANSFER") { printer.thermal = "transfer" } else if thermal.hasSuffix("DIRECT") { printer.thermal = "direct" }
        let dark = JS.round(JS.parseFloat(pc["DARKNESS"].str))
        if dark.isFinite, dark >= 0, dark <= 30 { printer.darkness = Int(dark) }
        let speed = JS.round(JS.parseFloat(pc["SPEED"].str))
        if speed.isFinite, speed >= 2, speed <= 14 { printer.speed = Int(speed) }
        if !printer.isEmpty { layout.printer = printer }
        return layout
    }

    /// The `n` of the first `{…_n}` or `{…_n|…}` in a text (n of one or two digits), as TS `/\{[^{}]*_(\d{1,2})(?:\|[^{}]*)?\}/`.
    private static func firstTagNumber(_ text: String) -> Int? {
        let t = Array(text.unicodeScalars)
        var i = 0
        while i < t.count {
            guard t[i] == "{" else { i += 1; continue }
            var j = i + 1
            while j < t.count, t[j] != "}", t[j] != "{" { j += 1 }
            guard j < t.count, t[j] == "}" else { i += 1; continue }
            let inner = Array(t[(i + 1)..<j])
            // The last underscore with one or two digits after it that is followed by the end or a pipe.
            var u = inner.count - 1
            while u >= 0 {
                if inner[u] == "_" {
                    for width in [2, 1] where u + 1 + width <= inner.count && (u + 1..<u + 1 + width).allSatisfy({ inner[$0].value >= 48 && inner[$0].value <= 57 }) {
                        let after = u + 1 + width
                        if after == inner.count || inner[after] == "|" {
                            return Int(String(String.UnicodeScalarView(inner[(u + 1)..<after])))
                        }
                    }
                }
                u -= 1
            }
            i = j + 1
        }
        return nil
    }
}
