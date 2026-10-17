// Ported from src/lib/website/site-weight.ts (tests: SiteWeightTests): a weight typed on a Posts card, whether the
// website should keep it, and whether it is the post's own. taheri.shop's own photographs only, and only where the
// site has none: a weight already on the site is never changed from a post (Website → Weights changes it).

import Foundation

/// A weight as typed ("3.84", "12"): a positive number, or nothing.
public func validWeight(_ w: String) -> Bool {
    let t = JS.trim(w)
    guard !t.isEmpty, t.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil else { return false }
    return JS.toNumber(w) > 0
}

/// The weight the website should keep for this piece: typed for one of taheri.shop's own photographs
/// (`source` "attributes") that has none, to two places; nil otherwise.
public func weightForSite(source: String?, siteGrams: Double?, typed: String) -> Double? {
    if source != "attributes" || (siteGrams ?? 0) != 0 { return nil }
    return validWeight(typed) ? JS.round(JS.toNumber(typed) * 100) / 100 : nil
}

/// The post carries its own weight, not the site's: one is typed, the site has one, and they differ (to two places).
public func postOnlyWeight(siteGrams: Double?, typed: String) -> Bool {
    guard let site = siteGrams, site != 0, validWeight(typed) else { return false }
    return JS.round(JS.toNumber(typed) * 100) != JS.round(site * 100)
}
