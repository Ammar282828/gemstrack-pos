import Foundation

// The shop's tag (src/lib/label-layout.ts `StoredLabelLayout`), kept in settings as `labelLayout`: the label's size
// in printer dots, and the fields on it. Decoded leniently like every model here; encoded to the same JSON the web
// stores (a key is left out when the value is not set), so a layout saved from the phone is the browser's too.
//
// Every position is in dots from the label's TOP-LEFT; a field's x, y is the corner of its rotated box (^FO).
// The ZPL a layout prints as is Logic/Zpl.swift; a Label LIVE design becomes one in Logic/LabelLSC.swift.
//
// Named `LabelLayoutField`, not the TypeScript's `LabelField`, because `LabelField` is already the Label LIVE
// piece-field list (LabelLive.labelFields).

public enum LabelFieldType: String, Hashable, CaseIterable {
    case text, qr, barcode, line, box, ellipse, image
}

/// What the printer is told before each label (TS `LabelPrinterSettings`). The words are the TypeScript's:
/// thermal `transfer`/`direct`; mode `tear`/`peel`/`cutter`/`rewind`/`delayed-cut`; media `gap`/`mark`/`continuous`;
/// orientation `normal`/`inverted`. A word it does not know is kept and simply not sent.
public struct LabelPrinterSettings: Hashable {
    public var thermal: String?
    public var mode: String?
    public var media: String?
    /// 0–30 (~SD).
    public var darkness: Int?
    /// Inches a second, 2–14 (^PR).
    public var speed: Int?
    /// -120...120 (^LT).
    public var labelTop: Int?
    /// -9999...9999 (^LS).
    public var labelShift: Int?
    /// -120...120 (~TA).
    public var tearOff: Int?
    public var orientation: String?
    public var mirror: Bool?
    public var homeX: Int?
    public var homeY: Int?

    public init(thermal: String? = nil, mode: String? = nil, media: String? = nil, darkness: Int? = nil, speed: Int? = nil,
                labelTop: Int? = nil, labelShift: Int? = nil, tearOff: Int? = nil, orientation: String? = nil,
                mirror: Bool? = nil, homeX: Int? = nil, homeY: Int? = nil) {
        self.thermal = thermal; self.mode = mode; self.media = media; self.darkness = darkness; self.speed = speed
        self.labelTop = labelTop; self.labelShift = labelShift; self.tearOff = tearOff; self.orientation = orientation
        self.mirror = mirror; self.homeX = homeX; self.homeY = homeY
    }

    public var isEmpty: Bool { self == LabelPrinterSettings() }
}

extension LabelPrinterSettings: Codable {
    private enum K: String, CodingKey {
        case thermal, mode, media, darkness, speed, labelTop, labelShift, tearOff, orientation, mirror, homeX, homeY
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        thermal = c.string(.thermal); mode = c.string(.mode); media = c.string(.media)
        darkness = c.dots(.darkness); speed = c.dots(.speed); labelTop = c.dots(.labelTop); labelShift = c.dots(.labelShift)
        tearOff = c.dots(.tearOff); orientation = c.string(.orientation); mirror = c.bool(.mirror)
        homeX = c.dots(.homeX); homeY = c.dots(.homeY)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encodeIfPresent(thermal, forKey: .thermal); try c.encodeIfPresent(mode, forKey: .mode); try c.encodeIfPresent(media, forKey: .media)
        try c.encodeIfPresent(darkness, forKey: .darkness); try c.encodeIfPresent(speed, forKey: .speed)
        try c.encodeIfPresent(labelTop, forKey: .labelTop); try c.encodeIfPresent(labelShift, forKey: .labelShift)
        try c.encodeIfPresent(tearOff, forKey: .tearOff); try c.encodeIfPresent(orientation, forKey: .orientation)
        try c.encodeIfPresent(mirror, forKey: .mirror); try c.encodeIfPresent(homeX, forKey: .homeX); try c.encodeIfPresent(homeY, forKey: .homeY)
    }
}

