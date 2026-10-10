import SwiftUI
import PhotosUI
import UIKit
import ERPCore

// Investments' automatic sending (page.tsx `SchedulePanel`) and a day filed by hand (`AddByHand`), with the
// words and clock both screens use. The rules of the schedule (what is due, when) stay the server's
// (lib/investments-schedule.ts, read through /api/investments/status); what is here is only how the page says
// a schedule in words.

// MARK: Words and the clock

enum WebsiteGoldTime {
    private static func format(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }
    private static let dayParse = format("yyyy-MM-dd")
    private static let long = format("EEEE d MMMM")
    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    /// "2026-10-07" → "Wednesday 7 October".
    static func longDate(_ day: String) -> String {
        guard let d = dayParse.date(from: day) else { return day }
        return long.string(from: d)
    }

    /// "13:05" → "1:05 pm" (investments-schedule.ts `clock`).
    static func clock(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]), (0...23).contains(h), (0...59).contains(m) else { return hhmm }
        return "\(h % 12 == 0 ? 12 : h % 12):\(String(format: "%02d", m)) \(h < 12 ? "am" : "pm")"
    }

    /// Today at "HH:MM" in Karachi, for a time picker.
    static func date(_ hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":")
        let h = parts.count == 2 ? Int(parts[0]) ?? 11 : 11
        let m = parts.count == 2 ? Int(parts[1]) ?? 30 : 30
        return calendar.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }

    /// A picked time as "HH:MM" in Karachi.
    static func hhmm(_ d: Date) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    static func minutesSince(_ iso: String?) -> Int? {
        guard let d = ERPDate.parse(iso) else { return nil }
        return Int((Date().timeIntervalSince(d) / 60).rounded())
    }

    /// "just now", "12 min ago", "3 h ago" (page.tsx `ago`).
    static func ago(_ iso: String?) -> String {
        guard let m = minutesSince(iso) else { return "" }
        if m < 1 { return "just now" }
        if m < 60 { return "\(m) min ago" }
        return "\(Int((Double(m) / 60).rounded())) h ago"
    }
}

enum WebsiteGoldWords {
    static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// "Mon–Sat", "Every day", "Mon, Wed, Fri" (investments-schedule.ts `daysLabel`).
    static func days(_ days: [Int]) -> String {
        let d = Array(Set(days.filter { (x: Int) in (0...6).contains(x) })).sorted()
        if d.count == 7 { return "Every day" }
        if d.isEmpty { return "No days" }
        if d == [1, 2, 3, 4, 5, 6] { return "Mon–Sat" }
        if d == [1, 2, 3, 4, 5] { return "Mon–Fri" }
        return d.map { (x: Int) in dayNames[x] }.joined(separator: ", ")
    }

    /// "at 11:30 am", "as soon as it arrives".
    static func when(_ at: String) -> String { at == "arrival" ? "As soon as it arrives" : clock(at) }

    static func clock(_ at: String) -> String { WebsiteGoldTime.clock(at) }

    /// "Post + square card → the Investments by Taheri group", in the server's words.
    static func place(_ t: String, targets: [WebsiteGoldStatus.Target]) -> String {
        guard let x = targets.first(where: { (x: WebsiteGoldStatus.Target) in x.id == t }) else { return t }
        return "\(x.label) → \(x.to)"
    }

    /// "two", "three", "four".
    static func count(_ n: Int) -> String {
        switch n {
        case 2: return "two"
        case 3: return "three"
        case 4: return "four"
        default: return "\(n)"
        }
    }

    /// The schedule in a line (page.tsx `summary`).
    static func summary(_ s: WebsiteGoldSchedule, targets: [WebsiteGoldStatus.Target]) -> String {
        let short = ["teaser": "teaser", "instagram": "Instagram", "channel": "channel", "group": "group"]
        let parts = targets.filter { (t: WebsiteGoldStatus.Target) in s.plan(t.id).on }.map { (t: WebsiteGoldStatus.Target) -> String in
            let at = s.plan(t.id).at
            return "\(short[t.id] ?? t.id) \(at == "arrival" ? "on arrival" : clock(at))"
        }
        return "\(days(s.days)) · \(parts.isEmpty ? "nothing chosen" : parts.joined(separator: " · "))\(s.mode == "approve" ? " · after your OK" : "")"
    }

