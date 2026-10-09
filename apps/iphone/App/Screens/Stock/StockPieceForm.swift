import SwiftUI
import ERPCore

/// Add a piece to stock (/products/add) or edit one (/products/<sku>/edit): the ERP's product form
/// (src/components/product/product-form.tsx), every field it edits, in its order and under its checks,
/// saved through the ERP (`addProduct` / `updateProduct` on /api/app/write, lib/writes/products.ts): the
/// same SKU numbering, names and gold coin rules as the browser's store. Owners only, as Stock is.
///
/// The photo is the one thing not here: the web uploads it to Firebase Storage from the browser, and the
/// ERP has no route a phone could send one through, so Photo opens the ERP's own edit page. An edit never
/// sends the photo, the tag's QR or the Shopify ids, so what is on file stays.
///
/// The web form puts the wastage back to 10% (25% with diamonds) whenever the metal, the diamonds, the
/// stones or the category changes, and also as it opens. Here an edit opens on the piece's own wastage, so
/// changing only its name never moves its price; every other reset is the web's, on opening and on change.
struct StockPieceForm: View {
    /// nil adds a piece.
    let sku: String?

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    var body: some View {
        content
            .task {
                book.products.need()
                book.settings.need()
            }
    }

    @ViewBuilder
    private var content: some View {
        if !session.isOwner {
            ContentUnavailableView("Only an owner can change the stock", systemImage: "lock", description: Text("Ask an owner to add or edit the piece."))
                .navigationTitle(sku == nil ? "Add piece" : "Edit piece")
                .navigationBarTitleDisplayMode(.inline)
        } else if let sku {
            ShelfState(loaded: book.products.loaded, error: book.products.error, offline: book.products.offline) {
                if let p = book.products.item(sku) {
                    StockPieceEditor(original: p)
                } else {
                    notInStock(sku)
                }
            }
            .navigationTitle("Edit piece")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            StockPieceEditor(original: nil)
        }
    }

    /// A sold piece has left the stock, and the ERP's edit page cannot find it either; its own page says where it went.
    private func notInStock(_ sku: String) -> some View {
        ContentUnavailableView {
            Label("Not in stock", systemImage: "shippingbox")
        } description: {
            Text("\(sku) is not in stock, so it cannot be edited. A sold piece stays as it was sold.")
        } actions: {
            NavigationLink(value: Route(path: StockKit.piecePath(sku))) { Text("Open \(sku)") }
        }
    }
}

// MARK: The form

private struct StockPieceEditor: View {
    /// The piece being edited, as it was when the form opened; nil adds one.
    let original: Product?

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var f: StockPieceFields
    @State private var saving = false
    @State private var failure: String?
    @State private var saved: Saved?
    @State private var tick = 0

    private struct Saved: Equatable {
        let sku: String
        let name: String
    }

    init(original: Product?) {
        self.original = original
        var start: StockPieceFields
        if let original {
            start = StockPieceFields(original)
            start.settle(keepWastage: true)
        } else {
            start = StockPieceFields()
            start.settle()
        }
        _f = State(initialValue: start)
    }

    private var editing: Bool { original != nil }

