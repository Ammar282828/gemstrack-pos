import SwiftUI
import ERPCore

/// Settings → Activity (src/app/activity-log/page.tsx): everything done in the ERP, newest first (Firestore `activity_log`),
/// narrowed by the kind of event and a range of days. Owners only, as Settings is: the log is the shop's books.
///
/// Owners read the collection live, as the web does. The filters are the page's: Event Type (a kind, matched on the start
/// of the event's type) and a date range; here the last day of the range counts in full (ActivityLogRules.filter says why).
/// What stays the ERP's page: Revert (it deletes the invoice, order or expense, so it asks for the delete code), the
/// sign-in list and the emergency lock, which the page carries below the log.
struct ActivityLogScreen: View {
    @Environment(Session.self) private var session

    /// Firestore `activity_log`: a long log, so it is read only while this screen is open.
    @State private var shelf = Shelf<ActivityLogEntry>("activity_log") { $0.timestamp > $1.timestamp }
    @State private var demoEntries: [ActivityLogEntry] = House.isDemo ? WorkDemo.activity() : []
    /// "All" or one of `ActivityLogRules.eventTypes`.
    @State private var type = "All"
    @State private var range = WorkRange()
    /// How many lines are listed: a log runs to thousands, so it is shown a page at a time.
    @State private var shown = ActivityLogScreen.pageSize
    @State private var openWeb = false
    @State private var narrowed = Memo<[ActivityLogEntry]>()

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
        .navigationDestination(isPresented: $openWeb) {
            PlaceScreen(path: "/activity-log?web=1")
        }
        .onAppear {
            if session.isOwner && !House.isDemo { shelf.need() }
        }
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
                Text("Filters")
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
                Text("Everything done in the ERP, newest first · \(list.count) \(list.count == 1 ? "entry" : "entries")")
                    .textCase(nil)
            }
            .houseRows()

            Section {
                NavigationLink(value: Route(path: "/activity-log?web=1")) {
                    Label("Sign-ins and the emergency lock", systemImage: "lock.shield")
                }
            } footer: {
                Text("Reverting an invoice, an order or an expense asks for the delete code, so it stays on the ERP's page (swipe the line). The last 30 sign-ins and the emergency lock are there too.")
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func row(_ e: ActivityLogEntry) -> some View {
        let tint = color(ActivityLogRules.tone(e.eventType))
        let revertable = ActivityLogRules.isRevertable(e.eventType)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol(e.eventType))
                .foregroundStyle(tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.description).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
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
                Button { openWeb = true } label: { Label("Revert", systemImage: "arrow.uturn.backward") }
                    .tint(.red)
            }
        }
        .contextMenu {
            if revertable {
                Button { openWeb = true } label: { Label("Revert on the ERP's page", systemImage: "arrow.uturn.backward") }
            }
        }
    }

    private func color(_ tone: ActivityLogRules.Tone) -> Color {
        switch tone {
        case .created: return .green
        case .updated: return .blue
        case .deleted: return .red
        case .other: return .secondary
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
