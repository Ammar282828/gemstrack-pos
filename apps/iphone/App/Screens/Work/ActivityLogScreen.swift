import SwiftUI
import FirebaseFirestore
import ERPCore

/// Settings → Activity (src/app/activity-log/page.tsx): everything done in the ERP, newest first (Firestore `activity_log`),
/// narrowed by the kind of event and a range of days. Owners only, as Settings is: the log is the shop's books.
///
/// Owners read the collection live, as the web does. The filters are the page's: Event Type (a kind, matched on the start
/// of the event's type) and a date range; here the last day of the range counts in full (ActivityLogRules.filter says why).
/// Revert is the page's: a new invoice, order or expense is deleted, said in the page's words and asked for with the delete
/// code (the ERP's own deleteInvoice, deleteOrder, deleteExpense, which check it). Below the log, as on the page, the last
/// 30 sign-ins (Firestore `signInLogs`) and the Emergency lock (`lockDatabase`, one way only).
struct ActivityLogScreen: View {
    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Firestore `activity_log`: a long log, so it is read only while this screen is open.
    @State private var shelf = Shelf<ActivityLogEntry>("activity_log") { $0.timestamp > $1.timestamp }
    @State private var demoEntries: [ActivityLogEntry] = House.isDemo ? WorkDemo.activity() : []
    /// "All" or one of `ActivityLogRules.eventTypes`.
    @State private var type = "All"
    @State private var range = WorkRange()
    /// How many lines are listed: a log runs to thousands, so it is shown a page at a time.
    @State private var shown = ActivityLogScreen.pageSize
    @State private var narrowed = Memo<[ActivityLogEntry]>()
    /// A revert waiting for its code.
    @State private var reverting: OwnerDeletion?
    @State private var reverted = 0
    @State private var note: Note?
    /// The last sign-ins, read once as the page reads them; nil until they are.
    @State private var signIns: [ActivitySignIn]?
    @State private var signInsFailed = false
    @State private var askLock = false
    @State private var locking = false
    @State private var failure: String?

    private static let pageSize = 200

