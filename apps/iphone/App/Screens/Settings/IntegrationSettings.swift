import SwiftUI
import ERPCore

/// Settings → Integrations (src/app/settings/integrations): the website, Shopify and Meta. Connecting
/// any of them is a sign-in on the other service's own page, so this shows where each stands and opens
/// the ERP's page for the rest.
struct IntegrationSettings: View {
    var body: some View {
        SettingsGate(title: "Integrations") { IntegrationsForm(settings: $0) }
    }
}

private struct IntegrationsForm: View {
    let settings: Settings
    @Environment(Session.self) private var session

    var body: some View {
        Form { Group {
            if session.shop.websiteSelling {
                Section {
                    NavigationLink(value: Route(path: "/settings/integrations?web=1")) {
                        Label("Selling on the website", systemImage: "globe")
                    }
                } footer: {
                    Text("Whether the site takes orders, and at what rate.")
                }
            }

            if let domain = settings.shopifyStoreDomain, !domain.isEmpty {
                Section {
                    LabeledContent("Store", value: domain)
                    LabeledContent("Last synced", value: settings.shopifyLastSyncedAt.map { ShopDate.say($0, withTime: true) } ?? "Not yet")
                    NavigationLink(value: Route(path: "/settings/integrations?web=1")) {
                        Label("Connection and sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                } header: {
                    LedgerHeading(title: "Shopify")
                }
            }

            Section {
                NavigationLink(value: Route(path: "/ads/setup")) {
                    Label("Ads › Setup", systemImage: "megaphone")
                }
            } header: {
                LedgerHeading(title: "Meta")
            } footer: {
                Text("The Facebook login, ad account, Page, Instagram and pixel.")
            }

            Section {
                NavigationLink(value: Route(path: "/settings/printer")) {
                    Label("Labels and tags", systemImage: "tag")
                }
            }
            }
            .houseRows()
        }
    }
}
