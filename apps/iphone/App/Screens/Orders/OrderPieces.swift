import SwiftUI
import FirebaseFirestore
import ERPCore

/// One piece of an order, as the bench and the counter both need it (src/app/orders/[id]/page.tsx), in two
/// lines (CONVENTIONS rule 15): what it is and its price; then who has it (amber while nobody does) and the
/// specification the order captured. A tap opens the stones, the instructions for the karigar and the price's
/// breakdown under them. The tick is the web's "Mark as Complete"; the karigar is picked on the piece, as the
/// page's inline picker (KarigarAssign).
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

    /// The stones, the instructions and the breakdown, shown on a tap.
    @State private var open = false
    /// The sample photo kept in its own document, once read (OrderPiecePhoto.stored).
    @State private var storedPhoto: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let uri = OrderPiecePhoto.inline(item) ?? storedPhoto {
                OrderPiecePhoto(uri: uri, item: item)
            }
            VStack(alignment: .leading, spacing: 4) {
                heading
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    karigarLine
                    factLine
                }
                if open {
                    notes
                    if showBreakdown && !item.isManualPrice && item.totalEstimate != nil { breakdown }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { if hasMore { Motion.run(reduce: reduceMotion) { open.toggle() } } }
            .accessibilityHint(hasMore ? (open ? "Hides the details" : "Shows the stones, the instructions and the breakdown") : "")
            // A finished piece sits quieter than one still to make.
            .opacity(item.isCompleted ? 0.7 : 1)
            Spacer(minLength: 0)
            tick
        }
        .padding(.vertical, 6)
        .task(id: item.samplePhotoId) { storedPhoto = await OrderPiecePhoto.stored(item) }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Something under the two lines to open.
    private var hasMore: Bool {
        clean(item.diamondDetails) != nil || clean(item.stoneDetails) != nil || clean(item.adminNote) != nil
            || (showBreakdown && !item.isManualPrice && item.totalEstimate != nil)
    }

    // MARK: What it is

    /// The piece and its price on one line.
    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(item.description.isEmpty ? "Piece \(index + 1)" : item.description)
                .font(.headline)
                .foregroundStyle(item.isCompleted ? Color.secondary : Color.primary)
                .lineLimit(open ? nil : 1)
            Spacer(minLength: 8)
            if let total = item.totalEstimate { RowAmount(amount: total) }
        }
        .accessibilityElement(children: .combine)
    }

    /// "21K Gold · Est. 12.5 g · 8% wastage · Size 14 · White Rhodium": what the order captured, in the order
    /// the bench reads it. The percentage stays here and on the slip; an invoice shows grams (decision
    /// "Wastage in grams").
    private var facts: [String] {
        var out: [String] = []
        if let category = OrdersLogic.categorySingular(item.itemCategory),
           !item.description.localizedCaseInsensitiveContains(category) { out.append(category) }
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
                .lineLimit(open ? nil : 1)
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
                Picker("Karigar", selection: Binding(get: { item.karigarId ?? "none" }, set: { assign.pick($0) })) {
                    Text("Unassigned").tag("none")
                    ForEach(assign.karigars) { k in Text(k.name).tag(k.id) }
                }
            } label: {
                karigarWords
            }
            .disabled(assign.busy)
            .accessibilityHint("Picks the karigar for this piece")
        } else if karigar != nil || !item.isCompleted {
            karigarWords
        }
    }

    private var karigarWords: some View {
        // Amber only while the piece is still to make and nobody has it, or it has not left the shop yet.
        let waiting = !item.isCompleted
        return HStack(spacing: 4) {
            if let karigar {
                Text(karigar).fontWeight(.medium)
                Text("· " + givenWords)
                    .foregroundStyle(waiting && item.givenAt == nil ? Tone.owed.color : Color.secondary)
            } else {
                Text("Not given out").foregroundStyle(waiting ? Tone.owed.color : Color.secondary)
            }
            if assign != nil {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if !facts.isEmpty {
                Text("· ").foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
        .lineLimit(1)
        .fixedSize()
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

    // MARK: The price's breakdown, on a tap: owners only

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
                onTick(!item.isCompleted)
            } label: {
                Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(item.isCompleted ? Tone.settled.color : Color.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(item.isCompleted ? "Done. Tap to mark not done." : "Mark as complete")
        } else if item.isCompleted {
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
