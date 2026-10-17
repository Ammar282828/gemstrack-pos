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
                        NotAvailableState("This shop doesn't change its website from the ERP", why: "Its website is managed outside the ERP, so there are no website tools here.", symbol: "globe")
                    }
                } else {
                    Section {
                        ForEach(tabs) { (t: NavPlace) in
                            MarketingLink(title: t.label, symbol: NavIcon.symbol(for: t.icon), path: t.href)
                        }
                    } footer: {
                        Text("What changes here is on the website within a minute; each change says where it goes first.")
                    }
                    Section {
                        MarketingLink(title: "Posts", symbol: "paperplane.fill", path: "/posts")
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Website")
        .navigationBarTitleDisplayMode(.large)
    }
}
