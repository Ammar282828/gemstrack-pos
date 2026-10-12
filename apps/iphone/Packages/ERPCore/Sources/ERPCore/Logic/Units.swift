// Ported from src/lib/units.ts: weight, the way a Karachi jeweller talks about it. Everything is stored in
// grams; tola is how it is quoted. 11.664 g per tola is the one figure every screen reads.

import Foundation

public let gramsPerTola: Double = 11.664

public func toTola(_ grams: Double) -> Double { (grams.isNaN ? 0 : grams) / gramsPerTola }

/// `n.toLocaleString('en-US', { maximumFractionDigits })`: grouped, a half going up (ICU's), no trailing zeros.
private func localeNumber(_ x: Double, maxDigits: Int) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "en_US")
    f.numberStyle = .decimal
    f.roundingMode = .halfUp
    f.minimumFractionDigits = 0
    f.maximumFractionDigits = maxDigits
    return f.string(from: NSNumber(value: x)) ?? String(x)
}

/// "12.5 g · 1.072 tola": grams first because that is what was weighed.
public func formatWeight(_ grams: Double, tolaDigits: Int = 3, gramDigits: Int = 2) -> String {
    let g = grams.isNaN ? 0 : grams
    return "\(localeNumber(g, maxDigits: gramDigits)) g · \(localeNumber(toTola(g), maxDigits: tolaDigits)) tola"
}
