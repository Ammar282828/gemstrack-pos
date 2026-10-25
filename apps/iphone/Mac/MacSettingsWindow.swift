#if os(macOS)
import SwiftUI

/// ERP › Settings… (⌘,): every setting in one window with a sidebar of panes, as System Settings has them (docs/features/
/// mac-design.md, "Settings"). Settings is no longer a place in the main window's sidebar; each pane is the screen that
/// already edits it, shown at the window's width. Panes an account may not change are not listed for it.
struct MacSettingsWindow: View {
    @State private var pane: MacSettingsPane? = .general

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if session.state == .signedIn {
                let panes = MacSettingsPane.groups(owner: session.isOwner, websiteSelling: session.shop.websiteSelling)
                NavigationSplitView {
                    List(selection: $pane) {
                        ForEach(panes, id: \.title) { group in
                            Section(group.title) {
                                ForEach(group.panes) { p in
                                    Label(p.title, systemImage: p.symbol).tag(p)
                                }
                            }
                        }
                    }
                    .listStyle(.sidebar)
                    .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
                } detail: {
                    NavigationStack {
                        MacSettingsPaneView(pane: pane ?? .general)
                            .id(pane)
                            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                }
                .onAppear {
                    let all = panes.flatMap(\.panes)
                    if let p = pane, !all.contains(p) { pane = .general }
                }
            } else {
                ContentUnavailableView("Sign in first", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("Settings open once you have signed in in the main window."))
            }
        }
        .environment(session)
        .environment(Book.shared)
        .tint(Theme.accent)
        .alternatingRowBackgrounds(.disabled)
        .modifier(MacLockCover())
        .environment(\.locale, Locale(identifier: "en_PK"))
        .frame(minWidth: 820, idealWidth: 920, minHeight: 600, idealHeight: 700)
    }
}

/// One pane of the Settings window and the screen that edits it.
enum MacSettingsPane: String, Hashable, Identifiable {
    case general, businesses, account
    case shop, bankAccounts, alerts, data
    case printing, labelLive
    case website, shopify
    case ai, voice

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "This Mac"
        case .businesses: return "Businesses"
        case .account: return "Account"
        case .shop: return "Shop"
        case .bankAccounts: return "Bank Accounts"
        case .alerts: return "Alerts"
        case .data: return "Data"
        case .printing: return "Printing"
        case .labelLive: return "Label LIVE"
        case .website: return "Selling Online"
        case .shopify: return "Shopify"
        case .ai: return "Connect an AI"
        case .voice: return "Voice"
        }
    }

    var symbol: String {
        switch self {
        case .general: return "desktopcomputer"
        case .businesses: return "building.2"
        case .account: return "person.crop.circle"
        case .shop: return "storefront"
        case .bankAccounts: return "building.columns"
        case .alerts: return "bell"
        case .data: return "cylinder.split.1x2"
        case .printing: return "printer"
        case .labelLive: return "tag"
        case .website: return "globe"
        case .shopify: return "bag"
        case .ai: return "sparkles"
        case .voice: return "mic"
        }
    }

    /// The screen's path (nil: drawn here).
    var path: String? {
        switch self {
        case .general: return "/app/phone"
        case .businesses: return "/app/businesses"
        case .account: return nil
        case .shop: return "/settings/shop"
        case .bankAccounts: return "/settings/payment-methods"
        case .alerts: return "/settings/alerts"
        case .data: return "/settings/data"
        case .printing: return "/app/tag-printer"
        case .labelLive: return "/app/label-live"
        case .website: return "/app/settings/website"
        case .shopify: return "/app/settings/shopify"
        case .ai: return "/settings/ai"
        case .voice: return "/settings/voice"
        }
    }

    struct PaneGroup {
        let title: String
        let panes: [MacSettingsPane]
    }

    /// The panes this account sees: everyone has This Mac, Businesses, Account and printing; the shop's own are owners'.
    static func groups(owner: Bool, websiteSelling: Bool) -> [PaneGroup] {
        var out = [PaneGroup(title: "This Mac", panes: [.general, .businesses, .account]),
                   PaneGroup(title: "Labels", panes: [.printing, .labelLive])]
        if owner {
            out.insert(PaneGroup(title: "Shop", panes: [.shop, .bankAccounts, .alerts, .data]), at: 1)
            out.append(PaneGroup(title: "Selling", panes: websiteSelling ? [.website, .shopify] : [.shopify]))
            out.append(PaneGroup(title: "Connections", panes: [.ai, .voice]))
        }
        return out
    }
}

/// A pane's screen.
struct MacSettingsPaneView: View {
    let pane: MacSettingsPane

    var body: some View {
        if let path = pane.path {
            PlaceScreen(path: path)
        } else {
            MacAccountPane()
        }
    }
}

/// Settings › Account: who is signed in, and Sign Out.
struct MacAccountPane: View {
    @Environment(Session.self) private var session

    var body: some View {
        Form {
            Section {
                LabeledContent("Signed in as", value: session.me?.email ?? "")
                LabeledContent("Role", value: session.role.capitalized)
                LabeledContent("Business", value: House.storeName)
            }
            Section {
                Button("Sign Out…") { MacSignOut.ask() }
            } footer: {
                Text("Signing out clears this Mac's copy of \(House.storeName)'s books. Sign in again with the Gmail the shop has for you.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Account")
    }
}
#endif
