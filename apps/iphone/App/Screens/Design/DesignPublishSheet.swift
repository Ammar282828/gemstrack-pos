import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The Publish sheet (publish-sheet.tsx): one list for everywhere a design can go. The engine is `DesignPublishModel`.
struct DesignPublishSheet: View {
    @State private var p: DesignPublishModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var note: Note?
    @State private var share: DesignShareRequest?
    @State private var problem: String?
    @State private var confirmingAgain = false

    init(model: DesignWorkspaceModel) { _p = State(initialValue: DesignPublishModel(model: model)) }

    private func bind<T>(_ key: ReferenceWritableKeyPath<DesignPublishModel, T>) -> Binding<T> {
        Binding(get: { p[keyPath: key] }, set: { p[keyPath: key] = $0 })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let err = p.loadError {
                    ErrorState(err) { Task { await p.load() } }
                } else if !p.loaded {
                    SkeletonLoading("Looking at where this can go").padding(pt(16)).frame(maxHeight: .infinity, alignment: .top)
                } else {
                    content
                }
            }
            .modifier(HouseGround())
            .navigationTitle("Publish").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                #if os(macOS)
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                #else
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                #endif
            }
            .modifier(DesignSpeech(get: { p.model.speak }, set: { p.model.speak = $0 }, note: $note))
            .failureAlert($problem, title: "Could not finish")
            .moneyFeedback(success: p.sent, failure: p.failures)
            .confirmDestructive(isPresented: $confirmingAgain, title: "Send again from the start?",
                                message: "What already went out is forgotten here, so every place can be sent to again.",
                                action: "Send again from the start") { p.forgetAll() }
            .sheet(item: $share) { r in MarketingShareSheet(items: r.items, completion: { done in if done, let id = r.step { p.markDone(id) } }) }
            .confirmationDialog(confirmTitle, isPresented: bind(\.confirming), titleVisibility: .visible) {
                Button("Yes, send") { startRun() }
                Button("Not yet", role: .cancel) {}
            } message: { Text(confirmMessage) }
        }
        .interactiveDismissDisabled(p.busy)
        .task { await p.load() }
        .onChange(of: p.folder) { _, _ in p.remember() }
        .onChange(of: p.waKeys) { _, _ in p.remember() }
        .task(id: wordsKey) {
            try? await Task.sleep(for: .milliseconds(500))
            if !Task.isCancelled { await p.checkWords() }
        }
    }

    private var wordsKey: String { [p.wa, p.ig, p.adText, p.adHeadline, "\(p.waOn)", "\(p.postOn)", "\(p.metaOn)"].joined(separator: "|") }

    private var plan: DesignPublishModel.Plan { p.plan() }

    // MARK: The sheet

    private var content: some View {
        #if os(macOS)
        macContent
        #else
        phoneContent
        #endif
    }

    @ViewBuilder
    private var phoneContent: some View {
        let plan = self.plan
        let problems = p.problems(plan)
        return ScrollView {
            VStack(alignment: .leading, spacing: pt(16)) {
                health
                places
                if p.waOn || p.postOn { captions }
                if p.metaOn && p.ok("meta-ad") { metaWords }
                timing
                if !(problems + p.wordIssues).isEmpty {
                    VStack(alignment: .leading, spacing: pt(4)) {
                        ForEach(problems + p.wordIssues, id: \.self) { Label($0, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Tone.problem.color) }
                    }
                }
                if !plan.steps.isEmpty { steps(plan) }
                if let path = p.metaPath ?? p.ref("meta-ad") {
                    Button { p.model.route = Route(path: path); dismiss() } label: { Label("Open the new ad", systemImage: "sparkles").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered).largeOnPhone()
                }
                if let n = p.note { Text(n).font(.footnote).foregroundStyle(.secondary) }
                extras
            }
            .padding(.horizontal, pt(16)).padding(.vertical, pt(12))
        }
        .scrollDismissesKeyboard(.interactively)
        // Sending is the sheet's one job: it stays at the foot with what it will do (rule 16).
        .actionBar(primary: sendAction(plan, problems), summary: sendSummary(plan))
    }

    // MARK: Connections (the health strip)

    private var health: some View {
        let failing = p.checks.filter { $0.s("status") == "fail" }
        return SectionCard("Connections") {
            if p.healthLoading && p.checks.isEmpty {
                SkeletonLoading("Checking the connections")
            } else if let f = p.healthFailed {
                Text(f).font(.footnote).foregroundStyle(Tone.owed.color)
            } else if failing.isEmpty {
                Label("Every connection is fine", systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(Tone.settled.color)
            } else {
                ForEach(failing, id: \.text) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(c.s("label"), systemImage: "xmark.circle").font(.subheadline.weight(.medium)).foregroundStyle(Tone.problem.color)
                        if !c.s("fix").isEmpty { Text(c.s("fix")).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            if !p.checks.isEmpty {
                DisclosureGroup("Every check") {
                    ForEach(p.checks, id: \.text) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            Label(c.s("label"), systemImage: c.s("status") == "ok" ? "checkmark.circle" : "exclamationmark.triangle").font(.footnote)
                            Text(c.s("detail")).font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, pt(2))
                    }
                }.font(.subheadline)
            }
            Button { Task { await p.refreshHealth() } } label: { Label("Check again", systemImage: "arrow.clockwise") }.font(.footnote).disabled(p.healthLoading)
        }
    }

    // MARK: Where it goes

    private var places: some View {
        SectionCard("Where it goes") {
            if p.row("website") != nil { websiteBlock }
            if p.row("whatsapp") != nil || p.row("channel") != nil { whatsappBlock }
            instagramBlock("instagram-story", "Instagram story", "camera.viewfinder", bind(\.storyOn))
            instagramBlock("instagram-post", "Instagram post", "photo", bind(\.postOn))
            if p.ok("meta-ad") { placeToggle("Meta ad", "megaphone", bind(\.metaOn), dest: "meta-ad", note: metaNote) }
            if p.ok("site-replace") { placeToggle("Replace the photo on the website", "arrow.triangle.2.circlepath", bind(\.replaceOn), dest: "site-replace", note: nil) }
            Toggle(isOn: bind(\.saveOn)) { Label("Save the design", systemImage: "square.and.arrow.down") }.tint(Theme.accent)
        }
    }

    private var metaNote: String? {
        guard p.metaOn else { return nil }
        let beside = DesignDestinations.storyPage(p.pages) != nil ? " and the 9:16 beside it" : ""
        return "Opens New ad with the picture" + beside + "."
    }

    private func placeToggle(_ title: String, _ symbol: String, _ on: Binding<Bool>, dest: String, note: String?) -> some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Toggle(isOn: on) { Label(title, systemImage: symbol) }.tint(Theme.accent)
            if on.wrappedValue { pictureLine(dest) }
            if let note, on.wrappedValue { Text(note).font(.footnote).foregroundStyle(.secondary) }
        }
    }

    /// The page a place takes, or the button that makes the one it lacks ("Make 1:1 from this").
    @ViewBuilder private func pictureLine(_ dest: String) -> some View {
        let pick = p.pick(dest)
        if let page = pick.page {
            Text("Uses: \(page.label)").font(.footnote).foregroundStyle(.secondary)
        } else if let m = p.missing(dest) {
            Button { Task { await p.make(m) } } label: { Label(m.label, systemImage: "wand.and.stars") }.buttonStyle(.bordered).font(.footnote)
        }
    }

    private var websiteBlock: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Toggle(isOn: bind(\.websiteOn)) { Label("Website", systemImage: "globe") }.tint(Theme.accent).disabled(!p.ok("website"))
            if let reason = p.row("website")?.reason, !p.ok("website") { Text(reason).font(.footnote).foregroundStyle(.secondary) }
            if p.websiteOn && p.ok("website") {
                Picker("Collection", selection: bind(\.folder)) {
                    Text("Choose a collection…").tag("")
                    ForEach(p.collections) { Text($0.title).tag($0.folder) }
                }.pickerStyle(.menu)
                if p.ok("featured") {
                    Toggle("Set of the day on the home page", isOn: bind(\.featured)).font(.subheadline).tint(Theme.accent)
                    if p.featured, let f = WebsiteStore.shared.featured {
                        Text("It replaces \(f.file) as the set of the day.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if p.isMaison {
                    Picker("House", selection: bind(\.house)) {
                        Text("The house: Cartier, Van Cleef & Arpels…").tag("")
                        ForEach(p.model.catalogue["maisonHouses"].array.map(\.string), id: \.self) { Text($0).tag($0) }
                    }.pickerStyle(.menu)
                }
                if p.renaming || p.isMaison {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.isMaison ? "Official name, as the house names it" : "Name on the website").font(.caption).foregroundStyle(.secondary)
                        TextField(p.work?.fields["headline"] ?? p.work?.displayName ?? "", text: bind(\.siteName))
                            .padding(.horizontal, pt(12)).padding(.vertical, pt(8))
                            .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
                        if p.isMaison { Text("Shown under its house, in 18k, with no gold-rate price.").font(.caption2).foregroundStyle(.secondary) }
                    }
                } else {
                    HStack(spacing: pt(4)) {
                        Text("Named “\(p.siteName.trimmingCharacters(in: .whitespaces).isEmpty ? (p.work?.fields["headline"] ?? p.work?.displayName ?? "") : p.siteName)”")
                            .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        Button("Change") { p.renaming = true }.font(.footnote)
                    }
                }
                pictureLine("website")
                if !p.pages.contains(where: { $0.label == DesignSizes.website.label }), let m = p.missing("website") {
                    Button { Task { await p.make(m) } } label: { Label("Make the catalogue photo (weight stamped)", systemImage: "wand.and.stars") }.buttonStyle(.bordered).font(.footnote)
                }
            }
        }
    }

    private var whatsappBlock: some View {
        let wa = p.row("whatsapp"), ch = p.row("channel")
        var targets: [DesignPublishModel.Target] = []
        if wa?.available == true { targets += wa?.targets ?? [] }
        if ch?.available == true { targets += ch?.targets ?? [] }
        return VStack(alignment: .leading, spacing: pt(8)) {
            Toggle(isOn: bind(\.waOn)) { Label("WhatsApp", systemImage: "message") }.tint(Theme.accent).disabled(targets.isEmpty)
            if targets.isEmpty { Text(wa?.reason ?? ch?.reason ?? "This shop has no WhatsApp community set.").font(.footnote).foregroundStyle(.secondary) }
            if p.waOn && !targets.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: pt(8)) {
                        ForEach(targets, id: \.key) { t in
                            FilterChip(title: t.label + (t.key == "channel" ? " (channel)" : ""), chosen: p.waKeys.contains(t.key)) {
                                if let i = p.waKeys.firstIndex(of: t.key) { p.waKeys.remove(at: i) } else { p.waKeys.append(t.key) }
                            }
                        }
                    }
                }
                if !p.whatsappChoice.isEmpty { pictureLine(p.whatsappChoice.contains { $0 != "channel" } ? "whatsapp" : "channel") }
            }
        }
    }

    private func instagramBlock(_ id: String, _ title: String, _ symbol: String, _ on: Binding<Bool>) -> some View {
        let r = p.row(id)
        let share = p.igMode(id) == "share"
        return VStack(alignment: .leading, spacing: pt(6)) {
            Toggle(isOn: on) { Label(title + (share ? " (share sheet)" : ""), systemImage: symbol) }.tint(Theme.accent)
            if let reason = r?.reason { Text(reason).font(.footnote).foregroundStyle(.secondary) }
            if on.wrappedValue {
                pictureLine(id)
                if r?.connectable == true {
                    Button { Task { if let url = await p.connectInstagram() { openURL(url) } } } label: { Label("Connect Instagram", systemImage: "link") }.buttonStyle(.bordered).font(.footnote)
                }
            }
        }
    }

    // MARK: Words

    private var captions: some View {
        SectionCard("Captions") {
            Button { Task { await p.writeCaptions() } } label: {
                HStack { if p.aiBusy { ProgressView() } else { Image(systemName: "sparkles") }; Text("Write with AI") }.frame(maxWidth: .infinity)
            }.buttonStyle(.bordered).disabled(p.aiBusy)
            if p.waOn { captionField("WhatsApp caption", bind(\.wa)) }
            if p.postOn { captionField("Instagram caption", bind(\.ig)) }
        }
    }

    private var metaWords: some View {
        SectionCard("Meta ad words") {
            captionField("Ad headline", bind(\.adHeadline), lines: 1...2)
            captionField("Ad primary text", bind(\.adText))
        }
    }

    private func captionField(_ label: String, _ text: Binding<String>, lines: ClosedRange<Int> = 3...8) -> some View {
        VStack(alignment: .leading, spacing: pt(4)) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(label, text: text, axis: .vertical).lineLimit(lines)
                .padding(.horizontal, pt(12)).padding(.vertical, pt(9))
                .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
        }
    }

    private var timing: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Picker("When", selection: bind(\.when)) {
                Text("Send now").tag("now"); Text("Hold in the queue").tag("hold"); Text("Schedule").tag("schedule")
            }.pickerStyle(.segmented)
            if p.when == "schedule" { DatePicker("Send at", selection: bind(\.due), in: Date()...).font(.subheadline) }
            if p.queued && p.postOn { Text("The queue carries the website, WhatsApp and the story; the Instagram post goes out now, not from the queue.").font(.footnote).foregroundStyle(.secondary) }
        }
        .ledgerCard()
    }

    // MARK: Sending

    private var confirmTitle: String {
        let n = plan.steps.filter { p.ref($0.id) == nil && !$0.manual }.count
        return "Send to \(n) place\(n == 1 ? "" : "s")?"
    }
    private var confirmMessage: String {
        let plan = self.plan
        let groups = p.failingGroups(plan)
        let whole = p.whatsappChoice.contains("announcements") ? "This reaches the whole community: a thousand-odd customers. " : ""
        return whole + (groups.isEmpty ? "A published post cannot be taken back." : "A check is failing for \(groups.joined(separator: " and ")); it may not go.")
    }

    private func sendLabel() -> String { p.when == "now" ? "Publish" : p.when == "hold" ? "Hold in the queue" : "Schedule" }

    /// "3 places, now": what the button will do, above it.
    private func sendSummary(_ plan: DesignPublishModel.Plan) -> String? {
        let n = plan.steps.filter { p.ref($0.id) == nil }.count
        guard n > 0 else { return nil }
        let when = p.when == "now" ? "now" : p.when == "hold" ? "held in the queue" : "scheduled"
        return "\(n) place\(n == 1 ? "" : "s"), \(when)"
    }

    private func sendAction(_ plan: DesignPublishModel.Plan, _ problems: [String]) -> ActionBar.Action {
        let allDone = !plan.steps.isEmpty && plan.steps.allSatisfy { p.ref($0.id) != nil }
        return .init(sendLabel(), systemImage: "paperplane", isBusy: p.busy,
                     isDisabled: !problems.isEmpty || !p.wordIssues.isEmpty || plan.steps.isEmpty || allDone) {
            Task {
                await p.checkWords()
                guard problems.isEmpty, p.wordIssues.isEmpty else { return }
                let groups = p.failingGroups(plan)
                if !p.whatsappChoice.isEmpty || p.igMode("instagram-story") == "api" && p.storyOn || p.igMode("instagram-post") == "api" && p.postOn || !groups.isEmpty { p.confirming = true }
                else { startRun() }
            }
        }
    }

    /// Off to the Outbox and the sheet closes with a Note, unless a step still needs the person's hands (a story to share).
    private func startRun() {
        let waiting = plan.steps.contains { (s: DesignPublishModel.Step) in s.manual && p.ref(s.id) == nil }
        let n = plan.steps.filter { (s: DesignPublishModel.Step) in p.ref(s.id) == nil && !s.manual }.count
        p.runInBackground()
        p.model.say("Sending to \(n) \(n == 1 ? "place" : "places")…", detail: "It says when it has gone.")
        if !waiting { dismiss() }
    }

    private func steps(_ plan: DesignPublishModel.Plan) -> some View {
        SectionCard("What goes") {
            ForEach(plan.steps, id: \.id) { s in
                let st = p.state(s)
                VStack(alignment: .leading, spacing: pt(6)) {
                    HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
                        icon(st.status).motion(st.status)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label).font(.subheadline)
                            if let e = st.error { Text(e).font(.footnote).foregroundStyle(Tone.problem.color) }
                        }
                        Spacer(minLength: 0)
                    }
                    if st.status == .failed {
                        Button { Task { await p.run(only: s.id) } } label: { Label("Retry", systemImage: "arrow.clockwise") }.buttonStyle(.bordered).font(.footnote).disabled(p.busy)
                    }
                    if s.manual && st.status == .manual {
                        HStack(spacing: pt(8)) {
                            Button { Task { await shareStep(s) } } label: { Label("Share it", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered).font(.footnote)
                            Button("Posted") { p.markDone(s.id, "by hand") }.font(.footnote)
                        }
                    }
                }
            }
            if plan.steps.contains(where: { p.state($0).status == .failed }) && !p.busy {
                Button { Task { await p.run() } } label: { Label("Retry what failed", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
            }
        }
    }

    @ViewBuilder private func icon(_ s: DesignPublishModel.Status) -> some View {
        switch s {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Tone.settled.color).contentTransition(.symbolEffect(.replace))
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(Tone.problem.color).contentTransition(.symbolEffect(.replace))
        case .running: ProgressView()
        case .manual: Image(systemName: "hand.tap").foregroundStyle(Tone.owed.color).contentTransition(.symbolEffect(.replace))
        case .waiting: Image(systemName: "circle").foregroundStyle(.secondary).contentTransition(.symbolEffect(.replace))
        }
    }

    private func shareStep(_ s: DesignPublishModel.Step) async {
        do {
            let url = try await p.shareFile(s)
            share = DesignShareRequest(items: [url], step: s.id)
        } catch { problem = error.localizedDescription }
    }

    // MARK: The rest

    private var extras: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Divider()
            Button { Task { await shareAll() } } label: { Label("Share or save every size", systemImage: "square.and.arrow.up.on.square") }.font(.subheadline)
            if p.row("whatsapp") != nil || p.row("channel") != nil {
                Button { Task { await shareCaptioned() } } label: { Label("Share the picture with its caption", systemImage: "square.and.arrow.up") }.font(.subheadline)
            }
            if !p.wa.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { UIPasteboard.general.string = p.wa; p.model.say("The caption is copied") } label: { Label("Copy the caption", systemImage: "doc.on.doc") }.font(.subheadline)
            }
            if let link = URL(string: p.config["posting"]["links"].s("waChannel")), link.scheme == "https" {
                Link(destination: link) { Label("Open the WhatsApp channel", systemImage: "arrow.up.right.square") }.font(.subheadline)
            }
            if !p.memory.isEmpty {
                Button("Send again from the start") { confirmingAgain = true }.font(.subheadline).disabled(p.busy)
            }
        }
    }

    private func shareAll() async {
        do { share = DesignShareRequest(items: try await p.allSizes(), step: nil) } catch { problem = error.localizedDescription }
    }

    private func shareCaptioned() async {
        do {
            share = DesignShareRequest(items: try await p.captioned(), step: nil)
            p.note = p.wa.isEmpty ? nil : "The caption is on the clipboard: paste it under the picture."
        } catch { problem = error.localizedDescription }
    }
}

