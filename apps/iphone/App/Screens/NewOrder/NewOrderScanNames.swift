import Foundation

// A name read off paper, ranked against the book and offered, never decided: src/lib/voice/phonetics.ts
// (`phoneticKey`, `nameScore`, `rankNames`) and the scanners' `guessName` (lib/vision/order-draft.ts,
// `guessCustomer` in bill-draft.ts), ported line for line so the phone ranks a slip's "Alifya" exactly as
// the browser does. Shared by Read a slip (New order) and Read a written bill (New sale).
//
// The bar is higher than voice's: a slip gives the matcher a few characters of somebody's shorthand, and a
// wrong karigar on an order is gold leaving the shop in the wrong direction. Only a clear winner is pinned;
// anything short of that comes back as candidates for a person to pick from.

/// Someone in the book a name is matched against (phonetics.ts `RosterEntry`).
struct PaperPerson: Equatable, Hashable {
    let id: String
    let name: String
}

/// One of the book, with how well the name read off the paper matches it.
struct PaperRankedName: Equatable, Hashable {
    let id: String
    let name: String
    let score: Double
}

/// A name read off paper (order-draft.ts `NameGuess`): what was written, the one person it surely is (only a
/// clear winner), and who else it might be. `pinned` is the person's choice from then on ("Not them", "Which one?").
struct PaperNameGuess: Equatable {
    let heard: String
    var pinned: PaperRankedName?
    let candidates: [PaperRankedName]
}

enum PaperNames {
    /// `guessName`: pinned at 0.88 and 0.15 clear of the next; candidates over 0.45, five at most.
    static func guess(_ heard: String?, pool: [PaperPerson]) -> PaperNameGuess? {
        let text = (heard ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        let ranked = rank(text, pool)
        let top = ranked.first
        let next = ranked.count > 1 ? ranked[1] : nil
        var decisive = false
        if let top, top.score >= 0.88 {
            decisive = next.map { top.score - $0.score >= 0.15 } ?? true
        }
        return PaperNameGuess(
            heard: text,
            pinned: decisive ? top : nil,
            candidates: Array(ranked.filter { $0.score > 0.45 }.prefix(5))
        )
    }

    /// `rankNames` (no learned aliases: a slip's names are never taught). Best first; equal scores keep the
    /// book's order, as the browser's stable sort does.
    static func rank(_ query: String, _ roster: [PaperPerson]) -> [PaperRankedName] {
        roster.enumerated()
            .map { (i, r) in (i, PaperRankedName(id: r.id, name: r.name, score: nameScore(query, r.name))) }
            .sorted { $0.1.score != $1.1.score ? $0.1.score > $1.1.score : $0.0 < $1.0 }
            .map { $0.1 }
    }

    // MARK: The sound of a name

    /// Sound-alike pairs that genuinely occur when these names are written in Latin script (`tokenKey`).
    static func tokenKey(_ word: String) -> String {
        var s = word
        // Aspirated consonants lose the h — Khan/Kan, Ghulam/Gulam, Bhai/Bai
        s = s.replacingOccurrences(of: "ph", with: "f")
        s = replace(aspirate, in: s, with: "$1")
        // Spelling variants for the same sound
        s = s.replacingOccurrences(of: "ck", with: "k").replacingOccurrences(of: "q", with: "k").replacingOccurrences(of: "x", with: "ks")
        s = s.replacingOccurrences(of: "w", with: "v") // Wala/Vala, Anwar/Anvar
        s = s.replacingOccurrences(of: "z", with: "j") // Zainab/Jainab — z is commonly voiced as j in Gujarati
        s = s.replacingOccurrences(of: "y", with: "i")
        // Long vowels are written doubled or singly at random — Batool/Batul, Sakeena/Sakina
        s = s.replacingOccurrences(of: "aa", with: "a").replacingOccurrences(of: "ee", with: "i").replacingOccurrences(of: "oo", with: "u")
        s = s.replacingOccurrences(of: "ai", with: "e").replacingOccurrences(of: "au", with: "o").replacingOccurrences(of: "ou", with: "u")
        s = replace(doubled, in: s, with: "$1") // Abbas/Abas, Shabbir/Shabir
        s = replace(finalH, in: s, with: "") // Fatemah/Fatema
        s = replace(finalVowel, in: s, with: "a") // Fateme/Fatema
        return s
    }

    private static let aspirate = try! NSRegularExpression(pattern: "([kgbdtjcs])h")
    private static let doubled = try! NSRegularExpression(pattern: "(.)\\1+")
    private static let finalH = try! NSRegularExpression(pattern: "h$")
    private static let finalVowel = try! NSRegularExpression(pattern: "[ae]$")

    private static func replace(_ re: NSRegularExpression, in s: String, with template: String) -> String {
        re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: template)
    }

