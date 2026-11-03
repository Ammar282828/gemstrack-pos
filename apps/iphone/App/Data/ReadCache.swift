import Foundation
import CryptoKit

/// The last answer of the ERP's read routes, on disk (owner, 2026-11-03: "every screen handles offline"). The books
/// themselves are Firestore's cache and `ShelfSnapshots`; this is for the screens that ask a route for their data
/// (Overheads, the gold rate, a hisaab reminder, the website pages…): with no line, `ERPAPI.data` hands such a screen
/// the last answer instead of an error, so it paints what it showed last time.
///
/// `Library/Caches/erp-reads/<business>/<sha256 of the path>.json`, per business, erased on sign-out
/// (`FirestoreSource.forget`) like the shelves. Only JSON answers, and never a route that carries a key, a token or a
/// person's portal: a cache of those is a copy of a secret on disk.
enum ReadCache {
    /// Larger answers (a backup, a photo list) are not worth a copy.
    private static let maxBytes = 3 * 1024 * 1024

    /// Routes whose answers are never kept: keys and tokens, the karigar's own portal, binary and one-shot answers.
    private static let never = [
        "/api/agent/", "/api/push/", "/api/widget/", "/api/voice/", "/api/karigar", "/api/staff/collections",
        "/api/app/backup", "/api/app/pdf", "/api/app/labels", "/api/app/diagnostics", "/api/app/launch",
    ]

    private static var root: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("erp-reads", isDirectory: true)
    }

    private static func safe(_ s: String) -> String {
        String(s.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "_" })
    }

    private static func folder(_ business: String) -> URL? { root?.appendingPathComponent(safe(business), isDirectory: true) }

    private static func file(_ path: String, _ business: String) -> URL? {
        let name = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder(business)?.appendingPathComponent(name + ".json")
    }

    /// Whether a path's answer may be kept.
    static func keeps(_ path: String) -> Bool {
        guard path.hasPrefix("/api/") else { return false }
        return !never.contains { path.hasPrefix($0) }
    }

    /// Kept only when it is a JSON object or array of a sensible size.
    static func store(_ data: Data, path: String, business: String) {
        guard keeps(path), data.count <= maxBytes, let first = data.first(where: { $0 != 0x20 && $0 != 0x0A && $0 != 0x0D && $0 != 0x09 }),
              first == UInt8(ascii: "{") || first == UInt8(ascii: "["),
              let url = file(path, business), let dir = folder(business) else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// The last answer for this path, if there is one.
    static func load(path: String, business: String) -> Data? {
        guard keeps(path), let url = file(path, business) else { return nil }
        return try? Data(contentsOf: url)
    }

    /// Every kept answer of a business (signing out of it, removing it).
    static func erase(business: String) {
        if let dir = folder(business) { try? FileManager.default.removeItem(at: dir) }
    }
}