/// One field on the tag (TS `LabelField`). Which properties matter depends on `type`; the rest stay nil.
public struct LabelLayoutField: Identifiable, Hashable {
    public var id: String
    public var type: LabelFieldType
    public var x: Int
    public var y: Int
    /// 0, 90, 180 or 270, clockwise.
    public var rotation: Int
    /// text, qr, barcode: may hold `{placeholders}`; text may hold new lines.
    public var data: String?
    /// The designer's: a hidden field is skipped on print.
    public var hidden: Bool
    /// The designer's: it cannot be dragged.
    public var locked: Bool
    /// The designer's: a name for the layers list.
    public var name: String?

    // text
    public var fontFamily: String?
    /// Dots; 20 when unset.
    public var fontSize: Int?
    /// text: with a width the text wraps and aligns in a block. line, box, ellipse, image: the size.
    public var width: Int?
    public var lines: Int?
    public var lineSpacing: Int?
    /// "L", "C" or "R".
    public var align: String?
    public var bold: Bool?

    // qr
    public var qrMagnification: Int?
    /// "L", "M", "Q" or "H".
    public var errorCorrection: String?

    // barcode
    /// "code128" (when unset), "code39", "ean13", "upca", "datamatrix" or "pdf417".
    public var symbology: String?
    public var height: Int?
    public var moduleWidth: Int?
    public var showText: Bool?

    // line, box, ellipse
    public var thickness: Int?
    public var rounding: Int?
    public var fill: Bool?

    // image
    /// Base64 of the monochrome picture, 1 bit a pixel, rows padded to whole bytes, 1 = black.
    public var bitmap: String?
    /// "threshold", "atkinson" or "floyd".
    public var dither: String?
    public var threshold: Double?
    /// The PNG data URL it was made from, kept only when under 64 KB.
    public var source: String?

    public init(id: String, type: LabelFieldType, x: Int = 0, y: Int = 0, rotation: Int = 0, data: String? = nil, hidden: Bool = false,
                locked: Bool = false, name: String? = nil, fontFamily: String? = nil, fontSize: Int? = nil, width: Int? = nil,
                lines: Int? = nil, lineSpacing: Int? = nil, align: String? = nil, bold: Bool? = nil, qrMagnification: Int? = nil,
                errorCorrection: String? = nil, symbology: String? = nil, height: Int? = nil, moduleWidth: Int? = nil,
                showText: Bool? = nil, thickness: Int? = nil, rounding: Int? = nil, fill: Bool? = nil, bitmap: String? = nil,
                dither: String? = nil, threshold: Double? = nil, source: String? = nil) {
        self.id = id; self.type = type; self.x = x; self.y = y; self.rotation = rotation; self.data = data; self.hidden = hidden
        self.locked = locked; self.name = name; self.fontFamily = fontFamily; self.fontSize = fontSize; self.width = width
        self.lines = lines; self.lineSpacing = lineSpacing; self.align = align; self.bold = bold
        self.qrMagnification = qrMagnification; self.errorCorrection = errorCorrection; self.symbology = symbology
        self.height = height; self.moduleWidth = moduleWidth; self.showText = showText; self.thickness = thickness
        self.rounding = rounding; self.fill = fill; self.bitmap = bitmap; self.dither = dither; self.threshold = threshold
        self.source = source
    }

    /// The designer's "Add Text Field".
    public init(newTextAt now: Date = Date()) {
        self.init(id: "field-\(Int(now.timeIntervalSince1970 * 1000))", type: .text, x: 10, y: 10, data: "New text", fontSize: 20)
    }
}

extension LabelLayoutField: Codable {
    private enum K: String, CodingKey {
        case id, type, x, y, rotation, data, hidden, locked, name
        case fontFamily, fontSize, width, lines, lineSpacing, align, bold
        case qrMagnification, errorCorrection
        case symbology, height, moduleWidth, showText
        case thickness, rounding, fill
        case bitmap, dither, threshold, source
    }

