import SwiftUI

/// Addresses a staff member is not shown (src/lib/staff-pages.ts, decision "Staff see no money"): the books, settings, analytics,
/// stock and the lists of what the shop earns. The menu already leaves them out; this is for a link or a path that still points
/// there (a notification, a search hit, a Siri shortcut). The server is the real boundary: staff read no books.
enum StaffPages {
    private static let blocked = ["/analytics", "/expenses", "/additional-revenue", "/overheads", "/hisaab", "/shareholders", "/settings",
                                  "/activity-log", "/today", "/products", "/ads/setup", "/ads/audiences", "/ads/rules", "/ads/tests"]
    /// Only for marketing: reachable by a staff member who is on the marketing list too.
    private static let marketingOnly = ["/ads", "/insights", "/website/interest"]

    private static func within(_ path: String, _ href: String) -> Bool {
        let h = href.split(separator: "?").first.map(String.init) ?? href
        return path == h || (h != "/" && path.hasPrefix(h + "/"))
    }

    /// Whether a staff member must not open `path`. `alsoMarketing`: she is on the marketing list as well.
    static func isBlocked(_ path: String, alsoMarketing: Bool) -> Bool {
        let p = path.split(separator: "?").first.map(String.init) ?? path
        // A piece's own page is how a scanned tag is sold (the sale flow links it); the stock lists are not.
        if p.hasPrefix("/products/") {
            let rest = p.dropFirst("/products/".count)
            if !rest.isEmpty, !rest.contains("/"), rest != "add", rest != "bulk-add" { return false }
        }
        if blocked.contains(where: { (h: String) in within(p, h) }) { return true }
        if !alsoMarketing, marketingOnly.contains(where: { (h: String) in within(p, h) }) { return true }
        return false
    }
}

/// Draws a page, or for a staff member a quiet "not for staff" where the page is one she may not open.
struct StaffGate<Content: View>: View {
    let path: String
    @ViewBuilder let content: () -> Content
    @Environment(Session.self) private var session

    var body: some View {
        if session.role == "staff" && StaffPages.isBlocked(path, alsoMarketing: session.alsoMarketing) {
            ContentUnavailableView("Not for staff", systemImage: "lock",
                                   description: Text("An owner looks after this part of the ERP."))
        } else {
            content()
        }
    }
}
