import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// Read a written bill (components/cart/bill-scanner.tsx): a handwritten bill or estimate photographed, read by the
/// ERP's reader (/api/vision/bill, owners only) and put on New sale for the person to check and save. Nothing is
/// invoiced here.
///
/// A bill has two kinds of line, and this screen never lets them look alike: one that showed its working is priced
/// from the rate (the bill's own, held in its box), one that showed only a figure is billed at that figure and will
/// not move when the rate does. Lines can be left off before they go on the sale.
struct SaleScanScreen: View {
    /// The sale's draft: the lines are added to it, and the sale shows them on return.
    @Binding var draft: SaleDraft
    /// A new sale is kept on this phone as well (SaleDraftStore); an invoice being edited is not.
    let keep: Bool

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var photo: PaperPhoto?
    @State private var reading: SaleBillReading?
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        #if os(macOS)
        macBody
        #else
        Group {
            if session.isOwner {
                form
            } else {
                NotAvailableState("Reading a bill is for the owners",
                                  why: "The ERP reads paper with the shop's AI account, which only an owner's sign-in may use.")
            }
        }
        .navigationTitle("Read a written bill")
        .navigationBarTitleDisplayMode(.inline)
        .selectionFeedback(trigger: reading?.skipped.count ?? 0)
        .task {
            book.customers.need()
            book.settings.need()
        }
        #endif
    }

    // MARK: The screen

    private var form: some View {
        Form { Group {
            photoSection
            if busy {
                Section {
                    HStack(spacing: pt(12)) {
                        SkeletonLoading()
                        Text("Reading it…")
                    }
                }
            }
            if let problem {
                Section {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                    if photo != nil {
                        Button("Try again") { Task { await read() } }
                            .buttonStyle(.borderless)
                    }
                } header: {
                    LedgerHeading(title: "Could not read that")
                }
            }
            if let reading, !busy { readingSections(reading) }
            }
            .houseRows()
        }
        .formColumn()
        .actionBar(primary: fillAction)
    }

    private var photoSection: some View {
        Section {
            if let photo {
                PaperPhotoStrip(photos: [photo], remove: nil)
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
            }
            PaperPicker(
                room: 1,
                scanTitle: photo == nil ? "Scan the bill" : "Retake",
                disabled: busy,
                add: { added in if let first = added.first { take(first) } },
                problem: { problem = $0 }
            )
        } header: {
            LedgerHeading(title: "The bill")
        } footer: {
            Text(photo == nil
                 ? "The lines go on the sale for you to check: nothing is invoiced here."
                 : "Retake or choose another to read again.")
        }
    }

    @ViewBuilder
    private func readingSections(_ r: SaleBillReading) -> some View {
        let a = r.answer
        if let unread = a.unreadable, !unread.isEmpty {
            Section {
                Label(unread, systemImage: "questionmark.circle").foregroundStyle(Tone.owed.color)
            } header: {
                LedgerHeading(title: "Could not make this out")
            }
        }
        if let g = r.customer {
            PaperNamePick(label: "Customer", guess: g, nobody: "Nobody in the book sounds like that: choose the customer on the sale.") { p in
                reading?.customer?.pinned = p
            }
        }
        linesSection(r)
        footSection(r)
    }

    private func linesSection(_ r: SaleBillReading) -> some View {
        let lines = r.answer.lines
        let bare = r.kept.filter { !SaleBill.hasBreakdown($0) }.count
        return Section {
            if lines.isEmpty {
                Text("No lines could be read off this. You can still bill it by hand.").foregroundStyle(.secondary)
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                Button { toggle(i) } label: { lineRow(l, on: !r.skipped.contains(i), billRate: r.answer.ratePerGram) }
                    .buttonStyle(.plain)
            }
        } header: {
            LedgerHeading(title: "\(r.kept.count) of \(lines.count) line\(lines.count == 1 ? "" : "s")")
        } footer: {
            if bare > 0 {
                Text("\(bare) line\(bare == 1 ? "" : "s") came without a weight, so \(bare == 1 ? "it is" : "they are") billed at the written figure and will not move if you change the rate. Tap a line to leave it off.")
            } else if !lines.isEmpty {
                Text("Tap a line to leave it off the sale.")
            }
        }
    }

    private func lineRow(_ l: SaleBillLine, on: Bool, billRate: Double?) -> some View {
        let s = NewOrderSlip.self
        var bits: [String] = []
        if SaleBill.hasBreakdown(l) {
            bits.append("Priced from the rate")
            if let m = l.metalType, !m.isEmpty { bits.append(m) }
            if let k = l.karat { bits.append("\(s.jsNumber(k))k") }
            let w = l.weightG ?? 0
            bits.append("\(s.jsNumber(w)) g" + (l.weightWasTola == true ? " (\(String(format: "%.2f", w / s.tolaG)) tola written)" : ""))
            if (l.stoneWeightG ?? 0) > 0 { bits.append("less \(s.jsNumber(l.stoneWeightG ?? 0)) g stone") }
            if let wp = SaleBill.wastagePercentOf(l) { bits.append("wastage \(s.jsNumber(wp))%" + ((l.wastageG ?? 0) > 0 ? " (\(s.jsNumber(l.wastageG ?? 0)) g)" : "")) }
            let rate = (l.ratePerGram ?? 0) > 0 ? (l.ratePerGram ?? 0) : (billRate ?? 0)
            if rate > 0 { bits.append("at \(s.money(rate))/g") }
            if (l.stoneCharges ?? 0) > 0 { bits.append("stones \(s.money(l.stoneCharges ?? 0))") }
            if (l.makingCharges ?? 0) > 0 { bits.append("making \(s.money(l.makingCharges ?? 0))") }
        } else {
            bits.append("As written on the bill: no breakdown, the figure is used as it stands")
        }
        let written = SaleBill.writtenTotal(l)
        return HStack(alignment: .firstTextBaseline, spacing: pt(10)) {
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(on ? Theme.accent : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
            VStack(alignment: .leading, spacing: pt(4)) {
                TwoLine(title: (l.description ?? "").isEmpty ? "Unnamed line" : l.description!,
                        subtitle: bits.joined(separator: " · "),
                        trailing: written > 0 ? Money.pkr(written) : nil)
                if let note = l.note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .opacity(on ? 1 : 0.45)
        .contentShape(.rect)
    }

    @ViewBuilder
    private func footSection(_ r: SaleBillReading) -> some View {
        let a = r.answer
        let written = SaleBill.writtenFigure(a)
        let held = SaleBill.rates(r.kept, billRate: a.ratePerGram, fallbackMetal: House.metal)
        Section {
            if (a.discount ?? 0) > 0 { LabeledContent("Discount", value: Money.pkr(a.discount ?? 0)) }
            if (a.grandTotal ?? 0) > 0 { LabeledContent("Total", value: Money.pkr(a.grandTotal ?? 0)) }
            if (a.amountPaid ?? 0) > 0 { LabeledContent("Paid", value: Money.pkr(a.amountPaid ?? 0)) }
            if let day = a.date, !day.isEmpty { LabeledContent("Dated", value: day) }
            if !held.isEmpty {
                ForEach(held.keys.sorted(), id: \.self) { k in
                    LabeledContent("Rate \(k.replacingOccurrences(of: "gold", with: "").uppercased())", value: "\(Money.grouped(held[k] ?? 0)) / g")
                }
            }
            if let check = filledCheck(r, written: written) {
                Label(check.text, systemImage: check.matches ? "checkmark.circle" : "exclamationmark.triangle.fill")
                    .foregroundStyle(check.matches ? Color.secondary : Tone.owed.color)
            }
        } header: {
            LedgerHeading(title: "Foot of the bill")
        } footer: {
            Text(footNote(a, held: held))
        }
    }

    private func footNote(_ a: SaleBillAnswer, held: [String: Double]) -> String {
        var parts: [String] = []
        if !held.isEmpty { parts.append("The bill's rate goes in its box for this sale only, so its lines come to the paper's figures; it is never kept as today's rate.") }
        if (a.discount ?? 0) > 0 { parts.append("Its discount goes in unless one is typed already.") }
        if (a.amountPaid ?? 0) > 0 { parts.append("What it says was paid goes in as cash, unless a payment is typed already: change it if it was paid another way.") }
        parts.append("Check the lines against the bill before saving.")
        return parts.joined(separator: " ")
    }

    /// The sale as it would be once filled, against the figure at the foot of the bill (sale-page.tsx's "This does
    /// not match the bill"): a line missed on a crowded slip shows here before anything goes on the sale.
    private func filledCheck(_ r: SaleBillReading, written: Double?) -> (text: String, matches: Bool)? {
        guard let written, !r.kept.isEmpty else { return nil }
        var preview = draft
        preview.fill(fromBill: r, customer: r.customer?.pinned.flatMap { book.customers.item($0.id) }, fallbackMetal: House.metal)
        let f = SaleFigures(draft: preview, settings: book.settings.value, customers: book.customers.items, marginSettings: House.margin)
        guard f.hasEstimate else { return nil }
        if !SaleBill.differs(written: written, computed: f.total) {
            return ("Filled in, the sale comes to \(Money.pkr(f.total)), as the bill says.", true)
        }
        let gap = f.total - written
        return ("This does not match the bill: it says \(Money.pkr(written)), the sale would come to \(Money.pkr(f.total)) (\(gap > 0 ? "+" : "−")\(Money.grouped(abs(gap)))). Check for a line that was missed.", false)
    }

    /// THE action: the kept lines onto the sale, then back to it.
    private var fillAction: ActionBar.Action {
        let n = reading?.kept.count ?? 0
        return ActionBar.Action(n > 0 ? "Add \(n == 1 ? "1 line" : "\(n) lines") to the sale" : "Add to the sale",
                                systemImage: "checkmark",
                                isDisabled: reading == nil || busy || n == 0) { fill() }
    }

    // MARK: Reading

    private func toggle(_ i: Int) {
        guard reading != nil else { return }
        Motion.run(reduce: reduceMotion) {
            if reading!.skipped.contains(i) { reading!.skipped.remove(i) } else { reading!.skipped.insert(i) }
        }
    }

    private func take(_ p: PaperPhoto) {
        photo = p
        problem = nil
        Task { await read() }
    }

    /// One photo (`{ image, mimeType }`), as the browser sends a bill; the customer matched against the book.
    private func read() async {
        guard let p = photo, !busy else { return }
        busy = true
        reading = nil
        problem = nil
        defer { busy = false }
        do {
            let data = try await PaperReader.ask("/api/vision/bill", ["image": p.jpeg.base64EncodedString(), "mimeType": "image/jpeg"])
            guard let answer = SaleBillAnswer.read(data) else {
                problem = "The ERP's answer could not be read back. Try again."
                return
            }
            guard photo?.id == p.id else { return }
            reading = SaleBillReading.resolve(answer, customers: book.customers.items)
        } catch {
            problem = PaperReader.words(error)
        }
    }

    /// The kept lines onto the sale (SaleDraft.fill(fromBill:)), the rates it set remembered as the bill's
    /// (SaleScanHeld), and a new sale kept on the phone at once so the form, reading it back, finds them there.
    private func fill() {
        guard let reading else { return }
        let customer = reading.customer?.pinned.flatMap { book.customers.item($0.id) }
        let before = draft
        let held = draft.fill(fromBill: reading, customer: customer, fallbackMetal: House.metal)
        SaleScanHeld.hold(held, before: before)
        if keep { SaleDraftStore.save(draft, business: House.business.id) }
        dismiss()
    }
}

// MARK: - The Mac: the bill and its reading, side by side

#if os(macOS)
/// Read a written bill on the Mac: the photo at the left (choose a file, drop one, or take it with the iPhone), what was
/// read at the right with its lines as a table to tick off, then the foot of the bill; "Add to the sale" is the footer.
extension SaleScanScreen {
    @ViewBuilder
    var macBody: some View {
        Group {
            if session.isOwner {
                macForm
            } else {
                NotAvailableState("Reading a bill is for the owners",
                                  why: "The ERP reads paper with the shop's AI account, which only an owner's sign-in may use.")
            }
        }
        .navigationTitle("Read a written bill")
        .selectionFeedback(trigger: reading?.skipped.count ?? 0)
        .task {
            book.customers.need()
            book.settings.need()
        }
    }

    @ViewBuilder
    private var macForm: some View {
        HSplitView {
            Form {
                Group {
                    photoSection
                    if busy {
                        Section {
                            HStack(spacing: 12) {
                                SkeletonLoading()
                                Text("Reading it…")
                            }
                        }
                    }
                    if let problem {
                        Section {
                            Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                            if photo != nil {
                                Button("Try again") { Task { await read() } }
                                    .buttonStyle(.borderless)
                            }
                        } header: {
                            Text("Could not read that")
                        }
                    }
                }
                .houseRows()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .frame(minWidth: 320, idealWidth: 380, maxWidth: 480)
            VStack(spacing: 0) {
                if let reading, !busy {
                    MacBillLines(lines: reading.answer.lines, skipped: reading.skipped,
                                 row: { l, on in lineRow(l, on: on, billRate: reading.answer.ratePerGram) },
                                 toggle: { toggle($0) })
                        .frame(minHeight: 180, idealHeight: 280)
                    Form {
                        Group { macReadingRest(reading) }.houseRows()
                    }
                    .formStyle(.grouped)
                    .scrollContentBackground(.hidden)
                } else {
                    ContentUnavailableView("Nothing read yet", systemImage: "doc.text.viewfinder",
                                           description: Text("Choose or drop a photo of the bill. Its lines come here to check."))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(minWidth: 460)
        }
        .background(Theme.ground)
        .actionBar(primary: fillAction)
    }

    /// What follows the lines: anything unreadable, the customer it sounds like, and the foot of the bill.
    @ViewBuilder
    private func macReadingRest(_ r: SaleBillReading) -> some View {
        let a = r.answer
        if let unread = a.unreadable, !unread.isEmpty {
            Section {
                Label(unread, systemImage: "questionmark.circle").foregroundStyle(Tone.owed.color)
            } header: {
                Text("Could not make this out")
            }
        }
        if let g = r.customer {
            PaperNamePick(label: "Customer", guess: g, nobody: "Nobody in the book sounds like that: choose the customer on the sale.") { p in
                reading?.customer?.pinned = p
            }
        }
        footSection(r)
    }
}

/// The bill's lines as a table: click a line (or press Space or double-click) to leave it off the sale or put it back.
private struct MacBillLines: View {
    let lines: [SaleBillLine]
    let skipped: Set<Int>
    let row: (SaleBillLine, Bool) -> AnyView
    let toggle: (Int) -> Void
    @State private var selection = Set<Int>()

    init<Content: View>(lines: [SaleBillLine], skipped: Set<Int>, row: @escaping (SaleBillLine, Bool) -> Content, toggle: @escaping (Int) -> Void) {
        self.lines = lines
        self.skipped = skipped
        self.row = { AnyView(row($0, $1)) }
        self.toggle = toggle
    }

    private struct Row: Identifiable {
        let id: Int
        let line: SaleBillLine
    }

    var body: some View {
        let rows = lines.enumerated().map { Row(id: $0.offset, line: $0.element) }
        let kept = lines.count - skipped.count
        VStack(alignment: .leading, spacing: 0) {
            Text("\(kept) of \(lines.count) line\(lines.count == 1 ? "" : "s")")
                .font(.headline)
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 6)
            Table(rows, selection: $selection) {
                TableColumn("") { r in
                    Image(systemName: skipped.contains(r.id) ? "circle" : "checkmark.circle.fill")
                        .foregroundStyle(skipped.contains(r.id) ? Color.secondary : Theme.accent)
                        .onTapGesture { toggle(r.id) }
                }
                .width(28)
                TableColumn("Line") { r in row(r.line, !skipped.contains(r.id)) }
            }
            .contextMenu(forSelectionType: Int.self) { ids in
                if !ids.isEmpty {
                    Button(ids.allSatisfy({ skipped.contains($0) }) ? "Put Back on the Sale" : "Leave Off the Sale") {
                        for i in ids { toggle(i) }
                    }
                }
            } primaryAction: { ids in for i in ids { toggle(i) } }
            .onKeyPress(.space) {
                guard !selection.isEmpty else { return .ignored }
                for i in selection { toggle(i) }
                return .handled
            }
            .overlay {
                if lines.isEmpty { Text("No lines could be read off this. You can still bill it by hand.").foregroundStyle(.secondary) }
            }
            Text("Leave a line off with a click on its circle. A line with only a figure is billed at that figure and will not move if you change the rate.")
                .font(.caption).foregroundStyle(.secondary)
                .padding(.horizontal, 20).padding(.vertical, 6)
        }
    }
}
#endif
