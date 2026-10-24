// Ported from src/lib/png-decode.ts (tests: LabelBitmapTests, label-bitmap.test.ts).
//
// A PNG's pixels without ImageIO (which Linux and the package's tests do not have): zlib's inflate (after
// Mark Adler's puff.c) and the five scanline filters. Every colour type and bit depth of a plain (not
// interlaced) PNG; anything else is nil, and the app can supply its own decoder to the Label LIVE import.

import Foundation

/// A picture's pixels, four bytes each (red, green, blue, alpha), row by row.
public struct DecodedImage: Hashable {
    public var width: Int
    public var height: Int
    public var rgba: [UInt8]

    public init(width: Int, height: Int, rgba: [UInt8]) {
        self.width = width
        self.height = height
        self.rgba = rgba
    }
}

public enum PNG {
    private static let lbase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lext = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let dbase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
    private static let dext = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    private static let clorder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
    /// The most a picture may unpack to.
    private static let maxOut = 64 * 1024 * 1024

    private struct Huffman { var count: [Int]; var symbol: [Int] }

    private static func construct(_ lengths: [Int], _ n: Int) -> Huffman? {
        var count = [Int](repeating: 0, count: 16)
        for i in 0..<n { count[lengths[i]] += 1 }
        var left = 1
        for len in 1..<16 { left <<= 1; left -= count[len]; if left < 0 { return nil } }
        var offs = [Int](repeating: 0, count: 16)
        for len in 1..<15 { offs[len + 1] = offs[len] + count[len] }
        var symbol = [Int](repeating: 0, count: n)
        for s in 0..<n where lengths[s] != 0 { symbol[offs[lengths[s]]] = s; offs[lengths[s]] += 1 }
        return Huffman(count: count, symbol: symbol)
    }

    private static let fixed: (Huffman, Huffman)? = {
        var l = [Int](repeating: 8, count: 288)
        for i in 144..<256 { l[i] = 9 }
        for i in 256..<280 { l[i] = 7 }
        guard let lit = construct(l, 288), let dist = construct([Int](repeating: 5, count: 30), 30) else { return nil }
        return (lit, dist)
    }()

    private struct Inflater {
        let src: [UInt8]
        var pos = 2
        var bitBuf = 0
        var bitCnt = 0
        var out: [UInt8] = []

        init(_ src: [UInt8]) { self.src = src }

        mutating func bits(_ need: Int) -> Int {
            var val = bitBuf
            while bitCnt < need {
                if pos >= src.count { return -1 }
                val |= Int(src[pos]) << bitCnt
                pos += 1
                bitCnt += 8
            }
            bitBuf = val >> need
            bitCnt -= need
            return val & ((1 << need) - 1)
        }

        mutating func decode(_ h: Huffman) -> Int {
            var code = 0, first = 0, index = 0
            for len in 1..<16 {
                let b = bits(1)
                if b < 0 { return -1 }
                code |= b
                let count = h.count[len]
                if code - count < first { return h.symbol[index + (code - first)] }
                index += count; first += count; first <<= 1; code <<= 1
            }
            return -1
        }

        mutating func codes(_ lit: Huffman, _ dist: Huffman) -> Bool {
            while true {
                var sym = decode(lit)
                if sym < 0 { return false }
                if sym < 256 { if out.count + 1 > PNG.maxOut { return false }; out.append(UInt8(sym)); continue }
                if sym == 256 { return true }
                sym -= 257
                if sym >= 29 { return false }
                let eb = bits(PNG.lext[sym])
                if eb < 0 { return false }
                let len = PNG.lbase[sym] + eb
                let ds = decode(dist)
                if ds < 0 || ds >= 30 { return false }
                let db = bits(PNG.dext[ds])
                if db < 0 { return false }
                let d = PNG.dbase[ds] + db
                if d > out.count || out.count + len > PNG.maxOut { return false }
                for _ in 0..<len { out.append(out[out.count - d]) }
            }
        }
    }