    /// The same names in the scripts they are also spoken and written in (Urdu and Arabic, Gujarati, Devanagari),
    /// by code point (`SCRIPTS`), deliberately rough: close enough for the sound rules to do their work.
    private static let scripts: [UInt32: String] = [
        0x0627: "a", 0x0622: "a", 0x0623: "a", 0x0625: "a", 0x0628: "b", 0x067E: "p", 0x062A: "t", 0x0679: "t",
        0x062B: "s", 0x062C: "j", 0x0686: "ch", 0x062D: "h", 0x062E: "kh", 0x062F: "d", 0x0688: "d", 0x0630: "z",
        0x0631: "r", 0x0691: "r", 0x0632: "z", 0x0698: "zh", 0x0633: "s", 0x0634: "sh", 0x0635: "s", 0x0636: "z",
        0x0637: "t", 0x0638: "z", 0x0639: "a", 0x063A: "gh", 0x0641: "f", 0x0642: "k", 0x06A9: "k", 0x0643: "k",
        0x06AF: "g", 0x0644: "l", 0x0645: "m", 0x0646: "n", 0x06BA: "n", 0x0648: "o", 0x06C1: "h", 0x0647: "h",
        0x06BE: "h", 0x06CC: "i", 0x064A: "i", 0x06D2: "e", 0x0A85: "a", 0x0A86: "a", 0x0A87: "i", 0x0A88: "i",
        0x0A89: "u", 0x0A8A: "u", 0x0A8F: "e", 0x0A90: "ai", 0x0A93: "o", 0x0A94: "au", 0x0A95: "k", 0x0A96: "kh",
        0x0A97: "g", 0x0A98: "gh", 0x0A9A: "ch", 0x0A9B: "ch", 0x0A9C: "j", 0x0A9D: "jh", 0x0A9F: "t", 0x0AA0: "th",
        0x0AA1: "d", 0x0AA2: "dh", 0x0AA3: "n", 0x0AA4: "t", 0x0AA5: "th", 0x0AA6: "d", 0x0AA7: "dh", 0x0AA8: "n",
        0x0AAA: "p", 0x0AAB: "f", 0x0AAC: "b", 0x0AAD: "bh", 0x0AAE: "m", 0x0AAF: "y", 0x0AB0: "r", 0x0AB2: "l",
        0x0AB3: "l", 0x0AB5: "v", 0x0AB6: "sh", 0x0AB7: "sh", 0x0AB8: "s", 0x0AB9: "h", 0x0ABE: "a", 0x0ABF: "i",
        0x0AC0: "i", 0x0AC1: "u", 0x0AC2: "u", 0x0AC7: "e", 0x0AC8: "ai", 0x0ACB: "o", 0x0ACC: "au", 0x0ACD: "",
        0x0A82: "n", 0x0905: "a", 0x0906: "a", 0x0907: "i", 0x0908: "i", 0x0909: "u", 0x090A: "u", 0x090F: "e",
        0x0910: "ai", 0x0913: "o", 0x0914: "au", 0x0915: "k", 0x0916: "kh", 0x0917: "g", 0x0918: "gh", 0x091A: "ch",
        0x091B: "ch", 0x091C: "j", 0x091D: "jh", 0x091F: "t", 0x0920: "th", 0x0921: "d", 0x0922: "dh", 0x0923: "n",
        0x0924: "t", 0x0925: "th", 0x0926: "d", 0x0927: "dh", 0x0928: "n", 0x092A: "p", 0x092B: "f", 0x092C: "b",
        0x092D: "bh", 0x092E: "m", 0x092F: "y", 0x0930: "r", 0x0932: "l", 0x0935: "v", 0x0936: "sh", 0x0937: "sh",
        0x0938: "s", 0x0939: "h", 0x093E: "a", 0x093F: "i", 0x0940: "i", 0x0941: "u", 0x0942: "u", 0x0947: "e",
        0x0948: "ai", 0x094B: "o", 0x094C: "au", 0x094D: "", 0x0902: "n",
    ]

