import SwiftUI
import ERPCore

/// Settings → Integrations → Selling on the website (components/settings/website-settings.tsx): whether the site
/// shows prices and takes orders, how a piece is priced on top of its gold, delivery, how fresh the rate must be,
/// and which ERP category a bought piece is filed under. Read live from `app_settings/website`; saved whole through
/// /api/app/write `saveWebsiteConfig` (lib/writes/website-config.ts), the page's own write, which checks every figure.
/// The bank account is not here: it is the server's environment, so nothing that writes the books can move a payment.
struct WebsiteSellingSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Selling on the website") { WebsiteSellingForm() }
    }
}

/// One collection's pricing, or the default's: a karat and three charges. A collection's row sets only what differs.
struct WebsitePricing: Decodable, Equatable {
    var karat: String?
    var wastagePercentage: Double?
    var makingChargesPerGram: Double?
    var stoneChargesDefault: Double?

    private enum K: String, CodingKey { case karat, wastagePercentage, makingChargesPerGram, stoneChargesDefault }

    init(karat: String? = nil, wastagePercentage: Double? = nil, makingChargesPerGram: Double? = nil, stoneChargesDefault: Double? = nil) {
        self.karat = karat
        self.wastagePercentage = wastagePercentage
        self.makingChargesPerGram = makingChargesPerGram
        self.stoneChargesDefault = stoneChargesDefault
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        karat = c.string(.karat).flatMap { $0.isEmpty ? nil : $0 }
        wastagePercentage = c.double(.wastagePercentage)
        makingChargesPerGram = c.double(.makingChargesPerGram)
        stoneChargesDefault = c.double(.stoneChargesDefault)
    }

    /// Only the fields set, as the page's JSON leaves an emptied box out.
    var json: [String: Any] {
        var d: [String: Any] = [:]
        if let karat, !karat.isEmpty { d["karat"] = karat }
        if let wastagePercentage { d["wastagePercentage"] = wastagePercentage }
        if let makingChargesPerGram { d["makingChargesPerGram"] = makingChargesPerGram }
        if let stoneChargesDefault { d["stoneChargesDefault"] = stoneChargesDefault }
        return d
    }
}

/// `app_settings/website` (lib/website/types.ts WebsiteConfig), with the page's defaults for what is missing.
struct WebsiteSellingConfig: Decodable, Equatable {
    var enabled = false
    var defaultPricing = WebsitePricing(karat: "21k", wastagePercentage: 0, makingChargesPerGram: 0, stoneChargesDefault: 0)
    var categoryPricing: [String: WebsitePricing] = [:]
    var diamondPolicy = "enquire"
    var diamondChargesDefault: Double = 0
    var palladiumKarat = "18k"
    var deliveryCharge: Double = 0
    var freeDeliveryOver: Double?
    var maxRateAgeHours: Double?
    var posCategoryId = ""
    var updatedAt: String?

    private enum K: String, CodingKey {
        case enabled, defaultPricing, categoryPricing, diamondPolicy, diamondChargesDefault, palladiumKarat
        case deliveryCharge, freeDeliveryOver, maxRateAgeHours, posCategoryId, updatedAt
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let base = WebsiteSellingConfig()
        enabled = c.bool(.enabled, default: false)
        // The page fills a stored default's missing fields from its own (website-settings.tsx).
        let stored = c.object(.defaultPricing, of: WebsitePricing.self)
        defaultPricing = WebsitePricing(
            karat: stored?.karat ?? base.defaultPricing.karat,
            wastagePercentage: stored?.wastagePercentage ?? 0,
            makingChargesPerGram: stored?.makingChargesPerGram ?? 0,
            stoneChargesDefault: stored?.stoneChargesDefault ?? 0
        )
        let rows = c.object(.categoryPricing, of: [String: Lossy<WebsitePricing>].self) ?? [:]
        categoryPricing = rows.compactMapValues(\.value)
        diamondPolicy = c.string(.diamondPolicy) == "gold_only" ? "gold_only" : "enquire"
        diamondChargesDefault = c.double(.diamondChargesDefault) ?? 0
        palladiumKarat = c.string(.palladiumKarat) == "12k" ? "12k" : "18k"
        deliveryCharge = c.double(.deliveryCharge) ?? 0
        freeDeliveryOver = c.double(.freeDeliveryOver).flatMap { $0 > 0 ? $0 : nil }
        maxRateAgeHours = c.double(.maxRateAgeHours).flatMap { $0 > 0 ? $0 : nil }
        posCategoryId = c.string(.posCategoryId, default: "")
        updatedAt = c.string(.updatedAt)
    }

