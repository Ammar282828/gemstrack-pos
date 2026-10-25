import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

// The confirmations before an online order moves (components/order/online-inbox.tsx's Confirm and Decline
// dialogs, website-order-panel.tsx's MoneyMoves): every one of them messages the customer from the shop's
// number, and Transfer received books money, so each sheet says to whom and, word for word, what goes
// (the server's preview: lib/website/online-preview.ts) before the move is asked of the server.

/// Where the WhatsApp goes and what it says, from the server's preview; the web's line while it comes.
struct OnlineMessageSection: View {
    let preview: OnlinePreview?
    let problem: String?
    /// What the web's dialog says, for when the exact words could not be read.
    let fallback: String

    var body: some View {
        Section {
            if let p = preview {
                LabeledContent("To") {
                    Text(p.to.isEmpty ? p.name : "\(p.name) · \(p.to)").multilineTextAlignment(.trailing)
                }
                Text(p.text)
                    .font(.subheadline)
                    .textSelection(.enabled)
            } else if let problem {
                Text(fallback).font(.subheadline)
                Text("The exact words could not be read: \(problem)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: pt(10)) {
                    ProgressView().controlSize(.small)
                    Text("Reading what is sent…").foregroundStyle(.secondary)
                }
            }
        } header: {
            LedgerHeading(title: "WhatsApp to the customer")
        } footer: {
            if let p = preview {
                if p.sends {
                    Text("Sent from the shop's number as soon as you go ahead.")
                } else {
                    Text("Nothing will be sent (\(p.to.isEmpty ? "the order has no number" : "this ERP's WhatsApp is off")): tell \(p.name) yourself.")
                }
            }
        }
    }
}

/// What the server will not do from here (confirmed already, declined): said in words, not as an error.
private struct OnlineRefusedSection: View {
    let message: String

    var body: some View {
        Section {
            Label(message, systemImage: "info.circle")
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: Confirm

/// Confirm: the ORD- order is written (labelled Online, the quoted prices), the price is held and the customer
/// is told on WhatsApp. Then the sheet's second step, as the web's: send the bank details from this phone.
struct OnlineConfirmSheet: View {
    let row: OnlineOrderRow
    /// Opens the order confirming made, once the sheet has closed.
    let openOrder: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var preview: OnlinePreview?
    @State private var problem: String?
    /// The server would refuse (confirmed already, declined): Confirm stays shut.
    @State private var refused: String?
    @State private var busy = false
    @State private var failure: String?
    @State private var confirmed: OnlineOrdersStore.Confirmed?

    private var store: OnlineOrdersStore { OnlineOrdersStore.shared }

    private var bankURL: URL? {
        OnlineOrdersLogic.bankDetailsURL(phone: row.customer.phone, name: row.customer.name, ref: row.id, total: row.grandTotal)
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                if let confirmed { doneSections(confirmed) } else { askSections }
                }
                .houseRows()
            }
            .houseForm()
            .navigationTitle(confirmed.map { "\(row.id) is \($0.orderId)" } ?? "Confirm \(row.id)?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if confirmed == nil {
                        Button(role: .cancel) { dismiss() }
                            .disabled(busy)
                    }
                }
                if confirmed != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .ordersBar(bar)
            .failureAlert($failure, title: "Not confirmed")
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(busy)
        .task { await readPreview() }
    }

    /// Confirm; then, with the order made, the bank details from this phone.
    private var bar: ActionBar.Action? {
        if confirmed == nil {
            return ActionBar.Action("Confirm", systemImage: "checkmark", isBusy: busy,
                                    isDisabled: refused != nil || (preview == nil && problem == nil)) {
                Task { await confirm() }
            }
        }
        if let url = bankURL {
            return ActionBar.Action("Send bank details on WhatsApp", systemImage: "paperplane") { openURL(url) }
        }
        return nil
    }

    @ViewBuilder
    private var askSections: some View {
        Section {
            Text(OnlineOrdersLogic.confirmWords(row, holdUntil: preview?.holdUntil)).font(.subheadline)
            LabeledContent("Sizes", value: OnlineOrdersLogic.sizes(row))
            LabeledContent("Ships to", value: row.delivery.city)
            if let dearer = OnlineOrdersLogic.dearerToday(row) {
                LabeledContent("Today it would be") {
                    Text(Money.pkr(dearer)).foregroundStyle(Tone.owed.color).monospacedDigit()
                }
            }
        }
        if let refused {
            OnlineRefusedSection(message: refused)
        } else {
            OnlineMessageSection(
                preview: preview,
                problem: problem,
                fallback: "\(row.customer.name) is told on WhatsApp that it is confirmed and that your bank details are coming, with the price held \(OnlineOrdersLogic.holdHours) hours."
            )
        }
    }