    /// Anything outside Latin (U+0020–U+024F) is read through `scripts`, else becomes a space. By code point, as
    /// the browser's /u regex walks it: a Gujarati vowel sign is its own letter here, not part of the one before.
    private static func transliterate(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            if (0x20...0x24F).contains(u.value) {
                out.append(u)
            } else {
                out.append(contentsOf: (scripts[u.value] ?? " ").unicodeScalars)
            }
        }
        return String(out)
    }

    /// JavaScript's `\s`.
    private static func isSpace(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    /// `phoneticKey`: the name's words, each reduced to its sound.
    static func phoneticKey(_ name: String?) -> [String] {
        let lower = transliterate(name ?? "").lowercased().decomposedStringWithCanonicalMapping
        var base = String.UnicodeScalarView()
        for u in lower.unicodeScalars {
            if (0x300...0x36F).contains(u.value) { continue }
            if (0x61...0x7A).contains(u.value) || isSpace(u) { base.append(u) } else { base.append(" ") }
        }
        return String(base).unicodeScalars
            .split(whereSeparator: isSpace)
            .map { tokenKey(String(String.UnicodeScalarView($0))) }
            .filter { !$0.isEmpty }
    }

    // MARK: How alike two names are

    /// Edit distance over the keys' letters (they are a–z only by now).
    private static func levenshtein(_ a: [UInt8], _ b: [UInt8]) -> Int {
        if a == b { return 0 }
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        for i in 0..<a.count {
            var cur = [i + 1]
            cur.reserveCapacity(b.count + 1)
            for j in 0..<b.count {
                cur.append(min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] == b[j] ? 0 : 1)))
            }
            prev = cur
        }
        return prev[b.count]
    }

    private static func ratio(_ a: String, _ b: String) -> Double {
        let x = Array(a.utf8), y = Array(b.utf8)
        if x.isEmpty && y.isEmpty { return 1 }
        return 1 - Double(levenshtein(x, y)) / Double(max(x.count, y.count))
    }

    /// `nameScore`: token by token. Every word written must find a home in the stored name (a word with nowhere
    /// to go pulls the score down); the stored name's own extra words are only lightly penalised, since a slip
    /// often carries part of a name ("Fatema" for "Fatema Bakir Abuwala").
    static func nameScore(_ query: String, _ candidate: String) -> Double {
        let q = phoneticKey(query)
        let c = phoneticKey(candidate)
        if q.isEmpty || c.isEmpty { return 0 }
        var pool = c
        var total = 0.0
        for qt in q {
            var best = 0.0
            var bestAt = -1
            for (i, ct) in pool.enumerated() {
                let r = ratio(qt, ct)
                if r > best {
                    best = r
                    bestAt = i
                }
            }
            if bestAt >= 0 && best > 0.5 { pool.remove(at: bestAt) }
            total += best
        }
        let covered = total / Double(q.count)
        // Matching one token of a three-token name is weaker evidence than matching all of them.
        let completeness = 1 - (Double(pool.count) / Double(c.count)) * 0.25
        return max(0, min(1, covered * completeness))
    }
}
