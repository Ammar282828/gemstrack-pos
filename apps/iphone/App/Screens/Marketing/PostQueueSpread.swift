import SwiftUI
import ERPCore

/// Spread over the day (queue-panel.tsx's dialog): the waiting pieces go out evenly between a first and a last time,
/// in the queue's order, each to wherever it was set to go. The times are `spreadTimes` (queue-plan.ts, ported to
/// ERPCore); each piece is given its time through the queue's own route, and the server's tick sends them, so nobody
/// needs to keep the app open.
struct PostQueueSpreadSheet: View {
    let onDone: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var first = PostQueueSpreadSheet.soon(10)
    @State private var last = PostQueueSpreadSheet.soon(10)
    @State private var busy: String?
    @State private var failure: String?
    @State private var scheduled = 0

    private var store: PostsStore { PostsStore.shared }

    init(onDone: @escaping (Note) -> Void) {
        self.onDone = onDone
        let start = Self.soon(10)
        let end = defaultSpreadEnd(Date())
        _first = State(initialValue: start)
        _last = State(initialValue: end > start ? end : start)
    }

    var body: some View {
        NavigationStack {
            Form {
                let waiting = store.waiting
                Section {
                    DatePicker("First", selection: $first, displayedComponents: .hourAndMinute)
                    DatePicker("Last", selection: $last, displayedComponents: .hourAndMinute)
                } footer: {
                    Text("The \(waiting.count) \(PostTrayModel.noun(waiting.count)) go out evenly between these times, each to wherever it was set to go. They go by themselves: nobody needs to keep the app open.")
                }
                if !waiting.isEmpty {
                    Section {
                        let times = planned(waiting.count)
                        ForEach(waiting.indices, id: \.self) { (i: Int) in
                            LabeledContent(waiting[i].headline.isEmpty ? "Untitled" : waiting[i].headline) {
                                Text(i < times.count ? ShopDate.say(times[i].ISO8601Format(), withTime: true) : "").monospacedDigit()
                            }
                        }
                    } header: {
                        LedgerHeading(title: "When each goes")
                    }
                }
                let failing = store.failingChecks
                if !failing.isEmpty {
                    Section {
                        ForEach(failing) { (c: PostCheck) in
                            Text("\(c.label): \(c.fix ?? c.detail)").font(.footnote)
                        }
                    } header: {
                        LedgerHeading(title: "Something they need is failing now", tone: .problem)
                    }
                }
            }
            .houseForm()
            .environment(\.timeZone, ERPDate.karachi)
            .navigationTitle("Spread over the day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Schedule them") { Task { await schedule() } }.disabled(store.waiting.isEmpty || busy != nil)
                }
            }
            .websiteBusy(busy)
            .failureAlert($failure)
            .savedFeedback(trigger: scheduled)
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy != nil)
    }

    /// The window as the counter set it: the first today at that time, or tomorrow if it has passed; the last on the
    /// first one's day (a "last" before the "first" just sends them all at the first).
    private func planned(_ n: Int) -> [Date] {
        let from = Self.atTime(first)
        let to = Self.onDay(of: from, time: last)
        return spreadTimes(n, from: from, to: to)
    }

    private func schedule() async {
        let waiting = store.waiting
        let times = planned(waiting.count)
        busy = "Giving each its time…"
        defer { busy = nil }
        do {
            try await store.spread(waiting.map(\.id), at: times)
            let span = times.count > 1 ? "from \(MarketingTime.clock(times[0].ISO8601Format())) to \(MarketingTime.clock(times[times.count - 1].ISO8601Format()))"
                : "at \(MarketingTime.clock(times.first?.ISO8601Format()))"
            onDone(Note(title: "\(waiting.count) \(PostTrayModel.noun(waiting.count)) spread \(span)", detail: "They go by themselves: the app can be closed."))
            scheduled += 1
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }

    // MARK: Times (queue-panel.tsx `soon`, `atTime`), on Karachi's clock

    private static var karachi: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }

    /// The next five-minute mark at least `min` minutes away.
    static func soon(_ min: Int, now: Date = Date()) -> Date {
        let d = now.addingTimeInterval(Double(min) * 60)
        let c = karachi
        let parts = c.dateComponents([.minute, .second, .nanosecond], from: d)
        let minute = parts.minute ?? 0
        let up = (Int((Double(minute) / 5).rounded(.up)) * 5) - minute
        let floored = d.addingTimeInterval(-Double(parts.second ?? 0) - Double(parts.nanosecond ?? 0) / 1e9)
        return floored.addingTimeInterval(Double(up) * 60)
    }

    /// The picked hour and minute today, or tomorrow if that has passed (more than a minute ago).
    static func atTime(_ picked: Date, now: Date = Date()) -> Date {
        let d = onDay(of: now, time: picked)
        return d.timeIntervalSince(now) < -60 ? karachi.date(byAdding: .day, value: 1, to: d) ?? d : d
    }

    /// `time`'s hour and minute on `day`'s date.
    static func onDay(of day: Date, time: Date) -> Date {
        let c = karachi
        let t = c.dateComponents([.hour, .minute], from: time)
        return c.date(bySettingHour: t.hour ?? 0, minute: t.minute ?? 0, second: 0, of: day) ?? day
    }
}
