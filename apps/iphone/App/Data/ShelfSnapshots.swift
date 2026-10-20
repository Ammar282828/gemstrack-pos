import Foundation

/// Each shelf's last answer on disk, so a cold start paints from one file read instead of waiting on Firestore's
/// own cache to hand thousands of documents over (owner, 2026-10-20: "the app's boot up is extremely slow").
/// `Library/Caches/erp-shelves/<business>/<collection>[--<doc>].json` is one JSON array of the documents as the
/// models read them (id included). A snapshot is only a first paint: the source's own first answer replaces it.
/// Staff read through the server, which strips the cost side, so theirs live under a different name and an
/// owner's file is never read as staff's (or the reverse).
enum ShelfSnapshots {
    enum Kind: String { case firestore = "", server = "srv-" }

    private static var root: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("erp-shelves", isDirectory: true)
    }

    private static func safe(_ s: String) -> String {
        String(s.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "_" })
    }

    private static func folder(_ business: String) -> URL? { root?.appendingPathComponent(safe(business), isDirectory: true) }

    private static func file(_ kind: Kind, _ business: String, _ collection: String, _ docId: String?) -> URL? {
        let name = kind.rawValue + safe(collection) + (docId.map { "--" + safe($0) } ?? "") + ".json"
        return folder(business)?.appendingPathComponent(name)
    }

    /// The snapshot's bytes, or nil when there is none. Bytes that are not an array are deleted (a torn or old file).
    static func read(_ kind: Kind, business: String, collection: String, docId: String?) -> Data? {
        guard let url = file(kind, business, collection, docId), let data = try? Data(contentsOf: url) else { return nil }
        let trimmed = data.drop { $0 == 0x20 || $0 == 0x0A }
        if trimmed.first == UInt8(ascii: "["), data.last(where: { $0 != 0x20 && $0 != 0x0A }) == UInt8(ascii: "]") { return data }
        try? FileManager.default.removeItem(at: url)
        return nil
    }

    /// The snapshot's file did not decode: erase it so the next start does not trip on it again.
    static func discard(_ kind: Kind, business: String, collection: String, docId: String?) {
        if let url = file(kind, business, collection, docId) { try? FileManager.default.removeItem(at: url) }
    }

    /// Atomically, so a launch killed mid-write finds the old snapshot or the new one, never half of one.
    static func write(_ kind: Kind, business: String, collection: String, docId: String?, documents: [Data]) {
        guard let url = file(kind, business, collection, docId), let dir = folder(business) else { return }
        var out = Data([UInt8(ascii: "[")])
        for (i, d) in documents.enumerated() {
            if i > 0 { out.append(UInt8(ascii: ",")) }
            out.append(d)
        }
        out.append(UInt8(ascii: "]"))
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? out.write(to: url, options: .atomic)
    }

    /// Every snapshot of a business (signing out of it, removing it).
    static func erase(business: String) {
        if let dir = folder(business) { try? FileManager.default.removeItem(at: dir) }
    }
}