    /// What switching it on (or saving it on) sends, and where (page.tsx's "Send … automatically?").
    static func switchOn(_ s: WebsiteGoldSchedule, targets: [WebsiteGoldStatus.Target]) -> String {
        let label = days(s.days)
        let lines = targets.filter { (t: WebsiteGoldStatus.Target) in s.plan(t.id).on }.map { (t: WebsiteGoldStatus.Target) in
            "• \(when(s.plan(t.id).at)): \(t.label.lowercased()) to \(t.to)"
        }.joined(separator: "\n")
        return "From now on, \(label == "Every day" ? "every day" : "on \(label)"), once the routine has filed the day's post\(s.mode == "approve" ? " and you've approved it" : ""):\n\(lines)\n\nOnly that day's post, each part once. A late post still goes until \(clock(s.lateUntil)). Hold any day from its card."
    }
}

// MARK: Automatic sending

/// The owner's schedule: the days, each part's time (or as soon as it arrives), the late cut-off, and whether
/// each day waits for an OK. Saved whole (PUT /api/investments/schedule); while it is on, or to switch it on,
/// the save says exactly what will go out.
struct WebsiteGoldScheduleSheet: View {
    @Environment(\.dismiss) private var dismiss
    private var gold: WebsiteGold { WebsiteGold.shared }

    @State private var draft: WebsiteGoldSchedule?
    @State private var asking: Saving?
    @State private var busy: String?
    @State private var failure: String?

    /// How the draft is to be saved.
    enum Saving: Identifiable {
        case keepOn
        case switchOn
        var id: Int { self == .keepOn ? 0 : 1 }
    }

