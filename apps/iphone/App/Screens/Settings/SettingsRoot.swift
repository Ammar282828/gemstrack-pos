import SwiftUI

/// `/settings`: who is signed in, then the shop's settings in the iPhone Settings app's grouping.
/// Each row opens its own screen; the ones that stay the ERP's pages (activity, voice) open inside the app.
struct SettingsRoot: View {
    @Environment(Session.self) private var session
    @State private var signingOut = false

    var body: some View {
        if session.isOwner {
            list
        } else {
            ContentUnavailableView("Owners only", systemImage: "lock", description: Text("Settings are the owners’."))
                .navigationTitle("Settings")
        }
    }

    private var list: some View {
        Form { Group {
            Section { account }

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
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
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
