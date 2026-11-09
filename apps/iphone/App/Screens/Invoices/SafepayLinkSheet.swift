import SwiftUI
import ERPCore

// Payment links by Safepay (owner, 2026-11-09; lib/writes/payment-links.ts, ops-paylinks.ts). Apart from the Shopify
// "Payment link" Mina's invoices have (InvoiceShopifySheets): this one is the house's own Safepay account. The sheet asks
// how much, the ERP makes the link, and it goes to the customer by Copy, Share or WhatsApp. The ERP records the money
// itself (an invoice payment or an order advance, by Card) within five minutes of its being paid: the app only refreshes.

/// What the sheet is for: an invoice or an order, what it still owes, and who to send it to.
struct SafepayLinkRequest: Identifiable, Hashable {
    /// "invoice" or "order": the write's `target`.
    let target: String
    let targetId: String
    let owed: Double
    let customerName: String
    /// The customer's number as it is on the record or their card; empty when there is none.
    let phone: String
    var id: String { target + ":" + targetId }
}

/// The ERP's answer: the link and what it asks for.
struct SafepayLinkMade: Equatable {
    let id: String
    let url: String
    let amount: Double

    init?(_ out: [String: Any]) {
        guard let link = out["link"] as? [String: Any], let url = link["url"] as? String, !url.isEmpty else { return nil }
        id = link["id"] as? String ?? ""
        self.url = url
        amount = (link["amount"] as? Double) ?? (link["amount"] as? Int).map(Double.init) ?? 0
    }
}

struct SafepayLinkSheet: View {
    let request: SafepayLinkRequest

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var amountText: String
    @State private var making = false
    @State private var made: SafepayLinkMade?
    @State private var failure: String?
    @State private var copied = 0
    @State private var savedTick = 0

    init(request: SafepayLinkRequest) {
        self.request = request
        let start = SafepayLink.defaultAmount(owed: request.owed)
        _amountText = State(initialValue: start >= 1 ? PaymentText.field(start) : "")
    }

    private var amount: Double { PaymentText.amount(amountText) ?? 0 }
    private var canMake: Bool { SafepayLink.isValidAmount(amount) && !making }

    /// What goes to the customer: the words with the link and the shop's own name (never "… ERP").
    private var text: String? {
        guard let made else { return nil }
        return SafepayLink.message(customerName: request.customerName, amount: made.amount > 0 ? made.amount : amount,
                                   id: request.targetId, url: made.url, shopName: session.shop.name)
    }