/// What the phone's share sheet is handed; `step` is the manual step it completes (Instagram through the share sheet).
struct DesignShareRequest: Identifiable {
    let id = UUID()
    let items: [Any]
    let step: String?
    init(items: [URL], step: String?) {
        self.items = items
        self.step = step
    }
}

#if os(macOS)
extension DesignPublishSheet {
    /// Publish as a Mac sheet (docs/features/mac-design.md): the places as a checkbox list (the website with its collection, each
    /// WhatsApp group and the channel on a row of its own, Instagram, the Meta ad), the captions, When as a pop-up, and the
    /// default button saying what happens ("Publish to 4 Places", or the queue, or the time): it does it, with no second ask.
    fileprivate var macContent: some View {
        let plan = self.plan
        let problems = p.problems(plan)
        return Form {
            macPlacesSection
            if p.waOn || p.postOn { macCaptions }
            if p.metaOn && p.ok("meta-ad") { macMetaWords }
            macWhen
            macProblems(problems + p.wordIssues)
            if plan.steps.contains(where: { (s: DesignPublishModel.Step) in p.state(s).status != .waiting }) { macSteps(plan) }
            macConnections
            macExtras
        }
        .formStyle(.grouped)
        .actionBar(primary: macSendAction(plan, problems), summary: macSummary(plan))
    }