    /// A field of a type this does not know fails to decode, and a list of fields drops it.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        guard let kind = c.string(.type).flatMap(LabelFieldType.init(rawValue:)) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown field type"))
        }
        id = c.string(.id) ?? ""
        type = kind
        x = c.dots(.x) ?? 0
        y = c.dots(.y) ?? 0
        let turn = c.dots(.rotation) ?? 0
        rotation = [90, 180, 270].contains(turn) ? turn : 0
        data = c.string(.data)
        hidden = c.bool(.hidden) ?? false
        locked = c.bool(.locked) ?? false
        name = c.string(.name)
        fontFamily = c.string(.fontFamily); fontSize = c.dots(.fontSize); width = c.dots(.width); lines = c.dots(.lines)
        lineSpacing = c.dots(.lineSpacing); align = c.string(.align); bold = c.bool(.bold)
        qrMagnification = c.dots(.qrMagnification); errorCorrection = c.string(.errorCorrection)
        symbology = c.string(.symbology); height = c.dots(.height); moduleWidth = c.dots(.moduleWidth); showText = c.bool(.showText)
        thickness = c.dots(.thickness); rounding = c.dots(.rounding); fill = c.bool(.fill)
        bitmap = c.string(.bitmap); dither = c.string(.dither); threshold = c.double(.threshold); source = c.string(.source)
    }

    /// As the web stores it: a rotation of 0 and the designer's flags when off are left out.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(id, forKey: .id)
        try c.encode(type.rawValue, forKey: .type)
        try c.encode(x, forKey: .x)
        try c.encode(y, forKey: .y)
        if rotation != 0 { try c.encode(rotation, forKey: .rotation) }
        try c.encodeIfPresent(data, forKey: .data)
        if hidden { try c.encode(true, forKey: .hidden) }
        if locked { try c.encode(true, forKey: .locked) }
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(fontFamily, forKey: .fontFamily); try c.encodeIfPresent(fontSize, forKey: .fontSize)
        try c.encodeIfPresent(width, forKey: .width); try c.encodeIfPresent(lines, forKey: .lines)
        try c.encodeIfPresent(lineSpacing, forKey: .lineSpacing); try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(bold, forKey: .bold)
        try c.encodeIfPresent(qrMagnification, forKey: .qrMagnification); try c.encodeIfPresent(errorCorrection, forKey: .errorCorrection)
        try c.encodeIfPresent(symbology, forKey: .symbology); try c.encodeIfPresent(height, forKey: .height)
        try c.encodeIfPresent(moduleWidth, forKey: .moduleWidth); try c.encodeIfPresent(showText, forKey: .showText)
        try c.encodeIfPresent(thickness, forKey: .thickness); try c.encodeIfPresent(rounding, forKey: .rounding)
        try c.encodeIfPresent(fill, forKey: .fill)
        try c.encodeIfPresent(bitmap, forKey: .bitmap); try c.encodeIfPresent(dither, forKey: .dither)
        try c.encodeIfPresent(threshold, forKey: .threshold); try c.encodeIfPresent(source, forKey: .source)
    }
}

/// The tag (TS `StoredLabelLayout`): its size in dots and its fields.
public struct LabelLayout: Hashable {
    public var id: String
    public var name: String
    public var widthDots: Int
    public var heightDots: Int
    /// 203 when unset; 300 and 600 are allowed.
    public var dpi: Int?
    /// Pieces to a label: 1 when unset, 2 for a double (butterfly) tag.
    public var tags: Int?
    public var printer: LabelPrinterSettings?
    public var fields: [LabelLayoutField]

