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
    /// The filters are folded away until asked for, so the log is what the page opens on.
    @State private var filtersOpen = false
    #if os(macOS)
    @State private var macPane = ActivityPane.log
    @State private var macSort = [KeyPathComparator(\ActivityLogEntry.timestamp, order: .reverse)]
    @State private var macSelection = Set<String>()
    @State private var macDatesOpen = false
    /// The lines in the table's order and page, made once per change of the log, a filter, the sort or the page.
    @State private var macRowsMemo = Memo<[ActivityLogEntry]>()
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    private static let pageSize = 200

    var body: some View {
        Group {
            if session.isOwner {
                ShelfState(
                    loaded: House.isDemo || shelf.loaded,
                    error: House.isDemo ? nil : shelf.error,
                    offline: !House.isDemo && shelf.offline
                ) {
                    #if os(macOS)
                    macPage
                    #else
                    page
                    #endif
                }
            } else {
                WorkNotYours(title: "Activity", detail: "The activity log is kept for the shop's owners.")
            }
        }
        .navigationTitle("Activity")
        .hubTitleDisplay()
        .sheet(item: $reverting) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                reverted += 1
                Note.show(Note(title: "Reverted", detail: "\u{201C}\(d.what)\u{201D} has been undone."), in: $note, reduce: reduceMotion)
            }
        }
        .confirmDestructive(isPresented: $askLock, title: "Lock the database?",
                            message: "This locks the app out of its database. It cannot be undone from the app.",
                            action: "Lock database") { Task { await lock() } }
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
            // The log first: it is what the page is for. The filters fold away above the sign-ins.
            Section {
                if list.isEmpty {
                    Text("No activity found for these filters.").foregroundStyle(.secondary)
                } else {
                    ForEach(list.prefix(shown)) { (e: ActivityLogEntry) in row(e) }
                    if list.count > shown {
                        Button("Show \(min(ActivityLogScreen.pageSize, list.count - shown)) more") {
                            Motion.run(reduce: reduceMotion) { shown += ActivityLogScreen.pageSize }
                        }
                    }
                }
            } header: {
                LedgerHeading(title: "Log", count: list.count)
            } footer: {
                Text("Everything done in the ERP, newest first.")
            }
            .houseRows()

            Section {
                DisclosureGroup(isExpanded: $filtersOpen) {
                    Picker("Event type", selection: $type) {
                        Text("All").tag("All")
                        ForEach(ActivityLogRules.eventTypes, id: \.self) { (t: String) in
                            Text(ActivityLogRules.title(t)).tag(t)
                        }
                    }
                    WorkRangeFields(range: $range)
                    if range.useFrom && !range.useTo {
                        Text("Without an end date the range runs to the end of today.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } label: {
                    Text("Filters").font(.headline)
                }
            }
            .houseRows()

            signInSection
            lockSection
        }
        .listStyle(.insetGrouped)
        .motion(type)
        .selectionFeedback(trigger: type)
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
                Button("Try again") {
                    signInsFailed = false
                    Task { await loadSignIns() }
                }
                .buttonStyle(.borderless)
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
            HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
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
                Label("Database secured", systemImage: "checkmark.shield")
                    .font(.headline)
                Text("The connection to the database is currently locked. No data can be read or written. To restore access, you must request a reset from the developer.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .houseRows()
        } else {
            // Alone, and last: it cannot be undone from the app.
            Section {
                Label("Irreversible", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tone.problem.color)
                Text("Activating this lock will make the app unusable until a developer manually restores access. This is a final security measure for emergencies.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(role: .destructive) { askLock = true } label: {
                    Label(locking ? "Locking…" : "Lock database now", systemImage: "exclamationmark.shield")
                        .frame(maxWidth: .infinity, minHeight: Metrics.tap)
                }
                .buttonStyle(.bordered)
                .disabled(locking || House.isDemo)
            } header: {
                LedgerHeading(title: "Emergency lock")
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
            Note.show(Note(title: "Database locked", detail: "Access has been severed. Reload the app to apply changes.", failed: true), in: $note, reduce: reduceMotion)
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

    private func row(_ e: ActivityLogEntry) -> some View {
        let tint = tone(ActivityLogRules.tone(e.eventType)).color
        let revertable = ActivityLogRules.isRevertable(e.eventType)
        return HStack(alignment: .top, spacing: pt(12)) {
            Image(systemName: symbol(e.eventType))
                .foregroundStyle(tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.description).font(.subheadline.weight(.semibold))
                if !e.details.isEmpty {
                    Text(e.details).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(ShopDate.say(e.timestamp, withTime: true))
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if revertable {
                Button(role: .destructive) { askRevert(e) } label: { Label("Revert", systemImage: "arrow.uturn.backward") }
            }
        }
        .contextMenu {
            if revertable {
                Button(role: .destructive) { askRevert(e) } label: { Label("Revert this action", systemImage: "arrow.uturn.backward") }
            }
        }
    }

    private func tone(_ kind: ActivityLogRules.Tone) -> Tone {
        switch kind {
        case .created: return .settled
        case .updated: return .working
        case .deleted: return .owed
        case .other: return .quiet
        }
    }

    /// The icon of the thing it was done to (the page's own, as SF Symbols).
    private func symbol(_ eventType: String) -> String {
        if eventType.hasSuffix(".refund") { return "arrow.uturn.backward" }
        switch eventType.split(separator: ".").first.map(String.init) ?? "" {
        case "product": return "diamond"
        case "customer": return "person"
        case "karigar", "job": return "hammer"
        case "invoice": return "receipt"
        case "order": return "list.clipboard"
        case "expense": return "banknote"
        case "revenue": return "chart.line.uptrend.xyaxis"
        case "given": return "shippingbox.and.arrow.backward"
        case "repair": return "wrench.and.screwdriver"
        case "rates": return "dollarsign.circle"
        default: return "clock.arrow.circlepath"
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

#if os(macOS)
/// The Mac's three panes of the activity log: the log, the sign-ins and the emergency lock, chosen in the toolbar.
private enum ActivityPane: String, CaseIterable, Identifiable {
    case log = "Log", signIns = "Sign-ins", lock = "Emergency lock"
    var id: String { rawValue }
}

// The Mac's activity log: a Table of the log (sort by any column), the filters in the toolbar, Revert in the toolbar and
// the right-click menu (the same askRevert, the same delete code), the sign-ins as a table and the lock in its own pane.
extension ActivityLogScreen {
    @ViewBuilder
    var macPage: some View {
        let list = visible()
        Group {
            switch macPane {
            case .log: macLog(list)
            case .signIns: macSignIns
            case .lock:
                Form { lockSection }
                    .formStyle(.grouped)
                    .frame(maxWidth: 620)
                    .frame(maxWidth: .infinity)
            }
        }
        .navigationSubtitle(macPane == .log ? "\(list.count) lines" : "")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $macPane) {
                    ForEach(ActivityPane.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .help("The log, the last sign-ins, or the emergency lock")
            }
            if macPane == .log {
                // Revert (the picked line's) and the one filter; the right-click menu has Revert too.
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        if let e = macRevertable(list) { askRevert(e) }
                    } label: {
                        Label("Revert", systemImage: "arrow.uturn.backward")
                    }
                    .disabled(macRevertable(list) == nil)
                    .help("Undo the picked invoice, order or expense that was added")
                    macFilterMenu
                }
            }
        }
    }

    /// The kind of event and the range of days in one Filter menu; the days open in a popover from the menu.
    private var macFilterMenu: some View {
        let on = type != "All" || range.useFrom
        return Menu {
            Picker("Event type", selection: $type) {
                Text("All Events").tag("All")
                ForEach(ActivityLogRules.eventTypes, id: \.self) { (t: String) in
                    Text(ActivityLogRules.title(t)).tag(t)
                }
            }
            .pickerStyle(.inline)
            Divider()
            Button { macDatesOpen = true } label: {
                Label("Days\u{2026}", systemImage: range.useFrom ? "calendar.badge.checkmark" : "calendar")
            }
        } label: {
            Label("Filter", systemImage: on ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("Show one kind of event, or a range of days")
        .popover(isPresented: $macDatesOpen) {
            Form {
                WorkRangeFields(range: $range)
                if range.useFrom && !range.useTo {
                    Text("Without an end date the range runs to the end of today.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .frame(width: 320)
            .padding(.vertical, 6)
        }
    }

    /// The picked line, when exactly one is picked and it can be undone.
    private func macRevertable(_ list: [ActivityLogEntry]) -> ActivityLogEntry? {
        guard macSelection.count == 1, let id = macSelection.first,
              let e = list.first(where: { $0.id == id }), ActivityLogRules.isRevertable(e.eventType) else { return nil }
        return e
    }

    /// The record a line is about, where the app has a page for it (not for a record that was removed).
    private func macPath(_ e: ActivityLogEntry) -> String? {
        guard !e.entityId.isEmpty, !e.eventType.hasSuffix(".delete") else { return nil }
        switch e.eventType.split(separator: ".").first.map(String.init) ?? "" {
        case "invoice": return WorkPaths.invoice(e.entityId)
        case "order": return WorkPaths.order(e.entityId)
        default: return nil
        }
    }

    private func macLog(_ list: [ActivityLogEntry]) -> some View {
        // Sorted and cut to the page once, not on every click of a line.
        let key: [Int] = [
            House.isDemo ? demoEntries.count : shelf.revision,
            ActivityLogRules.eventTypes.firstIndex(of: type) ?? -1,
            (range.fromDay ?? "").hashValue,
            (range.toDay ?? "").hashValue,
            ERPDate.karachiDay(Date()).hashValue,
            macSort.hashValue,
            shown,
        ]
        let rows: [ActivityLogEntry] = macRowsMemo(key) { Array(list.sorted(using: macSort).prefix(shown)) }
        return VStack(spacing: 0) {
            Table(rows, selection: $macSelection, sortOrder: $macSort) {
                TableColumn("Event", value: \.description) { (e: ActivityLogEntry) in
                    HStack(spacing: 8) {
                        Image(systemName: symbol(e.eventType))
                            .foregroundStyle(tone(ActivityLogRules.tone(e.eventType)).color)
                            .frame(width: 20)
                        Text(e.description).lineLimit(1)
                    }
                }
                .width(min: 140, ideal: 320)
                TableColumn("Details", value: \.details) { (e: ActivityLogEntry) in
                    Text(e.details).foregroundStyle(.secondary).lineLimit(1)
                }
                .width(min: 100, ideal: 240)
                TableColumn("Kind", value: \.eventType) { (e: ActivityLogEntry) in
                    Text(ActivityLogRules.title(e.eventType)).foregroundStyle(.secondary).lineLimit(1)
                }
                .width(min: 80, ideal: 120)
                TableColumn("When", value: \.timestamp) { (e: ActivityLogEntry) in
                    Text(ShopDate.say(e.timestamp, withTime: true)).monospacedDigit().lineLimit(1)
                }
                .width(min: 110, ideal: 150)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if ids.count == 1, let id = ids.first, let e = list.first(where: { $0.id == id }) {
                    if let path = macPath(e) {
                        Button("Open in New Window") { openPlace?(Route(path: path)) }
                    }
                    Button("Copy line") {
                        UIPasteboard.general.string = [e.description, e.details].filter { !$0.isEmpty }.joined(separator: " · ")
                    }
                    if ActivityLogRules.isRevertable(e.eventType) {
                        Divider()
                        Button(role: .destructive) { askRevert(e) } label: { Label("Revert this action", systemImage: "arrow.uturn.backward") }
                    }
                }
            } primaryAction: { ids in
                if ids.count == 1, let id = ids.first, let e = list.first(where: { $0.id == id }), let path = macPath(e) {
                    openPlace?(Route(path: path))
                }
            }
            .overlay {
                if list.isEmpty {
                    ContentUnavailableView("No Activity Found", systemImage: "clock.arrow.circlepath",
                                           description: Text(type != "All" || range.useFrom
                                                             ? "Nothing matches these filters. Choose Filter to change them."
                                                             : "What is done in the ERP is listed here as it happens."))
                }
            }
            if list.count > shown {
                Divider()
                HStack {
                    Text("Showing \(shown) of \(list.count)").font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Button("Show \(min(ActivityLogScreen.pageSize, list.count - shown)) more") {
                        shown += ActivityLogScreen.pageSize
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
        }
    }

    @ViewBuilder
    private var macSignIns: some View {
        if let signIns {
            Table(signIns) {
                TableColumn("Who") { (s: ActivitySignIn) in
                    Text(s.displayName.isEmpty ? (s.email.isEmpty ? "\u{2014}" : s.email) : s.displayName).lineLimit(1)
                }
                .width(min: 100, ideal: 160)
                TableColumn("Email") { (s: ActivitySignIn) in Text(s.email).foregroundStyle(.secondary).lineLimit(1) }
                    .width(min: 120, ideal: 200)
                TableColumn("Device") { (s: ActivitySignIn) in
                    Text([s.os, s.browser].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")).foregroundStyle(.secondary).lineLimit(1)
                }
                .width(min: 100, ideal: 150)
                TableColumn("When") { (s: ActivitySignIn) in
                    Text(s.timestamp.isEmpty ? "\u{2014}" : ShopDate.say(s.timestamp, withTime: true)).monospacedDigit().lineLimit(1)
                }
                .width(min: 110, ideal: 150)
            }
            .overlay {
                if signIns.isEmpty {
                    ContentUnavailableView("No sign-in activity recorded yet", systemImage: "person.badge.key")
                }
            }
        } else if signInsFailed {
            ContentUnavailableView {
                Label("The sign-ins could not be read", systemImage: "exclamationmark.icloud")
            } actions: {
                Button("Try again") {
                    signInsFailed = false
                    Task { await loadSignIns() }
                }
            }
        } else {
            ProgressView("Loading\u{2026}").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
#endif
