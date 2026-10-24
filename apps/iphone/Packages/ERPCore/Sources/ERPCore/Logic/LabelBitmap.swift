// Ported from src/lib/label-bitmap.ts (tests: LabelBitmapTests, label-bitmap.test.ts).
//
// Pictures on a tag, the way ZPL's ^GFA takes them: 1 bit a pixel, rows padded to whole bytes, 1 = black,
// kept in the layout as base64. Plain integer and Double arithmetic in the TypeScript's order, so the bits
// are the same ones the web makes. No Foundation base64: its rules for padding and spaces differ from ours.

import Foundation

public enum LabelBitmap {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)

    public static func base64Encode(_ bytes: [UInt8]) -> String {
        var out: [UInt8] = []
        var i = 0
        while i < bytes.count {
            let a = Int(bytes[i])
            let b = i + 1 < bytes.count ? Int(bytes[i + 1]) : 0
            let c = i + 2 < bytes.count ? Int(bytes[i + 2]) : 0
            out.append(alphabet[a >> 2])
            out.append(alphabet[((a & 3) << 4) | (b >> 4)])
            out.append(i + 1 < bytes.count ? alphabet[((b & 15) << 2) | (c >> 6)] : UInt8(ascii: "="))
            out.append(i + 2 < bytes.count ? alphabet[c & 63] : UInt8(ascii: "="))
            i += 3
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// The bytes of base64 text (white space ignored, padding optional); nil when anything else is in it.
    public static func base64Decode(_ text: String) -> [UInt8]? {
        var out: [UInt8] = []
        var acc = 0, bits = 0, pad = 0
        for ch in text.unicodeScalars {
            if ch == " " || ch == "\n" || ch == "\r" || ch == "\t" { continue }
            if ch == "=" { pad += 1; continue }
            if pad > 0 { return nil }
            guard ch.isASCII, let v = alphabet.firstIndex(of: UInt8(ch.value)) else { return nil }
            acc = (acc << 6) | v
            bits += 6
            if bits >= 8 { bits -= 8; out.append(UInt8((acc >> bits) & 255)); acc &= (1 << bits) - 1 }
        }
        return pad > 2 ? nil : out
    }

    public static func bytesPerRow(_ width: Int) -> Int { (width + 7) / 8 }

    /// The bitmap's bytes, padded with white or cut to exactly the size the picture needs; nil when it is not base64.
    public static func bytes(_ bitmap: String, width: Int, height: Int) -> [UInt8]? {
        guard let raw = base64Decode(bitmap) else { return nil }
        let total = bytesPerRow(width) * height
        var out = [UInt8](repeating: 0, count: max(0, total))
        for i in 0..<min(raw.count, out.count) { out[i] = raw[i] }
        return out
    }

    public static func hex(_ bytes: [UInt8]) -> String {
        let digits = Array("0123456789ABCDEF")
        var s = ""
        for b in bytes { s.append(digits[Int(b >> 4)]); s.append(digits[Int(b & 15)]) }
        return s
    }

    private static func bit(_ bytes: [UInt8], _ bpr: Int, _ x: Int, _ y: Int) -> Bool { (bytes[y * bpr + (x >> 3)] >> UInt8(7 - (x & 7))) & 1 == 1 }

    /// The picture turned a quarter turn clockwise `turns` times (0–3).
    public static func rotate(_ bytes: [UInt8], width: Int, height: Int, turns: Int) -> (bytes: [UInt8], width: Int, height: Int) {
        let t = ((turns % 4) + 4) % 4
        if t == 0 { return (bytes, width, height) }
        let bpr = bytesPerRow(width)
        let nw = t == 2 ? width : height, nh = t == 2 ? height : width
        let nbpr = bytesPerRow(nw)
        var out = [UInt8](repeating: 0, count: nbpr * nh)
        for y in 0..<height {
            for x in 0..<width where bit(bytes, bpr, x, y) {
                let nx = t == 1 ? height - 1 - y : t == 2 ? width - 1 - x : y
                let ny = t == 1 ? x : t == 2 ? height - 1 - y : width - 1 - x
                out[ny * nbpr + (nx >> 3)] |= UInt8(0x80 >> (nx & 7))
            }
        }
        return (out, nw, nh)
    }

    /// The ^GFA hex of a field's bitmap, turned half way when the field is; nil when it cannot be read.
    public static func hex(bitmap: String, width: Int, height: Int, rotate180: Bool) -> (hex: String, total: Int, bytesPerRow: Int)? {
        guard let b = bytes(bitmap, width: width, height: height) else { return nil }
        let r = rotate180 ? rotate(b, width: width, height: height, turns: 2).bytes : b
        return (hex(r), r.count, bytesPerRow(width))
    }

    public enum Dither: String { case threshold, atkinson, floyd }

    /// RGBA pixels → the bitmap (base64) at width × height dots. A pixel's grey is its luminance laid on white
    /// (alpha counts as white); a dot takes the average grey of the source pixels it covers.
    public static func fromRaster(_ rgba: [UInt8], sourceWidth sw: Int, sourceHeight sh: Int, width: Int, height: Int,
                                  dither: Dither = .threshold, threshold: Double? = nil, brightness: Double? = nil) -> String {
        var grey = [Double](repeating: 1, count: max(0, width * height))
        let lift = brightness.flatMap { $0.isFinite ? $0 : nil } ?? 0
        for ty in 0..<max(0, height) {
            let y0 = (ty * sh) / height, y1 = ((ty + 1) * sh + height - 1) / height
            for tx in 0..<max(0, width) {
                let x0 = (tx * sw) / width, x1 = ((tx + 1) * sw + width - 1) / width
                var sum = 0, count = 0
                var y = y0
                while y < y1 && y < sh {
                    var x = x0
                    while x < x1 && x < sw {
                        let i = (y * sw + x) * 4
                        let a = Int(rgba[i + 3])
                        let r = Int(rgba[i]) * a + 255 * (255 - a), g = Int(rgba[i + 1]) * a + 255 * (255 - a), b = Int(rgba[i + 2]) * a + 255 * (255 - a)
                        sum += 299 * r + 587 * g + 114 * b
                        count += 1
                        x += 1
                    }
                    y += 1
                }
                let g = count > 0 ? Double(sum) / (Double(count) * 65025000) : 1
                grey[ty * width + tx] = min(1, max(0, g + lift))
            }
        }
        let limit = threshold.flatMap { $0.isFinite ? $0 : nil } ?? 0.5
        let bpr = bytesPerRow(width)
        var out = [UInt8](repeating: 0, count: bpr * max(0, height))
        let spread: [(Int, Int, Double)]
        switch dither {
        case .atkinson: spread = [(1, 0, 1.0 / 8), (2, 0, 1.0 / 8), (-1, 1, 1.0 / 8), (0, 1, 1.0 / 8), (1, 1, 1.0 / 8), (0, 2, 1.0 / 8)]
        case .floyd: spread = [(1, 0, 7.0 / 16), (-1, 1, 3.0 / 16), (0, 1, 5.0 / 16), (1, 1, 1.0 / 16)]
        case .threshold: spread = []
        }
        for y in 0..<max(0, height) {
            for x in 0..<max(0, width) {
                let old = grey[y * width + x]
                let black = old < limit
                if black { out[y * bpr + (x >> 3)] |= UInt8(0x80 >> (x & 7)) }
                if !spread.isEmpty {
                    let err = old - (black ? 0 : 1)
                    for (dx, dy, w) in spread {
                        let nx = x + dx, ny = y + dy
                        if nx >= 0 && nx < width && ny < height { grey[ny * width + nx] += err * w }
                    }
                }
            }
        }
        return base64Encode(out)
    }
}