    // MARK: Where it goes

    @ViewBuilder
    private var macPlacesSection: some View {
        Section("Where it goes") {
            if p.row("website") != nil { macWebsite }
            macWhatsApp
            macInstagram("instagram-story", "Instagram Story", bind(\.storyOn))
            macInstagram("instagram-post", "Instagram Post", bind(\.postOn))
            if p.ok("meta-ad") { macPlace("Meta Ad", bind(\.metaOn), dest: "meta-ad", note: metaNote) }
            if p.ok("site-replace") { macPlace("Replace the Photo on the Website", bind(\.replaceOn), dest: "site-replace", note: nil) }
            Toggle("Save the design", isOn: bind(\.saveOn)).toggleStyle(.checkbox)
        }
    }

    private func macNote(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    /// The page a place takes, or the button that makes the one it lacks.
    @ViewBuilder
    private func macPicture(_ dest: String) -> some View {
        let pick = p.pick(dest)
        if let page = pick.page {
            macNote("Uses: \(page.label)")
        } else if let m = p.missing(dest) {
            Button(m.label) { Task { await p.make(m) } }
        }
    }

    @ViewBuilder
    private func macPlace(_ title: String, _ on: Binding<Bool>, dest: String, note: String?) -> some View {
        Toggle(title, isOn: on).toggleStyle(.checkbox)
        if on.wrappedValue {
            macPicture(dest)
            if let note { macNote(note) }
        }
    }

    @ViewBuilder
    private var macWebsite: some View {
        Toggle("Website", isOn: bind(\.websiteOn)).toggleStyle(.checkbox).disabled(!p.ok("website"))
        if let reason = p.row("website")?.reason, !p.ok("website") { macNote(reason) }
        if p.websiteOn && p.ok("website") {
            Picker("Collection", selection: bind(\.folder)) {
                Text("Choose a collection…").tag("")
                ForEach(p.collections) { Text($0.title).tag($0.folder) }
            }
            if p.ok("featured") {
                Toggle("Set of the day on the home page", isOn: bind(\.featured)).toggleStyle(.checkbox)
                if p.featured, let f = WebsiteStore.shared.featured { macNote("It replaces \(f.file) as the set of the day.") }
            }
            if p.isMaison {
                Picker("House", selection: bind(\.house)) {
                    Text("Choose the house…").tag("")
                    ForEach(p.model.catalogue["maisonHouses"].array.map(\.string), id: \.self) { Text($0).tag($0) }
                }
            }
            macSiteName
            macPicture("website")
            if !p.pages.contains(where: { $0.label == DesignSizes.website.label }), let m = p.missing("website") {
                Button("Make the Catalogue Photo (Weight Stamped)") { Task { await p.make(m) } }
            }
        }
    }

    @ViewBuilder
    private var macSiteName: some View {
        let fallback = p.work?.fields["headline"] ?? p.work?.displayName ?? ""
        if p.renaming || p.isMaison {
            TextField(p.isMaison ? "Official name" : "Name on the website", text: bind(\.siteName), prompt: Text(fallback))
            if p.isMaison { macNote("Shown under its house, in 18k, with no gold-rate price.") }
        } else {
            LabeledContent("Named") {
                HStack(spacing: 6) {
                    Text("“\(p.siteName.trimmingCharacters(in: .whitespaces).isEmpty ? fallback : p.siteName)”").lineLimit(1)
                    Button("Change") { p.renaming = true }.buttonStyle(.link)
                }
            }
        }
    }

    @ViewBuilder
    private var macWhatsApp: some View {
        let wa = p.row("whatsapp"), ch = p.row("channel")
        let targets: [DesignPublishModel.Target] = (wa?.available == true ? (wa?.targets ?? []) : []) + (ch?.available == true ? (ch?.targets ?? []) : [])
        if wa != nil || ch != nil {
            if targets.isEmpty { macNote(wa?.reason ?? ch?.reason ?? "This shop has no WhatsApp community set.") }
            ForEach(targets, id: \.key) { (t: DesignPublishModel.Target) in
                Toggle("WhatsApp · " + t.label + (t.key == "channel" ? " (channel)" : ""), isOn: macGroup(t.key)).toggleStyle(.checkbox)
            }
            if !p.whatsappChoice.isEmpty { macPicture(p.whatsappChoice.contains { $0 != "channel" } ? "whatsapp" : "channel") }
        }
    }

    /// One WhatsApp place on or off. The first one ticked starts the choice afresh, so places left over from an earlier visit
    /// do not come along unseen.
    private func macGroup(_ key: String) -> Binding<Bool> {
        Binding(
            get: { p.waOn && p.waKeys.contains(key) },
            set: { (on: Bool) in
                if on {
                    if !p.waOn { p.waKeys = [key]; p.waOn = true }
                    else if !p.waKeys.contains(key) { p.waKeys.append(key) }
                } else {
                    p.waKeys.removeAll { $0 == key }
                    if p.waKeys.isEmpty { p.waOn = false }
                }
            }
        )
    }

    @ViewBuilder
    private func macInstagram(_ id: String, _ title: String, _ on: Binding<Bool>) -> some View {
        let r = p.row(id)
        let byHand = p.igMode(id) == "share"
        Toggle(title + (byHand ? " (saved, then posted by hand)" : ""), isOn: on).toggleStyle(.checkbox)
        if let reason = r?.reason { macNote(reason) }
        if on.wrappedValue {
            macPicture(id)
            if r?.connectable == true {
                Button("Connect Instagram") { Task { if let url = await p.connectInstagram() { openURL(url) } } }
            }
        }
    }

    // MARK: Words and timing

    private var macCaptions: some View {
        Section("Captions") {
            Button {
                Task { await p.writeCaptions() }
            } label: {
                HStack(spacing: 6) {
                    if p.aiBusy { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                    Text("Write with AI")
                }
            }
            .disabled(p.aiBusy)
            if p.waOn { macCaption("WhatsApp caption", bind(\.wa)) }
            if p.postOn { macCaption("Instagram caption", bind(\.ig)) }
        }
    }

    private var macMetaWords: some View {
        Section("Meta ad words") {
            macCaption("Ad headline", bind(\.adHeadline), lines: 1...2)
            macCaption("Ad primary text", bind(\.adText))
        }
    }

    private func macCaption(_ label: String, _ text: Binding<String>, lines: ClosedRange<Int> = 3...8) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(label, text: text, axis: .vertical).labelsHidden().lineLimit(lines).textFieldStyle(.roundedBorder)
        }
    }

