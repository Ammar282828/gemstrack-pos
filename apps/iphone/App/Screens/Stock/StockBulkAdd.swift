import SwiftUI
import ERPCore

/// Add pieces in bulk (/products/bulk-add, src/app/products/bulk-add/page.tsx): one setup shared by every piece
/// (category, name prefix, metal and karat, wastage, making, stones, diamonds, sundries) and a list of weights,
/// one piece for each. Paste a list of weights, or type them, and each can carry its own name suffix.
///
/// The setup is the product form's own model (`StockPieceFields`, StockPieceForm.swift), so a piece made here is
/// checked, shaped and priced exactly as one made on the single form. The ERP adds them in order, each numbered
/// as a piece added by hand (`addProducts`, ops-stock2.ts, the same `addProduct` write as `addProduct`): all
/// are checked before the first is written, so a mistake in row 9 leaves nothing half in stock.
///
/// As the web's page, a piece here is priced by weight and rate (never a fixed price) and the figures start at
/// nothing, not at the single form's 10%. Silver is priced by its all-in rate, so it has no wastage or making.
/// Differences: a name suffix typed with no prefix names the piece (the page ignored it), pasting drops the
/// empty row first, and the weights go to the ERP twenty pieces to a request.
struct StockBulkAdd: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isOwner {
            StockBulkEditor()
        } else {
            ContentUnavailableView("Only an owner can change the stock", systemImage: "lock", description: Text("Ask an owner to add the pieces."))
                .navigationTitle("Add in bulk")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: The rules the page keeps to itself (lib/bulk-pieces.ts)

/// One weight to add: a row of the page's `items`.
struct StockBulkRow: Identifiable, Equatable {
    let id = UUID()
    var weight = ""
    /// Joins the shared prefix to name this piece.
    var suffix = ""
}

enum StockBulk {
    /// Pieces to a request: each is a trip to the database, and a request should not run for minutes.
    static let perRequest = 20

    /// The weights in a pasted list (lib/bulk-pieces.ts `pastedWeights`, the page's `handlePasteWeights`): every
    /// run of digits and dots read as a number, those above 0 kept.
    static func weights(in text: String) -> [Double] {
        var found: [Double] = []
        var run = ""
        // The space at the end closes the last run.
        for ch in text + " " {
            if (ch >= "0" && ch <= "9") || ch == "." {
                run.append(ch)
                continue
            }
            if let n = number(run), n > 0 { found.append(n) }
            run = ""
        }
        return found
    }

    /// JavaScript's `Number()` of a run of digits and dots: nil where that is NaN (a lone dot, "1.2.3").
    private static func number(_ run: String) -> Double? {
        guard !run.isEmpty else { return nil }
        let dots = run.filter { $0 == "." }.count
        guard dots <= 1, run.contains(where: { $0 != "." }) else { return nil }
        var s = run
        if s.hasPrefix(".") { s = "0" + s }
        if s.hasSuffix(".") { s += "0" }
        guard let v = Double(s), v.isFinite else { return nil }
        return v
    }

    /// The name a row's piece is given (lib/bulk-pieces.ts `bulkPieceName`): prefix and suffix, spaced, trimmed.
    /// Blank is no name: the ERP makes one from the category and the SKU.
    static func name(prefix: String, suffix: String) -> String {
        [prefix, suffix]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// The shared setup as the page opens it: gold (the house's metal) with no stones, wastage and making at nothing.
    static func freshSetup() -> StockPieceFields {
        var start = StockPieceFields()
        start.wastage = ""
        start.hasStones = false
        start.settle(keepWastage: true)
        return start
    }
}

// MARK: The form

private struct StockBulkEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var shared: StockPieceFields = StockBulk.freshSetup()
    @State private var prefix = ""
    @State private var rows: [StockBulkRow] = [StockBulkRow()]
    @State private var pasted = ""
    @State private var saving = false
    @State private var failureTitle = "The pieces weren't added"
    @State private var failure: String?
    /// The SKUs once everything is in stock.
    @State private var done: [String]?
    @State private var tick = 0

    var body: some View {
        Group {
            if let done {
                donePage(done)
            } else {
                form
            }
        }
        .navigationTitle(done != nil ? "Added" : "Add in bulk")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if done != nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .alert(failureTitle, isPresented: failureShown) {
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
            sharedSection
            if !shared.isGoldCoin {
                costSection
                stonesSection
            }
            addWeightsSection
            weightsSection
            resetSection
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .newOrderKeyboardDone()
        .disabled(saving)
        // The product form's rules, line for line (a coin carries nothing, silver no wastage), but the wastage
        // stays what was typed: the page this follows never put it back to 10%.
        .onChange(of: shared.ruleKey) { _, _ in shared.settle(keepWastage: true) }
        .safeAreaBar(edge: .bottom) { saveBar }
    }

    // MARK: Shared by every piece

    private var metalOptions: [String] {
        var out: [String] = METAL_TYPES.map { $0.rawValue }
        if !out.contains(shared.metalType) { out.append(shared.metalType) }
        return out
    }

    private var karatOptions: [String] {
        var out: [String] = karatsFor(MetalType.gold).map { $0.rawValue }
        if !shared.karat.isEmpty && !out.contains(shared.karat) { out.append(shared.karat) }
        return out
    }

    private var sharedSection: some View {
        Section {
            Picker("Category", selection: $shared.categoryId) {
                if shared.categoryId.isEmpty { Text("Choose").tag("") }
                ForEach(StockKit.categories) { (c: StockKit.Category) in
                    Text(c.title).tag(c.id)
                }
            }
            TextField("Name prefix", text: $prefix, prompt: Text("Optional, e.g. Gold ring design A"))
            Picker("Metal", selection: $shared.metalType) {
                ForEach(metalOptions, id: \.self) { (m: String) in
                    Text(metalLabel(m)).tag(m)
                }
            }
            if shared.metalType == "gold" {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Karat").font(.caption).foregroundStyle(.secondary)
                    Picker("Karat", selection: $shared.karat) {
                        ForEach(karatOptions, id: \.self) { (k: String) in
                            Text(karatLabel(k)).tag(k)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
        } header: {
            Text("Shared by every piece")
        } footer: {
            Text("A piece is named “prefix suffix”. With neither, it is named from the category and its SKU.")
        }
    }

    private var costSection: some View {
        Section {
            if !shared.silver {
                NewOrderNumberRow(title: "Wastage (%)", text: $shared.wastage, prompt: "e.g. 10")
                NewOrderNumberRow(title: "Making (PKR)", text: $shared.making, prompt: "e.g. 5000")
            }
            NewOrderNumberRow(title: "Misc (PKR)", text: $shared.miscCharges, prompt: "e.g. 250")
        } header: {
            Text("Costs")
        } footer: {
            if shared.silver {
                Text("Silver is priced by weight at the silver rate in settings, all-inclusive: no wastage or making.")
            }
        }
    }

    private var stonesSection: some View {
        Section {
            Toggle("Has other stones", isOn: $shared.hasStones)
            if shared.hasStones {
                NewOrderNumberRow(title: "Stone weight", text: $shared.stoneWeight, prompt: "e.g. 0.5", unit: "g")
                NewOrderNumberRow(title: "Stones (PKR)", text: $shared.stoneCharges, prompt: "e.g. 15000")
            }
            Toggle("Has diamonds", isOn: $shared.hasDiamonds)
            if shared.hasDiamonds {
                NewOrderNumberRow(title: "Diamonds (PKR)", text: $shared.diamondCharges, prompt: "e.g. 50000")
            }
        } header: {
            Text("Diamonds and stones")
        } footer: {
            if shared.hasStones || shared.hasDiamonds {
                Text("The same figures go on every piece.")
            }
        }
    }

    // MARK: The weights

    private var addWeightsSection: some View {
        Section {
            TextField("Weights", text: $pasted, prompt: Text("Paste or type weights, e.g. 4.2 5.1 6.75"), axis: .vertical)
                .lineLimit(2...6)
            Button { addPasted() } label: {
                Label("Add these weights", systemImage: "doc.on.clipboard")
            }
            .disabled(StockBulk.weights(in: pasted).isEmpty)
            Button { rows.append(StockBulkRow()) } label: {
                Label("Add a row", systemImage: "plus")
            }
        } header: {
            Text("Add weights")
        } footer: {
            Text("Paste a list from a message or a sheet: every number in it becomes a piece.")
        }
    }

    private var weightsSection: some View {
        Section {
            if rows.isEmpty {
                Text("No weights yet. Paste a list or add a row.").foregroundStyle(.secondary)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                weightRow(index, row)
            }
        } header: {
            Text("Weights to add · \(rows.count)")
        } footer: {
            Text("Swipe a row to take it out.")
        }
    }

    private func weightRow(_ index: Int, _ row: StockBulkRow) -> some View {
        HStack(spacing: 10) {
            Text("\(index + 1)")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(minWidth: 22)
            TextField("Weight", text: field(row.id, \.weight), prompt: Text("Weight (g)"))
                .keyboardType(.decimalPad)
                .monospacedDigit()
            TextField("Name suffix", text: field(row.id, \.suffix), prompt: Text("Name suffix"))
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { remove(row.id) } label: { Label("Remove", systemImage: "trash") }
        }
    }

    /// A box of one row, found by the row's id: a binding by position would point past the end as a row is removed.
    private func field(_ id: UUID, _ keyPath: WritableKeyPath<StockBulkRow, String>) -> Binding<String> {
        Binding(
            get: { rows.first(where: { $0.id == id })?[keyPath: keyPath] ?? "" },
            set: { typed in
                if let i = rows.firstIndex(where: { $0.id == id }) { rows[i][keyPath: keyPath] = typed }
            }
        )
    }

    private func remove(_ id: UUID) {
        rows.removeAll { $0.id == id }
    }

    private func addPasted() {
        let found = StockBulk.weights(in: pasted)
        guard !found.isEmpty else { return }
        // A row nothing was typed in would only fail the check.
        rows.removeAll { NewOrderFormat.trim($0.weight).isEmpty && NewOrderFormat.trim($0.suffix).isEmpty }
        rows.append(contentsOf: found.map { StockBulkRow(weight: NewOrderFormat.trimmed($0, digits: 3)) })
        pasted = ""
    }

    private var resetSection: some View {
        Section {
            Button("Reset form", role: .destructive) { reset() }
        }
    }

    private func reset() {
        shared = StockBulk.freshSetup()
        prefix = ""
        rows = [StockBulkRow()]
        pasted = ""
        failure = nil
    }

    // MARK: Save

    /// One row's piece: the shared setup with this row's weight and name, as the single form would send it.
    private func piece(for row: StockBulkRow) -> StockPieceFields {
        var p = shared
        p.weight = row.weight
        p.name = StockBulk.name(prefix: prefix, suffix: row.suffix)
        return p
    }

    /// The first thing the ERP would refuse, in the words it uses, with the row it is in.
    private var firstProblem: String? {
        if shared.categoryId.isEmpty { return "Category is required" }
        if rows.isEmpty { return "At least one item is required" }
        for (index, row) in rows.enumerated() {
            if let problem = piece(for: row).problem { return "Piece \(index + 1): \(problem)" }
        }
        return nil
    }

    private var saveBar: some View {
        Button {
            Task { await save() }
        } label: {
            Group {
                if saving {
                    ProgressView()
                } else {
                    Text("Add \(rows.count) piece\(rows.count == 1 ? "" : "s")")
                }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.houseProminent)
        .controlSize(.large)
        .disabled(saving || rows.isEmpty)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func save() async {
        guard !saving else { return }
        SaleKeyboard.dismiss()
        if let problem = firstProblem {
            failureTitle = "The pieces weren't added"
            failure = problem
            return
        }
        saving = true
        let all = rows
        var added: [String] = []
        var stopped: String?
        var next = 0
        while next < all.count {
            let part = Array(all[next..<min(next + StockBulk.perRequest, all.count)])
            do {
                // "part" tells two requests of the same weights apart: the ERP records one request once.
                let out = try await ERPAPI.shared.write("addProducts", ["pieces": part.map { piece(for: $0).piece }, "part": next])
                let made: [[String: Any]] = out["products"] as? [[String: Any]] ?? []
                added.append(contentsOf: made.compactMap { $0["sku"] as? String })
                if (out["partial"] as? Bool) == true {
                    next = min(next + made.count, all.count)
                    stopped = out["error"] as? String ?? "Not saved."
                    break
                }
                next += part.count
            } catch {
                stopped = error.localizedDescription
                break
            }
        }
        saving = false
        if let stopped {
            // What went in is in stock; the list keeps only what did not.
            let rest = Array(all[next...])
            rows = rest.isEmpty ? [StockBulkRow()] : rest
            if added.isEmpty {
                failureTitle = "The pieces weren't added"
                failure = stopped
            } else {
                failureTitle = "Some pieces weren't added"
                failure = "\(added.count) of \(all.count) pieces are in stock (\(added[0]) to \(added[added.count - 1])). \(stopped) Check Stock before adding the rest, which are still in the list."
            }
            return
        }
        tick += 1
        done = added
    }

    // MARK: Done

    private func donePage(_ skus: [String]) -> some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.green)
                    Text("Bulk add complete").font(.title2.weight(.semibold))
                    Text("\(skus.count) piece\(skus.count == 1 ? " is" : "s are") in stock.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                ForEach(skus, id: \.self) { (sku: String) in
                    NavigationLink(value: Route(path: StockKit.piecePath(sku))) {
                        Text(sku).monospacedDigit()
                    }
                }
            } header: {
                Text("Added")
            } footer: {
                Text("Photos are added on each piece's ERP page.")
            }
            .houseRows()
            Section {
                Button { startAgain() } label: {
                    Label("Add more pieces", systemImage: "plus.square.on.square")
                }
            } footer: {
                Text("The setup stays as it is; the weights start again.")
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaBar(edge: .bottom) {
            NavigationLink(value: Route(path: "/products")) {
                Text("Open Stock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func startAgain() {
        rows = [StockBulkRow()]
        pasted = ""
        failure = nil
        done = nil
    }
}