    /// What saveWebsiteConfig takes: the whole document, as the page saves it.
    var json: [String: Any] {
        var d: [String: Any] = [
            "enabled": enabled,
            "defaultPricing": defaultPricing.json,
            "categoryPricing": categoryPricing.mapValues(\.json),
            "diamondPolicy": diamondPolicy,
            "diamondChargesDefault": diamondChargesDefault,
            "palladiumKarat": palladiumKarat,
            "deliveryCharge": deliveryCharge,
            "posCategoryId": posCategoryId,
        ]
        if let freeDeliveryOver, freeDeliveryOver > 0 { d["freeDeliveryOver"] = freeDeliveryOver }
        if let maxRateAgeHours, maxRateAgeHours > 0 { d["maxRateAgeHours"] = maxRateAgeHours }
        return d
    }

    /// What the site cannot sell without (the page's `missing`, lib/website/config.ts configReadiness).
    var missing: [String] {
        var m: [String] = []
        if posCategoryId.isEmpty { m.append("an ERP category for website products") }
        if !((defaultPricing.makingChargesPerGram ?? 0) > 0) { m.append("a default making charge per gram") }
        return m
    }
}

private struct WebsiteSellingForm: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var doc = Single<WebsiteSellingConfig>(Collections.settings, Collections.websiteConfigDoc)
    /// The form as the person has left it; `base` is what the book held when it was last taken in.
    @State private var draft = WebsiteSellingConfig()
    @State private var base = WebsiteSellingConfig()
    @State private var taken = false
    @State private var saving = false
    @State private var adding = ""
    @State private var note: Note?
    @State private var failure: String?
    @State private var confirmingDiscard = false

    /// The site's collection folders, the keys a collection's pricing is written under (website-settings.tsx SITE_COLLECTIONS).
    static let siteCollections = [
        "Rings", "Diamond Rings", "Bands", "Palladium Bands for Him",
        "Bangles", "Thin Bangles", "Kara Churi set", "Karay", "Stone Bangles", "Diamond Bangles", "Bracelet", "Diamond Bracelets", "String Bracelets", "Bangle & Ring",
        "Chains", "Lockets", "Contemporary Lockets", "Takhti", "Taweez",
        "Gold Sets", "Diamond Sets", "Stone Sets", "String Set", "Locket Set With Bangle", "Locket sets without Bangle",
        "Tops", "Diamond Tops", "Jhumki", "Baali",
    ]
    static let karats = ["18k", "21k", "22k", "24k"]
    /// lib/website/config.ts DEFAULT_MAX_RATE_AGE_HOURS.
    static let defaultRateAge = 36.0

    private var dirty: Bool { draft != base }
    private var overridden: [String] { draft.categoryPricing.keys.sorted { a, b in
        (Self.siteCollections.firstIndex(of: a) ?? .max, a) < (Self.siteCollections.firstIndex(of: b) ?? .max, b)
    } }

    var body: some View {
        Group {
            if !doc.loaded {
                SkeletonLoading().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = doc.error, doc.value == nil, !taken {
                NotAvailableState("Couldn’t read the website settings", why: error, symbol: "exclamationmark.icloud")
            } else {
                form
            }
        }
        .navigationTitle("Selling on the website")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .disabled(!dirty || saving)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .confirmDestructive(isPresented: $confirmingDiscard, title: "Discard your changes?",
                            message: "The form goes back to what was last saved.", action: "Discard changes") { draft = base }
        .noteToast($note)
        .failureAlert($failure, title: "Not saved")
        .onAppear { doc.need() }
        .onDisappear { doc.reset() }
        .onChange(of: doc.loaded) { _, _ in takeIn() }
        .onChange(of: doc.value) { _, _ in takeIn() }
    }

    /// The book's copy replaces the form only where nothing has been changed on it.
    private func takeIn() {
        guard doc.loaded else { return }
        let fresh = doc.value ?? WebsiteSellingConfig()
        if !taken || !dirty { draft = fresh }
        base = fresh
        taken = true
    }

    private var form: some View {
        Form { Group {
            Section {
                Toggle(isOn: $draft.enabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show prices and take orders")
                        Text(draft.enabled ? "On. The site shows prices for every piece with a readable weight." : "Off. The site shows no prices; every piece is enquiry-only.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !draft.missing.isEmpty {
                    Label("Before this can work, set \(draft.missing.joined(separator: " and ")).", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Tone.owed.color)
                }
            } footer: {
                Text("The site prices each photographed piece live, weight × today’s rate for its karat plus what you set here, and creates the product and the order in the ERP when a customer checks out. Payment is by bank transfer; you confirm it on the order.")
            }

            Section {
                Picker("ERP category", selection: $draft.posCategoryId) {
                    Text("Choose a category").tag("")
                    ForEach(categoryChoices) { (c: StockKit.Category) in Text(c.title).tag(c.id) }
                }
                Picker("Diamond-set pieces", selection: $draft.diamondPolicy) {
                    Text("Price on request").tag("enquire")
                    Text("Price the gold, add a diamond charge").tag("gold_only")
                }
                if draft.diamondPolicy == "gold_only" {
                    amountRow("Default diamond charge, Rs", $draft.diamondChargesDefault)
                }
            } header: {
                LedgerHeading(title: "Orders")
            } footer: {
                Text("A product is created in that category the moment a piece is bought, none before. Diamond pieces priced on request are recommended.")
            }

            Section {
                Picker("Karat", selection: Binding(get: { draft.defaultPricing.karat ?? "21k" }, set: { draft.defaultPricing.karat = $0 })) {
                    ForEach(Self.karats, id: \.self) { Text($0).tag($0) }
                }
                optionalRow("Wastage %", Binding(get: { draft.defaultPricing.wastagePercentage }, set: { draft.defaultPricing.wastagePercentage = $0 ?? 0 }), placeholder: "0", decimal: true)
                optionalRow("Making, Rs per gram", Binding(get: { draft.defaultPricing.makingChargesPerGram }, set: { draft.defaultPricing.makingChargesPerGram = $0 ?? 0 }), placeholder: "0")
                optionalRow("Stones, Rs per piece", Binding(get: { draft.defaultPricing.stoneChargesDefault }, set: { draft.defaultPricing.stoneChargesDefault = $0 ?? 0 }), placeholder: "0")
                Picker("Palladium karat", selection: $draft.palladiumKarat) {
                    Text("18k").tag("18k")
                    Text("12k").tag("12k")
                }
            } header: {
                LedgerHeading(title: "Default pricing")
            } footer: {
                Text("Applies to every collection without its own row below.")
            }

            Section {
                if overridden.isEmpty {
                    Text("Every collection uses the default pricing.").foregroundStyle(.secondary)
                }
                ForEach(overridden, id: \.self) { name in collectionRow(name) }
                    .onDelete { offsets in
                        let names = overridden
                        for i in offsets { draft.categoryPricing[names[i]] = nil }
                    }
                let left = Self.siteCollections.filter { draft.categoryPricing[$0] == nil }
                if !left.isEmpty {
                    Picker("Add a collection", selection: $adding) {
                        Text("Choose…").tag("")
                        ForEach(left, id: \.self) { Text($0).tag($0) }
                    }
                    .onChange(of: adding) { _, name in
                        guard !name.isEmpty else { return }
                        draft.categoryPricing[name] = WebsitePricing()
                        adding = ""
                    }
                }
            } header: {
                LedgerHeading(title: "Per-collection pricing")
            } footer: {
                Text("Only the fields you fill differ from the default. Swipe a collection to remove it.")
            }

            Section {
                amountRow("Delivery charge, Rs", $draft.deliveryCharge)
                optionalRow("Free delivery over, Rs", $draft.freeDeliveryOver, placeholder: "None")
            } header: {
                LedgerHeading(title: "Delivery")
            } footer: {
                Text("Leopards, anywhere in Pakistan. Booked by you after the transfer clears.")
            }

            Section {
                optionalRow("Rate fresh for, hours", $draft.maxRateAgeHours, placeholder: "\(Int(Self.defaultRateAge))")
            } header: {
                LedgerHeading(title: "Today’s rate")
            } footer: {
                Text("The site sells only while the counter’s gold rate was set this recently (\(Int(Self.defaultRateAge)) hours when empty). Older, and every piece says to ask on WhatsApp until the rate is set again.")
            }

            Section {
                Text("The bank account shown to customers is kept by whoever manages the ERP, not here, so nothing that can write to the books can change where the money goes.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let at = base.updatedAt, !at.isEmpty {
                    LabeledContent("Last saved", value: ShopDate.say(at, withTime: true))
                }
            }

            if dirty {
                Section {
                    Button("Discard changes", role: .destructive) { confirmingDiscard = true }
                        .disabled(saving)
                }
            }
            }
            .houseRows()
        }
    }

    /// The ERP's categories, and the one saved if the list no longer has it.
    private var categoryChoices: [StockKit.Category] {
        var out = StockKit.categories
        if !draft.posCategoryId.isEmpty && !out.contains(where: { $0.id == draft.posCategoryId }) {
            out.append(StockKit.Category(id: draft.posCategoryId, title: draft.posCategoryId))
        }
        return out
    }

    private func collectionRow(_ name: String) -> some View {
        let row = Binding<WebsitePricing>(
            get: { draft.categoryPricing[name] ?? WebsitePricing() },
            set: { draft.categoryPricing[name] = $0 }
        )
        let def = draft.defaultPricing
        return VStack(alignment: .leading, spacing: 8) {
            Text(name).font(.headline)
            Picker("Karat", selection: Binding<String>(get: { row.wrappedValue.karat ?? "" }, set: { row.wrappedValue.karat = $0.isEmpty ? nil : $0 })) {
                Text("Default (\(def.karat ?? "21k"))").tag("")
                ForEach(Self.karats, id: \.self) { Text($0).tag($0) }
            }
            optionalRow("Wastage %", row.wastagePercentage, placeholder: Self.plain(def.wastagePercentage), decimal: true)
            optionalRow("Making per gram", row.makingChargesPerGram, placeholder: Self.plain(def.makingChargesPerGram))
            optionalRow("Stones", row.stoneChargesDefault, placeholder: Self.plain(def.stoneChargesDefault))
        }
        .padding(.vertical, 4)
    }

    /// A sum of money: whole rupees (owner, 2026-10-17: "there should be no decimals").
    private func amountRow(_ title: String, _ value: Binding<Double>) -> some View {
        let whole = Binding<Double>(get: { value.wrappedValue.rounded() }, set: { value.wrappedValue = $0.rounded() })
        return LabeledContent(title) {
            TextField("0", value: whole, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }

    /// A figure that may be left empty (a collection's row falls back to the default; delivery has no threshold).
    private func optionalRow(_ title: String, _ value: Binding<Double?>, placeholder: String, decimal: Bool = false) -> some View {
        LabeledContent(title) {
            TextField(placeholder, value: value, format: .number)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }

    static func plain(_ v: Double?) -> String {
        guard let v else { return "" }
        return v == v.rounded() ? String(Int(v)) : String(v)
    }

    private func save() async {
        guard dirty, !saving else { return }
        saving = true
        defer { saving = false }
        let sending = draft
        do {
            // `seq` makes each save its own: the same form saved twice within half a minute is two saves (ERPAPI).
            try await ERPAPI.shared.write("saveWebsiteConfig", ["config": sending.json, "seq": UUID().uuidString])
            base = sending
            Note.show(Note(title: "Website settings saved",
                           detail: sending.enabled ? "The site shows prices at the next rate refresh." : "Selling is switched off; the site shows no prices."),
                      in: $note, reduce: reduceMotion)
        } catch {
            failure = error.localizedDescription
        }
    }
}