    private var macWhen: some View {
        Section("When") {
            Picker("When", selection: bind(\.when)) {
                Text("Now").tag("now")
                Text("Hold in the Queue").tag("hold")
                Text("Schedule at…").tag("schedule")
            }
            if p.when == "schedule" { DatePicker("Send at", selection: bind(\.due), in: Date()...) }
            if p.queued && p.postOn { macNote("The queue carries the website, WhatsApp and the story; the Instagram post goes out now, not from the queue.") }
        }
    }

    @ViewBuilder
    private func macProblems(_ list: [String]) -> some View {
        if !list.isEmpty {
            Section {
                ForEach(list, id: \.self) { Label($0, systemImage: "exclamationmark.circle").foregroundStyle(Tone.problem.color) }
            }
        }
    }

    // MARK: The button

    /// How many places are left to go: each once, however many photographs go to it; the design's own save is not a place.
    private func macPlaceCount(_ plan: DesignPublishModel.Plan) -> Int {
        var n = plan.steps.filter { (s: DesignPublishModel.Step) in s.after.isEmpty && s.dest != "save" && s.dest != "queue" && p.ref(s.id) == nil }.count
        if plan.steps.contains(where: { (s: DesignPublishModel.Step) in s.dest == "queue" && p.ref(s.id) == nil }) {
            if p.websiteOK { n += 1 }
            n += p.whatsappChoice.count
            if p.storyOn && p.igMode("instagram-story") == "api" { n += 1 }
        }
        return n
    }

