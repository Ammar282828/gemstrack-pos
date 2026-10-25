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
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
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
        .readableColumn(780)
        .navigationTitle("Website")
        .hubTitleDisplay()
    }
}

#if os(macOS)
extension WebsiteMenu {
    /// The website's tools as plain rows, each also openable in a window of its own (the sidebar lists them too).
    @ViewBuilder
    var macBody: some View {
        let tabs = MarketingKit.tabs(of: "website", role: session.role)
        Group {
            if tabs.isEmpty {
                NotAvailableState("This shop doesn't change its website from the ERP", why: "Its website is managed outside the ERP, so there are no website tools here.", symbol: "globe")
            } else {
                List {
                    Section {
                        ForEach(tabs) { (t: NavPlace) in row(t.label, symbol: NavIcon.symbol(for: t.icon), path: t.href) }
                        row("Posts", symbol: "paperplane.fill", path: "/posts")
                    } footer: {
                        Text("What changes here is on the website within a minute; each change says where it goes first.")
                    }
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("Website")
    }

    private func row(_ title: String, symbol: String, path: String) -> some View {
        NavigationLink(value: Route(path: path)) {
            Label(title, systemImage: symbol)
        }
        .contextMenu { MacOpenInWindow(path: path) }
    }
}
#endif
