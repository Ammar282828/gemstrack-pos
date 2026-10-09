import SwiftUI
import Observation
import ERPCore

/// Website → Investments (src/app/website/investments/page.tsx): Taheri's daily gold post, filed each morning
/// by the owner's Claude routine. The fortnight, newest first; a day opens to change its words and send each
/// part where it goes (the post and its square card to the Investments group and the channel, the teaser to the
/// community's announcements, the story card to Instagram), or all of them in order. Automatic sending is the
/// owner's schedule; today's card says what it will do with each part (the server's own words,
/// /api/investments/status) and can hold the day, give it the OK, or try a failed part again.
///
/// Every route is the web page's own. Anything that reaches people (a send, switching the schedule on, an OK, a
/// held day let go, a retry) first lists exactly what goes where; a part goes once, and sending it again asks.
struct WebsiteInvestmentsScreen: View {
    private var gold: WebsiteGold { WebsiteGold.shared }

    @State private var opened: Opened?
    @State private var editing = false
    @State private var adding = false
    @State private var confirmingOn = false
    @State private var busy: String?
    @State private var failure: String?

    struct Opened: Identifiable { let id: String }

    var body: some View {
        Group {
            switch gold.phase {
            case .off:
                ContentUnavailableView("Investments by Taheri isn't part of this shop", systemImage: "chart.line.uptrend.xyaxis")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't load the posts", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") { Task { await gold.load() } }.buttonStyle(.glass)
                }
            case .idle, .loading:
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                page
            }
        }
        .navigationTitle("Investments")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add by hand", systemImage: "plus") }
                    .disabled(gold.phase != .loaded)
            }
        }
        .task { await gold.load() }
        // While the schedule is on, what it sends shows up here without a pull.
        .task(id: gold.schedule?.enabled ?? false) {
            guard gold.schedule?.enabled ?? false else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                await gold.load()
            }
        }
        .sheet(item: $opened) { (o: Opened) in WebsiteGoldDaySheet(id: o.id) }
        .sheet(isPresented: $editing) { WebsiteGoldScheduleSheet() }
        .sheet(isPresented: $adding) { WebsiteGoldAddSheet() }
        .websiteBusy(busy)
        .confirmationDialog("Send Investments by Taheri automatically?", isPresented: $confirmingOn, titleVisibility: .visible) {
            Button("Switch it on") { Task { await switchOn() } }
        } message: {
            if let s = gold.schedule {
                Text(WebsiteGoldWords.switchOn(s, targets: gold.targets))
            }
        }
        .alert("Not done", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: The page

    private var page: some View {
        List {
            Group {
                scheduleSection
                if gold.todays == nil {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Today's post hasn't arrived yet.")
                                Text("The routine runs at 11:00 and files it here when it finishes\((gold.schedule?.enabled ?? false) ? "; the schedule sends it once it's here" : ""). If it ran and nothing came, check its last step on claude.ai, or add today's by hand.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "clock").foregroundStyle(.orange)
                        }
                    }
                }
                Section {
                    if gold.posts.isEmpty {
                        Text("No posts yet. The first arrives with the routine's next run.").foregroundStyle(.secondary)
                    }
                    ForEach(gold.posts) { (p: WebsiteGoldPost) in
                        Button { opened = Opened(id: p.id) } label: { dayRow(p) }
                            .buttonStyle(.plain)
                    }
                } header: {
                    Text("The fortnight")
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await gold.load() }
    }

    private func dayRow(_ p: WebsiteGoldPost) -> some View {
        let targets = gold.targets
        let sent = targets.filter { (t: WebsiteGoldStatus.Target) in p.sent[t.id] != nil }.count
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(WebsiteGoldTime.longDate(p.date)).font(.body.weight(.semibold))
                    if p.date == gold.today { WebsiteGoldTag(text: "Today", tint: Theme.accent) }
                    if p.hold { WebsiteGoldTag(text: "Held", tint: .secondary) }
                }
                Text(p.headline).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("\(sent)/\(targets.count) sent").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    // MARK: Automatic sending

    private var scheduleSection: some View {
        Section {
            if let s = gold.schedule {
                Toggle(isOn: Binding(get: { s.enabled }, set: { (on: Bool) in flip(on) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Automatic sending")
                        Text(s.enabled ? WebsiteGoldWords.summary(s, targets: gold.targets) : "Off: nothing goes out unless someone presses Send.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .tint(.green)
                if s.enabled, WebsiteGoldTime.minutesSince(s.lastTick).map({ (m: Int) in m > 15 }) ?? true {
                    Label(s.lastTick == nil
                          ? "The scheduler hasn't checked in yet. It runs every 5 minutes; if this stays, nothing goes out by itself."
                          : "The scheduler last checked in \(WebsiteGoldTime.ago(s.lastTick)). It should every 5 minutes: until it does, nothing goes out by itself.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                }
                Button { editing = true } label: { Label("Edit the schedule", systemImage: "calendar.badge.clock") }
            } else {
                Text("The schedule couldn't be read.").foregroundStyle(.secondary)
            }
        } header: {
            Text("Automatic sending")
        } footer: {
            if let s = gold.schedule { Text(checkedWords(s)) }
        }
    }

    /// "Checked 3 min ago · set by owner@…".
    private func checkedWords(_ s: WebsiteGoldSchedule) -> String {
        var parts = [s.lastTick == nil ? "Not checked yet" : "Checked " + WebsiteGoldTime.ago(s.lastTick)]
        if let by = s.updatedBy { parts.append("set by " + (by == "counter" ? "the counter" : by)) }
        return parts.joined(separator: " · ")
    }

    /// Turning it on says exactly what will go out, where; turning it off is at once.
    private func flip(_ on: Bool) {
        guard let s = gold.schedule else { return }
        if !on {
            Task {
                busy = "Switching it off…"
                defer { busy = nil }
                var off = s
                off.enabled = false
                do { try await gold.saveSchedule(off) } catch { failure = error.localizedDescription }
            }
            return
        }
        let going = gold.targets.filter { (t: WebsiteGoldStatus.Target) in s.plan(t.id).on }
        if going.isEmpty || s.days.isEmpty {
            failure = "Choose what goes first: switch on at least one part in the schedule, and pick its days. Then switch it on."
            editing = true
            return
        }
        confirmingOn = true
    }

    private func switchOn() async {
        guard var s = gold.schedule else { return }
        s.enabled = true
        busy = "Switching it on…"
        defer { busy = nil }
        do { try await gold.saveSchedule(s) } catch { failure = error.localizedDescription }
    }
}

/// A small word on a coloured ground ("Today", "Held").
struct WebsiteGoldTag: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(tint.opacity(0.14), in: .capsule)
    }
}

// MARK: A day

/// One day's post (page.tsx `DayCard`): its words, changeable before they go; its cards; each part and where it
/// goes, sent once; Send all; and today's say over the schedule.
struct WebsiteGoldDaySheet: View {
    let id: String

    @Environment(\.dismiss) private var dismiss
    private var gold: WebsiteGold { WebsiteGold.shared }

    @State private var post = ""
    @State private var teaser = ""
    @State private var filled = false
    @State private var ask: Ask?
    @State private var busy: String?
    @State private var said: String?
    @State private var failure: String?

    /// What the counter is asked before it happens.
    enum Ask: Identifiable {
        case send([String], force: Bool)
        case approve
        case letGo
        case retry(String)

        var id: String {
            switch self {
            case .send(let list, let force): return "send:" + list.joined(separator: ",") + (force ? ":again" : "")
            case .approve: return "approve"
            case .letGo: return "letGo"
            case .retry(let t): return "retry:" + t
            }
        }
    }

    private var day: WebsiteGoldPost? { gold.post(id) }
    private var isToday: Bool { day?.date == gold.today }
    private var scheduled: Bool { isToday && (gold.schedule?.enabled ?? false) }

    var body: some View {
        NavigationStack {
            Group {
                if let d = day {
                    page(d)
                } else {
                    ContentUnavailableView("This day's post is gone", systemImage: "tray")
                }
            }
            .navigationTitle(day.map { (d: WebsiteGoldPost) in WebsiteGoldTime.longDate(d.date) } ?? "Investments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy != nil)
        .onAppear { fill() }
        .websiteBusy(busy)
        .confirmationDialog(askTitle, isPresented: askShown, titleVisibility: .visible, presenting: ask) { (a: Ask) in
            Button(askButton(a)) { Task { await run(a) } }
        } message: { (a: Ask) in
            Text(askWords(a))
        }
        .alert("Not all of it went", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var askShown: Binding<Bool> {
        Binding(get: { ask != nil }, set: { (on: Bool) in if !on { ask = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private func fill() {
        guard !filled, let d = day else { return }
        post = d.post
        teaser = d.teaser
        filled = true
    }

    // MARK: The page

    private func page(_ d: WebsiteGoldPost) -> some View {
        let edited = post != d.post || teaser != d.teaser
        return List {
            Group {
                if let said {
                    Section { Label(said, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                }
                Section {
                    TextField("The WhatsApp post", text: $post, axis: .vertical)
                        .font(.system(.footnote, design: .monospaced))
                        .lineLimit(6...24)
                    ShareLink(item: post) { Label("Share or copy the post", systemImage: "square.and.arrow.up") }
                } header: {
                    Text("Post · \(post.count) characters")
                } footer: {
                    if post.count > 1024 { Text("Too long for a caption: it goes under the card.") }
                }
                Section {
                    TextField("The teaser (optional)", text: $teaser, axis: .vertical)
                        .font(.system(.footnote, design: .monospaced))
                        .lineLimit(3...14)
                    if !teaser.isEmpty {
                        ShareLink(item: teaser) { Label("Share or copy the teaser", systemImage: "square.and.arrow.up") }
                    }
                } header: {
                    Text("Teaser · for the main community")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        if edited {
                            Text("You've changed the words: what you send now is your version, and it's saved when it goes.\(scheduled ? " The schedule sends the saved words, so send by hand to use these." : "")")
                                .foregroundStyle(.orange)
                        }
                        Text(arrivedWords(d))
                    }
                }
                cardsSection(d)
                if scheduled { planSection(d) }
                sendSection(d)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await gold.load() }
    }

    /// "Arrived Today 11:20 am from the Claude routine · edited Today 11:40 am".
    private func arrivedWords(_ d: WebsiteGoldPost) -> String {
        var s = "Arrived " + ShopDate.say(d.receivedAt, withTime: true) + " from " + (d.source == "routine" ? "the Claude routine" : "the ERP")
        if let e = d.editedAt { s += " · edited " + ShopDate.say(e, withTime: true) }
        return s
    }

    private func cardsSection(_ d: WebsiteGoldPost) -> some View {
        Section("Cards") {
            HStack(alignment: .top, spacing: 12) {
                card(d, kind: "square", label: "Square")
                card(d, kind: "story", label: "Story")
            }
            .buttonStyle(.borderless)
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func card(_ d: WebsiteGoldPost, kind: String, label: String) -> some View {
        if d.cards.contains(kind), let url = WebsiteGold.cardURL(d, kind: kind) {
            Link(destination: url) {
                VStack(alignment: .leading, spacing: 4) {
                    StockImage(imageUrl: url.absoluteString, name: label, key: d.id + kind + d.receivedAt)
                        .aspectRatio(kind == "square" ? 1 : 9.0 / 16.0, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 10))
                    Label(label, systemImage: "arrow.up.right.square").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
        } else {
            Text("No \(kind) card")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 90)
                .background(.quaternary, in: .rect(cornerRadius: 10))
        }
    }

    private func planSection(_ d: WebsiteGoldPost) -> some View {
        Section {
            if gold.schedule?.mode == "approve" {
                if let at = d.approvedAt {
                    Label("Approved \(ShopDate.say(at, withTime: true))", systemImage: "checkmark.shield").foregroundStyle(.green)
                } else if !d.hold {
                    Button { ask = .approve } label: { Label("Approve today", systemImage: "checkmark.shield") }
                }
            }
            if d.hold {
                Button { ask = .letGo } label: { Label("Let it send", systemImage: "play.fill") }
            } else {
                Button { Task { await plan(["hold": true], said: "Held: today won't go by itself.") } } label: {
                    Label("Hold today", systemImage: "pause.fill")
                }
            }
        } header: {
            Text("On the schedule")
        }
    }

    private func sendSection(_ d: WebsiteGoldPost) -> some View {
        let targets = gold.targets
        let unsent = targets.filter { (t: WebsiteGoldStatus.Target) in d.sent[t.id] == nil && !missing(t.id, d) }.map { (t: WebsiteGoldStatus.Target) in t.id }
        return Section {
            if unsent.count > 1 {
                Button { ask = .send(unsent, force: false) } label: {
                    Label("Send all \(WebsiteGoldWords.count(unsent.count))", systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            ForEach(targets) { (t: WebsiteGoldStatus.Target) in partRow(t, d) }
        } header: {
            Text("Where it goes")
        } footer: {
            Text("Each part goes once. None of it can be unsent from here.")
        }
    }

    private func partRow(_ t: WebsiteGoldStatus.Target, _ d: WebsiteGoldPost) -> some View {
        let went = d.sent[t.id]
        let part = isToday ? gold.status?.parts[t.id] : nil
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.label).font(.body.weight(.medium))
                    Text("to " + t.to).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if let went {
                    Label(ShopDate.say(went.at, withTime: true) + (went.by == "schedule" ? " · auto" : ""), systemImage: "checkmark")
                        .font(.caption).foregroundStyle(.green)
                }
            }
            if scheduled, let line = part?.line {
                Label(line, systemImage: "calendar.badge.clock")
                    .font(.caption)
                    .foregroundStyle(part?.tone == "ok" ? Color.green : part?.tone == "warn" ? Color.orange : Color.secondary)
            }
            HStack(spacing: 16) {
                Button(went == nil ? "Send now" : "Send again…") { ask = .send([t.id], force: went != nil) }
                    .disabled(missing(t.id, d))
                if scheduled && part?.kind == "gave-up" {
                    Button("Try again") { ask = .retry(t.id) }
                }
            }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
    }

    /// A part with nothing to send (page.tsx `missing`): no teaser, no story card, no post.
    private func missing(_ t: String, _ d: WebsiteGoldPost) -> Bool {
        switch t {
        case "teaser": return teaser.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case "instagram": return !d.cards.contains("story")
        default: return post.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    // MARK: Asking first

    private var askTitle: String {
        switch ask {
        case .send(let list, let force)?: return force ? "Send it again?" : list.count > 1 ? "Send all \(list.count) now?" : "Send it now?"
        case .approve?: return "Approve today's post?"
        case .letGo?: return "Let today's post send?"
        case .retry(_)?: return "Try it again?"
        case nil: return ""
        }
    }

    private func askButton(_ a: Ask) -> String {
        switch a {
        case .send(let list, let force): return force ? "Send again" : list.count > 1 ? "Send all" : "Send"
        case .approve: return "Approve"
        case .letGo: return "Let it send"
        case .retry: return "Try again"
        }
    }

    /// Exactly where it goes.
    private func askWords(_ a: Ask) -> String {
        let date = WebsiteGoldTime.longDate(day?.date ?? "")
        switch a {
        case .send(let list, let force):
            if list.count > 1 {
                let lines = list.map { (t: String) in "• " + WebsiteGoldWords.place(t, targets: gold.targets) }.joined(separator: "\n")
                return "\(date), one after another:\n\(lines)\n\nNone of it can be unsent from here."
            }
            let t = list.first ?? ""
            let target = gold.targets.first { (x: WebsiteGoldStatus.Target) in x.id == t }
            return "\(target?.label ?? t) for \(date) goes to \(target?.to ?? t)\(force ? " a second time: everyone will see it twice" : ""). It can't be unsent from here."
        case .approve, .letGo:
            guard let s = gold.schedule, let d = day else { return "" }
            var waits = false
            if case .letGo = a { waits = s.mode == "approve" && d.approvedAt == nil }
            let lines = gold.targets.filter { (t: WebsiteGoldStatus.Target) in s.plan(t.id).on && d.sent[t.id] == nil }
                .map { (t: WebsiteGoldStatus.Target) in "• " + WebsiteGoldWords.when(s.plan(t.id).at) + ": " + WebsiteGoldWords.place(t.id, targets: gold.targets) }
                .joined(separator: "\n")
            let what = lines.isEmpty ? "Nothing of it is set to go by itself." : "It goes by itself at its times, saved words only:\n\(lines)"
            return what + (waits ? "\n\nIt still waits for your OK." : "")
        case .retry(let t):
            return "The next check (within 5 minutes) tries \(WebsiteGoldWords.place(t, targets: gold.targets)) again."
        }
    }

    // MARK: Doing it

    private func run(_ a: Ask) async {
        switch a {
        case .send(let list, let force): await send(list, force: force)
        case .approve: await plan(["approve": true], said: "Approved: it goes at its times.")
        case .letGo: await plan(["hold": false], said: "It sends by itself again.")
        case .retry(let t): await plan(["retry": t], said: "The next check tries it again.")
        }
    }

    /// One part after another, the group first: if one fails the rest still go, and each says how it went.
    private func send(_ list: [String], force: Bool) async {
        guard let d = day else { return }
        busy = list.count > 1 ? "Sending all…" : "Sending…"
        said = nil
        defer { busy = nil }
        var done: [String] = []
        var problems: [String] = []
        for t in list {
            busy = "Sending " + WebsiteGoldWords.place(t, targets: gold.targets) + "…"
            do {
                if try await gold.send(d.id, target: t, force: force, post: post != d.post ? post : nil, teaser: teaser != d.teaser ? teaser : nil) {
                    done.append(t)
                }
            } catch {
                problems.append(WebsiteGoldWords.place(t, targets: gold.targets) + ": " + error.localizedDescription)
            }
        }
        await gold.load()
        if let fresh = day {
            // The words that went are the saved ones now.
            post = fresh.post
            teaser = fresh.teaser
        }
        if !done.isEmpty {
            said = (done.count == list.count ? (list.count > 1 ? "All sent: " : "Sent: ") : "\(done.count) of \(list.count) sent: ")
                + done.map { (t: String) in WebsiteGoldWords.place(t, targets: gold.targets) }.joined(separator: " · ")
        }
        if !problems.isEmpty { failure = problems.joined(separator: "\n") }
    }

    private func plan(_ change: [String: Any], said words: String) async {
        guard let d = day else { return }
        busy = "Changing the plan…"
        said = nil
        defer { busy = nil }
        do {
            try await gold.plan(d.id, change)
            said = words
        } catch {
            failure = error.localizedDescription
        }
    }
}

// MARK: The store

/// The fortnight's posts, the schedule and today's plan, read together for the screen and a day's sheet.
@MainActor
@Observable
final class WebsiteGold {
    static let shared = WebsiteGold()

    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
        /// The house has no Investments (the routes answer 404).
        case off
    }

    private(set) var phase: Phase = .idle
    private(set) var posts: [WebsiteGoldPost] = []
    private(set) var today = ""
    private(set) var schedule: WebsiteGoldSchedule?
    private(set) var status: WebsiteGoldStatus?
    @ObservationIgnored private var loading = false

    /// The parts this shop can send, in the order they go, in the ERP's words.
    var targets: [WebsiteGoldStatus.Target] { status?.targets ?? [] }
    var todays: WebsiteGoldPost? { posts.first { (p: WebsiteGoldPost) in p.date == today } }

    func post(_ id: String) -> WebsiteGoldPost? { posts.first { (p: WebsiteGoldPost) in p.id == id } }

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if phase != .loaded { phase = .loading }
        do {
            async let a = ERPAPI.shared.get("/api/investments", as: WebsiteGoldAnswer.self)
            async let s = ERPAPI.shared.get("/api/investments/schedule", as: WebsiteGoldScheduleAnswer.self)
            async let st = ERPAPI.shared.get("/api/investments/status", as: WebsiteGoldStatus.self)
            let (answer, plan, now) = try await (a, s, st)
            posts = answer.posts
            today = answer.today
            schedule = plan.schedule
            status = now
            phase = .loaded
        } catch let f as ERPAPI.Failure where f.status == 404 {
            phase = .off
        } catch {
            if phase != .loaded { phase = .failed(error.localizedDescription) }
        }
    }

    /// One part through the Send route. True when it went, or had already gone (the schedule got there first):
    /// that part is done, not an error. Edited words go with it and are saved.
    func send(_ id: String, target: String, force: Bool, post: String?, teaser: String?) async throws -> Bool {
        var body: [String: Any] = ["target": target, "force": force]
        if let post { body["post"] = post }
        if let teaser { body["teaser"] = teaser }
        do {
            _ = try await ERPAPI.shared.send("/api/investments/\(id)/publish", body, timeout: 130)
            return true
        } catch let f as ERPAPI.Failure where f.status == 409 && !force {
            return true
        }
    }

    /// Hold the day, let it go, approve it, or clear a part that failed three times.
    func plan(_ id: String, _ change: [String: Any]) async throws {
        _ = try await ERPAPI.shared.send("/api/investments/\(id)/plan", change)
        await load()
    }

    func saveSchedule(_ s: WebsiteGoldSchedule) async throws {
        _ = try await ERPAPI.shared.send("/api/investments/schedule", method: "PUT", ["schedule": s.body])
        await load()
    }

    /// A day filed by hand (the routine's four things); nothing is sent on filing.
    func file(date: String, post: String, teaser: String, square: Data?, story: Data?) async throws {
        var files: [WebsiteForm.File] = []
        if let square { files.append(WebsiteForm.File(field: "square", name: "square.jpg", type: "image/jpeg", data: square)) }
        if let story { files.append(WebsiteForm.File(field: "story", name: "story.jpg", type: "image/jpeg", data: story)) }
        _ = try await WebsiteForm.send("/api/investments", fields: [("date", date), ("post", post), ("teaser", teaser)], files: files, timeout: 90)
        await load()
    }

    /// A day's card, served by the ERP to anyone (Instagram fetches the story from there too).
    static func cardURL(_ p: WebsiteGoldPost, kind: String) -> URL? {
        let v = p.receivedAt.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return URL(string: "/api/public/investments/\(p.id)/\(kind)?v=\(v)", relativeTo: House.serverURL)?.absoluteURL
    }
}