    /// The bytes inside a zlib stream (its 2-byte header skipped, its checksum not checked); nil when it is damaged.
    public static func inflate(_ src: [UInt8]) -> [UInt8]? {
        if src.count < 2 || (src[0] & 15) != 8 { return nil }
        var s = Inflater(src)
        while true {
            let last = s.bits(1), type = s.bits(2)
            if last < 0 || type < 0 { return nil }
            if type == 0 {
                s.bitBuf = 0; s.bitCnt = 0
                if s.pos + 4 > src.count { return nil }
                let len = Int(src[s.pos]) | (Int(src[s.pos + 1]) << 8)
                if (len ^ 0xffff) != (Int(src[s.pos + 2]) | (Int(src[s.pos + 3]) << 8)) { return nil }
                s.pos += 4
                if s.pos + len > src.count || s.out.count + len > maxOut { return nil }
                s.out.append(contentsOf: src[s.pos..<(s.pos + len)])
                s.pos += len
            } else if type == 1 {
                guard let f = fixed, s.codes(f.0, f.1) else { return nil }
            } else if type == 2 {
                let nlen = s.bits(5) + 257, ndist = s.bits(5) + 1, ncode = s.bits(4) + 4
                if nlen < 257 || ndist < 1 || ncode < 4 || nlen > 286 || ndist > 30 { return nil }
                var lengths = [Int](repeating: 0, count: 320)
                for i in 0..<ncode { let v = s.bits(3); if v < 0 { return nil }; lengths[clorder[i]] = v }
                guard let lencode = construct(lengths, 19) else { return nil }
                var index = 0
                lengths = [Int](repeating: 0, count: 320)
                while index < nlen + ndist {
                    let sym = s.decode(lencode)
                    if sym < 0 { return nil }
                    if sym < 16 { lengths[index] = sym; index += 1 } else {
                        var len = 0, rep: Int
                        if sym == 16 { if index == 0 { return nil }; len = lengths[index - 1]; rep = 3 + s.bits(2) }
                        else if sym == 17 { rep = 3 + s.bits(3) }
                        else { rep = 11 + s.bits(7) }
                        if rep < 3 || index + rep > nlen + ndist { return nil }
                        while rep > 0 { lengths[index] = len; index += 1; rep -= 1 }
                    }
                }
                if lengths[256] == 0 { return nil }
                guard let lit = construct(lengths, nlen), let dist = construct(Array(lengths[nlen...]), ndist), s.codes(lit, dist) else { return nil }
            } else { return nil }
            if last == 1 { break }
        }
        return s.out
    }

    private static func u32(_ b: [UInt8], _ i: Int) -> Int { (Int(b[i]) << 24) | (Int(b[i + 1]) << 16) | (Int(b[i + 2]) << 8) | Int(b[i + 3]) }

