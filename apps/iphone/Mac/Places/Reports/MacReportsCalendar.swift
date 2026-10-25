#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Calendar, the chosen day's column: what was sold and ordered that day, and what was promised for it, as one
// plain list with section headers, selectable rows. Return or a double-click opens the invoice or order in a window of its
// own; the right-click menu has Open, Open in New Window and Copy Number. The month's grid and figures are CalendarScreen's.

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
        List(selection: $picked) {
            Section {
                if events.isEmpty {
                    Text("No events for this day.").foregroundStyle(.secondary)
                } else {
                    ForEach(events) { (e: ShopCalendarEvent) in
                        eventRow(e).tag(e.id)
                    }
                }
            } header: {
                Text("Events for \(ShopCalendar.longDay(day))")
            }
            if !promised.isEmpty {
                Section {
                    ForEach(promised) { (o: Order) in
                        promisedRow(o).tag(Self.promisedID(o))
                    }
                } header: {
                    Text("Promised for this day")
                }
            }
        }
        .listStyle(.inset)
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

    private func eventRow(_ e: ShopCalendarEvent) -> some View {
        HStack(spacing: 8) {
            Image(systemName: e.isInvoice ? "receipt" : "list.clipboard")
                .foregroundStyle(e.isInvoice ? Tone.settled.color : Tone.working.color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(e.docId).font(.body.monospaced()).lineLimit(1)
                Text(e.customerName.isEmpty ? "Walk-in" : e.customerName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.pkr(e.grandTotal)).monospacedDigit()
                Text(ShopCalendar.clock(iso: e.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func promisedRow(_ o: Order) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "calendar.badge.clock")
                .foregroundStyle(Tone.owed.color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(o.id).font(.body.monospaced()).lineLimit(1)
                Text((o.customerName ?? "").isEmpty ? "Walk-in" : (o.customerName ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            // Completed is the expected end: no word for it.
            if o.status != .completed {
                MacStatus(o.status.rawValue.isEmpty ? "No status" : o.status.rawValue, tone: Tone(status: o.status))
            }
        }
        .padding(.vertical, 2)
    }
}
#endif