    var body: some View {
        Group {
            if let saved {
                savedPage(saved)
            } else {
                form
            }
        }
        .navigationTitle(saved != nil ? "Saved" : (editing ? "Edit piece" : "Add piece"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if saved == nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving)
                }
            }
            if saved != nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .alert(editing ? "The piece wasn't saved" : "The piece wasn't added", isPresented: failureShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .sensoryFeedback(.success, trigger: tick)
        .interactiveDismissDisabled(saving)
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    private var form: some View {
        Form { Group {
            pieceSection
            if f.silver { finishSection }
            if f.isMensRing && !f.fixed { secondMetalSection }
            sizeSection
            priceSection
            if !f.fixed && !f.isGoldCoin { stonesSection }
            photoSection
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .newOrderKeyboardDone()
        .disabled(saving)
        // What the web form's effect watches: the coin, the diamonds, the stones, the metals, the men's ring.
        .onChange(of: f.ruleKey) { _, _ in f.settle() }
    }

    // MARK: The piece

    private var categoryOptions: [StockKit.Category] {
        var out: [StockKit.Category] = StockKit.categories
        // A category the ERP's list no longer has stays selectable on the piece that carries it.
        if !f.categoryId.isEmpty && !out.contains(where: { $0.id == f.categoryId }) {
            out.append(StockKit.Category(id: f.categoryId, title: f.categoryId))
        }
        return out
    }

    private var metalOptions: [String] {
        var out: [String] = METAL_TYPES.map { $0.rawValue }
        if !out.contains(f.metalType) { out.append(f.metalType) }
        return out
    }

    /// The product form offers a karat for gold only (palladium's is the order form's and the sale's).
    private var karatOptions: [String] {
        var out: [String] = karatsFor(MetalType.gold).map { $0.rawValue }
        if !f.karat.isEmpty && !out.contains(f.karat) { out.append(f.karat) }
        return out
    }

    private var pieceSection: some View {
        Section {
            Picker("Category", selection: $f.categoryId) {
                if f.categoryId.isEmpty { Text("Choose").tag("") }
                ForEach(categoryOptions) { (c: StockKit.Category) in
                    Text(c.title).tag(c.id)
                }
            }
            // A fixed-price piece is named by its description (that is what the save writes into its name),
            // so the box that names the piece is whichever one the price mode uses.
            if f.fixed {
                TextField("Description", text: $f.description, prompt: Text("e.g. Turkish silver ring with onyx stone"), axis: .vertical)
                    .lineLimit(2...5)
            } else {
                TextField("Name", text: $f.name, prompt: Text("Name (optional)"))
            }
            Picker("Metal", selection: $f.metalType) {
                ForEach(metalOptions, id: \.self) { (m: String) in
                    Text(metalLabel(m)).tag(m)
                }
            }
            if f.metalType == "gold" {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Karat").font(.caption).foregroundStyle(.secondary)
                    Picker("Karat", selection: $f.karat) {
                        ForEach(karatOptions, id: \.self) { (k: String) in
                            Text(karatLabel(k)).tag(k)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
        } header: {
            Text("The piece")
        } footer: {
            if !f.fixed {
                Text("Left blank, the name is made from the category and the SKU.")
            }
        }
    }

    private var platingOptions: [String] {
        var out: [String] = SalePlating.all
        if !f.platingType.isEmpty && !out.contains(f.platingType) { out.append(f.platingType) }
        return out
    }

    private var finishSection: some View {
        Section("925 Sterling Silver finish") {
            Picker("Plating", selection: $f.platingType) {
                Text("No plating").tag("")
                ForEach(platingOptions, id: \.self) { (p: String) in
                    Text(p).tag(p)
                }
            }
            if f.platingType == "Other" {
                TextField("Describe the plating", text: $f.platingNote, prompt: Text("e.g. Rose gold plating"))
            }
            Toggle("Nickel free", isOn: $f.nickelFree)
        }
    }

    /// A men's ring can carry a second metal, priced from the rate only (the web's "Second metal").
    private var secondMetalSection: some View {
        Section {
            Picker("Metal", selection: $f.secondMetal) {
                Text("None").tag("")
                ForEach(METAL_TYPES, id: \.rawValue) { (m: MetalType) in
                    Text(metalLabel(m)).tag(m.rawValue)
                }
            }
            if f.secondMetal == "gold" {
                Picker("Karat", selection: $f.secondKarat) {
                    if f.secondKarat.isEmpty { Text("Choose").tag("") }
                    ForEach(karatsFor(MetalType.gold), id: \.rawValue) { (k: KaratValue) in
                        Text(karatLabel(k)).tag(k.rawValue)
                    }
                }
            }
            if !f.secondMetal.isEmpty {
                NewOrderNumberRow(title: "Weight", text: $f.secondWeight, prompt: "e.g. 1.25", unit: "g")
            }
        } header: {
            Text("Second metal")
        } footer: {
            Text("Optional.")
        }
    }

    // MARK: Size

    /// A category with a scale picks its size from it (the web's SizePicker); any other category has no size.
    @ViewBuilder
    private var sizeSection: some View {
        if let scale = NewOrderSizes.scale(for: f.categoryId) {
            Section {
                if scale.multi {
                    ForEach(scale.parts) { (part: NewOrderSizes.Part) in
                        NewOrderSizeField(title: part.label, options: part.options, value: partBinding(scale, part))
                    }
                } else if let only = scale.parts.first {
                    NewOrderSizeField(title: "Size", options: only.options, value: $f.size)
                }
            } header: {
                Text("Size")
            } footer: {
                Text(scale.multi ? scale.label + ". Leave either blank if not applicable." : scale.label)
            }
        }
    }

    private func partBinding(_ scale: NewOrderSizes.Scale, _ part: NewOrderSizes.Part) -> Binding<String> {
        Binding(
            get: { NewOrderSizes.parse(f.size, legacyKey: scale.legacyPartKey)[part.key] ?? "" },
            set: { typed in
                var parsed = NewOrderSizes.parse(f.size, legacyKey: scale.legacyPartKey)
                parsed[part.key] = typed
                f.size = NewOrderSizes.compose(parsed, order: scale.parts.map { $0.key })
            }
        )
    }

    // MARK: Price

    private var priceSection: some View {
        Section {
            Picker("How it is priced", selection: $f.fixed) {
                Text("Weight × rate").tag(false)
                Text("Fixed price").tag(true)
            }
            .pickerStyle(.segmented)
            if f.fixed {
                NewOrderNumberRow(title: "Price (PKR)", text: $f.customPrice, prompt: "e.g. 15000")
                NewOrderNumberRow(title: "Reference rate per gram", text: $f.silverRate, prompt: "Optional")
            } else {
                NewOrderNumberRow(title: "Weight", text: $f.weight, prompt: "e.g. 5.75", unit: "g")
                if f.silver {
                    NewOrderNumberRow(title: "Rate per gram (PKR)", text: $f.silverRate, prompt: "e.g. 275")
                } else if !f.isGoldCoin {
                    NewOrderNumberRow(title: "Wastage (%)", text: $f.wastage, prompt: "e.g. 10")
                }
                if !f.isGoldCoin {
                    if !f.silver {
                        NewOrderNumberRow(title: "Making (PKR)", text: $f.making, prompt: "e.g. 5000")
                    }
                    NewOrderNumberRow(title: "Misc (PKR)", text: $f.miscCharges, prompt: "e.g. 250")
                }
            }
            if let price = todaysPrice {
                LabeledContent("At today's rates") {
                    Text(price > 0 ? Money.pkr(price) : "Price N/A")
                        .fontWeight(.semibold)
                        .monospacedDigit()
                }
            }
        } header: {
            Text("Price")
        } footer: {
            priceFooter
        }
    }

    @ViewBuilder
    private var priceFooter: some View {
        if f.fixed {
            Text("The reference rate is for the shop's own record only: it does not change the price.")
        } else if f.silver {
            Text("The rate is all-inclusive, for this piece. 0 uses the silver rate in settings.")
        } else if f.isGoldCoin {
            Text("A gold coin is sold by its weight alone: no making, wastage, stones or sundries.")
        }
    }

    /// What the piece sells for today, as the piece page will price it once saved (ERPCore's calculateProductCosts).
    private var todaysPrice: Double? {
        guard let rates = StockKit.rates(book.settings.value) else { return nil }
        return calculateProductCosts(f.priced, rates).totalPrice
    }

    // MARK: Diamonds and stones

    private var stonesSection: some View {
        Section("Diamonds and stones") {
            Toggle("Has diamonds", isOn: $f.hasDiamonds)
            if f.hasDiamonds {
                NewOrderNumberRow(title: "Diamonds (PKR)", text: $f.diamondCharges, prompt: "e.g. 50000")
                TextField("Diamond details", text: $f.diamondDetails, prompt: Text("e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2"), axis: .vertical)
                    .lineLimit(2...4)
            }
            Toggle("Has other stones", isOn: $f.hasStones)
            if f.hasStones {
                NewOrderNumberRow(title: "Stone weight", text: $f.stoneWeight, prompt: "e.g. 0.5", unit: "g")
                NewOrderNumberRow(title: "Stones (PKR)", text: $f.stoneCharges, prompt: "e.g. 15000")
                TextField("Stone details", text: $f.stoneDetails, prompt: Text("e.g. 1 × ruby 2ct, and 2g gold accent"), axis: .vertical)
                    .lineLimit(2...4)
            }
        }
    }

    // MARK: Photo

    /// Photos are the ERP's page: it uploads them from the browser, and the phone has no way to send one.
    @ViewBuilder
    private var photoSection: some View {
        if let original {
            let photo: String? = StockKit.filled(original.imageUrl)
            Section {
                if let photo {
                    StockImage(imageUrl: photo, name: original.name, key: original.sku, decodeDataURI: true)
                        .frame(width: 96, height: 96)
                        .clipShape(.rect(cornerRadius: 12))
                }
                NavigationLink(value: Route(path: StockKit.editPath(original.sku) + "?web=1")) {
                    Label(photo == nil ? "Add a photo in the ERP" : "Change the photo in the ERP", systemImage: "photo")
                }
            } header: {
                Text("Photo")
            } footer: {
                Text("The photo is uploaded on the ERP's own page. Everything else saves here, and saving here keeps the photo.")
            }
        } else {
            Section {
                Label("Add the photo once the piece is saved", systemImage: "photo")
                    .foregroundStyle(.secondary)
            } header: {
                Text("Photo")
            } footer: {
                Text("The photo is uploaded on the ERP's own page, which opens from here after saving.")
            }
        }
    }

    // MARK: Saved

    private func savedPage(_ s: Saved) -> some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.green)
                    Text("Saved").font(.title2.weight(.semibold))
                    Text("\(s.name) is in stock as \(s.sku).").foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                NavigationLink(value: Route(path: StockKit.editPath(s.sku) + "?web=1")) {
                    Label("Add a photo", systemImage: "photo")
                }
                Button { startAnother() } label: {
                    Label("Add another piece", systemImage: "plus.square.on.square")
                }
            } footer: {
                Text("The photo is added on the ERP's own page. Another piece starts in the same category.")
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaBar(edge: .bottom) {
            NavigationLink(value: Route(path: StockKit.piecePath(s.sku))) {
                Text("Open \(s.sku)").frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    /// The web's "Save & Add Another": a fresh form in the same category.
    private func startAnother() {
        var next = StockPieceFields()
        next.categoryId = f.categoryId
        next.settle()
        f = next
        failure = nil
        saved = nil
    }

    // MARK: Save

    private func save() async {
        guard !saving else { return }
        SaleKeyboard.dismiss()
        if let problem = f.problem {
            failure = problem
            return
        }
        saving = true
        do {
            if let original {
                try await ERPAPI.shared.write("updateProduct", ["sku": original.sku, "piece": f.piece])
                tick += 1
                saving = false
                dismiss()
                return
            }
            let out = try await ERPAPI.shared.write("addProduct", ["piece": f.piece])
            let doc: [String: Any] = out["product"] as? [String: Any] ?? [:]
            let newSku: String = doc["sku"] as? String ?? ""
            let made: Product? = newSku.isEmpty ? nil : DocJSON.decode(Product.self, id: newSku, data: doc)
            tick += 1
            saved = Saved(sku: newSku, name: made?.name ?? newSku)
        } catch {
            failure = error.localizedDescription
        }
        saving = false
    }
}

// MARK: What the form holds

/// Everything the product form edits (product-form.tsx `ProductFormData`), held as text so the boxes stay
/// editable. `piece` is what goes to the ERP, which checks it again with the form's own schema and shapes it
/// as the form's `processAndSubmit` does (lib/writes/products.ts `cleanProductForm`).
struct StockPieceFields: Equatable {
    /// lib/pricing.ts GOLD_COIN_CATEGORY_ID; lib/writes/products.ts MENS_RING_CATEGORY.
    static let goldCoin = "cat017"
    static let mensRing = "cat018"

    var name = ""
    var categoryId = ""
    /// The house's own metal: the silver house starts on silver, the gold house on gold.
    var metalType = House.metal
    /// A new piece opens on 21k, the karat the shop sells.
    var karat = "21k"
    var weight = ""
    /// Silver's all-in rate for this piece; a fixed price's reference rate.
    var silverRate = ""
    /// "" is no second metal (a men's ring only).
    var secondMetal = ""
    var secondKarat = ""
    var secondWeight = ""
    var wastage = "10"
    var making = ""
    var hasDiamonds = false
    /// A new piece opens with the stone fields in play, as on the web.
    var hasStones = true
    var stoneWeight = ""
    var diamondCharges = ""
    var stoneCharges = ""
    var miscCharges = ""
    var stoneDetails = ""
    var diamondDetails = ""
    /// `isCustomPrice`.
    var fixed = false
    var customPrice = ""
    var description = ""
    var size = ""
    var platingType = ""
    var platingNote = ""
    var nickelFree = false

    init() {}

    /// A piece's own figures, as the web form opens on them (`getSafeDefaultValues(p)`).
    init(_ p: Product) {
        name = p.name
        categoryId = p.categoryId
        metalType = p.metalType.rawValue.isEmpty ? House.metal : p.metalType.rawValue
        karat = p.karat?.rawValue ?? ""
        weight = Self.box(p.metalWeightG, 3)
        silverRate = Self.box(p.silverRatePerGram ?? 0, 2)
        secondMetal = p.secondaryMetalType?.rawValue ?? ""
        secondKarat = p.secondaryMetalKarat?.rawValue ?? ""
        secondWeight = Self.box(p.secondaryMetalWeightG ?? 0, 3)
        wastage = NewOrderFormat.trimmed(p.wastagePercentage, digits: 2)
        making = Self.box(p.makingCharges, 2)
        hasDiamonds = p.hasDiamonds
        hasStones = p.hasStones
        stoneWeight = Self.box(p.stoneWeightG, 3)
        diamondCharges = Self.box(p.diamondCharges, 2)
        stoneCharges = Self.box(p.stoneCharges, 2)
        miscCharges = Self.box(p.miscCharges, 2)
        stoneDetails = p.stoneDetails ?? ""
        diamondDetails = p.diamondDetails ?? ""
        fixed = p.isCustomPrice
        customPrice = Self.box(p.customPrice ?? 0, 2)
        description = p.description ?? ""
        size = p.size ?? ""
        platingType = p.platingType ?? ""
        platingNote = p.platingNote ?? ""
        nickelFree = p.nickelFree
    }

    /// A number in its box: blank for 0 (decisions.md "Number fields").
    private static func box(_ x: Double, _ digits: Int) -> String { NewOrderFormat.boxText(x, digits: digits) }

    private static func num(_ s: String) -> Double { NewOrderFormat.num(s) }
    private static func trim(_ s: String) -> String { NewOrderFormat.trim(s) }

    var isGoldCoin: Bool { categoryId == Self.goldCoin && metalType == "gold" }
    var isMensRing: Bool { categoryId == Self.mensRing }
    var silver: Bool { metalType == "silver" }

    /// What the web form's effect watches; any change runs `settle`.
    struct RuleKey: Equatable {
        let coin: Bool
        let diamonds: Bool
        let stones: Bool
        let mensRing: Bool
        let metal: String
        let second: String
    }

    var ruleKey: RuleKey {
        RuleKey(coin: isGoldCoin, diamonds: hasDiamonds, stones: hasStones, mensRing: isMensRing, metal: metalType, second: secondMetal)
    }

    /// The web form's effect, line for line: a gold coin carries nothing but its metal (and is 24k), silver has
    /// no wastage or making, no diamonds means no diamond charge, no stones no stone weight; a karat for gold
    /// only, a second metal on a men's ring only. `keepWastage` keeps a piece's own wastage as an edit opens.
    mutating func settle(keepWastage: Bool = false) {
        if isGoldCoin {
            hasDiamonds = false
            hasStones = false
            diamondCharges = ""
            wastage = "0"
            making = ""
            stoneCharges = ""
            miscCharges = ""
            stoneDetails = ""
            diamondDetails = ""
            stoneWeight = ""
            karat = "24k"
        } else if silver {
            wastage = "0"
            making = ""
        } else {
            if hasDiamonds {
                if !keepWastage { wastage = "25" }
            } else {
                if !keepWastage { wastage = "10" }
                diamondCharges = ""
                diamondDetails = ""
            }
            if !hasStones {
                stoneWeight = ""
                stoneDetails = ""
            }
        }

        if metalType != "gold" {
            karat = ""
        } else if karat.isEmpty {
            karat = "21k"
        }

        if !isMensRing && (!secondMetal.isEmpty || Self.num(secondWeight) != 0) {
            secondMetal = ""
            secondKarat = ""
            secondWeight = ""
        }
        if !secondMetal.isEmpty && secondMetal != "gold" {
            secondKarat = ""
        }
    }

    /// The first thing the web form would refuse (its zod schema, in its order), or nil.
    var problem: String? {
        if categoryId.isEmpty { return "Category is required" }
        let amounts: [(String, String)] = [
            ("Metal weight", weight), ("Rate per gram", silverRate), ("Secondary metal weight", secondWeight),
            ("Wastage", wastage), ("Making charges", making), ("Stone weight", stoneWeight),
            ("Diamond charges", diamondCharges), ("Stone charges", stoneCharges), ("Misc charges", miscCharges),
            ("Price", customPrice),
        ]
        for (label, text) in amounts where Self.num(text) < 0 {
            return "\(label) must be non-negative"
        }
        if Self.num(wastage) > 100 { return "Wastage must be between 0 and 100" }

        if fixed {
            if Self.trim(description).count < 3 { return "Description is required for custom priced items." }
            if Self.num(customPrice) <= 0 { return "A positive price is required." }
        }
        if !fixed && Self.num(weight) < 0.001 { return "Metal weight must be a positive number" }
        if !fixed {
            if metalType == "gold" && karat.isEmpty { return "Karat is required for gold items." }
            if secondMetal == "gold" && secondKarat.isEmpty { return "Karat is required for secondary gold metal." }
            if !secondMetal.isEmpty && Self.num(secondWeight) <= 0 { return "A positive weight is required for secondary metal." }
            if Self.num(stoneWeight) > Self.num(weight) + Self.num(secondWeight) {
                return "Stone weight cannot be greater than the total metal weight."
            }
        }
        return nil
    }

    /// The form's fields as the ERP's `piece`: every field it edits, numbers as numbers, a karat only when set.
    var piece: [String: Any] {
        var out: [String: Any] = [
            "name": Self.trim(name),
            "categoryId": categoryId,
            "metalType": metalType,
            "metalWeightG": Self.num(weight),
            "silverRatePerGram": Self.num(silverRate),
            "secondaryMetalType": secondMetal,
            "secondaryMetalKarat": secondKarat,
            "secondaryMetalWeightG": Self.num(secondWeight),
            "wastagePercentage": Self.num(wastage),
            "makingCharges": Self.num(making),
            "hasDiamonds": hasDiamonds,
            "hasStones": hasStones,
            "stoneWeightG": Self.num(stoneWeight),
            "diamondCharges": Self.num(diamondCharges),
            "stoneCharges": Self.num(stoneCharges),
            "miscCharges": Self.num(miscCharges),
            "stoneDetails": Self.trim(stoneDetails),
            "diamondDetails": Self.trim(diamondDetails),
            "isCustomPrice": fixed,
            "customPrice": Self.num(customPrice),
            "description": Self.trim(description),
            "size": Self.trim(size),
            "platingType": platingType,
            "platingNote": Self.trim(platingNote),
            "nickelFree": nickelFree,
        ]
        if !karat.isEmpty { out["karat"] = karat }
        return out
    }

    /// The piece as the ERP will price it once saved: the store's rules applied (a coin's charges at nothing,
    /// gold without a karat at 21k, a second metal on a men's ring only).
    var priced: PricedPiece {
        let coin = isGoldCoin
        let second: MetalType? = isMensRing && !secondMetal.isEmpty ? MetalType(rawValue: secondMetal) : nil
        let karatValue: KaratValue? = metalType == "gold" ? KaratValue(rawValue: karat.isEmpty ? "21k" : karat) : nil
        return PricedPiece(
            categoryId: categoryId,
            metalType: MetalType(rawValue: metalType),
            karat: karatValue,
            metalWeightG: Self.num(weight),
            secondaryMetalType: second,
            secondaryMetalKarat: second == .gold && !secondKarat.isEmpty ? KaratValue(rawValue: secondKarat) : nil,
            secondaryMetalWeightG: second == nil ? nil : Self.num(secondWeight),
            stoneWeightG: Self.num(stoneWeight),
            wastagePercentage: coin ? 0 : Self.num(wastage),
            makingCharges: coin ? 0 : Self.num(making),
            hasDiamonds: coin ? false : hasDiamonds,
            diamondCharges: coin || !hasDiamonds ? 0 : Self.num(diamondCharges),
            stoneCharges: coin ? 0 : Self.num(stoneCharges),
            miscCharges: coin ? 0 : Self.num(miscCharges),
            isCustomPrice: fixed,
            customPrice: fixed ? Self.num(customPrice) : nil,
            silverRatePerGram: Self.num(silverRate)
        )
    }
}