    var body: some View {
        Group {
            if session.isOwner {
                ShelfState(
                    loaded: House.isDemo || shelf.loaded,
                    error: House.isDemo ? nil : shelf.error,
                    offline: !House.isDemo && shelf.offline
                ) {
                    page
                }
            } else {
                WorkNotYours(title: "Activity", detail: "The activity log is kept for the shop's owners.")
            }
        }
        .navigationTitle("Activity")
        .sheet(item: $reverting) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                reverted += 1
                Note.show(Note(title: "Reverted", detail: "\u{201C}\(d.what)\u{201D} has been undone."), in: $note, reduce: reduceMotion)
            }
        }
        .confirmationDialog("Are you absolutely sure?", isPresented: $askLock, titleVisibility: .visible) {
            Button("Yes, Lock It Down", role: .destructive) { Task { await lock() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You are about to lock this application from accessing its database. This action is NOT REVERSIBLE through the user interface.")
        }
        .destructiveFeedback(trigger: reverted)
        .noteToast($note)
        .failureAlert($failure, title: "Not done")
        .onAppear {
            if session.isOwner && !House.isDemo {
                shelf.need()
                book.settings.need()
            }
        }
        .task { if session.isOwner { await loadSignIns() } }
        .onDisappear { shelf.reset() }
        .onChange(of: type) { _, _ in shown = ActivityLogScreen.pageSize }
        .onChange(of: range) { _, _ in shown = ActivityLogScreen.pageSize }
    }

    // MARK: The lines

    private var entries: [ActivityLogEntry] { House.isDemo ? demoEntries : shelf.items }

    /// The log as the filters leave it, worked out once per change of the log or of a filter, not per drawing.
    private func visible() -> [ActivityLogEntry] {
        let today = ERPDate.karachiDay(Date())
        let key = [
            House.isDemo ? demoEntries.count : shelf.revision,
            ActivityLogRules.eventTypes.firstIndex(of: type) ?? -1,
            (range.fromDay ?? "").hashValue,
            (range.toDay ?? "").hashValue,
            today.hashValue,
        ]
        return narrowed(key) {
            ActivityLogRules.filter(entries, type: type, fromDay: range.fromDay, toDay: range.toDay, today: today)
        }
    }

    // MARK: The page

    @ViewBuilder
    private var page: some View {
        let list = visible()
        List {
            Section {
                Picker("Event type", selection: $type) {
                    Text("All").tag("All")
                    ForEach(ActivityLogRules.eventTypes, id: \.self) { (t: String) in
                        Text(ActivityLogRules.title(t)).tag(t)
                    }
                }
                WorkRangeFields(range: $range)
            } header: {
                LedgerHeading(title: "Filters")
            } footer: {
                if range.useFrom && !range.useTo {
                    Text("Without an end date the range runs to the end of today.")
                }
            }
            .houseRows()

            Section {
                if list.isEmpty {
                    ContentUnavailableView(
                        "No Activity Found",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("There are no log entries for the selected filters.")
                    )
                } else {
                    ForEach(list.prefix(shown)) { (e: ActivityLogEntry) in row(e) }
                    if list.count > shown {
                        Button("Show \(min(ActivityLogScreen.pageSize, list.count - shown)) more") {
                            shown += ActivityLogScreen.pageSize
                        }
                    }
                }
            } header: {
                LedgerHeading(title: "Newest first", count: list.count)
            }
            .houseRows()

            signInSection
            lockSection
        }
        .listStyle(.insetGrouped)
    }

    // MARK: Sign-in activity

    private var signInSection: some View {
        Section {
            if let signIns {
                if signIns.isEmpty {
                    Text("No sign-in activity recorded yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(signIns) { (s: ActivitySignIn) in signInRow(s) }
                }
            } else if signInsFailed {
                Text("The sign-ins could not be read.").foregroundStyle(.secondary)
            } else {
                SkeletonLoading("Loading…").frame(height: 44)
            }
        } header: {
            LedgerHeading(title: "Sign-in activity")
        } footer: {
            Text("The last 30 sign-ins to this app.")
        }
        .houseRows()
    }

    private func signInRow(_ s: ActivitySignIn) -> some View {
        let who = s.displayName.isEmpty ? s.email : s.displayName
        // Two lines: who and when; then their address and the device, quiet.
        let quiet = [s.email != who ? s.email : "", s.os, s.browser].filter { !$0.isEmpty }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(who.isEmpty ? "—" : who).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(s.timestamp.isEmpty ? "—" : ShopDate.say(s.timestamp, withTime: true))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if !quiet.isEmpty {
                Text(quiet).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    /// The page's read: newest first, thirty, once (settings-sections.tsx SignInActivity).
    private func loadSignIns() async {
        if House.isDemo { signIns = []; return }
        guard signIns == nil, let db = await Businesses.shared.firestore else { return }
        do {
            let snap = try await db.collection("signInLogs").order(by: "timestamp", descending: true).limit(to: 30).getDocuments()
            signIns = snap.documents.compactMap { (d: QueryDocumentSnapshot) -> ActivitySignIn? in
                DocJSON.decode(ActivitySignIn.self, id: d.documentID, data: d.data(), custom: FirestoreSource.plainSDK)
            }
        } catch {
            signInsFailed = true
        }
    }

    // MARK: Emergency lock

    @ViewBuilder
    private var lockSection: some View {
        if book.settings.value?.databaseLocked == true {
            Section {
                Label("Database Secured", systemImage: "checkmark.shield")
                    .font(.headline)
                    .foregroundStyle(Tone.settled.color)
                Text("The connection to the database is currently locked. No data can be read or written. To restore access, you must request a reset from the developer.")
                    .font(.subheadline)
                    .foregroundStyle(Tone.settled.color)
            }
            .houseRows()
        } else {
            Section {
                Label("WARNING: IRREVERSIBLE ACTION", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tone.problem.color)
                Text("Activating this lock will make the app unusable until a developer manually restores access. This is a final security measure for emergencies.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(role: .destructive) { askLock = true } label: {
                    Label(locking ? "Locking…" : "Lock Database Now", systemImage: "exclamationmark.shield")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(locking || House.isDemo)
            } header: {
                LedgerHeading(title: "Emergency Lock")
            } footer: {
                Text("This will immediately sever the application's connection to the database.")
            }
            .houseRows()
        }
    }

    /// One way: nothing in the app or the ERP unlocks it (lib/writes/database-lock.ts).
    private func lock() async {
        guard !locking else { return }
        locking = true
        do {
            try await ERPAPI.shared.write("lockDatabase", ["confirm": true])
            Note.show(Note(title: "Database Locked", detail: "Access has been severed. Reload the app to apply changes.", failed: true), in: $note, reduce: reduceMotion)
            // Left on: the lock is one way, and the page's button stays off once it has gone.
            return
        } catch {
            failure = error.localizedDescription
        }
        locking = false
    }

    // MARK: Revert

    /// The page's "Revert this action?": what it was and when, and what undoing it does, then the delete code. The ERP
    /// carries out the same delete as the record's own page and checks the code with it.
    private func askRevert(_ e: ActivityLogEntry) {
        let op: String
        let key: String
        switch e.eventType {
        case "invoice.create": op = "deleteInvoice"; key = "invoiceId"
        case "order.create": op = "deleteOrder"; key = "orderId"
        case "expense.create": op = "deleteExpense"; key = "expenseId"
        default: return
        }
        guard !e.entityId.isEmpty else {
            failure = "This entry does not say which record it was, so it cannot be reverted."
            return
        }
        let when = ShopDate.say(e.timestamp, withTime: true)
        let detail = [when.isEmpty ? "" : when + ".", ActivityLogRules.consequence(e.eventType) ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        let id = e.entityId
        reverting = OwnerDeletion(what: e.description.isEmpty ? "Revert this action" : e.description, detail: detail) { code in
            if House.isDemo { return }
            _ = try await ERPAPI.shared.write(op, [key: id, "deleteCode": code])
        }
    }

    /// Two lines (rule 15): what was done and when; then its details, quiet, on one line. No icon or colour per kind: the
    /// filter carries the kind, and a line is no alarm.
    private func row(_ e: ActivityLogEntry) -> some View {
        let revertable = ActivityLogRules.isRevertable(e.eventType)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(e.description).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(ShopDate.say(e.timestamp, withTime: true))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if !e.details.isEmpty {
                Text(e.details).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if revertable {
                Button { askRevert(e) } label: { Label("Revert", systemImage: "arrow.uturn.backward") }
                    .tint(Tone.owed.color)
            }
        }
        .contextMenu {
            if revertable {
                Button(role: .destructive) { askRevert(e) } label: { Label("Revert this action", systemImage: "arrow.uturn.backward") }
            }
        }
    }
}

/// One line of Firestore `signInLogs` (google-auth-gate.tsx writes it at each sign-in): who, on what, when.
struct ActivitySignIn: Decodable, Identifiable {
    let id: String
    let email: String
    let displayName: String
    let os: String
    let browser: String
    /// ISO (a Firestore Timestamp, turned into text as every date the app reads).
    let timestamp: String

    private enum K: String, CodingKey {
        case id, email, displayName, os, browser, timestamp
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        email = c.string(.email, default: "")
        displayName = c.string(.displayName, default: "")
        os = c.string(.os, default: "")
        browser = c.string(.browser, default: "")
        timestamp = c.string(.timestamp, default: "")
    }
}