    @ViewBuilder
    private func doneSections(_ c: OnlineOrdersStore.Confirmed) -> some View {
        Section {
            if let n = c.notified, !n.isEmpty {
                Label("Confirmed, but the WhatsApp telling \(row.customer.name) did not send (\(n)).", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Tone.owed.color)
            } else {
                Label("\(row.customer.name) has been told it is confirmed and that your bank details are coming.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Tone.settled.color)
            }
            Text("Send them now: the price is held \(holdWords) for \(Money.pkr(row.grandTotal)).")
        } footer: {
            Text(bankURL == nil
                 ? "There is no WhatsApp number on the order: call them for the transfer."
                 : "WhatsApp opens on this \(OrderDevice.word) with the amount and \(row.id) written in. Add your account and press send there.")
        }
        if !c.orderId.isEmpty {
            Section {
                Button {
                    dismiss()
                    openOrder(c.orderId)
                } label: {
                    Label("Open \(c.orderId)", systemImage: "list.clipboard")
                }
            }
        }
    }

    private var holdWords: String { OnlineOrdersLogic.holdWords(preview?.holdUntil) }

    private func readPreview() async {
        do {
            preview = try await store.previewOnline(row.id, action: "confirm")
        } catch let f as ERPAPI.Failure where f.status == 409 {
            refused = f.message
        } catch {
            problem = error.localizedDescription
        }
    }

    private func confirm() async {
        busy = true
        failure = nil
        do {
            confirmed = try await store.confirm(row.id)
        } catch {
            failure = error.localizedDescription
        }
        busy = false
    }
}

// MARK: Decline

/// Decline: the customer is sent the reason; nothing else is written, and nothing was charged.
struct OnlineDeclineSheet: View {
    let row: OnlineOrderRow
    /// What to say once it is done.
    let done: (OnlineTold) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var preview: OnlinePreview?
    @State private var problem: String?
    @State private var busy = false
    @State private var failure: String?

    private var store: OnlineOrdersStore { OnlineOrdersStore.shared }
    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var ready: Bool { OnlineOrdersLogic.reasonReady(reason) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Text("\(row.customer.name) is sent this on WhatsApp, after “we can't take it as it was placed:”. Nothing has been charged, so nothing needs undoing.")
                        .font(.subheadline)
                }
                Section {
                    ForEach(OnlineOrdersLogic.reasons, id: \.self) { (r: String) in
                        Button { reason = r } label: {
                            HStack {
                                Text(r).foregroundStyle(.primary)
                                Spacer(minLength: 8)
                                if trimmed == r { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }
                        }
                    }
                    TextField("Why, in a line", text: $reason, prompt: Text("Why, in a line"), axis: .vertical)
                        .lineLimit(2...5)
                } header: {
                    LedgerHeading(title: "Why")
                }
                if ready {
                    OnlineMessageSection(
                        preview: preview,
                        problem: problem,
                        fallback: "\(row.customer.name) is told why on WhatsApp, with the link to their order."
                    )
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Decline \(row.id)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .disabled(busy)
                }
            }
            .ordersBar(ActionBar.Action("Decline and tell them", systemImage: "xmark", role: .destructive, isBusy: busy,
                                        isDisabled: !ready || (preview == nil && problem == nil)) {
                Task { await decline() }
            })
            .failureAlert($failure, title: "Not declined")
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(busy)
        .onChange(of: reason) { _, now in
            if now.count > OnlineOrdersLogic.reasonLimit { reason = String(now.prefix(OnlineOrdersLogic.reasonLimit)) }
        }
        // The words follow the reason as it is typed: asked once the typing pauses.
        .task(id: trimmed) { await readPreview() }
    }

    private func readPreview() async {
        let r = trimmed
        preview = nil
        problem = nil
        guard OnlineOrdersLogic.reasonReady(r) else { return }
        do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
        do {
            let p = try await store.previewOnline(row.id, action: "decline", reason: r)
            if !Task.isCancelled { preview = p }
        } catch {
            if !Task.isCancelled { problem = error.localizedDescription }
        }
    }

    private func decline() async {
        busy = true
        failure = nil
        do {
            let notified = try await store.decline(row.id, reason: trimmed)
            done(OnlineOrdersLogic.told(notified, name: row.customer.name, sent: "\(row.id) declined: \(row.customer.name) has been told why."))
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
        busy = false
    }
}

// MARK: Transfer received, Let it lapse

/// A confirmed online order's two money moves (website-order-panel.tsx MoneyMoves): the transfer is in the
/// bank, or nothing came and it lapses. Both tell the customer; the first books the money.
struct OnlineMoveSheet: View {
    enum Kind: String, Identifiable {
        case paid = "transfer_received"
        case lapse
        var id: String { rawValue }
    }

    let order: Order
    let kind: Kind
    /// What to say once it is done.
    let done: (OnlineTold) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var preview: OnlinePreview?
    @State private var problem: String?
    @State private var refused: String?
    @State private var busy = false
    @State private var failure: String?

