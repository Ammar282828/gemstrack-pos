import SwiftUI

/// Website: the house's own site, as the places that change it (nav.ts "website": Add photos, Edit a
/// piece, Photo weights), each a native screen on the web page's own routes (Website*.swift). The tabs come
/// from the house's map (nav-<house>.json), already cut to its flags (Edit a piece, Photo weights) and to
/// this person's role.
///
/// Registered at /marketing/website and not at /website/photos, which is the real Add photos page.
struct WebsiteMenu: View {
    @Environment(Session.self) private var session

    var body: some View {
        let tabs = MarketingKit.tabs(of: "website", role: session.role)
        List {
            Group {
                if tabs.isEmpty {
                    Section {
                        ContentUnavailableView("This shop doesn't change its website from the ERP", systemImage: "globe")
                    }
                } else {
                    Section {
                        ForEach(tabs) { (t: NavPlace) in
                            MarketingLink(title: t.label, subtitle: Self.about[t.href], symbol: NavIcon.symbol(for: t.icon), path: t.href)
                        }
                    } footer: {
                        Text("What changes here is on the website within a minute; each change says where it goes first.")
                    }
                    Section {
                        MarketingLink(title: "Posts", subtitle: "What went out, the queue, the site's pieces", symbol: "paperplane.fill", path: "/posts")
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Website")
        .navigationBarTitleDisplayMode(.large)
    }

    /// What each page is for, in the ERP's words.
    private static let about: [String: String] = [
        "/website/photos": "Upload photographs to a collection on the site",
        "/website/edit": "Rename it, change its words or weight, hide it, re-make its photo",
        "/website/weights": "Record the weight the site draws on a photograph",
    ]
}