    public init(id: String, name: String, widthDots: Int, heightDots: Int, dpi: Int? = nil, tags: Int? = nil,
                printer: LabelPrinterSettings? = nil, fields: [LabelLayoutField] = []) {
        self.id = id; self.name = name; self.widthDots = widthDots; self.heightDots = heightDots
        self.dpi = dpi; self.tags = tags; self.printer = printer; self.fields = fields
    }

    /// The Zebra 2000T's dumbbell jewellery tag, 83 × 37 mm (TS `STANDARD_LABEL_LAYOUT`): the SKU up the left, its QR on the right.
    public static let standard = LabelLayout(
        id: "zebra-2000t-jewellery", name: "Zebra 2000T Jewellery Tag (83x37mm)", widthDots: 664, heightDots: 296,
        fields: [
            LabelLayoutField(id: "sku-left", type: .text, x: 100, y: 150, rotation: 90, data: "SKU: {sku}", fontSize: 20),
            LabelLayoutField(id: "qr-right", type: .qr, x: 450, y: 80, data: "{sku}", qrMagnification: 4),
        ])

    /// Pieces to a label (1…12).
    public var tagsPerLabel: Int {
        guard let n = tags, n >= 1 else { return 1 }
        return min(12, n)
    }

    /// A layout that can be drawn and printed: it has a size.
    public var hasSize: Bool { widthDots > 0 && heightDots > 0 }

    /// The printer options with the older top-level darkness and speed folded in (`printer` wins).
    public var effectivePrinter: LabelPrinterSettings { printer ?? LabelPrinterSettings() }
}

extension LabelLayout: Codable {
    private enum K: String, CodingKey { case id, name, widthDots, heightDots, dpi, tags, darkness, speed, printer, fields }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        name = c.string(.name, default: "")
        widthDots = c.dots(.widthDots) ?? 0
        heightDots = c.dots(.heightDots) ?? 0
        dpi = c.dots(.dpi)
        tags = c.dots(.tags)
        var p: LabelPrinterSettings? = c.object(.printer)
        // Older layouts kept darkness and speed at the top: `printer` says it when it has them, else they move in.
        let darkness = c.dots(.darkness), speed = c.dots(.speed)
        if p?.darkness == nil, let darkness { p = p ?? LabelPrinterSettings(); p?.darkness = darkness }
        if p?.speed == nil, let speed { p = p ?? LabelPrinterSettings(); p?.speed = speed }
        printer = p
        fields = c.list(.fields, of: LabelLayoutField.self).filter { !$0.id.isEmpty }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(widthDots, forKey: .widthDots)
        try c.encode(heightDots, forKey: .heightDots)
        try c.encodeIfPresent(dpi, forKey: .dpi)
        try c.encodeIfPresent(tags, forKey: .tags)
        if let printer, !printer.isEmpty { try c.encode(printer, forKey: .printer) }
        try c.encode(fields, forKey: .fields)
    }
}

// MARK: Saving it

extension LabelLayout {
    /// The ERP's name for the write that saves a layout (/api/app/write, src/lib/writes/label-layout.ts).
    public static let saveOp = "saveLabelLayout"

    /// The layout as the web stores it, a JSON dictionary the write takes as `layout`.
    public var json: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return object
    }

    /// The fields `saveLabelLayout` expects: `layout`, and `seq` that makes each save its own (a field moved and moved
    /// back is a new change, not one sent twice). `Outbox.shared.send(op: LabelLayout.saveOp, fields: layout.saveFields(), …)`.
    public func saveFields(seq: String = UUID().uuidString) -> [String: Any] {
        ["layout": json, "seq": seq]
    }
}

// MARK: Reading numbers

extension KeyedDecodingContainer {
    /// A whole number of dots from a number or a numeric text: halves go up as `Math.round` has them, and an absurd
    /// size is held to a million (the write refuses anything over 8000 anyway).
    func dots(_ key: Key) -> Int? {
        guard let d = double(key) else { return nil }
        return Int(min(1_000_000, max(-1_000_000, JS.round(d))))
    }
}