    private var store: OnlineOrdersStore { OnlineOrdersStore.shared }
    private var total: Double { OrdersLogic.onlineTotal(order) }
    private var ref: String { order.website?.onlineId ?? order.id }
    private var name: String { OrdersLogic.customerName(order) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Text(kind == .paid
                         ? "Only once you see it in the bank: a slip is not the money."
                         : "Only once you have checked the bank and nothing came.")
                        .font(.subheadline.weight(.semibold))
                    if kind == .paid { bookingRows } else {
                        Text("The order is cancelled and \(name) is told it lapsed and can order again at today's rate.")
                            .font(.subheadline)
                    }
                }
                if let refused {
                    OnlineRefusedSection(message: refused)
                } else {
                    OnlineMessageSection(preview: preview, problem: problem, fallback: fallback)
                }
                }
                .houseRows()
            }
            .houseForm()
            .navigationTitle(kind == .paid ? "\(Money.pkr(total)) is in the account?" : "Let \(ref) lapse?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not yet") { dismiss() }
                        .disabled(busy)
                }
            }
            .ordersBar(ActionBar.Action(kind == .paid ? "Yes, it is in" : "Let it lapse",
                                        systemImage: kind == .paid ? "banknote" : "nosign",
                                        role: kind == .lapse ? .destructive : nil, isBusy: busy,
                                        isDisabled: refused != nil || (preview == nil && problem == nil)) {
                Task { await go() }
            })
            .failureAlert($failure, title: kind == .paid ? "Transfer not booked" : "Not lapsed")
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(busy)
        .task { await readPreview() }
    }

    /// What Transfer received books: the server's sums once its preview has come, the web's words until then.
    @ViewBuilder
    private var bookingRows: some View {
        let advance = preview?.booking?.advance ?? order.subtotal
        let delivery = preview?.booking?.deliveryRevenue ?? (order.website?.deliveryCharge ?? 0)
        LabeledContent("Bank Transfer advance") {
            Text(Money.pkr(advance)).monospacedDigit()
        }
        if delivery > 0 {
            LabeledContent("Delivery, as extra revenue") {
                Text(Money.pkr(delivery)).monospacedDigit()
            }
        }
        Text("The order is paid in full, \(name) is told, and it is ready to give out.")
            .font(.subheadline)
    }

    private var fallback: String {
        kind == .paid
            ? "\(name) is told on WhatsApp that the transfer for \(ref) has come and the piece is being prepared."
            : "\(name) is told on WhatsApp that \(ref) is closed because the transfer did not come."
    }

    private func readPreview() async {
        do {
            preview = try await store.previewOrder(order.id, action: kind.rawValue)
        } catch let f as ERPAPI.Failure where f.status == 409 {
            refused = f.message
        } catch {
            problem = error.localizedDescription
        }
    }

    private func go() async {
        busy = true
        failure = nil
        do {
            let notified: String?
            if kind == .paid {
                notified = try await store.transferReceived(order: order.id)
            } else {
                notified = try await store.lapse(order: order.id)
            }
            let sent = kind == .paid
                ? "Transfer received: \(name) has been told on WhatsApp."
                : "\(ref) lapsed: \(name) has been told on WhatsApp."
            done(OnlineOrdersLogic.told(notified, name: name, sent: sent))
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
        busy = false
    }
}

// MARK: A slip

/// A transfer slip the customer sent (/api/website/orders/<id>/slips/<slip>), to check against the bank: a
/// picture shown here, a PDF handed to the share sheet to open.
struct OnlineSlipSheet: View {
    let orderId: String
    let slip: WebsiteSlip

    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var file: URL?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Group {
                if let image {
                    ScrollView {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .padding()
                    }
                } else if let file {
                    ContentUnavailableView {
                        Label("A PDF slip", systemImage: "doc.richtext")
                    } description: {
                        Text("Open it from the share sheet.")
                    } actions: {
                        ShareLink(item: file) { Label("Open the PDF", systemImage: "square.and.arrow.up") }
                            .buttonStyle(.houseProminent)
                    }
                } else if let failure {
                    ErrorState(failure) {
                        self.failure = nil
                        Task { await load() }
                    }
                } else {
                    SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Slip " + ShopDate.say(slip.at, withTime: true))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        #if os(macOS)
        .ordersMacSheet(width: 640, height: 560)
        #endif
        .task { await load() }
    }

    private func load() async {
        let path = "/api/website/orders/\(OnlineOrdersLogic.component(orderId))/slips/\(OnlineOrdersLogic.component(slip.id))"
        do {
            let data = try await ERPAPI.shared.data(path)
            if let picture = UIImage(data: data) {
                image = picture
            } else {
                // Kept only while the app runs; the system clears its temporary folder.
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(orderId)-slip.pdf")
                try data.write(to: url, options: .atomic)
                file = url
            }
        } catch {
            failure = OnlineOrdersStore.say(error)
        }
    }
}
