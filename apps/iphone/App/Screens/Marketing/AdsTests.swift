import SwiftUI
import ERPCore

/// Ads → A/B tests (src/app/ads/tests/page.tsx): Meta's split test. Two to five ad sets run against each other with
/// their audiences kept apart, so the difference in cost per result is the ad sets' own. Made here on the web's
/// route (/api/ads/tests, which checks the test with study.ts and says what stops it); each side's spend, results,
/// cost per result and ROAS so far read here; Meta's verdict, with how sure it is, stays in Ads Manager.
struct AdsTestsScreen: View {
    @Environment(Session.self) private var session

    @State private var status: AdsStatusAnswer?
    @State private var data: AdsTestsAnswer?
    @State private var problem: String?
    @State private var loadProblem: String?
    @State private var name = ""
    @State private var picked: [String] = []
    @State private var search = ""
    @State private var start = Date().addingTimeInterval(15 * 60)
    @State private var end = Date().addingTimeInterval(7 * 86_400)
    @State private var purchases = false
    @State private var asking = false
    @State private var making = false
    @State private var failure: String?
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        Group {
            if !mayUse {
                AdsOwnersOnly()
            } else if let status, status.ready {
                content(status)
            } else {
                AdsNotReady(status: status, problem: problem, retry: { await load(fresh: true) })
            }
        }
        .navigationTitle("A/B tests")
        .navigationBarTitleDisplayMode(.inline)
        .task { if mayUse && status == nil { await load() } }
        .confirmationDialog("Start “\(name.trimmingCharacters(in: .whitespaces))”?", isPresented: $asking, titleVisibility: .visible) {
            Button("Start the test") { Task { await make() } }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("\(picked.count) ad sets, an even split, \(ShopDate.stamp(start, withTime: true)) to \(ShopDate.stamp(end, withTime: true)). Meta keeps the people who see each one apart; the ad sets spend their own budgets as before.")
        }
        .failureAlert($failure, title: "Meta didn't take that")
        .noteToast($note)
    }

    // MARK: Asking the ERP

    private func load(fresh: Bool = false) async {
        do {
            let s = try await AdsAPI.status(fresh: fresh)
            status = s
            problem = nil
            if s.ready { await loadTests() }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func loadTests() async {
        do {
            data = try await ERPAPI.shared.get("/api/ads/tests", as: AdsTestsAnswer.self)
            loadProblem = nil
        } catch {
            loadProblem = error.localizedDescription
        }
    }

    private func make() async {
        making = true
        defer { making = false }
        do {
            let body: [String: Any] = [
                "name": name.trimmingCharacters(in: .whitespaces), "adsetIds": picked,
                "start": start.ISO8601Format(), "end": end.ISO8601Format(), "purchases": purchases,
            ]
            _ = try await ERPAPI.shared.send("/api/ads/tests", body)
            name = ""
            picked = []
            Note.show(Note(title: "Test started"), in: $note, reduce: reduceMotion)
            await loadTests()
        } catch {
            failure = error.localizedDescription
        }
    }

    // MARK: The page

    private func content(_ s: AdsStatusAnswer) -> some View {
        #if os(macOS)
        macContent(s)
        #else
        phoneContent(s)
        #endif
    }

    private func phoneContent(_ s: AdsStatusAnswer) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                if let loadProblem {
                    Section {
                        Label(loadProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                        Button("Try again") { Task { await loadTests() } }
                    }
                }
                newSection
                testsSection(s)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
        .refreshable { await loadTests() }
    }

    private var shownAdsets: [AdsTestAdset] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        return (data?.adsets ?? []).filter { (a: AdsTestAdset) in
            words.allSatisfy { (w: String) in "\(a.name) \(a.campaign)".lowercased().contains(w) }
        }
    }

    private func toggle(_ id: String) {
        if let i = picked.firstIndex(of: id) { picked.remove(at: i) } else if picked.count < 5 { picked.append(id) }
    }

    private var newSection: some View {
        Section {
            TextField("Name, like “Packshot vs on-hand”", text: $name)
            TextField("Find an ad set", text: $search)
            if let data {
                ForEach(shownAdsets.prefix(40)) { (a: AdsTestAdset) in
                    Button { toggle(a.id) } label: {
                        HStack(spacing: pt(10)) {
                            let i = picked.firstIndex(of: a.id)
                            ZStack {
                                Circle().strokeBorder(i == nil ? Color.secondary.opacity(0.5) : Theme.accent, lineWidth: 1.5)
                                if let i { Text(["A", "B", "C", "D", "E"][min(i, 4)]).font(.caption.weight(.bold)).foregroundStyle(Theme.accent) }
                            }
                            .frame(width: 26, height: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.name).foregroundStyle(.primary)
                                Text("\(a.campaign) · \(a.status.lowercased().replacingOccurrences(of: "_", with: " "))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if data.adsets.isEmpty { Text("No ad sets to compare yet.").foregroundStyle(.secondary) }
            } else if loadProblem == nil {
                MarketingReading(text: "Reading the ad sets…")
            }
            DatePicker("Starts", selection: $start, in: Date()..., displayedComponents: [.date, .hourAndMinute])
            DatePicker("Ends", selection: $end, in: start..., displayedComponents: [.date, .hourAndMinute])
            Toggle("Judge on website purchases", isOn: $purchases).tint(Theme.accent)
            Button { asking = true } label: {
                HStack(spacing: pt(8)) {
                    if making { SkeletonLoading() }
                    Text("Start the test").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(making || picked.count < 2 || name.trimmingCharacters(in: .whitespaces).isEmpty)
            .listRowBackground(Color.clear)
        } header: {
            LedgerHeading(title: "A new test")
        } footer: {
            Text("Make the versions in Ad sets first (copy one, change one thing), then choose two to five. Off: each ad set is judged on its own result.")
        }
    }

    @ViewBuilder
    private func testsSection(_ s: AdsStatusAnswer) -> some View {
        let cur = data?.currency ?? "PKR"
        Section {
            if let data {
                if data.tests.isEmpty { Text("None yet.").foregroundStyle(.secondary) }
                ForEach(data.tests) { (t: AdsTest) in testCard(t, cur) }
            }
            if let act = s.settings?.adAccountId, let url = URL(string: "https://adsmanager.facebook.com/adsmanager/manage/experiments?act=\(act.replacingOccurrences(of: "act_", with: ""))") {
                Link(destination: url) { Label("Meta's verdict, in Ads Manager", systemImage: "arrow.up.right.square") }
            }
        } header: {
            LedgerHeading(title: "Tests")
        }
    }

    private func testCard(_ t: AdsTest, _ cur: String) -> some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            Text(t.name).font(.headline)
            // Running is the expected state: only the dates.
            Text("\(ShopDate.say(t.start)) to \(ShopDate.say(t.end))").font(.caption).foregroundStyle(.secondary)
            ForEach(t.cells) { (c: AdsTestCell) in
                VStack(alignment: .leading, spacing: pt(4)) {
                    HStack(spacing: pt(4)) {
                        Text(c.name).font(.subheadline.weight(.semibold))
                        if t.ahead == c.name { Image(systemName: "trophy.fill").font(.caption).foregroundStyle(Tone.owed.color) }
                        Text(c.adsets.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    FigureRow(spacing: pt(8)) {
                        FigureTile(label: "Spent", value: AdsFormat.money(c.spend, cur))
                        FigureTile(label: c.resultLabel, value: AdsFormat.count(c.result))
                        FigureTile(label: "Each", value: c.costPerResult.map { (v: Double) in AdsFormat.money(v, cur) } ?? "—")
                        FigureTile(label: "ROAS", value: AdsResults.roasText(c.roas))
                    }
                }
            }
            if let ahead = t.ahead {
                Text("\(ahead) is ahead on cost per result so far. Give it the full run before deciding; Meta's verdict says how sure it is.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, pt(6))
    }
}

// MARK: The answers

struct AdsTestAdset: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let campaign: String
    let status: String
    private enum K: String, CodingKey { case id, name, campaign, status }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        campaign = c.string(.campaign, default: "")
        status = c.string(.status, default: "")
    }
}

struct AdsTestCell: Decodable, Identifiable, Hashable {
    let name: String
    let adsets: [String]
    let spend: Double
    let result: Double
    let resultLabel: String
    let costPerResult: Double?
    let roas: Double?
    var id: String { name }

    private enum K: String, CodingKey { case name, adsets, spend, result, resultLabel, costPerResult, roas }
    private struct Named: Decodable {
        let name: String
        private enum K: String, CodingKey { case name }
        init(from decoder: Decoder) throws { name = (try? decoder.container(keyedBy: K.self))?.string(.name, default: "") ?? "" }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        name = c.string(.name, default: "")
        adsets = c.list(.adsets, of: Named.self).map(\.name)
        spend = c.double(.spend, default: 0)
        result = c.double(.result, default: 0)
        resultLabel = c.string(.resultLabel, default: "Results")
        costPerResult = c.double(.costPerResult)
        roas = c.double(.roas)
    }
}

struct AdsTest: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let start: String?
    let end: String?
    let running: Bool
    let cells: [AdsTestCell]
    let ahead: String?

    private enum K: String, CodingKey { case id, name, start, end, running, cells, ahead }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        start = c.string(.start)
        end = c.string(.end)
        running = c.bool(.running) ?? false
        cells = c.list(.cells, of: AdsTestCell.self)
        ahead = c.string(.ahead)
    }
}

struct AdsTestsAnswer: Decodable {
    let currency: String
    let tests: [AdsTest]
    let adsets: [AdsTestAdset]
    private enum K: String, CodingKey { case currency, tests, adsets }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        currency = c.string(.currency, default: "PKR")
        tests = c.list(.tests, of: AdsTest.self).filter { (t: AdsTest) in !t.id.isEmpty }
        adsets = c.list(.adsets, of: AdsTestAdset.self).filter { (a: AdsTestAdset) in !a.id.isEmpty }
    }
}

#if os(macOS)
extension AdsTestsScreen {
    /// Making a test (the ad sets to split) on the left; the tests so far with their sides on the right.
    func macContent(_ s: AdsStatusAnswer) -> some View {
        MacTwoPane(sideWidth: 460) {
            List {
                Group {
                    AdsAlertsSection(status: s)
                    if let loadProblem {
                        Section {
                            Label(loadProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                            Button("Try again") { Task { await loadTests() } }
                        }
                    }
                    newSection
                }
                .houseRows()
            }
            .listStyle(.inset)
        } main: {
            List {
                Group { testsSection(s) }.houseRows()
            }
            .listStyle(.inset)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await loadTests() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r", modifiers: .command)
                    .help("Read the tests again")
            }
        }
    }
}
#endif
