#if os(macOS)
import SwiftUI

/// ERP › Settings… (⌘,): this Mac's and this person's settings, as a Mac app keeps them (Apple's HIG, Settings › macOS): a
/// tab bar showing the pane in front, the pane last open opened again, each pane at its own fixed size. Only what is set
/// once in a while and belongs to this Mac or this person is here; the shop's shared records (the shop, bank accounts,
/// alerts, data, selling online, connections) are ERP › Shop Settings… (⇧⌘,), a window of their own (`MacShopSettingsWindow`).
struct MacSettingsWindow: View {
    /// The pane last open, opened again next time.
    @AppStorage("mac.settings.pane") private var pane: MacSettingsPane = .general

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if session.state == .signedIn {
                let tabs = MacSettingsPane.tabs
                // A stored pane that is no longer a tab (an older build's) opens This Mac.
                let shown = tabs.contains(pane) ? pane : .general
                TabView(selection: Binding(get: { shown }, set: { pane = $0 })) {
                    // `tabs`, in order.
                    Tab(MacSettingsPane.general.title, systemImage: MacSettingsPane.general.symbol, value: MacSettingsPane.general) {
                        MacSettingsTab(pane: .general)
                    }
                    Tab(MacSettingsPane.businesses.title, systemImage: MacSettingsPane.businesses.symbol, value: MacSettingsPane.businesses) {
                        MacSettingsTab(pane: .businesses)
                    }
                    Tab(MacSettingsPane.account.title, systemImage: MacSettingsPane.account.symbol, value: MacSettingsPane.account) {
                        MacSettingsTab(pane: .account)
                    }
                    Tab(MacSettingsPane.printing.title, systemImage: MacSettingsPane.printing.symbol, value: MacSettingsPane.printing) {
                        MacSettingsTab(pane: .printing)
                    }
                    Tab(MacSettingsPane.labelLive.title, systemImage: MacSettingsPane.labelLive.symbol, value: MacSettingsPane.labelLive) {
                        MacSettingsTab(pane: .labelLive)
                    }
                }
            } else {
                ContentUnavailableView("Sign in first", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("Settings open once you have signed in in the main window."))
                    .frame(width: 480, height: 280)
            }
        }
        .environment(session)
        .environment(Book.shared)
        .tint(Theme.accent)
        .alternatingRowBackgrounds(.disabled)
        .modifier(MacLockCover())
        .environment(\.locale, Locale(identifier: "en_PK"))
    }
}

/// One tab of Settings: the pane's screen at the pane's own size (the window takes it, and does not resize freely), in a
/// stack of its own so a row that opens a page (This Mac's widgets, Printing's Label LIVE) opens it here.
private struct MacSettingsTab: View {
    let pane: MacSettingsPane

    var body: some View {
        NavigationStack {
            MacSettingsPaneView(pane: pane)
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
        }
        .frame(width: pane.size.width, height: pane.size.height)
    }
}

/// ERP › Shop Settings… (⇧⌘,): the shop's shared records, an owner's, in a window of its own beside the main one (they are
/// the books' settings, changed for everyone, not this Mac's): Shop, Bank Accounts, Alerts, Data, Selling Online, Connect an
/// AI and Voice, in the sidebar of panes the Settings window had before (2026-11-15).
struct MacShopSettingsWindow: View {
    /// The pane last open, opened again next time.
    @AppStorage("mac.shopSettings.pane") private var stored: MacSettingsPane = .shop

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if session.state == .signedIn, session.isOwner {
                let groups = MacSettingsPane.shopGroups(websiteSelling: session.shop.websiteSelling)
                let all = groups.flatMap(\.panes)
                // A pane this account no longer sees (another business, selling turned off) is never drawn.
                let shown = all.contains(stored) ? stored : .shop
                NavigationSplitView {
                    List(selection: Binding<MacSettingsPane?>(get: { shown }, set: { if let p = $0 { stored = p } })) {
                        ForEach(groups, id: \.title) { group in
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
                        MacSettingsPaneView(pane: shown)
                            .id(shown)
                            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                }
                .navigationTitle("Shop Settings")
            } else if session.state == .signedIn {
                ContentUnavailableView("For owners", systemImage: "lock",
                                       description: Text("The shop\u{2019}s settings are changed by its owners."))
            } else {
                ContentUnavailableView("Sign in first", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("Shop Settings open once you have signed in in the main window."))
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

/// One pane of Settings (⌘,) or Shop Settings (⇧⌘,), and the screen that edits it.
enum MacSettingsPane: String, Hashable, Identifiable {
    case general, businesses, account
    case shop, bankAccounts, alerts, data
    case printing, labelLive
    case website
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
        case .ai: return "/settings/ai"
        case .voice: return "/settings/voice"
        }
    }

    /// The Settings window's size for this pane: fixed, as a Mac app's settings panes are (the window follows the tab).
    /// The shop's panes are in Shop Settings, a resizable window, and never ask.
    var size: CGSize {
        switch self {
        case .general: return CGSize(width: 640, height: 580)
        case .businesses: return CGSize(width: 640, height: 520)
        case .account: return CGSize(width: 560, height: 320)
        case .printing: return CGSize(width: 680, height: 620)
        case .labelLive: return CGSize(width: 680, height: 660)
        default: return CGSize(width: 720, height: 620)
        }
    }

    struct PaneGroup {
        let title: String
        let panes: [MacSettingsPane]
    }

    /// The Settings window's tabs (⌘,): this Mac's and this person's, everyone's.
    static let tabs: [MacSettingsPane] = [.general, .businesses, .account, .printing, .labelLive]

    /// Shop Settings' panes (⇧⌘,): the shop's shared records, owners' only.
    static func shopGroups(websiteSelling: Bool) -> [PaneGroup] {
        var out = [PaneGroup(title: "Shop", panes: [.shop, .bankAccounts, .alerts, .data])]
        if websiteSelling { out.append(PaneGroup(title: "Selling", panes: [.website])) }
        out.append(PaneGroup(title: "Connections", panes: [.ai, .voice]))
        return out
    }

    /// Every pane this account sees, in both windows: everyone has This Mac, Businesses, Account and printing (Settings);
    /// the shop's own are owners' (Shop Settings).
    static func groups(owner: Bool, websiteSelling: Bool) -> [PaneGroup] {
        var out = [PaneGroup(title: "This Mac", panes: [.general, .businesses, .account]),
                   PaneGroup(title: "Labels", panes: [.printing, .labelLive])]
        if owner { out.insert(contentsOf: shopGroups(websiteSelling: websiteSelling), at: 1) }
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
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Form {
            Section {
                LabeledContent("Signed in as", value: session.me?.email ?? "")
                LabeledContent("Role", value: session.role.capitalized)
                LabeledContent("Business", value: House.storeName)
            }
            if session.isOwner {
                Section {
                    Button("Shop Settings\u{2026}") { openWindow(id: MacWindows.shopSettings) }
                } footer: {
                    Text("The shop, its bank accounts, alerts, data and connections: the same for everyone at \(House.storeName).")
                }
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