    var body: some View {
        NavigationStack {
            Group {
                if draft != nil {
                    form
                } else {
                    ContentUnavailableView("The schedule couldn't be read", systemImage: "calendar.badge.exclamationmark")
                }
            }
            .navigationTitle("Automatic sending")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .onAppear { if draft == nil { draft = gold.schedule } }
        .websiteBusy(busy)
        .confirmationDialog("Send Investments by Taheri automatically?", isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (a: Saving) in
            Button(a == .switchOn ? "Switch it on" : "Save changes") { Task { await save(on: true) } }
        } message: { (_: Saving) in
            if let d = draft { Text(WebsiteGoldWords.switchOn(d, targets: gold.targets)) }
        }
        .alert("Not saved", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var askingShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { (on: Bool) in if !on { asking = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private var usable: [WebsiteGoldStatus.Target] { gold.targets }
    private var going: Int { usable.filter { (t: WebsiteGoldStatus.Target) in draft?.plan(t.id).on ?? false }.count }

    private var form: some View {
        let d = draft
        let wasOn = gold.schedule?.enabled ?? false
        let changed = !(d.map { (x: WebsiteGoldSchedule) in gold.schedule.map { (y: WebsiteGoldSchedule) in x.sameChoices(y) } ?? false } ?? true)
        return List {
            Group {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { (n: Int) in
                                MarketingChip(title: WebsiteGoldWords.dayNames[n], selected: d?.days.contains(n) ?? false) { toggleDay(n) }
                            }
                        }
                    }
                    .scrollClipDisabled()
                    HStack(spacing: 16) {
                        Button("Every day") { draft?.days = [0, 1, 2, 3, 4, 5, 6] }
                        Button("Mon–Sat") { draft?.days = [1, 2, 3, 4, 5, 6] }
                        Button("Mon–Fri") { draft?.days = [1, 2, 3, 4, 5] }
                    }
                    .font(.subheadline)
                    .buttonStyle(.borderless)
                } header: {
                    LedgerHeading(title: "Which days")
                }
                Section {
                    ForEach(usable) { (t: WebsiteGoldStatus.Target) in partRow(t) }
                } header: {
                    LedgerHeading(title: "What goes, and when · Karachi time")
                }
                Section {
                    DatePicker("Still send it until", selection: lateBinding, displayedComponents: .hourAndMinute)
                        .environment(\.timeZone, ERPDate.karachi)
                } header: {
                    LedgerHeading(title: "If the post comes late")
                } footer: {
                    Text("After that, a part that hasn't gone waits for someone to press Send.")
                }
                Section {
                    Picker("Each day", selection: modeBinding) {
                        Text("Send by itself").tag("auto")
                        Text("Wait for my OK").tag("approve")
                    }
                    .pickerStyle(.segmented)
                } header: {
                    LedgerHeading(title: "Each day")
                } footer: {
                    Text(d?.mode == "approve" ? "Each day's post waits until you press Approve on it; then it goes at its times." : "It goes at its times unless you hold the day.")
                }
                Section {
                    if wasOn {
                        Button { ask(.keepOn) } label: { Label("Save changes", systemImage: "checkmark").frame(maxWidth: .infinity) }
                            .buttonStyle(.houseProminent)
                            .disabled(!changed || busy != nil)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                        Button("Switch automatic sending off", role: .destructive) { Task { await save(on: false) } }
                    } else {
                        Button { ask(.switchOn) } label: { Label("Save and switch on", systemImage: "checkmark").frame(maxWidth: .infinity) }
                            .buttonStyle(.houseProminent)
                            .disabled(busy != nil)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                        Button("Save, keep it off") { Task { await save(on: false) } }
                            .disabled(!changed || busy != nil)
                    }
                } footer: {
                    Text(wasOn ? "It's on: what you save here is what goes out." : "Off: nothing goes out unless someone presses Send.")
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func partRow(_ t: WebsiteGoldStatus.Target) -> some View {
        let plan = draft?.plan(t.id) ?? WebsiteGoldSchedule.Plan(on: false, at: "11:30")
        return VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: onBinding(t.id)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.label)
                    Text("to " + t.to).font(.caption).foregroundStyle(.secondary)
                }
            }
            .tint(Theme.accent)
            if plan.on {
                Picker("When", selection: arrivalBinding(t.id)) {
                    Text("On arrival").tag(true)
                    Text("At a time").tag(false)
                }
                .pickerStyle(.segmented)
                if plan.at != "arrival" {
                    DatePicker("At", selection: timeBinding(t.id), displayedComponents: .hourAndMinute)
                        .environment(\.timeZone, ERPDate.karachi)
                }
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: Bindings into the draft

    private func toggleDay(_ n: Int) {
        guard var d = draft else { return }
        if d.days.contains(n) { d.days.removeAll { (x: Int) in x == n } } else { d.days.append(n) }
        d.days.sort()
        draft = d
    }

    private func onBinding(_ t: String) -> Binding<Bool> {
        Binding(get: { draft?.plan(t).on ?? false }, set: { (v: Bool) in
            guard var d = draft else { return }
            var p = d.plan(t)
            p.on = v
            d.targets[t] = p
            draft = d
        })
    }

    private func arrivalBinding(_ t: String) -> Binding<Bool> {
        Binding(get: { draft?.plan(t).at == "arrival" }, set: { (v: Bool) in
            guard var d = draft else { return }
            var p = d.plan(t)
            if v { p.at = "arrival" } else if p.at == "arrival" { p.at = WebsiteGoldSchedule.defaults[t]?.at ?? "11:30" }
            d.targets[t] = p
            draft = d
        })
    }

    private func timeBinding(_ t: String) -> Binding<Date> {
        Binding(get: { WebsiteGoldTime.date(draft?.plan(t).at ?? "11:30") }, set: { (v: Date) in
            guard var d = draft else { return }
            var p = d.plan(t)
            p.at = WebsiteGoldTime.hhmm(v)
            d.targets[t] = p
            draft = d
        })
    }

    private var lateBinding: Binding<Date> {
        Binding(get: { WebsiteGoldTime.date(draft?.lateUntil ?? "20:00") }, set: { (v: Date) in draft?.lateUntil = WebsiteGoldTime.hhmm(v) })
    }

    private var modeBinding: Binding<String> {
        Binding(get: { draft?.mode ?? "auto" }, set: { (v: String) in draft?.mode = v })
    }

    // MARK: Saving

    private func ask(_ how: Saving) {
        guard let d = draft else { return }
        if d.days.isEmpty || going == 0 {
            failure = "Choose what goes first: switch on at least one part, and pick its days."
            return
        }
        asking = how
    }

    private func save(on: Bool) async {
        guard var d = draft else { return }
        d.enabled = on
        busy = "Saving the schedule…"
        defer { busy = nil }
        do {
            try await gold.saveSchedule(d)
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}

// MARK: A day by hand

/// The routine's four things, from the phone: the post, the teaser, the square card and the story card, filed
/// under a day (POST /api/investments). Nothing is sent on filing; a day that already exists is replaced, and
/// what already went stays marked as sent.
struct WebsiteGoldAddSheet: View {
    @Environment(\.dismiss) private var dismiss
    private var gold: WebsiteGold { WebsiteGold.shared }

    @State private var date = Date()
    @State private var post = ""
    @State private var teaser = ""
    @State private var square: Data?
    @State private var story: Data?
    @State private var squareThumb: UIImage?
    @State private var storyThumb: UIImage?
    @State private var pickingSquare = false
    @State private var pickingStory = false
    @State private var squareItem: PhotosPickerItem?
    @State private var storyItem: PhotosPickerItem?
    @State private var confirmingReplace = false
    @State private var busy: String?
    @State private var failure: String?

    private var day: String { ERPDate.karachiDay(date) }
    private var exists: Bool { gold.posts.contains { (p: WebsiteGoldPost) in p.date == day } }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    Section {
                        DatePicker("Date", selection: $date, displayedComponents: .date)
                            .environment(\.timeZone, ERPDate.karachi)
                    } footer: {
                        Text(exists ? "\(WebsiteGoldTime.longDate(day)) is filed already: this replaces it, and anything sent stays marked as sent." : "Paste the post and the teaser, and attach the routine's two cards.")
                    }
                    LedgerSection("The WhatsApp post") {
                        TextField("The post", text: $post, axis: .vertical)
                            .font(.system(.footnote, design: .monospaced))
                            .lineLimit(6...20)
                    }
                    LedgerSection("The teaser (optional)") {
                        TextField("The teaser", text: $teaser, axis: .vertical)
                            .font(.system(.footnote, design: .monospaced))
                            .lineLimit(3...12)
                    }
                    LedgerSection("Cards") {
                        cardRow("Square card (1080 × 1080)", thumb: squareThumb, has: square != nil) { pickingSquare = true } clear: {
                            square = nil
                            squareThumb = nil
                        }
                        .photosPicker(isPresented: $pickingSquare, selection: $squareItem, matching: .images)
                        cardRow("Story card (1080 × 1920)", thumb: storyThumb, has: story != nil) { pickingStory = true } clear: {
                            story = nil
                            storyThumb = nil
                        }
                        .photosPicker(isPresented: $pickingStory, selection: $storyItem, matching: .images)
                    }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Add a day by hand")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("File it") { if exists { confirmingReplace = true } else { Task { await file() } } }
                        .disabled(post.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy != nil)
                }
            }
        }
        .presentationDetents([.large])
        .websiteBusy(busy)
        .onChange(of: squareItem) { _, item in
            guard let item else { return }
            Task { await load(item, square: true) }
        }
        .onChange(of: storyItem) { _, item in
            guard let item else { return }
            Task { await load(item, square: false) }
        }
        .confirmationDialog("Replace \(WebsiteGoldTime.longDate(day))?", isPresented: $confirmingReplace, titleVisibility: .visible) {
            Button("Replace it") { Task { await file() } }
        } message: {
            Text("The day's post, teaser and cards are replaced by these. Nothing is sent; what already went stays marked as sent.")
        }
        .alert("Not filed", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private func cardRow(_ title: String, thumb: UIImage?, has: Bool, pick: @escaping () -> Void, clear: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Rectangle().fill(.quaternary)
                if let thumb {
                    Image(uiImage: thumb).resizable().scaledToFill()
                } else {
                    Image(systemName: "photo").foregroundStyle(.secondary)
                }
            }
            .frame(width: 52, height: 52)
            .clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline)
                HStack(spacing: 14) {
                    Button(has ? "Replace" : "Choose", action: pick)
                    if has { Button("Remove", role: .destructive, action: clear) }
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
            }
        }
    }

    /// A card as the ERP reads it: a JPEG (the server sizes it), whatever Photos hands over.
    private func load(_ item: PhotosPickerItem, square isSquare: Bool) async {
        defer { if isSquare { squareItem = nil } else { storyItem = nil } }
        guard let raw = try? await item.loadTransferable(type: Data.self) else { failure = "Couldn't read that picture."; return }
        let ready = await Task.detached(priority: .userInitiated) { () -> (Data, UIImage?)? in
            guard let jpeg = WebsitePhoto.jpegCopy(raw, longestEdge: 2400) else { return nil }
            return (jpeg, WebsitePhoto.thumbnail(jpeg, maxPixel: 160))
        }.value
        guard let ready else { failure = "Couldn't use that picture."; return }
        if isSquare {
            square = ready.0
            squareThumb = ready.1
        } else {
            story = ready.0
            storyThumb = ready.1
        }
    }

    private func file() async {
        busy = "Filing it…"
        defer { busy = nil }
        do {
            try await gold.file(date: day, post: post.trimmingCharacters(in: .whitespacesAndNewlines),
                                teaser: teaser.trimmingCharacters(in: .whitespacesAndNewlines), square: square, story: story)
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}
