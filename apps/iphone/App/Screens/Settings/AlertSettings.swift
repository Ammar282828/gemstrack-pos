import SwiftUI
import ERPCore

/// Settings → Alerts (NotificationsCard, settings-sections.tsx): who gets the shop's WhatsApp alerts
/// and which reports go out when, whether WhatsApp can send, a test, and "Send now" (AlertConnection.swift).
/// The phone's own push notifications are "This phone".
struct AlertSettings: View {
    var body: some View {
        SettingsGate(title: "Alerts") { AlertsForm(settings: $0) }
    }
}

private struct AlertsForm: View {
    let settings: Settings
    @State private var writer = SettingsWriter()
    /// The numbers as the person has left them; the book catches up a moment later.
    @State private var phones: [String]
    @State private var newNumber = ""
    @State private var times: Times
    @State private var timeSave: Task<Void, Never>?
    @State private var note: Note?
    @State private var failure: String?

    private struct Times: Equatable {
        var checklist: Date
        var endOfDay: Date
        var report: Date

        init(_ s: Settings) {
            checklist = AlertsForm.date(s.notifDailyChecklistTime ?? "09:00")
            endOfDay = AlertsForm.date(s.notifEndOfDayTime ?? "19:00")
            report = AlertsForm.date(s.notifDailyReportTime ?? "21:00")
        }
    }

    /// Switches that act as things happen.
    private static let live: [(key: String, title: String, detail: String, value: KeyPath<Settings, Bool>)] = [
        ("notifNewOrder", "New order", "A new order is created", \Settings.notifNewOrder),
        ("notifOrderCompleted", "Order completed", "An order is marked completed", \Settings.notifOrderCompleted),
        ("notifOrderCancelled", "Order cancelled", "An order is cancelled or refunded", \Settings.notifOrderCancelled),
        ("notifNewInvoice", "New sale or invoice", "An invoice is created", \Settings.notifNewInvoice),
        ("notifPaymentReceived", "Payment received", "A payment is recorded on an invoice", \Settings.notifPaymentReceived),
    ]

    private static let reports: [(key: String, title: String, detail: String, value: KeyPath<Settings, Bool>)] = [
        ("notifDailyReport", "Daily report", "Nightly: sales, cash collected, orders, outstanding", \Settings.notifDailyReport),
        ("notifDailyChecklist", "Daily checklist", "Morning: active orders, overdue, unreturned items", \Settings.notifDailyChecklist),
        ("notifEndOfDay", "End of day", "Evening: today’s sales, orders and expenses", \Settings.notifEndOfDay),
        ("notifWeeklyReport", "Weekly report", "Mondays: the last seven days", \Settings.notifWeeklyReport),
        ("notifMonthlyReport", "Monthly report", "The 1st: the month before, as a PDF", \Settings.notifMonthlyReport),
        ("notifAdsDaily", "Ads summary", "Yesterday’s Meta ads and what needs attention", \Settings.notifAdsDaily),
    ]

    private static let checks: [(key: String, title: String, detail: String, value: KeyPath<Settings, Bool>)] = [
        ("notifOrderOverdue", "Overdue orders", "Orders past the date promised", \Settings.notifOrderOverdue),
        ("notifGivenItems", "Given items overdue", "Items out and not returned for 7 days", \Settings.notifGivenItems),
        ("notifKarigarPayment", "Karigar balances", "Cash to pay and gold with each karigar", \Settings.notifKarigarPayment),
    ]

    init(settings: Settings) {
        self.settings = settings
        _phones = State(initialValue: settings.notifPhones)
        _times = State(initialValue: Times(settings))
    }