    private func macSendLabel(_ plan: DesignPublishModel.Plan) -> String {
        let n = macPlaceCount(plan)
        guard n > 0 else { return "Publish" }
        let places = "\(n) \(n == 1 ? "Place" : "Places")"
        switch p.when {
        case "hold": return "Hold \(places) in the Queue"
        case "schedule": return "Schedule \(places) for \(ShopDate.stamp(p.due, withTime: true))"
        default: return "Publish to \(places)"
        }
    }

    private func macSendAction(_ plan: DesignPublishModel.Plan, _ problems: [String]) -> ActionBar.Action {
        let allDone = !plan.steps.isEmpty && plan.steps.allSatisfy { (s: DesignPublishModel.Step) in p.ref(s.id) != nil }
        return .init(macSendLabel(plan), systemImage: "paperplane", isBusy: p.busy,
                     isDisabled: !problems.isEmpty || !p.wordIssues.isEmpty || plan.steps.isEmpty || allDone) {
            Task {
                await p.checkWords()
                guard problems.isEmpty, p.wordIssues.isEmpty else { return }
                startRun()
            }
        }
    }

    /// What a post that cannot be taken back needs said beside the button: the whole community, a check that is failing.
    private func macSummary(_ plan: DesignPublishModel.Plan) -> String? {
        let groups = p.failingGroups(plan)
        let risky = !p.whatsappChoice.isEmpty || (p.igMode("instagram-story") == "api" && p.storyOn) || (p.igMode("instagram-post") == "api" && p.postOn) || !groups.isEmpty
        return risky ? confirmMessage : nil
    }

