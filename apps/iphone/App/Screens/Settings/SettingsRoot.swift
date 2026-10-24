import SwiftUI

/// `/settings`: who is signed in, then the shop's settings in the iPhone Settings app's grouping.
/// Each row opens its own screen, the web's tabs in its order; Backups and the imports are under Data, Labels
/// under Integrations (and Stock), as on the web.
struct SettingsRoot: View {
    /// "/settings?tab=rates": the rates live in the rate sheet now, as on the web, so it opens over the list.
    var opensRates = false
    @Environment(Session.self) private var session
    @State private var signingOut = false
    @State private var rates = false
    /// Once: coming back from a screen pushed over the list does not open the sheet again.
    @State private var ratesOpened = false

    var body: some View {
        Group {
            if session.isOwner {
                #if os(macOS)
                macList
                #else
                list
                #endif
            } else {
                NotAvailableState("Owners only", why: "Settings are the owners’.", symbol: "lock")
                    .navigationTitle("Settings")
            }
        }
        .onAppear {
            guard opensRates, !ratesOpened else { return }
            ratesOpened = true
            rates = true
        }
        .sheet(isPresented: $rates) {
            if session.isOwner { RateSheet().presentationSizing(.form) } else { RateReadout().presentationSizing(.form) }
        }
    }

    private var list: some View {
        Form { Group {
            Section { account }

            Section {
                SettingsLinkRow(title: "Businesses", symbol: "building.2.fill", color: .orange, path: "/app/businesses")
            } footer: {
                Text("Switch between the shops on this phone, or add another by its ERP's address.")
            }

            ForEach(settingsSections, id: \.name) { section in
                Section {
                    ForEach(section.tabs) { t in row(t) }
                } header: { LedgerHeading(title: section.name) }
            }

            Section {
                SettingsLinkRow(title: "This phone", symbol: "iphone", color: .teal, path: "/app/phone")
            }

            Section {
                Button("Sign out", role: .destructive) { signingOut = true }
            } footer: {
                Text("\(House.storeName) · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
            }
            }
            .houseRows()
        }
        .modifier(HouseGround())
        .navigationTitle("Settings")
        .hubTitleDisplay()
        .confirmationDialog("Sign out of \(session.shop.name)?", isPresented: $signingOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { session.signOut() }
        } message: {
            Text("The books are cleared from this phone until you sign in again.")
        }
    }

    /// The web's Settings sections (nav.ts SETTINGS `section`: Shop, Connections, Records) with their tabs in its order.
    private var settingsSections: [(name: String, tabs: [NavPlace])] {
        guard let e = NavMap.current.visible(to: session.role).settings else { return [] }
        return e.sections.map { (name: $0, tabs: e.tabs(in: $0)) }
    }

    /// A tab as a row: the app's own look for the ones it has drawn, the map's icon for any the web adds.
    @ViewBuilder private func row(_ t: NavPlace) -> some View {
        switch t.href {
        case "/settings": SettingsLinkRow(title: "Shop", symbol: "storefront.fill", color: .blue, path: "/app/settings/shop")
        case "/settings/alerts": SettingsLinkRow(title: "Alerts", symbol: "bell.badge.fill", color: .red, path: t.href)
        case "/settings/payment-methods": SettingsLinkRow(title: "Bank accounts", symbol: "building.columns.fill", color: .green, path: t.href)
        case "/settings/integrations": SettingsLinkRow(title: "Integrations", symbol: "puzzlepiece.extension.fill", color: .purple, path: t.href)
        case "/settings/data": SettingsLinkRow(title: "Data", symbol: "externaldrive.fill", color: .gray, path: t.href)
        case "/activity-log": SettingsLinkRow(title: "Activity", symbol: "clock.arrow.circlepath", color: .indigo, path: t.href)
        case "/settings/voice": SettingsLinkRow(title: "Voice", symbol: "mic.fill", color: .pink, path: t.href)
        default: SettingsLinkRow(title: t.label, symbol: NavIcon.symbol(for: t.icon), color: .teal, path: t.href)
        }
    }

    /// The signed-in person, as the top of the iPhone's own Settings shows its account.
    private var account: some View {
        let email = session.me?.email ?? ""
        let name = session.shop.person ?? email
        return HStack(spacing: 14) {
            ZStack {
                Circle().fill(Theme.accent)
                Text(String(name.prefix(1)).uppercased())
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
            }
            .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.headline).lineLimit(1)
                if session.shop.person != nil, !email.isEmpty {
                    Text(email).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Text("Owner · \(session.shop.name)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }
}

#if os(macOS)
extension SettingsRoot {
    /// System Settings' shape: one grouped page of sections, each row a page of its own (no second sidebar: the app's
    /// sidebar is the only one). The rates are a toolbar button, as the gold rate is the day's first job.
    fileprivate var macList: some View {
        Form {
            Section { account }

            Section {
                SettingsLinkRow(title: "Businesses", symbol: "building.2.fill", color: .orange, path: "/app/businesses")
            } footer: {
                Text("Switch between the shops on this Mac, or add another by its ERP's address.")
            }

            ForEach(settingsSections, id: \.name) { section in
                Section {
                    ForEach(section.tabs) { t in row(t) }
                } header: { Text(section.name) }
            }

            Section {
                SettingsLinkRow(title: "This Mac", symbol: "desktopcomputer", color: .teal, path: "/app/phone")
            }

            Section {
                Button("Sign out…", role: .destructive) { signingOut = true }
            } footer: {
                Text("\(House.storeName) · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
            }
        }
        .macSettingsPage()
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Settings")
        .navigationSubtitle(session.shop.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { rates = true } label: { Label("Today's rates", systemImage: "chart.line.uptrend.xyaxis") }
                    .help("Set today's gold rates")
            }
        }
        .confirmDestructive(isPresented: $signingOut, title: "Sign out of \(session.shop.name)?",
                            message: "The books are cleared from this Mac until you sign in again.",
                            action: "Sign out") { session.signOut() }
    }
}
#endif
