import SwiftUI
import FirebaseFirestore
import ERPCore

/// One piece of an order, as the bench and the counter both need it (src/app/orders/[id]/page.tsx):
/// what it is, every specification the order captured (one line of facts, not a table), who has it and
/// whether it has left the shop, the instructions for the karigar, and its price. The tick is the web's
/// "Mark as Complete"; the karigar is picked on the piece, as the page's inline picker (KarigarAssign), and the
/// piece's sample photo leads the row when it has one.
struct OrderPieceRow: View {
    let index: Int
    let item: OrderItem
    /// The karigar's name; nil when none is picked.
    let karigar: String?
    /// Owners tick pieces off, until the order is invoiced.
    let canTick: Bool
    let busy: Bool
    /// The price broken into metal, wastage, making, diamonds and stones: owners only.
    let showBreakdown: Bool
    let onTick: (Bool) -> Void
    /// Who makes it, picked here (owners, until the order is invoiced); nil shows the karigar only.
    var assign: OrderPieceAssign? = nil
    /// What the person just did, shown before the shelf's copy catches up (nil: the shelf's value).
    var doneOverride: Bool? = nil
    var karigarOverride: String? = nil

    @State private var priceOpen = false
    private var done: Bool { doneOverride ?? item.isCompleted }
    /// The sample photo kept in its own document, once read (OrderPiecePhoto.stored).
    @State private var storedPhoto: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let uri = OrderPiecePhoto.inline(item) ?? storedPhoto {
                OrderPiecePhoto(uri: uri, item: item)
            }
            VStack(alignment: .leading, spacing: 8) {
                heading
                factLine
                karigarLine
                notes
                price
            }
            // A finished piece sits quieter than one still to make.
            .opacity(done ? 0.7 : 1)
            Spacer(minLength: 0)
            tick
        }
        .padding(.vertical, 6)
        .task(id: item.samplePhotoId) { storedPhoto = await OrderPiecePhoto.stored(item) }
    }

    // MARK: What it is

    private var heading: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let category = OrdersLogic.categorySingular(item.itemCategory) {
                Text(category.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.6)
                    .foregroundStyle(.secondary)
            }
            Text(item.description.isEmpty ? "Piece \(index + 1)" : item.description)
                .font(.headline)
                .foregroundStyle(done ? Color.secondary : Color.primary)
        }
        .accessibilityElement(children: .combine)
    }

    /// "21K Gold · Est. 12.5 g · 8% wastage · Size 14 · White Rhodium": what the order captured, in the order
    /// the bench reads it. The percentage stays here and on the slip; an invoice shows grams (decision
    /// "Wastage in grams").
    private var facts: [String] {
        var out: [String] = []
        let metal = describeMetal(item.metalType, item.karat)
        if !metal.isEmpty { out.append(metal) }
        if !item.isManualPrice && item.estimatedWeightG > 0 {
            out.append("Est. " + OrdersLogic.grams(item.estimatedWeightG))
            if item.metalType != .silver && item.wastagePercentage > 0 {
                out.append(OrdersLogic.number(item.wastagePercentage, maxDigits: 2) + "% wastage")
            }
        }
        if let size = item.size?.trimmingCharacters(in: .whitespacesAndNewlines), !size.isEmpty { out.append("Size " + size) }
        if let finish = describePlating(item) { out.append(finish) }
        if item.stoneWeightG > 0 { out.append("Stones " + OrdersLogic.grams(item.stoneWeightG)) }
        if let sku = item.referenceSku, !sku.isEmpty { out.append("Ref " + sku) }
        if item.sampleGiven { out.append("Sample from the customer") }
        if item.isManualPrice { out.append("Fixed at " + Money.pkr(item.manualPrice ?? item.totalEstimate ?? 0)) }
        return out
    }

    @ViewBuilder
    private var factLine: some View {
        let all = facts
        if !all.isEmpty {
            Text(all.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Who has it

    /// "given yesterday", "given Tue 6 Oct", or not yet: the gold leaving the shop is its own moment.
    private var givenWords: String {
        guard let given = item.givenAt, !given.isEmpty else { return "not given yet" }
        let said = ShopDate.say(given)
        return "given " + (["Today", "Yesterday", "Tomorrow"].contains(said) ? said.lowercased() : said)
    }

    /// Amber while nobody has it: work to hand out, not a promise missed. A finished piece with no karigar
    /// (made in the shop) says nothing, unless it can be given one here.
    @ViewBuilder
    private var karigarLine: some View {
        if let assign {
            Menu {
                Picker("Karigar", selection: Binding(get: { karigarOverride ?? item.karigarId ?? "none" }, set: { assign.pick($0) })) {
                    Text("Unassigned").tag("none")
                    ForEach(assign.karigars) { k in Text(k.name).tag(k.id) }
                }
            } label: {
                karigarWords
            }
            .disabled(assign.busy)
            .accessibilityHint("Picks the karigar for this piece")
        } else if karigar != nil || !done {
            karigarWords
        }
    }

    private var karigarWords: some View {
        HStack(spacing: 6) {
            Image(systemName: "hammer")
                .foregroundStyle(karigar == nil && !done ? Tone.owed.color : Color.secondary)
            if let karigar {
                Text(karigar).fontWeight(.medium)
                Text("· " + givenWords)
                    .foregroundStyle(item.givenAt == nil && !done ? Tone.owed.color : Color.secondary)
            } else {
                Text("Not given out").foregroundStyle(done ? Color.secondary : Tone.owed.color)
            }
            if assign != nil {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    // MARK: Stones, diamonds and the instructions

    @ViewBuilder
    private var notes: some View {
        if let d = clean(item.diamondDetails) {
            noteBox("Diamonds", d, symbol: "diamond", tint: .secondary)
        }
        if let s = clean(item.stoneDetails) {
            noteBox("Stones", s, symbol: "sparkles", tint: .secondary)
        }
        // Owners only: the staff's copy of the order comes without it (roles.ts).
        if let a = clean(item.adminNote) {
            noteBox("Instructions for the karigar (never printed)", a, symbol: "lock.fill", tint: Tone.owed.color)
        }
    }

    private func clean(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func noteBox(_ title: String, _ text: String, symbol: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.secondary.opacity(0.12), in: .rect(cornerRadius: Radius.thumb, style: .continuous))
    }

    // MARK: Price, last: subordinate to what the piece is

    @ViewBuilder
    private var price: some View {
        if let total = item.totalEstimate {
            if showBreakdown && !item.isManualPrice {
                Button {
                    priceOpen.toggle()
                } label: {
                    HStack {
                        Text("Item total").foregroundStyle(.secondary)
                        Spacer()
                        Text(Money.pkr(total)).fontWeight(.semibold).monospacedDigit()
                        Image(systemName: priceOpen ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.primary)
                if priceOpen { breakdown }
            } else {
                HStack {
                    Text("Item total").foregroundStyle(.secondary)
                    Spacer()
                    Text(Money.pkr(total)).fontWeight(.semibold).monospacedDigit()
                }
                .font(.subheadline)
            }
        }
    }

    private var breakdown: some View {
        VStack(spacing: 2) {
            line("Metal", item.metalCost ?? 0, always: true)
            line("Wastage", item.wastageCost ?? 0)
            line("Making", item.makingCharges)
            line("Diamonds", item.diamondCharges)
            line("Stones", item.stoneCharges)
        }
        .font(.caption)
    }

    @ViewBuilder
    private func line(_ label: String, _ amount: Double, always: Bool = false) -> some View {
        if always || amount > 0 {
            HStack {
                Text(label).foregroundStyle(.secondary)
                Spacer()
                Text(Money.pkr(amount)).monospacedDigit()
            }
        }
    }

    // MARK: Done

    /// The tick's hit area is a finger's (44 pt), whatever the glyph.
    @ViewBuilder
    private var tick: some View {
        if busy {
            ProgressView().controlSize(.small)
                .frame(width: 44, height: 44)
        } else if canTick {
            Button {
                onTick(!done)
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(done ? Tone.settled.color : Color.secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .motion(done)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(done ? "Done. Tap to mark not done." : "Mark as complete")
        } else if done {
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Tone.settled.color)
                .frame(width: 44, height: 44)
                .accessibilityLabel("Done")
        }
    }
}

/// The karigar picker on a piece: the shop's karigars (removed ones left out) and the bench's own write
/// (setPieceKarigar, as the Workshop board's picker).
struct OrderPieceAssign {
    let karigars: [Karigar]
    /// A pick on its way: the menu waits for it.
    let busy: Bool
    let pick: (String) -> Void
}

/// A piece's sample photo, wherever it is kept (components/order/order-photo.tsx): inline on the piece (a stock
/// piece's address, or an older order's data URI) or in its own document (`order_photos/<id>`, lib/order-photos.ts),
/// read once the piece is shown. Nothing when the piece has none, or the photo cannot be read (the shop floor's
/// accounts read no Firestore of their own).
struct OrderPiecePhoto: View {
    let uri: String
    let item: OrderItem

    var body: some View {
        StockImage(imageUrl: uri, name: item.description, key: item.samplePhotoId ?? uri, decodeDataURI: true)
            .frame(width: 64, height: 64)
            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            .accessibilityLabel("Sample photo")
    }

    static func inline(_ item: OrderItem) -> String? {
        let s = (item.sampleImageDataUri ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : s
    }

    /// The photo's own document, when the piece keeps it there; nil when it has none or it cannot be read.
    @MainActor
    static func stored(_ item: OrderItem) async -> String? {
        guard inline(item) == nil, let id = item.samplePhotoId, !id.isEmpty, !House.isDemo,
              let db = Businesses.shared.firestore,
              let snapshot = try? await db.collection("order_photos").document(id).getDocument() else { return nil }
        return snapshot.data()?["dataUri"] as? String
    }
}