    /// A plain PNG as RGBA; nil for anything this does not read (interlaced, damaged, not a PNG).
    public static func decode(_ png: [UInt8]) -> DecodedImage? {
        let sig: [UInt8] = [137, 80, 78, 71, 13, 10, 26, 10]
        if png.count < 33 || Array(png[0..<8]) != sig { return nil }
        var width = 0, height = 0, depth = 0, ctype = -1, interlace = 0
        var palette: [Int] = [], trns: [Int] = []
        var idat: [UInt8] = []
        var pos = 8
        while pos + 8 <= png.count {
            let len = u32(png, pos)
            let name = String(decoding: png[(pos + 4)..<(pos + 8)], as: UTF8.self)
            if pos + 8 + len > png.count { return nil }
            let body = Array(png[(pos + 8)..<(pos + 8 + len)])
            if name == "IHDR" {
                if body.count < 13 { return nil }
                width = u32(body, 0); height = u32(body, 4); depth = Int(body[8]); ctype = Int(body[9]); interlace = Int(body[12])
            } else if name == "PLTE" { palette = body.map(Int.init) }
            else if name == "tRNS" { trns = body.map(Int.init) }
            else if name == "IDAT" { idat.append(contentsOf: body) }
            else if name == "IEND" { break }
            pos += 12 + len
        }
        guard let channels = [0: 1, 2: 3, 3: 1, 4: 2, 6: 4][ctype] else { return nil }
        if interlace != 0 || ![1, 2, 4, 8, 16].contains(depth) || width < 1 || height < 1 || width * height > 16_000_000 { return nil }
        if ctype == 3 && (depth == 16 || palette.count < 3) { return nil }
        if (ctype == 2 || ctype == 4 || ctype == 6) && depth < 8 { return nil }
        guard let raw = inflate(idat) else { return nil }
        let bitsPerPixel = channels * depth
        let rowBytes = (width * bitsPerPixel + 7) / 8
        let bpp = max(1, bitsPerPixel >> 3)
        if raw.count < (rowBytes + 1) * height { return nil }
        // Undo the filters, row by row.
        var pix = [UInt8](repeating: 0, count: rowBytes * height)
        for y in 0..<height {
            let ft = Int(raw[y * (rowBytes + 1)])
            let src = y * (rowBytes + 1) + 1, dst = y * rowBytes, up = dst - rowBytes
            for i in 0..<rowBytes {
                let a = i >= bpp ? Int(pix[dst + i - bpp]) : 0
                let b = y > 0 ? Int(pix[up + i]) : 0
                let c = y > 0 && i >= bpp ? Int(pix[up + i - bpp]) : 0
                var v = Int(raw[src + i])
                switch ft {
                case 0: break
                case 1: v += a
                case 2: v += b
                case 3: v += (a + b) >> 1
                case 4:
                    let p = a + b - c, pa = abs(p - a), pb = abs(p - b), pc = abs(p - c)
                    v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
                default: return nil
                }
                pix[dst + i] = UInt8(v & 255)
            }
        }
        func sample(_ row: Int, _ n: Int) -> Int {
            let base = row * rowBytes
            if depth == 8 { return Int(pix[base + n]) }
            if depth == 16 { return (Int(pix[base + n * 2]) << 8) | Int(pix[base + n * 2 + 1]) }
            let per = 8 / depth, shift = 8 - depth * ((n % per) + 1)
            return (Int(pix[base + n / per]) >> shift) & ((1 << depth) - 1)
        }
        let maxSample = (1 << depth) - 1
        func to8(_ v: Int) -> Int { depth == 8 ? v : depth == 16 ? v >> 8 : (v * 255) / maxSample }
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let o = (y * width + x) * 4
                var r = 0, g = 0, b = 0, a = 255
                switch ctype {
                case 0:
                    let v = sample(y, x)
                    r = to8(v); g = r; b = r
                    if trns.count >= 2 && v == ((trns[0] << 8) | trns[1]) { a = 0 }
                case 2:
                    let sr = sample(y, x * 3), sg = sample(y, x * 3 + 1), sb = sample(y, x * 3 + 2)
                    r = to8(sr); g = to8(sg); b = to8(sb)
                    if trns.count >= 6 && sr == ((trns[0] << 8) | trns[1]) && sg == ((trns[2] << 8) | trns[3]) && sb == ((trns[4] << 8) | trns[5]) { a = 0 }
                case 3:
                    let i = sample(y, x)
                    r = i * 3 < palette.count ? palette[i * 3] : 0
                    g = i * 3 + 1 < palette.count ? palette[i * 3 + 1] : 0
                    b = i * 3 + 2 < palette.count ? palette[i * 3 + 2] : 0
                    if i < trns.count { a = trns[i] }
                case 4:
                    r = to8(sample(y, x * 2)); g = r; b = r
                    a = to8(sample(y, x * 2 + 1))
                default:
                    r = to8(sample(y, x * 4)); g = to8(sample(y, x * 4 + 1)); b = to8(sample(y, x * 4 + 2)); a = to8(sample(y, x * 4 + 3))
                }
                rgba[o] = UInt8(r); rgba[o + 1] = UInt8(g); rgba[o + 2] = UInt8(b); rgba[o + 3] = UInt8(a)
            }
        }
        return DecodedImage(width: width, height: height, rgba: rgba)
    }

    /// The bytes of `data:image/…;base64,…`; nil when it is not one.
    public static func dataURLBytes(_ url: String) -> [UInt8]? {
        let chars = Array(url.unicodeScalars)
        let prefix = "data:image/".unicodeScalars.count
        guard chars.count > prefix, String(String.UnicodeScalarView(chars[0..<prefix])).lowercased() == "data:image/" else { return nil }
        var i = prefix
        while i < chars.count && chars[i] != ";" && chars[i] != "," { i += 1 }
        let marker = ";base64,".unicodeScalars.count
        guard i + marker <= chars.count, String(String.UnicodeScalarView(chars[i..<(i + marker)])).lowercased() == ";base64," else { return nil }
        return LabelBitmap.base64Decode(String(String.UnicodeScalarView(chars[(i + marker)...])))
    }

    /// `data:image/png;base64,…` (any image type in the header) → the PNG it holds; nil when it is not one.
    public static func decodeDataURL(_ url: String) -> DecodedImage? {
        dataURLBytes(url).flatMap(decode)
    }
}
