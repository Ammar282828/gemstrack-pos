import SwiftUI
import ERPCore

// Settings → Alerts: whether WhatsApp can actually send, when each report last went, "Send now" and a test
// (NotificationsCard, settings-sections.tsx). The routes are the page's own: /api/notifications/health,
// /api/notifications/run (GET the last runs; POST { task, force } sends one to the shop's saved numbers) and
// /api/notifications/alert { event: 'test', to }, which sends only to a number on the list.

/// GET /api/notifications/health. A gateway that cannot send answers 503, which ERPAPI throws with its words.
struct AlertHealth: Decodable, Equatable {
    var ok = false
    var configured = false
    var state: String?
    var detail: String?

    private enum K: String, CodingKey { case ok, configured, state, detail }

    init(ok: Bool, configured: Bool, state: String? = nil, detail: String? = nil) {
        self.ok = ok
        self.configured = configured
        self.state = state
        self.detail = detail
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ok = c.bool(.ok, default: false)
        configured = c.bool(.configured, default: false)
        state = c.string(.state)
        detail = c.string(.detail)
    }
}

/// One report's last run (lib/notifications/dispatch.ts LastRun).
struct AlertLastRun: Decodable, Equatable {
    var date = ""
    var status = ""
    var at: String?
    var sent = 0
    var recipients = 0
    var failed: [String] = []
    var error: String?
    var tries = 0

    private enum K: String, CodingKey { case date, status, at, sent, recipients, failed, error, tries }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        status = c.string(.status, default: "")
        at = c.string(.at)
        sent = c.int(.sent) ?? 0
        recipients = c.int(.recipients) ?? 0
        failed = c.strings(.failed)
        error = c.string(.error)
        tries = c.int(.tries) ?? 0
    }
}

private struct AlertRuns: Decodable {
    let last: [String: AlertLastRun]

    private enum K: String, CodingKey { case last }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        last = (c.object(.last, of: [String: Lossy<AlertLastRun>].self) ?? [:]).compactMapValues(\.value)
    }
}

/// A scheduled report (lib/notifications/schedule.ts ReportTask), its switch and when it goes.
struct AlertReport: Identifiable, Hashable {
    let id: String
    let title: String
    let toggle: KeyPath<Settings, Bool>

    /// In the order a tick sends them (REPORT_TASKS).
    static let all: [AlertReport] = [
        .init(id: "daily-checklist", title: "Daily checklist", toggle: \Settings.notifDailyChecklist),
        .init(id: "overdue-orders", title: "Overdue orders", toggle: \Settings.notifOrderOverdue),
        .init(id: "given-items", title: "Given items overdue", toggle: \Settings.notifGivenItems),
        .init(id: "end-of-day", title: "End of day", toggle: \Settings.notifEndOfDay),
        .init(id: "daily-report", title: "Daily report", toggle: \Settings.notifDailyReport),
        .init(id: "weekly-report", title: "Weekly report", toggle: \Settings.notifWeeklyReport),
        .init(id: "karigar-payments", title: "Karigar balances", toggle: \Settings.notifKarigarPayment),
        .init(id: "ads-daily", title: "Ads summary", toggle: \Settings.notifAdsDaily),
        .init(id: "monthly-report", title: "Monthly report", toggle: \Settings.notifMonthlyReport),
    ]

    /// schedule.ts reportWhen: "Daily at 9:00 am", "Mondays at 9:00 am", the monthly on the 1st.
    func when(_ s: Settings) -> String {
        let checklist = Self.time(s.notifDailyChecklistTime) ?? "09:00"
        switch id {
        case "end-of-day": return "Daily at \(Self.clock(Self.time(s.notifEndOfDayTime) ?? "19:00"))"
        case "daily-report": return "Daily at \(Self.clock(Self.time(s.notifDailyReportTime) ?? "21:00"))"
        case "weekly-report", "karigar-payments": return "Mondays at \(Self.clock(checklist))"
        case "ads-daily": return "Daily at \(Self.clock("09:30"))"
        case "monthly-report": return "The 1st of each month at \(Self.clock(checklist)), for the month before"
        default: return "Daily at \(Self.clock(checklist))"
        }
    }