    // MARK: What went

    private func macSteps(_ plan: DesignPublishModel.Plan) -> some View {
        Section("What goes") {
            ForEach(plan.steps, id: \.id) { (s: DesignPublishModel.Step) in macStep(s) }
            if plan.steps.contains(where: { (s: DesignPublishModel.Step) in p.state(s).status == .failed }) && !p.busy {
                Button("Retry What Failed") { Task { await p.run() } }
            }
        }
    }

    private func macStep(_ s: DesignPublishModel.Step) -> some View {
        let st = p.state(s)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            macIcon(st.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.label)
                if let e = st.error { Text(e).font(.caption).foregroundStyle(Tone.problem.color) }
            }
            Spacer(minLength: 8)
            if st.status == .failed { Button("Retry") { Task { await p.run(only: s.id) } }.disabled(p.busy) }
            if s.manual && st.status == .manual {
                Button("Show in Finder") { Task { await macReveal(s) } }
                Button("Posted") { p.markDone(s.id, "by hand") }
            }
        }
    }

    @ViewBuilder
    private func macIcon(_ s: DesignPublishModel.Status) -> some View {
        switch s {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Tone.settled.color)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(Tone.problem.color)
        case .running: ProgressView().controlSize(.small)
        case .manual: Image(systemName: "hand.point.up.left").foregroundStyle(Tone.owed.color)
        case .waiting: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }

    /// A story or post that is posted by hand: the picture saved and shown in the Finder (its caption is on the clipboard).
    private func macReveal(_ s: DesignPublishModel.Step) async {
        do {
            let url = try await p.shareFile(s)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch { problem = error.localizedDescription }
    }

    // MARK: Connections and the rest

    private var macConnections: some View {
        let failing = p.checks.filter { $0.s("status") == "fail" }
        return Section("Connections") {
            if p.healthLoading && p.checks.isEmpty {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Checking the connections").foregroundStyle(.secondary) }
            } else if let f = p.healthFailed {
                Text(f).foregroundStyle(Tone.owed.color)
            } else if failing.isEmpty {
                Label("Every connection is fine", systemImage: "checkmark.circle").foregroundStyle(Tone.settled.color)
            } else {
                ForEach(failing, id: \.text) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(c.s("label"), systemImage: "xmark.circle").foregroundStyle(Tone.problem.color)
                        if !c.s("fix").isEmpty { macNote(c.s("fix")) }
                    }
                }
            }
            Button("Check Again") { Task { await p.refreshHealth() } }.disabled(p.healthLoading)
        }
    }

    private var macExtras: some View {
        Section {
            if let path = p.metaPath ?? p.ref("meta-ad") {
                Button("Open the New Ad") { p.model.route = Route(path: path); dismiss() }
            }
            if let n = p.note { macNote(n) }
            Button("Export Every Size…") { Task { await macExportAll() } }
            if p.row("whatsapp") != nil || p.row("channel") != nil {
                Button("Show the WhatsApp Picture in Finder") { Task { await macRevealCaptioned() } }
            }
            if !p.wa.trimmingCharacters(in: .whitespaces).isEmpty {
                Button("Copy the Caption") { MacClipboard.copy(p.wa); p.model.say("The caption is copied") }
            }
            if let link = URL(string: p.config["posting"]["links"].s("waChannel")), link.scheme == "https" {
                Link("Open the WhatsApp Channel", destination: link)
            }
            if !p.memory.isEmpty {
                Button("Send Again from the Start…") { confirmingAgain = true }.disabled(p.busy)
            }
        }
    }

    /// Every size as a picture in a folder the person chooses.
    private func macExportAll() async {
        do {
            let urls = try await p.allSizes()
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.canCreateDirectories = true
            panel.prompt = "Export"
            panel.message = "Choose where to save every size."
            guard panel.runModal() == .OK, let folder = panel.url else { return }
            for u in urls {
                let to = folder.appendingPathComponent(u.lastPathComponent)
                try? FileManager.default.removeItem(at: to)
                try FileManager.default.copyItem(at: u, to: to)
            }
            p.model.say("Exported \(urls.count) size\(urls.count == 1 ? "" : "s")", detail: folder.lastPathComponent)
        } catch { problem = error.localizedDescription }
    }

    /// The WhatsApp picture saved and shown in the Finder; its caption is on the clipboard (WhatsApp often drops text sent with a file).
    private func macRevealCaptioned() async {
        do {
            let urls = try await p.captioned()
            NSWorkspace.shared.activateFileViewerSelecting(urls)
            p.note = p.wa.isEmpty ? nil : "The caption is on the clipboard: paste it under the picture."
        } catch { problem = error.localizedDescription }
    }
}
#endif
