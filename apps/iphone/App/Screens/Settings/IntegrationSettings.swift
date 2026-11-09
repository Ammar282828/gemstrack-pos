import SwiftUI
import ERPCore

/// Settings → Integrations (src/app/settings/integrations): the website and Meta. The website's selling
/// settings (WebsiteSellingSettings) are native; Meta's connection is Ads › Setup. Shopify has no card here
/// (2026-11-09): the server registers its notices and catches up every order itself.
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
                    NavigationLink(value: Route(path: "/app/settings/website")) {
                        Label("Selling on the website", systemImage: "globe")
                    }
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