    static func time(_ v: String?) -> String? {
        guard let v, v.count == 5, let h = Int(v.prefix(2)), let m = Int(v.suffix(2)), v.dropFirst(2).first == ":",
              (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        return v
    }

    /// investments-schedule.ts clock: "09:00" → "9:00 am".
    static func clock(_ hhmm: String) -> String {
        guard let t = time(hhmm), let h = Int(t.prefix(2)) else { return hhmm }
        return "\(h % 12 == 0 ? 12 : h % 12):\(t.suffix(2)) \(h < 12 ? "am" : "pm")"
    }

    /// The page's lastRunLine: "last sent today 9:02 pm to 4 of 4", "29 Sep: nothing to report", "failed …".
    static func lastLine(_ r: AlertLastRun?) -> (text: String, bad: Bool) {
        guard let r else { return ("not sent in the last week", false) }
        let today = ERPDate.karachiDay(Date())
        let day: String
        if r.date == today {
            day = ("today " + (r.at.flatMap { ERPDate.parse($0) }.map { timeOfDay($0) } ?? "")).trimmingCharacters(in: .whitespaces)
        } else {
            day = shortDay(r.date)
        }
        switch r.status {
        case "sent":
            let missed = r.failed.map { String($0.split(separator: ":").first ?? "") }
            return ("last sent \(day) to \(r.sent) of \(r.recipients)" + (missed.isEmpty ? "" : " (not \(missed.joined(separator: ", ")))"), !r.failed.isEmpty)
        case "quiet": return ("\(day): nothing to report", false)
        case "running": return ("sending (\(day))", false)
        default:
            let why = r.error ?? (r.failed.isEmpty ? "unknown error" : r.failed.joined(separator: "; "))
            return ("failed \(day)\(r.tries < 3 && r.date == today ? ", trying again" : ""): \(why)", true)
        }
    }

    private static func timeOfDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "h:mm a"
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f.string(from: d)
    }

    /// "2026-09-29" → "29 Sep".
    private static func shortDay(_ ymd: String) -> String {
        let p = ymd.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, (1...12).contains(p[1]) else { return ymd }
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(p[2]) \(months[p[1] - 1])"
    }
}

/// The connection, the test and "Send now", as sections of the Alerts form.
struct AlertConnectionSections: View {
    let settings: Settings
    /// "Alerts on" as the form shows it (the switch keeps its new value until the book catches up).
    let enabled: Bool
    /// The numbers as the form holds them (saved, or about to be).
    let phones: [String]
    @Binding var note: Note?
    @Binding var failure: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var health: AlertHealth?
    @State private var checking = false
    @State private var testing: String?
    @State private var runs: [String: AlertLastRun]?
    @State private var sending: String?
    @State private var asking: AlertReport?

    var body: some View {
        // The task and the dialog hang on the one section always there: on a Group they would go to each section.
        connection
        .task { await check(); await loadRuns() }
        .confirmationDialog(asking.map { "Send the \($0.title.lowercased()) now?" } ?? "",
                            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
                            titleVisibility: .visible, presenting: asking) { r in
            Button("Send to \(phones.count) number\(phones.count == 1 ? "" : "s")") { Task { await sendNow(r) } }
            Button("Cancel", role: .cancel) {}
        } message: { r in
            Text("It goes on WhatsApp, as a PDF, to every number on the list: \(phones.joined(separator: ", ")). It is sent even if it already went today\(settings[keyPath: r.toggle] ? "" : ", and even though this report is switched off").")
        }
        if enabled { reports }
    }

    // MARK: Connection

