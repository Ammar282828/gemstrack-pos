import Foundation

/// Several photos of one piece with one description (src/lib/social/album.ts, the owner, 2026-10-23). WhatsApp gets the
/// photos one after another, the caption under the first only; Instagram a carousel of the first ten; one-photo places
/// (the story) the first. The same rules as the TypeScript, so the hub, the queue and the web agree.
public enum Album {
    /// Instagram's limit on a carousel's children.
    public static let igCarouselMax = 10
    /// Photos of one piece in one send.
    public static let max = 30

    /// The caption each photo carries: the description under the first, nothing under the rest.
    public static func captions(_ caption: String, count n: Int) -> [String] {
        (0..<Swift.max(0, n)).map { (i: Int) -> String in i == 0 ? caption : "" }
    }

    /// "ruby-ring.jpg", "ruby-ring-2.jpg", …
    public static func fileName(_ base: String, _ i: Int, ext: String = "jpg") -> String {
        "\(base.isEmpty ? "piece" : base)\(i > 0 ? "-\(i + 1)" : "").\(ext)"
    }

    /// What a carousel takes from `n` photos: the first ten; `dropped` is how many are left out. 1 is a plain photo.
    public static func carouselPlan(_ n: Int, max limit: Int = Album.igCarouselMax) -> (take: Int, dropped: Int, carousel: Bool) {
        let count = Swift.max(0, n)
        let take = Swift.min(count, limit)
        return (take, count - take, take > 1)
    }

    /// A WhatsApp caption as Instagram should show it: *bold*, _italic_ and ~strike~ markers taken off.
    public static func instagramText(_ caption: String) -> String {
        var out = caption
        for mark in ["\\*", "_", "~"] {
            let pattern = "(^|[\\s(])" + mark + "([^" + (mark == "\\*" ? "*" : mark) + "\\n]+)" + mark + "(?=[\\s).,!?:;]|$)"
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines]) else { continue }
            out = re.stringByReplacingMatches(in: out, options: [], range: NSRange(out.startIndex..., in: out), withTemplate: "$1$2")
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "3 photos" / "1 photo".
    public static func photosLabel(_ n: Int) -> String { "\(n) photo\(n == 1 ? "" : "s")" }

    /// Which places photo `i` still goes to: a place that failed an earlier photo is left out of the rest.
    public static func placesFor(_ all: [String], failed: Set<String>) -> [String] {
        all.filter { (k: String) in !failed.contains(k) }
    }
}
