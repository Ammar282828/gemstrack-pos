#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Calendar, the chosen day's column: what was sold and ordered that day, and what was promised for it, as one
// plain list with section headers, selectable rows. Return or a double-click opens the invoice or order in a window of its
// own; the right-click menu has Open, Open in New Window and Copy Number. The month's grid and figures are CalendarScreen's.
// It sits in the inspector (260 to 420 points wide), so nothing in it is wider than 240.

struct MacReportsCalendarDay: View {
    /// The day chosen, "yyyy-MM-dd".
    let day: String
    let events: [ShopCalendarEvent]
    /// Orders promised for the day (the promise layer, apart from the money).
    let promised: [Order]

    @Environment(\.openPlaceWindow) private var openPlace
    @State private var picked = Set<String>()

    private static func promisedID(_ o: Order) -> String { "p:" + o.id }

    /// Row id → the place it opens.
    private var places: [String: String] {
        var out: [String: String] = [:]
        for e in events { out[e.id] = e.isInvoice ? DashPath.invoice(e.docId) : DashPath.order(e.docId) }
        for o in promised { out[Self.promisedID(o)] = DashPath.order(o.id) }
        return out
    }

    /// Row id → the number Copy Number puts on the clipboard.
    private var numbers: [String: String] {
        var out: [String: String] = [:]
        for e in events { out[e.id] = e.docId }
        for o in promised { out[Self.promisedID(o)] = o.id }
        return out
    }

    var body: some View {
        let placeOf = places
        let numberOf = numbers
        VStack(spacing: 0) {
            header
            List(selection: $picked) {
                Section {
                    if events.isEmpty {
                        Text("No events for this day.").foregroundStyle(.secondary)
                    } else {
                        ForEach(events) { (e: ShopCalendarEvent) in
                            eventRow(e).tag(e.id)
                        }
                    }
                }
                .houseRows()
                if !promised.isEmpty {
                    Section {
                        ForEach(promised) { (o: Order) in
                            promisedRow(o).tag(Self.promisedID(o))
                        }
                    } header: {
                        LedgerHeading(title: "Promised", count: promised.count)
                    }
                    .houseRows()
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                if let id = ids.sorted().first, let place = placeOf[id] {
                    NavigationLink(value: Route(path: place)) { Text("Open") }
                    if let openPlace {
                        Button("Open in New Window") { openPlace(Route(path: place)) }
                    }
                    Button("Copy Number") { UIPasteboard.general.string = numberOf[id] }
                }
            } primaryAction: { (ids: Set<String>) in
                for id in ids.sorted().prefix(5) {
                    if let place = placeOf[id] { openPlace?(Route(path: place)) }
                }
            }
        }
    }

    /// What the inspector is about, as every inspector's head says it: a headline over the day it is for.
    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Events").font(.title3.weight(.semibold))
            Text(ShopCalendar.longDay(day)).font(.callout).foregroundStyle(.secondary).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    // The rows are made for the inspector's 260 points: two lines, the number and what it came to over who and when, no
    // column on the right, and the amount as digits.
    private func eventRow(_ e: ShopCalendarEvent) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Image(systemName: e.isInvoice ? "receipt" : "list.clipboard")
                    .foregroundStyle(e.isInvoice ? Tone.settled.color : Tone.working.color)
                    .frame(width: 16)
                Text(e.docId).font(.body.monospaced()).lineLimit(1)
                MacAmount(e.grandTotal)
            }
            HStack(spacing: 6) {
                Text(e.customerName.isEmpty ? "Walk-in" : e.customerName)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(ShopCalendar.clock(iso: e.createdAt)).lineLimit(1)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.leading, 22)
        }
        .padding(.vertical, 2)
    }

    private func promisedRow(_ o: Order) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Image(systemName: "calendar.badge.clock")
                    .foregroundStyle(Tone.owed.color)
                    .frame(width: 16)
                Text(o.id).font(.body.monospaced()).lineLimit(1)
                Spacer(minLength: 4)
                // Completed is the expected end: no word for it.
                if o.status != .completed {
                    MacStatus(o.status.rawValue.isEmpty ? "No status" : o.status.rawValue, tone: Tone(status: o.status))
                        .font(.caption)
                }
            }
            Text((o.customerName ?? "").isEmpty ? "Walk-in" : (o.customerName ?? ""))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.leading, 22)
        }
        .padding(.vertical, 2)
    }
}
#endif
