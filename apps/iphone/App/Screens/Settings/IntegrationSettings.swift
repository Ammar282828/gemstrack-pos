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

            if session.isOwner { SafepaySection() }

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

/// Safepay (owner, 2026-11-09; ops-paylinks.ts `setSafepayKey`): the house's PUBLIC key, which turns on the payment link on
/// invoices and orders. Owners only. Saving an empty box, or Disconnect, turns it off. The ERP answers whether links are on.
private struct SafepaySection: View {
    @State private var key = ""
    @State private var saving = false
    @State private var failure: String?
    @State private var confirmDisconnect = false
    @State private var savedTick = 0
    @State private var refusedTick = 0

    private var connected: Bool { Businesses.shared.current.offersPaymentLinks }
    private var trimmed: String { key.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Section {
            LabeledContent("Safepay", value: connected ? "Connected" : "Not connected")
            TextField("Public key", text: $key, prompt: Text("sec_\u{2026}"))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            Button("Save") { Task { await save(trimmed) } }
                .disabled(saving || !SafepayLink.isPublicKey(trimmed))
            if connected {
                Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                    .disabled(saving)
            }
        } header: {
            LedgerHeading(title: "Safepay")
        } footer: {
            if !trimmed.isEmpty && !SafepayLink.isPublicKey(trimmed) {
                Text("That is not a public key: it starts with sec_ and is letters and numbers only.")
                    .foregroundStyle(Tone.problem.color)
            } else {
                Text("Safepay dashboard \u{2192} Developer \u{2192} API \u{2192} Public key (starts with sec_). Never the Secret key.")
            }
        }
        .failureAlert($failure, title: "Safepay")
        .confirmDestructive(isPresented: $confirmDisconnect, title: "Disconnect Safepay?",
                            message: "Invoices and orders stop offering a payment link. Links already sent still work.",
                            action: "Disconnect") {
            Task { await save("") }
        }
        .savedFeedback(trigger: savedTick)
        .refusedFeedback(trigger: refusedTick)
    }

    /// An empty key disconnects. Needs a connection (it is not kept to send later): the ERP says so itself.
    private func save(_ publicKey: String) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let out = try await ERPAPI.shared.write("setSafepayKey", ["publicKey": publicKey], queueOffline: false)
            Businesses.shared.setPaymentLinks(out["paymentLinks"] as? Bool ?? !publicKey.isEmpty)
            key = ""
            savedTick += 1
        } catch {
            failure = error.localizedDescription
            refusedTick += 1
        }
    }
}
