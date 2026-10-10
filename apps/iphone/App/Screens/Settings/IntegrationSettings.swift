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
    @State private var shopify: ShopifyConnection?
    @State private var shopifyFailure: String?

    private struct ShopifyConnection: Decodable {
        let configured: Bool
        let connected: Bool?
        let shop: String?
        let shopName: String?
        let lastSyncedAt: String?
        let error: String?
    }

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

                Section {
                    if let shopify {
                        LabeledContent("Status", value: !shopify.configured ? "Not configured" : (shopify.connected == true ? "Connected" : "Needs attention"))
                        if let domain = shopify.shop { LabeledContent("Store", value: domain) }
                        if shopify.configured {
                            LabeledContent("Last synced", value: shopify.lastSyncedAt.map { ShopDate.say($0, withTime: true) } ?? "Not yet")
                        }
                        if let error = shopify.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    } else if let shopifyFailure {
                        Text(shopifyFailure).font(.footnote).foregroundStyle(.secondary)
                        Button("Check connection again") { Task { await checkShopify() } }
                    } else {
                        SkeletonLoading()
                    }
                    NavigationLink(value: Route(path: "/settings/integrations?web=1")) {
                        Label("Connection and sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                } header: {
                    LedgerHeading(title: "Shopify")
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
        .task { await checkShopify() }
    }

    private func checkShopify() async {
        shopifyFailure = nil
        do { shopify = try await ERPAPI.shared.get("/api/shopify/status", as: ShopifyConnection.self) }
        catch { shopifyFailure = error.localizedDescription }
    }
}