    var body: some View {
        let enabled = writer.isOn("notifEnabled", settings.notifEnabled)
        Form { Group {
            Section {
                SettingToggle(title: "Alerts on", key: "notifEnabled", stored: settings.notifEnabled, writer: writer)
            } footer: {
                Text(enabled ? "Every alert and report arrives on WhatsApp as a PDF." : "Turn on to choose who gets what.")
            }

            if enabled {
                recipients
                switches("As it happens", Self.live)
                switches("Reports", Self.reports)
                switches("Checks", Self.checks)
                schedule
            }

            AlertConnectionSections(settings: settings, enabled: enabled, phones: phones, note: $note, failure: $failure)
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .settingsFailure(writer)
        .onChange(of: settings) { _, new in
            phones = new.notifPhones
            if timeSave == nil { times = Times(new) }
            writer.settled()
        }
        .onChange(of: times) { _, _ in scheduleTimeSave() }
        .noteToast($note)
        .failureAlert($failure, title: "Not sent")
    }

    private var recipients: some View {
        Section {
            ForEach(phones, id: \.self) { p in
                Text(p).monospacedDigit()
            }
            .onDelete { offsets in
                var next = phones
                next.remove(atOffsets: offsets)
                savePhones(next)
            }
            LabeledContent("WhatsApp number") {
                TextField("0300 1234567", text: $newNumber)
                    .keyboardType(.phonePad)
                    .submitLabel(.done)
                    .multilineTextAlignment(.trailing)
                    .onSubmit { addNumber() }
            }
            Button("Add number") { addNumber() }
                .disabled(newNumber.trimmingCharacters(in: .whitespaces).isEmpty)
        } header: {
            LedgerHeading(title: "Recipients")
        } footer: {
            Text("A number from Pakistan can start with 0; any other with its country code.")
        }
    }

    private func switches(_ title: String, _ rows: [(key: String, title: String, detail: String, value: KeyPath<Settings, Bool>)]) -> some View {
        Section(title) {
            ForEach(rows, id: \.key) { r in
                SettingToggle(title: r.title, detail: r.detail, key: r.key, stored: settings[keyPath: r.value], writer: writer)
            }
        }
    }

    private var schedule: some View {
        Section {
            DatePicker("Daily checklist", selection: $times.checklist, displayedComponents: .hourAndMinute)
            DatePicker("End of day", selection: $times.endOfDay, displayedComponents: .hourAndMinute)
            DatePicker("Daily report", selection: $times.report, displayedComponents: .hourAndMinute)
        } header: {
            LedgerHeading(title: "Times")
        } footer: {
            Text("Karachi time. The checks, the weekly and the monthly reports go with the checklist.")
        }
        // The footer says Karachi time, so the wheels show it whatever zone the phone is in.
        .environment(\.timeZone, Self.karachi)
    }

    // MARK: Numbers

    private func addNumber() {
        guard let n = Self.international(newNumber) else {
            writer.error = "Add the number with its country code, like 92 300 1234567."
            return
        }
        guard !phones.contains(n) else {
            writer.error = "\(n) is already in the list."
            return
        }
        newNumber = ""
        savePhones(phones + [n])
    }

    private func savePhones(_ next: [String]) {
        phones = next
        writer.queue(["notifPhones": next], label: "Alert numbers")
    }

    /// International format with no plus, as the sender reads it. A leading 0 is Pakistan's.
    static func international(_ typed: String) -> String? {
        let t = typed.trimmingCharacters(in: .whitespaces)
        var d = t.filter { $0.isASCII && $0.isNumber }
        if t.hasPrefix("+") {
            // Already international.
        } else if d.hasPrefix("00") {
            d = String(d.dropFirst(2))
        } else if d.hasPrefix("0") {
            d = "92" + String(d.dropFirst())
        } else if d.count == 10, d.hasPrefix("3") {
            d = "92" + d
        }
        return (8...15).contains(d.count) ? d : nil
    }

    // MARK: Times

    /// The shop's clock: the times are Karachi's wherever the phone is.
    static let karachi = TimeZone(identifier: "Asia/Karachi") ?? .current

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = karachi
        return c
    }

    /// "09:00" as a time on a fixed day: only the clock is used, read in Karachi.
    static func date(_ hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        let h = p.count > 0 ? p[0] : 9
        let m = p.count > 1 ? p[1] : 0
        return calendar.date(from: DateComponents(year: 2001, month: 1, day: 1, hour: h, minute: m)) ?? Date()
    }

    static func hhmm(_ date: Date) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// The wheel moves through many times on the way to the one meant: saved when it rests.
    private func scheduleTimeSave() {
        timeSave?.cancel()
        let picked = times
        let stored = settings
        timeSave = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            var patch: [String: Any] = [:]
            let checklist = Self.hhmm(picked.checklist), endOfDay = Self.hhmm(picked.endOfDay), report = Self.hhmm(picked.report)
            if checklist != (stored.notifDailyChecklistTime ?? "09:00") { patch["notifDailyChecklistTime"] = checklist }
            if endOfDay != (stored.notifEndOfDayTime ?? "19:00") { patch["notifEndOfDayTime"] = endOfDay }
            if report != (stored.notifDailyReportTime ?? "21:00") { patch["notifDailyReportTime"] = report }
            if !patch.isEmpty { writer.queue(patch, label: "Alert times") }
            timeSave = nil
        }
    }
}