    private var connection: some View {
        Section {
            HStack(spacing: pt(10)) {
                Circle()
                    .fill(checking || health == nil ? Color.secondary : (health?.ok == true ? Tone.settled.color : Tone.problem.color))
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(statusLine).font(.body.weight(.medium))
                    if let detail = health?.detail, !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Button { Task { await check() } } label: {
                Label(checking ? "Checking…" : "Check again", systemImage: "arrow.clockwise")
            }
            .disabled(checking)
            if phones.isEmpty {
                Text("Add a number to send a test.").font(.footnote).foregroundStyle(.secondary)
            } else {
                Menu {
                    ForEach(phones, id: \.self) { p in
                        Button(p) { Task { await test(p) } }
                    }
                } label: {
                    Label(testing.map { "Sending a test to \($0)…" } ?? "Send a test to a number", systemImage: "paperplane")
                }
                .disabled(testing != nil || health?.ok != true)
            }
        } header: {
            LedgerHeading(title: "WhatsApp connection")
        } footer: {
            Text("Whether WhatsApp can send right now. A test is a PDF like every alert, to one number on the list.")
        }
    }

    private var statusLine: String {
        if checking || health == nil { return "Checking…" }
        guard let health else { return "Checking…" }
        if health.ok { return "Connected" }
        if !health.configured { return "Not configured" }
        return "Not ready" + (health.state.map { " — \($0)" } ?? "")
    }

    private func check() async {
        checking = true
        defer { checking = false }
        do {
            health = try await ERPAPI.shared.get("/api/notifications/health", as: AlertHealth.self)
        } catch let f as ERPAPI.Failure where f.status == 503 {
            // The gateway answered and cannot send: its words come in `error` (health/route.ts).
            health = AlertHealth(ok: false, configured: f.message != "Not configured", detail: f.message == "Not configured" ? nil : f.message)
        } catch {
            health = AlertHealth(ok: false, configured: false, detail: "Could not reach the ERP: \(error.localizedDescription)")
        }
    }

    private func test(_ phone: String) async {
        testing = phone
        defer { testing = nil }
        do {
            let out = try await ERPAPI.shared.send("/api/notifications/alert", ["event": "test", "to": phone], timeout: 120)
            let status = out["status"] as? String
            if status == "off" || status == "failed" {
                let failed = (out["failed"] as? [String])?.joined(separator: "; ")
                throw ERPAPI.Failure(status: 0, message: (out["error"] as? String) ?? failed ?? "Not sent.")
            }
            Note.show(Note(title: "Test sent", detail: "Check WhatsApp on \(phone)."), in: $note, reduce: reduceMotion)
        } catch {
            failure = "Test failed: \(error.localizedDescription)"
        }
    }

    // MARK: Reports

    private var reports: some View {
        Section {
            ForEach(AlertReport.all) { r in
                let on = settings[keyPath: r.toggle]
                let last = on && runs != nil ? AlertReport.lastLine(runs?[r.id]) : nil
                HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.title)
                        Text(r.when(settings) + (on ? "" : " · off"))
                            .font(.caption).foregroundStyle(.secondary)
                        if let last {
                            Text(last.text)
                                .font(.caption)
                                .foregroundStyle(last.bad ? Tone.problem.color : Color.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Button {
                        asking = r
                    } label: {
                        if sending == r.id { ProgressView() } else { Text("Send now") }
                    }
                    .buttonStyle(.borderless)
                    .disabled(sending != nil || phones.isEmpty)
                }
            }
        } header: {
            LedgerHeading(title: "Send a report now")
        } footer: {
            Text(phones.isEmpty ? "Add a number first." : "Sends the report now, to every number on the list.")
        }
    }

    private func loadRuns() async {
        // The times still show without them.
        if let r = try? await ERPAPI.shared.get("/api/notifications/run", as: AlertRuns.self) { runs = r.last }
    }

    private func sendNow(_ r: AlertReport) async {
        sending = r.id
        defer { sending = nil }
        do {
            let out = try await ERPAPI.shared.send("/api/notifications/run", ["task": r.id, "force": true], timeout: 150)
            let status = out["status"] as? String
            if status == "off" { throw ERPAPI.Failure(status: 0, message: (out["error"] as? String) ?? "Alerts are off, or there is no number to send to.") }
            if status == "quiet" {
                Note.show(Note(title: "Nothing to report", detail: "There is nothing in it right now, so nothing was sent."), in: $note, reduce: reduceMotion)
            } else {
                let sent = out["sent"] as? Int ?? 0
                let total = out["recipients"] as? Int ?? 0
                let failed = out["failed"] as? [String] ?? []
                Note.show(Note(title: "Sent", detail: "Sent to \(sent) of \(total)" + (failed.isEmpty ? "." : ", not to \(failed.joined(separator: "; ")).")),
                          in: $note, reduce: reduceMotion)
            }
        } catch {
            failure = "Send failed: \(error.localizedDescription)"
        }
        await loadRuns()
    }
}
