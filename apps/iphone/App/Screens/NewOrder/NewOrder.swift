import SwiftUI
import UIKit
import ERPCore

/// New order (src/app/orders/add/page.tsx, components/order/order-form.tsx): who it is for, when it is
/// promised, the pieces (each opens full-screen), the rates, the discount, the advance and the exchange,
/// and the totals as the web works them out. Saved through the ERP's own shared write (`createOrder`,
/// lib/writes/create-order.ts): it numbers the order and stamps the rates, exactly as the browser's does.
///
/// The order in progress stays on this phone if the screen closes (NewOrderDraftStore), until it is
/// saved or started over. The AI slip reader and the voice order stay on the ERP's page ("Read a slip").
/// Not here: Add from inventory and the offer to save a size to the customer's profile (both are the
/// ERP's page; the app has no write that updates a customer yet).
struct NewOrder: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var draft = NewOrderDraft.fresh()
    /// The phone's copy has been read (and not before: an unread draft must never be overwritten).
    @State private var loaded = false
    @State private var restored = false
    @State private var editing: NewOrderPieceRef?
    @State private var takenNames: [String] = []
    @State private var saving = false
    @State private var failure: String?
    @State private var failureTitle = "The order wasn't saved"
    @State private var created: String?
    @State private var confirmReset = false

    init() {}

    var body: some View {
        Group {
            if let created {
                NewOrderLanding(id: created)
            } else if session.role == "owner" || session.role == "staff" {
                form
            } else {
                ContentUnavailableView("Orders are taken by the shop", systemImage: "lock", description: Text("Sign in with an owner or staff account to take an order."))
            }
        }
        .onAppear { start() }
    }

    // MARK: Reading

    /// Customers who are people: not removed, not the old "Walk-in Customer" records (lib/walk-in.ts).
    private var people: [Customer] {
        NewOrderMath.people(book.customers.items)
    }

    private var karigars: [Karigar] {
        book.karigars.items.filter { ($0.deletedAt ?? "").isEmpty }
    }

    private var addressOnFile: String? {
        guard !draft.customerId.isEmpty, let c = book.customers.item(draft.customerId) else { return nil }
        let a = NewOrderFormat.trim(c.address ?? "")
        return a.isEmpty ? nil : a
    }

    private func start() {
        book.customers.need()
        book.karigars.need()
        book.settings.need()
        book.orders.need()
        book.invoices.need()
        if !loaded {
            if let saved = NewOrderDraftStore.load() {
                draft = saved
                restored = true
            }
            loaded = true
        }
        seedRates()
    }

    /// The rates start as today's, once; a draft that is continued keeps the rates it was quoted at.
    private func seedRates() {
        guard loaded, !draft.ratesSeeded, let s = book.settings.value else { return }
        draft.seedRates(from: s)
    }

    /// The web offers the house's people list; the app has none yet, so: the names already used on recent
    /// orders and invoices (the last 60 days), and free text.
    private func recentNames() -> [String] {
        let cutoff = Date().addingTimeInterval(-60 * 86_400)
        var names = Set<String>()
        // Both shelves are newest first, so the walk stops at the first one older than the window.
        for o in book.orders.items {
            guard let d = ERPDate.parse(o.createdAt) else { continue }
            if d < cutoff { break }
            let t = NewOrderFormat.trim(o.takenBy ?? "")
            if !t.isEmpty { names.insert(t) }
        }
        for i in book.invoices.items {
            guard let d = ERPDate.parse(i.createdAt) else { continue }
            if d < cutoff { break }
            let t = NewOrderFormat.trim(i.takenBy ?? "")
            if !t.isEmpty { names.insert(t) }
        }
        return names.sorted()
    }

    // MARK: The form

    private var form: some View {
        let settings = book.settings.value
        let totals = NewOrderMath.totals(draft, settings)
        return screen(totals, settings)
            .alert(failureTitle, isPresented: failureShown) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
            .confirmationDialog("Start this order over?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Start over", role: .destructive) { startOver() }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text("Everything typed so far is cleared from this phone.")
            }
            .interactiveDismissDisabled(saving)
            .sensoryFeedback(.success, trigger: created)
            .modifier(keeping)
    }

    /// The form, its bar and its toolbar.
    private func screen(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        Form {
            if restored { restoredBanner }
            NewOrderCustomerSection(draft: $draft, people: people, takenNames: takenNames)
            NewOrderPromisedSection(draft: $draft)
            piecesSection(totals)
            NewOrderRatesSection(draft: $draft, settings: settings)
            NewOrderPrintedSection(draft: $draft)
            NewOrderPaymentSection(draft: $draft)
            NewOrderExchangeSection(draft: $draft)
            tail(totals, settings)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New order")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // The AI slip reader and the voice order stay on the ERP's page; ?web=1 opens it even though
                // /orders/add has a native screen, and the page reads scan=parchi to open the reader at once.
                NavigationLink(value: Route(path: "/orders/add?web=1&scan=parchi")) {
                    Label("Read a slip", systemImage: "doc.text.viewfinder")
                        .labelStyle(.titleAndIcon)
                }
            }
        }
        .newOrderKeyboardDone()
        .safeAreaInset(edge: .bottom) { saveBar(totals) }
        .navigationDestination(item: $editing) { ref in editor(ref.id) }
    }

    /// Kept on this phone as it is typed: a moment after the last key, and at once when the app leaves.
    private var keeping: NewOrderKeeping {
        NewOrderKeeping(
            draft: draft,
            loaded: loaded,
            settingsValue: book.settings.value,
            counts: book.orders.items.count + book.invoices.items.count,
            keep: { keepNow() },
            seed: { seedRates() },
            names: { takenNames = recentNames() }
        )
    }

    private func keepNow() {
        guard loaded, created == nil else { return }
        NewOrderDraftStore.save(draft, now: true)
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    private var restoredBanner: some View {
        Section {
            Label("Your order in progress is back. It was kept on this phone.", systemImage: "arrow.uturn.backward.circle")
                .font(.subheadline)
            if draft.photosLeftOut {
                Label("The sample photos were too many to keep: add them again.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: The pieces

    private func piecesSection(_ totals: NewOrderMath.Totals) -> some View {
        Section {
            ForEach(Array(draft.pieces.enumerated()), id: \.element.id) { index, piece in
                Button { editing = NewOrderPieceRef(id: piece.id) } label: {
                    NewOrderPieceRow(piece: piece, number: index + 1, price: index < totals.prices.count ? totals.prices[index] : 0)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { removePiece(piece.id) } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .leading) {
                    Button { duplicatePiece(piece.id) } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    .tint(.blue)
                }
                .contextMenu {
                    Button { duplicatePiece(piece.id) } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    Button(role: .destructive) { removePiece(piece.id) } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
            }
            Button(action: addPiece) {
                Label("Add a piece", systemImage: "plus.circle.fill")
            }
        } header: {
            Text("Pieces")
        } footer: {
            NewOrderPiecesFooter(count: draft.pieces.count)
        }
    }

    /// A new piece opens at once: it is what you came to fill in.
    private func addPiece() {
        let piece = NewOrderPieceDraft()
        draft.pieces.append(piece)
        editing = NewOrderPieceRef(id: piece.id)
    }

    private func duplicatePiece(_ id: UUID) {
        draft.duplicatePiece(id)
    }

    private func removePiece(_ id: UUID) {
        draft.pieces.removeAll { $0.id == id }
    }

    private func pieceBinding(_ id: UUID) -> Binding<NewOrderPieceDraft> {
        Binding(
            get: { draft.pieces.first(where: { $0.id == id }) ?? NewOrderPieceDraft() },
            set: { next in
                if let i = draft.pieces.firstIndex(where: { $0.id == id }) { draft.pieces[i] = next }
            }
        )
    }

    @ViewBuilder
    private func editor(_ id: UUID) -> some View {
        if let i = draft.pieces.firstIndex(where: { $0.id == id }) {
            NewOrderPieceEditor(
                piece: pieceBinding(id),
                number: i + 1,
                rates: NewOrderMath.formRates(draft, book.settings.value),
                isOwner: session.isOwner,
                karigars: karigars,
                onDuplicate: { duplicatePiece(id) },
                onRemove: { removePiece(id) }
            )
        } else {
            ContentUnavailableView("That piece is gone", systemImage: "trash")
        }
    }

    // MARK: The rest of the form

    @ViewBuilder
    private func tail(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        NewOrderNotesSection(draft: $draft)
        NewOrderDeliverySection(draft: $draft, addressOnFile: addressOnFile)
        if session.isOwner && House.margin.rattiLess != nil {
            NewOrderMarginSection(draft: $draft, settings: settings) {
                NewOrderMath.margin(draft, settings, totals)
            }
        }
        NewOrderTotalsSection(totals: totals, pieces: draft.pieces.count)
        if !draft.isBlank {
            Section {
                Button("Start over", role: .destructive) { confirmReset = true }
            } footer: {
                Text("Your order is kept on this phone until you save it or start over.")
            }
        }
    }

    private func startOver() {
        NewOrderDraftStore.clear()
        draft = NewOrderDraft.fresh()
        restored = false
        editing = nil
        seedRates()
    }

    // MARK: Saving

    /// THE action of the screen: one glass button, with the balance beside it.
    private func saveBar(_ totals: NewOrderMath.Totals) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Balance due").font(.caption).foregroundStyle(.secondary)
                MoneyText(amount: totals.balance, exact: true)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 8)
            Button {
                Task { await save() }
            } label: {
                Group {
                    if saving {
                        ProgressView()
                    } else {
                        Text("Save order")
                    }
                }
                .frame(minWidth: 120)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(saving)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func tell(_ title: String, _ message: String) {
        failureTitle = title
        failure = message
    }

    /// The same checks as the web's form (`orderFormSchema`), then `createOrder` with `{ order }`, then the
    /// order's own page replaces this one. The ERP numbers the order and stamps the rates; nothing here
    /// updates a shelf, the new order arrives on it by itself.
    private func save() async {
        guard !saving else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        guard let settings = book.settings.value else {
            tell("The order can't be saved yet", "The shop's rates haven't loaded. Check the connection and try again.")
            return
        }
        if let problem = NewOrderMath.problem(draft) {
            tell("The order can't be saved yet", problem)
            return
        }
        saving = true
        defer { saving = false }
        let request = NewOrderMath.request(draft, settings: settings, customers: people, owner: session.isOwner)
        do {
            let out = try await ERPAPI.shared.write("createOrder", request)
            guard let made = out["order"] as? [String: Any], let id = made["id"] as? String, !id.isEmpty else {
                throw ERPAPI.Failure(status: 0, message: "The ERP saved the order but didn't say its number. Look for it in Orders.")
            }
            NewOrderDraftStore.clear()
            // Blank, so a keep that was already on its way writes nothing back.
            draft = NewOrderDraft.fresh()
            created = id
        } catch let e as ERPAPI.Failure {
            tell("The order wasn't saved", e.message)
        } catch {
            // No answer is not "no": the order may have gone through, and saving again would make a second.
            tell("The order wasn't saved", error.localizedDescription + "\n\nIf the connection dropped, the order may have been saved. Check Orders before saving it again.")
        }
    }
}

/// The order stays on this phone while it is typed (NewOrderDraftStore): written a moment after the last
/// key, and at once when the app leaves or the screen goes. It also seeds the rates when the shop's settings
/// arrive, and works out the "Taken by" names when the books change. Its own modifier so the form's chain of
/// modifiers stays short for the compiler.
struct NewOrderKeeping: ViewModifier {
    let draft: NewOrderDraft
    let loaded: Bool
    let settingsValue: Settings?
    let counts: Int
    let keep: () -> Void
    let seed: () -> Void
    let names: () -> Void

    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task(id: draft) {
                guard loaded else { return }
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                NewOrderDraftStore.save(draft)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { keep() }
            }
            .onChange(of: settingsValue) { _, _ in seed() }
            .task(id: counts) { names() }
            .onDisappear { keep() }
    }
}

/// After the save: the new order's own page replaces the form. The order reaches the shelf a moment
/// after the write, so a short wait keeps the page from saying "Order not found" first.
struct NewOrderLanding: View {
    let id: String

    @Environment(Book.self) private var book
    @State private var waited = false

    var body: some View {
        if waited || book.orders.items.contains(where: { $0.id == id }) {
            OrderScreen(id: id)
        } else {
            VStack(spacing: 12) {
                ProgressView().controlSize(.large)
                Text("Opening \(id)…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(id)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                book.orders.need()
                try? await Task.sleep(for: .seconds(4))
                waited = true
            }
        }
    }
}
