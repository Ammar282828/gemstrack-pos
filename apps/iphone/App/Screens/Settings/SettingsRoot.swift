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
                list
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
            if session.isOwner { RateSheet() } else { RateReadout() }
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

            Section {
                SettingsLinkRow(title: "Shop", symbol: "storefront.fill", color: .blue, path: "/app/settings/shop")
                SettingsLinkRow(title: "Alerts", symbol: "bell.badge.fill", color: .red, path: "/settings/alerts")
                SettingsLinkRow(title: "Bank accounts", symbol: "building.columns.fill", color: .green, path: "/settings/payment-methods")
            }

            Section {
                SettingsLinkRow(title: "Integrations", symbol: "puzzlepiece.extension.fill", color: .purple, path: "/settings/integrations")
                SettingsLinkRow(title: "Data", symbol: "externaldrive.fill", color: .gray, path: "/settings/data")
                SettingsLinkRow(title: "Activity", symbol: "clock.arrow.circlepath", color: .indigo, path: "/activity-log")
                SettingsLinkRow(title: "Voice", symbol: "mic.fill", color: .pink, path: "/settings/voice")
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
