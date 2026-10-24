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
        .navigationBarTitleDisplayMode(.large)
    }
}

#if os(macOS)
extension WebsiteMenu {
    /// The website's tools as wide cards across the window, each also openable in a window of its own.
    @ViewBuilder
    var macBody: some View {
        let tabs = MarketingKit.tabs(of: "website", role: session.role)
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if tabs.isEmpty {
                    NotAvailableState("This shop doesn't change its website from the ERP", why: "Its website is managed outside the ERP, so there are no website tools here.", symbol: "globe")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14, alignment: .top)], spacing: 14) {
                        ForEach(tabs) { (t: NavPlace) in card(t.label, symbol: NavIcon.symbol(for: t.icon), path: t.href) }
                        card("Posts", symbol: "paperplane.fill", path: "/posts")
                    }
                    Text("What changes here is on the website within a minute; each change says where it goes first.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
        .navigationTitle("Website")
    }

    private func card(_ title: String, symbol: String, path: String) -> some View {
        NavigationLink(value: Route(path: path)) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.title2).foregroundStyle(Theme.accent).frame(width: 32)
                Text(title).font(.headline)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .ledgerCard()
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .pointerHover()
        .contextMenu { MacOpenInWindow(path: path) }
    }
}
#endif