    private var whatsAppURL: URL? { text.flatMap { InvoiceFacts.whatsAppURL(phone: request.phone, text: $0) } }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        NavigationStack {
            Form { Group {
                if let made {
                    madeSections(made)
                } else {
                    Section {
                        TextField("Amount in rupees", text: $amountText)
                            .keyboardType(.numberPad)
                            .font(.house(.title2).weight(.semibold))
                            .monospacedDigit()
                        if amount > 0 { Text(Money.pkrLac(amount)).monospacedDigit().foregroundStyle(.secondary) }
                        if request.owed >= 1 {
                            Button("All that's owed: \(PaymentText.pkr(request.owed))") {
                                amountText = PaymentText.field(SafepayLink.defaultAmount(owed: request.owed))
                            }
                        }
                    } footer: {
                        Text("The customer pays \(request.targetId) by card on Safepay. It is recorded here by itself within a few minutes.")
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .navigationTitle("Payment link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if made == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(role: .cancel) { dismiss() }
                            .disabled(making)
                    }
                } else {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .makeBar(made == nil, ActionBar.Action("Make the link", systemImage: "link", isBusy: making, isDisabled: !canMake) {
                Task { await make() }
            })
            .failureAlert($failure, title: "No payment link")
            .savedFeedback(trigger: savedTick)
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(making)
        #endif
    }

    /// The link made: it, and Copy, Share and WhatsApp.
    @ViewBuilder
    private func madeSections(_ made: SafepayLinkMade) -> some View {
        Section {
            Text(made.url)
                .font(.house(.footnote))
                .textSelection(.enabled)
        } header: {
            LedgerHeading(title: "Link for \(Money.pkr(made.amount > 0 ? made.amount : amount))")
        }
        Section {
            Button {
                SecretPasteboard.copy(made.url, minutes: 60)
                copied += 1
                savedTick += 1
            } label: { Label(copied == 0 ? "Copy" : "Copied", systemImage: "doc.on.doc") }
            if let url = URL(string: made.url), let text {
                ShareLink(item: url, message: Text(text)) { Label("Share", systemImage: "square.and.arrow.up") }
            }
            if let whatsAppURL {
                Button { openURL(whatsAppURL) } label: { Label("WhatsApp", systemImage: "message") }
            }
        } footer: {
            if whatsAppURL == nil {
                Text("There is no WhatsApp number on this record: use Share to pick the chat.")
            } else {
                Text("WhatsApp opens with the message written: press send there.")
            }
        }
    }

    /// Needs the line (a link is made by Safepay, never kept to send later).
    private func make() async {
        guard canMake else { return }
        if Connection.shared.isOffline {
            failure = "Needs a connection. A payment link is made by Safepay, so it works when you're back online."
            return
        }
        making = true
        defer { making = false }
        do {
            let out = try await ERPAPI.shared.write("createPaymentLink", [
                "target": request.target, "targetId": request.targetId, "amount": amount.rounded(),
            ], queueOffline: false)
            guard let link = SafepayLinkMade(out) else {
                failure = "Safepay gave no link. Try again."
                return
            }
            made = link
            savedTick += 1
        } catch {
            failure = error.localizedDescription
        }
    }

    #if os(macOS)
    // The Mac's sheet: the amount focused, then the link with Copy, Share and WhatsApp (docs/features/mac-design.md, rule 7).
    var macBody: some View {
        MacInvoiceSheetFrame(title: "Payment Link", subtitle: request.targetId + " \u{00B7} " + PaymentText.pkr(request.owed) + " is owed",
                             confirmTitle: made == nil ? "Make the Link" : "Done",
                             cancelTitle: made == nil ? "Cancel" : "Close",
                             canConfirm: made == nil ? canMake : true, busy: making,
                             confirm: { if made == nil { Task { await make() } } else { dismiss() } },
                             cancel: { dismiss() }) {
            if let made {
                Text(made.url).font(.house(.callout)).textSelection(.enabled)
                Button(copied == 0 ? "Copy" : "Copied") {
                    SecretPasteboard.copy(made.url, minutes: 60)
                    copied += 1
                }
                if let url = URL(string: made.url), let text {
                    ShareLink(item: url, message: Text(text)) { Text("Share") }
                }
                if let whatsAppURL {
                    Button("WhatsApp") { openURL(whatsAppURL) }
                }
            } else {
                LabeledContent("Amount") {
                    HStack(spacing: 8) {
                        MacInvoiceNumberField(title: "Amount in rupees", text: $amountText, prompt: "PKR")
                        if request.owed >= 1 {
                            Button("All That's Owed") { amountText = PaymentText.field(SafepayLink.defaultAmount(owed: request.owed)) }
                        }
                    }
                }
                if amount > 0 { Text(Money.pkrLac(amount)).font(.house(.callout)).monospacedDigit().foregroundStyle(.secondary) }
            }
        }
        .failureAlert($failure, title: "No payment link")
    }
    #endif
}

private extension View {
    /// The one action at the foot until the link is made; then the page has Done.
    @ViewBuilder
    func makeBar(_ show: Bool, _ action: ActionBar.Action) -> some View {
        if show { actionBar(primary: action) } else { self }
    }
}

extension View {
    /// The Safepay payment link sheet for whichever request `request` is set to.
    func safepayLinkSheet(_ request: Binding<SafepayLinkRequest?>) -> some View {
        sheet(item: request) { r in
            SafepayLinkSheet(request: r)
        }
    }
}
