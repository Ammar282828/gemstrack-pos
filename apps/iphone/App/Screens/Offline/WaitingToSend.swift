import SwiftUI

// Offline, said and kept (owner, 2026-11-03: "it should fully handle not being connected at all in any situation").
// The pieces: the capsule at the top of the app while the line is gone (or something is still to send), the sheet it
// opens (Waiting to send: every kept change with its state), the pending rows at the top of Orders and Invoices, and
// the row in Settings → This phone. The queue itself is `Outbox`; the line is `Connection`.

// MARK: The capsule

/// A slim glass capsule: "Offline — changes will send when you're back", or how many are waiting. Tap opens Waiting to
/// send. Nothing at all when the line is there and nothing waits. It does not fade or slide (glass forming mid-
/// transition draws a stray bubble): it is there, or it is not.
struct OfflineCapsule: View {
    @State private var connection = Connection.shared
    @State private var outbox = Outbox.shared

    private var words: String? {
        let n = outbox.waitingCount
        if connection.isOffline {
            return n == 0 ? "Offline — changes will send when you're back" : "Offline — \(n) waiting to send"
        }
        return n == 0 ? nil : (n == 1 ? "1 waiting to send" : "\(n) waiting to send")
    }

    var body: some View {
        if let words {
            Button { outbox.queueOpen = true } label: {
                Label(words, systemImage: connection.isOffline ? "icloud.slash" : "arrow.triangle.2.circlepath")
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, pt(14)).padding(.vertical, pt(7))
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .padding(.vertical, pt(4))
            .frame(maxWidth: .infinity)
            .accessibilityHint("Shows what is waiting to send")
        }
    }
}

// MARK: Waiting to send

/// Every change kept on this phone or on its way, with its state. A refused one is kept with its data: Retry sends it
/// again, Discard (after asking) lets it go.
struct WaitingToSendSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var outbox = Outbox.shared
    @State private var connection = Connection.shared
    @State private var discarding: Outbox.Item?

    private var refused: [Outbox.Item] { outbox.items.filter { $0.status == .failed } }
    private var waiting: [Outbox.Item] { outbox.items.filter { $0.status != .failed }.sorted { $0.createdAt < $1.createdAt } }

    var body: some View {
        NavigationStack {
            List {
                if connection.isOffline {
                    Section {
                        Label("No connection. Everything here is kept on this phone and goes by itself when you're back online.", systemImage: "icloud.slash")
                            .font(.subheadline)
                    }
                }
                if !refused.isEmpty {
                    Section {
                        ForEach(refused) { row($0) }
                    } header: {
                        LedgerHeading(title: "Needs you", count: refused.count, tone: .problem)
                    } footer: {
                        Text("The ERP refused these. Nothing is lost: what you entered is still here.")
                    }
                    .houseRows()
                }
                if !waiting.isEmpty {
                    Section {
                        ForEach(waiting) { row($0) }
                    } header: {
                        LedgerHeading(title: "Waiting to send", count: waiting.count)
                    } footer: {
                        Text("Each goes once, in the order it was made, whatever happens to the connection or the app.")
                    }
                    .houseRows()
                }
            }
            .overlay {
                if outbox.items.isEmpty {
                    EmptyState("Nothing is waiting", symbol: "checkmark.icloud", message: "Everything you did is at the ERP.")
                }
            }
            .houseForm()
            .navigationTitle("Waiting to send")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmDestructive(isPresented: Binding(get: { discarding != nil }, set: { if !$0 { discarding = nil } }),
                                title: "Discard \(discarding?.label ?? "this")?",
                                message: "It has not reached the ERP. It will be gone from this phone.",
                                action: "Discard") {
                if let d = discarding { outbox.discard(d.id) }
                discarding = nil
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func row(_ item: Outbox.Item) -> some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label).font(.headline)
                    if let s = item.summary, !s.detail.isEmpty || s.amount != nil {
                        Text([s.detail, s.amount.map { Money.pkr($0) } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                PendingState(item: item)
            }
            if item.status == .failed {
                if !item.message.isEmpty {
                    Text(item.message).font(.footnote).foregroundStyle(Tone.problem.color)
                }
                HStack(spacing: pt(10)) {
                    Button("Retry") { outbox.retry(item.id) }.buttonStyle(.bordered)
                    if !item.isPost {
                        Button("Discard", role: .destructive) { discarding = item }.buttonStyle(.bordered)
                    }
                }
            } else if item.durable {
                Button("Discard", role: .destructive) { discarding = item }
                    .font(.footnote)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, pt(2))
    }
}

/// A change's state in a capsule.
struct PendingState: View {
    let item: Outbox.Item

    var body: some View {
        switch item.status {
        case .waiting: Pill("Waiting to send", tone: .owed, symbol: "clock")
        case .saving: Pill("Sending…", tone: .working)
        case .retrying: Pill("Trying again", tone: .working)
        case .failed: Pill("Not sent", tone: .problem, symbol: "exclamationmark.circle")
        }
    }
}

// MARK: The pending rows of a list

/// New orders (kind "order") or sales ("invoice") the ERP does not have yet, at the top of their list: the person
/// sees what they just took, with a clear capsule and "Pending" where its number will be, until the ERP numbers it and
/// the real record takes its place. In a List (`width` nil) it is a section; on the iPad's grid it is a heading and cards.
struct PendingRecords: View {
    let kind: String
    var width: CGFloat?
    @State private var outbox = Outbox.shared

    var body: some View {
        let rows = outbox.records(kind: kind)
        if !rows.isEmpty {
            if let width {
                VStack(alignment: .leading, spacing: pt(16)) {
                    LedgerHeading(title: "Waiting to send", count: rows.count)
                    RecordGrid(items: rows, width: width) { (item: Outbox.Item) in
                        RecordCard { row(item) }
                            .onTapGesture { outbox.queueOpen = true }
                    }
                }
            } else {
                Section {
                    ForEach(rows) { (item: Outbox.Item) in
                        row(item)
                            .contentShape(Rectangle())
                            .onTapGesture { outbox.queueOpen = true }
                    }
                } header: {
                    LedgerHeading(title: "Waiting to send", count: rows.count)
                }
                .houseRows()
            }
        }
    }

    private func row(_ item: Outbox.Item) -> some View {
        let s = item.summary ?? PendingSummary(kind: kind, title: item.label)
        return RecordRow(
            name: s.title,
            title: s.title,
            subtitle: Text(["Pending", s.detail].filter { !$0.isEmpty }.joined(separator: " · ")),
            money: s.amount.map { RecordMoney(amount: $0) },
            status: RecordStatus(text: item.status == .failed ? "Not sent" : "Waiting to send",
                                 tone: item.status == .failed ? .problem : .owed,
                                 symbol: item.status == .failed ? "exclamationmark.circle" : "clock")
        )
    }
}

// MARK: Settings

/// "Waiting to send (N)" in Settings → This phone: opens the sheet. Nothing when nothing is kept.
struct WaitingToSendSection: View {
    @State private var outbox = Outbox.shared

    var body: some View {
        if !outbox.items.isEmpty {
            Section {
                Button { outbox.queueOpen = true } label: {
                    HStack {
                        Label("Waiting to send", systemImage: "tray.and.arrow.up")
                        Spacer()
                        Text("\(outbox.items.count)").foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            } footer: {
                Text("Changes kept on this phone until the ERP has them.")
            }
        }
    }
}
