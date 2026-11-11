// Ported from src/app/website/weights/page.tsx (caratsText, caratsLine, parseCt) and the carats rules of
// src/lib/website/weights.ts (tests: PhotoCaratsTests). The owner, 2026-11-10: for diamond pieces the carats go right below the
// weight on the photo, smaller; a solitaire may have smaller diamonds beside it, drawn "0.50ct + 0.24ct".

import Foundation

public enum PhotoCarats {
    /// The weight's size and the carats' size on the site's 3000-unit photo (WeightLabel.jsx; the page's CT_SIZE).
    public static let weightSize = 143.0
    public static let caratsSize = 90.0
    /// The baseline of the weight and of the carats line under it, in the same 3000 units (page.tsx CT_BASELINE).
    public static let weightBaseline = 100.0 + 143.0 * 1.1
    public static let caratsBaseline = 100.0 + 143.0 * 1.1 + 90.0 * 1.3

    /// 0.5 -> "0.50ct".
    /// Rounded half up as JS's toFixed(2) does, not to even as printf would.
    public static func text(_ n: Double) -> String { String(format: "%.2f", JS.round(n * 100) / 100) + "ct" }

    /// The line under the weight: the solitaire's carats, then the smaller diamonds' after a plus ("0.50ct + 0.24ct"); a part
    /// that is not above 0 is left out, and "" when neither is.
    public static func line(main: Double, side: Double) -> String {
        var parts: [String] = []
        if main > 0 { parts.append(text(main)) }
        if side > 0 { parts.append(text(side)) }
        return parts.joined(separator: " + ")
    }

    /// What was typed in a carats field: nil when empty (cleared), else the number with a comma read as a point (NaN when it
    /// is not a number).
    public static func parse(_ typed: String) -> Double? {
        let t = typed.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return nil }
        return Double(t.replacingOccurrences(of: ",", with: ".")) ?? Double.nan
    }

    /// Whether a parsed field may be sent: empty, or above 0 and under 500 (the route's limit).
    public static func valid(_ v: Double?) -> Bool {
        guard let v else { return true }
        return v > 0 && v < 500
    }

    /// The carats as the route sends them: a number above 0, else nothing (the page's `|| null`).
    public static func recorded(_ v: Double?) -> Double? {
        guard let v, v > 0 else { return nil }
        return v
    }
}
