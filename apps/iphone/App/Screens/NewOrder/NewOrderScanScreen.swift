import SwiftUI
import UIKit
import ERPCore

/// Read a slip (components/order/order-scanner.tsx): a parchi photographed, front and back, a second page, or a
/// picture of the piece beside it, read by the ERP's reader (/api/vision/order, Gemini, owners only: the shop's AI
/// account pays for it) and laid into New order's form for the person to check and save. Nothing is created here.
///
/// The photos stay on screen beside the reading, the names it could not pin are offered as a choice, and a slip
/// that does not add up as read says where. Up to six photos are read together as one order; adding or removing one
/// reads the set again, because the second page changes what the first page means.
struct NewOrderScanScreen: View {
    /// The order form's draft: the reading is added to it, and the form shows it on return.
    @Binding var draft: NewOrderDraft

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var photos: [PaperPhoto] = []
    @State private var reading: NewOrderScanReading?
    @State private var busy = false
    @State private var problem: String?

    /// The route's own cap: front, back, a second page and the piece is four.
    private static let maxPhotos = 6

    var body: some View {
        Group {
            if session.isOwner {
                form
            } else {
                ContentUnavailableView("Reading a slip is for the owners", systemImage: "lock",
                                       description: Text("The ERP reads paper with the shop's AI account, which only an owner's sign-in may use. Type the order in, or ask an owner."))
            }
        }
        .navigationTitle("Read a slip")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            book.customers.need()
            book.karigars.need()
            book.settings.need()
        }
    }

    // MARK: The screen

    private var form: some View {
        Form { Group {
            photosSection
            if busy {
                Section {
                    HStack(spacing: 12) {
                        SkeletonLoading()
                        Text(photos.count > 1 ? "Reading \(photos.count) photos…" : "Reading it…")
                    }
                } footer: {
                    Text("Usually a few seconds; up to a minute when the shop's AI is busy.")
                }
            }
            if let problem {
                Section {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                } header: {
                    LedgerHeading(title: "Could not read that")
                }
            }
            if let reading, !busy { readingSections(reading) }
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaBar(edge: .bottom) { fillBar }
    }

    private var photosSection: some View {
        Section {
            if !photos.isEmpty {
                PaperPhotoStrip(photos: photos, remove: busy ? nil : { id in remove(id) })
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
            }
            if photos.count < Self.maxPhotos {
                PaperPicker(
                    room: Self.maxPhotos - photos.count,
                    scanTitle: photos.isEmpty ? "Scan the slip" : "Scan another",
                    disabled: busy,
                    add: { added in add(added) },
                    problem: { problem = $0 }
                )
            }
        } header: {
            LedgerHeading(title: "The slip")
        } footer: {
            Text(photos.isEmpty
                 ? "A parchi, front and back, or a picture of the piece: up to six, read together as one order. Nothing is saved here: the form is filled in for you to check."
                 : "Read together as one order. The first photo goes on the order as its reference picture, unless the reading says which photo shows which piece.")
        }
    }

    @ViewBuilder
    private func readingSections(_ r: NewOrderScanReading) -> some View {
        let a = r.answer
        let check = NewOrderSlip.check(a)
        if let unread = a.unreadable, !unread.isEmpty {
            Section {
                Label(unread, systemImage: "questionmark.circle").foregroundStyle(.orange)
            } header: {
                LedgerHeading(title: "Could not make this out")
            }
        }
        if !check.warnings.isEmpty {
            Section {
                ForEach(check.warnings, id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            } header: {
                LedgerHeading(title: "The slip does not add up as read")
            } footer: {
                Text("Nothing has been corrected: check the figures against the photo, and fix them on the form.")
            }
        }
        if let g = r.karigar {
            PaperNamePick(label: "Karigar", guess: g, nobody: "Nobody in the book sounds like that: choose the karigar on each piece.") { p in
                reading?.karigar?.pinned = p
            }
        }
        if let g = r.customer {
            PaperNamePick(label: "Customer", guess: g, nobody: "Nobody in the book sounds like that: the name goes on the order as written, as a new customer.") { p in
                reading?.customer?.pinned = p
            }
        }
        piecesSection(a, check)
        footSection(a, check)
    }

    private func piecesSection(_ a: NewOrderScanAnswer, _ check: NewOrderSlip.Check) -> some View {
        Section {
            if a.items.isEmpty {
                Text("No pieces could be read off this. Filling the form adds one empty piece to start by hand.")
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(a.items.enumerated()), id: \.offset) { i, it in
                pieceRow(it, off: check.itemsOff.contains(i))
            }
        } header: {
            Text(a.items.count == 1 ? "1 piece" : "\(a.items.count) pieces")
        } footer: {
            if a.items.contains(where: NewOrderSlip.hasHisaab) {
                Text("The rate on the slip goes into the order's rate box, so the form prices these pieces the way the slip did. Change the rate on the form and they move with it.")
            }
        }
    }

    private func pieceRow(_ it: NewOrderScanItem, off: Bool) -> some View {
        let s = NewOrderSlip.self
        let written = s.num(it.lineTotal)
        let computed = s.linePrice(it)
        var bits: [String] = []
        if s.hasHisaab(it) {
            bits.append("Hisaab on the slip")
        } else if written > 0 && !s.hasWeight(it) {
            bits.append("Figure only: a fixed price")
        }
        if let c = it.itemCategory, !c.isEmpty { bits.append(c) }
        if let m = it.metalType, !m.isEmpty, m != "gold" { bits.append(m) }
        if let k = it.karat { bits.append("\(s.jsNumber(k))k") }
        if let w = it.weightG {
            bits.append("\(s.jsNumber(w)) g" + (it.weightWasTola == true ? " (\(String(format: "%.3f", w / s.tolaG)) tola on the slip)" : ""))
        }
        if s.num(it.ratePerGram) > 0 {
            bits.append("@ \(s.money(s.num(it.ratePerGram)))/g" + (it.rateWasPerTola == true ? " (\(s.money(s.num(it.ratePerGram) * s.tolaG))/tola on the slip)" : ""))
        }
        if let w = s.wastagePercentOf(it) { bits.append("wastage \(s.jsNumber(w))%" + (s.num(it.wastageG) > 0 ? " (\(s.jsNumber(s.num(it.wastageG))) g)" : "")) }
        if s.num(it.stoneWeightG) > 0 { bits.append("less \(s.jsNumber(s.num(it.stoneWeightG))) g stone") }
        if s.num(it.makingCharges) > 0 { bits.append("making \(s.money(s.num(it.makingCharges)))" + (it.makingWasPerGram == true ? " (written per gram)" : "")) }
        if s.num(it.stoneCharges) > 0 { bits.append("stones \(s.money(s.num(it.stoneCharges)))") }
        if let size = it.size, !size.isEmpty { bits.append("Size \(size)") }
        if let idx = it.photoIndex, photos.count > 1 { bits.append("photo \(s.jsNumber(idx))") }
        return VStack(alignment: .leading, spacing: 4) {
            TwoLine(title: (it.description ?? "").isEmpty ? "Unnamed piece" : it.description!,
                    subtitle: bits.joined(separator: " · "),
                    trailing: written > 0 ? Money.pkr(written) : nil,
                    trailingTint: off ? .red : .primary)
            if let computed, written <= 0 {
                Text("Rate × weight comes to \(Money.pkr(computed)): no amount was written against it.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let note = it.note, !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func footSection(_ a: NewOrderScanAnswer, _ check: NewOrderSlip.Check) -> some View {
        let s = NewOrderSlip.self
        let ex = s.exchangeValue(a.exchange)
        let hasFoot = a.advancePayment != nil || a.exchange != nil || a.discount != nil || a.subtotal != nil
            || a.balanceDue != nil || !(a.expectedDate ?? "").isEmpty || !(a.notes ?? "").isEmpty
        if hasFoot {
            Section {
                if s.num(a.subtotal) > 0 { LabeledContent("Pieces", value: Money.pkr(s.num(a.subtotal))) }
                if s.num(a.discount) > 0 { LabeledContent("Discount", value: "− " + Money.pkr(s.num(a.discount))) }
                if s.num(a.advancePayment) > 0 { LabeledContent("Advance (cash)", value: "− " + Money.pkr(s.num(a.advancePayment))) }
                if let x = a.exchange {
                    LabeledContent {
                        Text(ex.from == .unpriced ? "No figure" : "− " + Money.pkr(ex.value))
                            .foregroundStyle(ex.from == .unpriced ? Color.red : Color.primary)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Taken in exchange")
                            Text(exchangeWords(x, ex.from)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if s.num(a.balanceDue) > 0 {
                    LabeledContent("Balance written") { Text(Money.pkr(s.num(a.balanceDue))).fontWeight(.semibold) }
                } else if let b = check.balance {
                    LabeledContent("Balance, as the figures read") { Text(Money.pkr(b)).fontWeight(.semibold) }
                }
                if let day = a.expectedDate, !day.isEmpty { LabeledContent("Wanted by", value: day) }
                if let notes = a.notes, !notes.isEmpty { Text(notes).foregroundStyle(.secondary) }
            } header: {
                LedgerHeading(title: "Foot of the slip")
            } footer: {
                Text("The advance, the discount and the old gold go into their own boxes. The slip's totals are only checked: the form works out its own.")
            }
        }
    }

    private func exchangeWords(_ x: NewOrderScanExchange, _ from: NewOrderSlip.ExchangeFrom) -> String {
        let s = NewOrderSlip.self
        var parts: [String] = []
        if let d = x.description, !d.isEmpty { parts.append(d) }
        if s.num(x.karat) > 0 { parts.append("\(s.jsNumber(s.num(x.karat)))k") }
        if s.num(x.weightG) > 0 { parts.append("\(s.jsNumber(s.num(x.weightG))) g" + (x.weightWasTola == true ? " (tola on the slip)" : "")) }
        if s.num(x.ratePerGram) > 0 { parts.append("@ \(s.money(s.num(x.ratePerGram)))/g") }
        if from == .computed { parts.append("weight × rate off the slip") }
        return parts.joined(separator: " · ")
    }

    /// THE action: the reading into the form, then back to it.
    private var fillBar: some View {
        Button { fill() } label: {
            Label("Fill the form", systemImage: "checkmark")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.houseProminent)
        .controlSize(.large)
        // The rates are seeded from today's before the slip's go in: the shop's settings must have arrived.
        .disabled(reading == nil || busy || photos.isEmpty || (!draft.ratesSeeded && book.settings.value == nil))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: Reading

    private func add(_ added: [PaperPhoto]) {
        problem = nil
        photos = Array((photos + added).prefix(Self.maxPhotos))
        Task { await read() }
    }

    /// A photo taken away is really gone: the rest are read again without it.
    private func remove(_ id: UUID) {
        photos.removeAll { $0.id == id }
        problem = nil
        if photos.isEmpty {
            reading = nil
        } else {
            Task { await read() }
        }
    }

    /// The whole set, sent together (`{ images: [{ data, mimeType }] }`), and the names matched against the book.
    private func read() async {
        let set = photos
        guard !set.isEmpty, !busy else { return }
        busy = true
        reading = nil
        problem = nil
        defer { busy = false }
        do {
            let data = try await PaperReader.ask("/api/vision/order", ["images": set.map(\.payload)])
            guard let answer = NewOrderScanAnswer.read(data) else {
                problem = "The ERP's answer could not be read back. Try again."
                return
            }
            // Photos changed while it read (they cannot, while busy): the answer is for a set no longer here.
            guard set.map(\.id) == photos.map(\.id) else { return }
            reading = NewOrderScanReading.resolve(answer, customers: book.customers.items, karigars: book.karigars.items)
        } catch {
            problem = PaperReader.words(error)
        }
    }

    /// The reading into the order (NewOrderDraft.fill(fromSlip:)): the customer and karigar as picked here, the
    /// photos as the pieces' reference pictures. The form then shows it all, to be checked and saved there.
    private func fill() {
        guard let reading else { return }
        let customer = reading.customer?.pinned.flatMap { book.customers.item($0.id) }
        draft.fill(
            fromSlip: reading.answer,
            customer: customer,
            heardCustomer: customer == nil ? reading.customer?.heard : nil,
            karigarId: reading.karigar?.pinned?.id ?? "",
            photos: photos.map(\.small),
            fallbackMetal: House.metal,
            settings: book.settings.value
        )
        dismiss()
    }
}
