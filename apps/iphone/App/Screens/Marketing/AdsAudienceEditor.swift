import SwiftUI
import ERPCore

/// Who an ad is shown to (src/app/ads/audience-editor.tsx), as a sheet: places (with a radius around a city),
/// ages, gender, interests, the house's own audiences in or out, Advantage+ audience, and where on Instagram,
/// with Meta's estimate of how many people that is, asked again a moment after each change. Used by New ad and
/// by each ad set of the designer; every search and the estimate are the web's own routes. "Around this phone"
/// is left out: the app does not ask for the phone's location.
struct AdsAudienceSheet: View {
    let title: String
    /// The optimisation goal the estimate is asked for ("CONVERSATIONS").
    let goal: String
    let positions: [AdsChoice]
    let done: (AdsAudience) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: AdsAudience
    @State private var estimate: AdsEstimate?
    @State private var estimating = false
    @State private var placeQ = ""
    @State private var placeHits: [AdsPlace]?
    @State private var interestQ = ""
    @State private var interestHits: [AdsInterestHit]?
    @State private var audiences: [AdsAudienceRow]?
    @State private var showAudiences: Bool

    init(title: String, draft: AdsAudience, goal: String, positions: [AdsChoice], done: @escaping (AdsAudience) -> Void) {
        self.title = title
        self.goal = goal
        self.positions = positions.isEmpty ? AdsChoice.instagramPlaces : positions
        self.done = done
        _draft = State(initialValue: draft)
        _showAudiences = State(initialValue: !draft.include.isEmpty || !draft.exclude.isEmpty)
    }

    private static let cityShortcuts = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Hyderabad, Sindh", "Dubai"]
    private static let interestShortcuts = ["Jewellery", "Gold", "Diamonds", "Engagement ring", "Wedding", "Luxury goods", "Bridal"]

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    estimateSection
                    placesSection
                    whoSection
                    interestsSection
                    audiencesSection
                    advantageSection
                    placementsSection
                }
                .houseRows()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        done(draft)
                        dismiss()
                    }
                    .disabled(draft.places.isEmpty)
                }
            }
            .modifier(AdsAudienceLookups(draft: draft, placeQ: placeQ, interestQ: interestQ,
                                         estimateAgain: estimateAgain, searchPlaces: searchPlaces, searchInterests: searchInterests))
            .task { if showAudiences { await loadAudiences() } }
        }
    }

    // MARK: The estimate

    private var estimateSection: some View {
        Section {
            HStack(spacing: 10) {
                Image(systemName: "person.2").foregroundStyle(.secondary)
                if let e = estimate, let upper = e.upper, upper > 0 {
                    Text("About \(AdsFormat.compact(e.lower ?? 0))–\(AdsFormat.compact(upper)) people").monospacedDigit()
                } else if estimating {
                    Text("Estimating the audience…").foregroundStyle(.secondary)
                } else {
                    Text("Meta gave no estimate for this audience.").foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if estimating && estimate != nil { SkeletonLoading() }
            }
        } footer: {
            Text(draft.words)
        }
    }

    private func estimateAgain() async {
        guard !draft.places.isEmpty else { return }
        do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
        estimating = true
        let e = try? await AdsAPI.estimate(draft, goal: goal)
        if Task.isCancelled { return }
        estimate = e
        estimating = false
    }

    // MARK: Where

    private var placesSection: some View {
        Section {
            ForEach(draft.places) { (p: AdsPlace) in placeRow(p) }
            if draft.places.isEmpty {
                Text("Choose at least one place.").foregroundStyle(.red)
            }
            TextField("A city, area or country", text: $placeQ)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
            placeHitRows
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.cityShortcuts, id: \.self) { (c: String) in
                        Button("+ \(c.components(separatedBy: ",")[0])") { Task { await shortcut(c) } }
                            .buttonStyle(.glass)
                    }
                    Button("+ All Pakistan") { add(AdsPlace.pakistan) }.buttonStyle(.glass)
                }
            }
        } header: {
            LedgerHeading(title: "Where")
        } footer: {
            Text("People who live in, or were recently in, these places. A city takes the people around it too.")
        }
    }

    @ViewBuilder
    private var placeHitRows: some View {
        if let hits = placeHits, !placeQ.trimmingCharacters(in: .whitespaces).isEmpty {
            if hits.isEmpty {
                Text("Nothing by that name.").foregroundStyle(.secondary)
            }
            ForEach(hits) { (h: AdsPlace) in
                Button { add(h) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(h.name).foregroundStyle(.primary)
                        Text([h.detail ?? "", h.type].filter { (s: String) in !s.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func placeRow(_ p: AdsPlace) -> some View {
        HStack(spacing: 10) {
            Image(systemName: p.type == "pin" ? "mappin.and.ellipse" : "mappin").foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name)
                if let d = p.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            if p.type == "city" || p.type == "pin" { radiusMenu(p) }
            Button { remove(p) } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove \(p.name)")
        }
    }

    /// Meta's limits: a city's radius 17–80 km, a pin's 1–80 km (targeting.ts cityRadius, pinRadius).
    private func radiusMenu(_ p: AdsPlace) -> some View {
        let options: [Int] = p.type == "pin" ? [1, 2, 3, 5, 8, 10, 15, 25, 40] : [17, 25, 40, 60, 80]
        let now = Int((p.radiusKm ?? 0).rounded())
        return Menu {
            if p.type == "city" {
                Button("City only") { setRadius(p, nil) }
            }
            ForEach(options, id: \.self) { (k: Int) in
                Button("+\(k) km") { setRadius(p, Double(k)) }
            }
        } label: {
            Text(now > 0 ? "+\(now) km" : "City only").font(.subheadline)
        }
    }

    private func add(_ p: AdsPlace) {
        var place = p
        if place.type == "city" && place.radiusKm == nil { place.radiusKm = 25 }
        let lone = draft.places.count == 1
        // A country covers its cities: picking a city replaces a lone "Pakistan".
        let rest = draft.places.filter { (x: AdsPlace) in
            x.id != place.id && !(place.type != "country" && x.type == "country" && lone)
        }
        draft.places = rest + [place]
        placeQ = ""
        placeHits = nil
    }

    private func remove(_ p: AdsPlace) {
        draft.places.removeAll { (x: AdsPlace) in x.id == p.id }
    }

    private func setRadius(_ p: AdsPlace, _ km: Double?) {
        guard let i = draft.places.firstIndex(where: { (x: AdsPlace) in x.id == p.id }) else { return }
        draft.places[i].radiusKm = km
    }

    private func shortcut(_ name: String) async {
        guard let hits = try? await AdsAPI.places(name) else { return }
        if let hit = hits.first(where: { (h: AdsPlace) in h.type == "city" }) ?? hits.first { add(hit) }
    }

    private func searchPlaces() async {
        let q = placeQ.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            placeHits = nil
            return
        }
        do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
        let hits = (try? await AdsAPI.places(q)) ?? []
        if Task.isCancelled { return }
        placeHits = hits
    }

    // MARK: Ages and who

    private var ageFrom: Binding<Int> {
        Binding(get: { draft.ageMin }, set: { (v: Int) in
            draft.ageMin = v
            if draft.ageMax < v { draft.ageMax = v }
        })
    }

    private var whoSection: some View {
        Section {
            Picker("From age", selection: ageFrom) {
                ForEach(Array(18...65), id: \.self) { (a: Int) in Text("\(a)").tag(a) }
            }
            Picker("To age", selection: $draft.ageMax) {
                ForEach(Array(draft.ageMin...65), id: \.self) { (a: Int) in Text(a == 65 ? "65+" : "\(a)").tag(a) }
            }
            Picker("Who", selection: $draft.gender) {
                Text("Everyone").tag("all")
                Text("Women").tag("women")
                Text("Men").tag("men")
            }
            .pickerStyle(.segmented)
        } header: {
            LedgerHeading(title: "Ages and who")
        }
    }

    // MARK: Interests

    private var interestsSection: some View {
        Section {
            ForEach(draft.interests) { (i: AdsNamed) in
                HStack {
                    Text(i.name)
                    Spacer(minLength: 8)
                    Button { draft.interests.removeAll { (x: AdsNamed) in x.id == i.id } } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove \(i.name)")
                }
            }
            TextField("Jewellery, gold, weddings…", text: $interestQ)
                .autocorrectionDisabled()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.interestShortcuts, id: \.self) { (s: String) in
                        Button(s) { interestQ = s }.buttonStyle(.glass)
                    }
                    if !draft.interests.isEmpty {
                        Button { Task { await suggest() } } label: { Label("More like these", systemImage: "sparkles") }
                            .buttonStyle(.glass)
                    }
                }
            }
            interestHitRows
        } header: {
            LedgerHeading(title: "Interests")
        } footer: {
            Text(draft.interests.isEmpty ? "None: Meta finds the people itself (often the cheapest)." : "Shown to people with any of these interests.")
        }
    }

    @ViewBuilder
    private var interestHitRows: some View {
        if let hits = interestHits {
            if hits.isEmpty {
                Text("Nothing found.").foregroundStyle(.secondary)
            }
            ForEach(hits) { (h: AdsInterestHit) in
                let on = draft.interests.contains { (x: AdsNamed) in x.id == h.id }
                Button {
                    if !on { draft.interests.append(AdsNamed(id: h.id, name: h.name)) }
                } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.name).foregroundStyle(.primary)
                            if let path = h.path, !path.isEmpty { Text(path).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        Spacer(minLength: 8)
                        if let size = h.size { Text(AdsFormat.compact(size)).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                        Image(systemName: on ? "checkmark" : "plus.circle").foregroundStyle(Theme.accent)
                    }
                }
                .disabled(on)
            }
        }
    }

    private func searchInterests() async {
        let q = interestQ.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            interestHits = nil
            return
        }
        do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
        let hits = (try? await AdsAPI.interests(q)) ?? []
        if Task.isCancelled { return }
        interestHits = hits
    }

    private func suggest() async {
        let names = draft.interests.map { (i: AdsNamed) in i.name }
        interestHits = (try? await AdsAPI.suggestions(names)) ?? []
    }

    // MARK: The house's audiences

    @ViewBuilder
    private var audiencesSection: some View {
        Section {
            if !showAudiences {
                Button("Include or leave out customers, Instagram engagers, lookalikes…") {
                    showAudiences = true
                    Task { await loadAudiences() }
                }
            } else if let list = audiences {
                if list.isEmpty {
                    Text("None yet: make them on Audiences.").foregroundStyle(.secondary)
                }
                ForEach(list) { (a: AdsAudienceRow) in audienceRow(a) }
            } else {
                MarketingReading(text: "Reading the audiences…")
            }
        } header: {
            LedgerHeading(title: "The shop's audiences")
        }
    }

    private func loadAudiences() async {
        guard audiences == nil else { return }
        audiences = (try? await AdsAPI.audiences().audiences) ?? []
    }

    private func audienceRow(_ a: AdsAudienceRow) -> some View {
        let bits = [a.kind, a.sizeWords ?? "", a.ready ? "" : "not ready"].filter { (s: String) in !s.isEmpty }
        return VStack(alignment: .leading, spacing: 6) {
            Text(a.name)
            Text(bits.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            Picker("Use", selection: use(a)) {
                Text("Not used").tag("off")
                Text("Reach").tag("include")
                Text("Leave out").tag("exclude")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    private func use(_ a: AdsAudienceRow) -> Binding<String> {
        Binding(get: {
            if draft.include.contains(where: { (x: AdsNamed) in x.id == a.id }) { return "include" }
            if draft.exclude.contains(where: { (x: AdsNamed) in x.id == a.id }) { return "exclude" }
            return "off"
        }, set: { (v: String) in
            draft.include.removeAll { (x: AdsNamed) in x.id == a.id }
            draft.exclude.removeAll { (x: AdsNamed) in x.id == a.id }
            let n = AdsNamed(id: a.id, name: a.name)
            if v == "include" { draft.include.append(n) } else if v == "exclude" { draft.exclude.append(n) }
        })
    }

    // MARK: Advantage+ and placements

    private var advantageSection: some View {
        Section {
            Toggle("Advantage+ audience", isOn: $draft.advantage).tint(Theme.accent)
        } footer: {
            Text(draft.advantage
                 ? "On: the ages, gender, interests and audiences above are Meta's starting point, and it goes beyond them when it finds better people. Places and \"leave out\" stay firm; nobody under 25 is shown it unless allowed above."
                 : "Off: the ages, gender and interests above are strict limits.")
        }
    }

    private func positionOn(_ key: String) -> Binding<Bool> {
        Binding(get: { draft.igPositions.contains(key) }, set: { (on: Bool) in
            if on {
                if !draft.igPositions.contains(key) { draft.igPositions.append(key) }
            } else {
                draft.igPositions.removeAll { (x: String) in x == key }
            }
        })
    }

    private var placementsSection: some View {
        Section {
            Picker("Where it appears", selection: $draft.placements) {
                Text("Instagram only").tag("instagram")
                Text("Instagram + Facebook").tag("instagram_facebook")
                Text("Everywhere (Meta decides)").tag("auto")
            }
            if draft.placements != "auto" {
                ForEach(positions) { (p: AdsChoice) in
                    Toggle(p.label, isOn: positionOn(p.key)).tint(Theme.accent)
                }
            }
        } header: {
            LedgerHeading(title: "Where it appears")
        } footer: {
            if draft.placements != "auto" && draft.igPositions.isEmpty {
                Text("None chosen: Meta uses the feed, stories and reels.")
            }
        }
    }
}

/// The sheet's lookups, each a moment after the last change: Meta's estimate and the two searches. Its own
/// modifier so the sheet's chain stays short for the compiler.
private struct AdsAudienceLookups: ViewModifier {
    let draft: AdsAudience
    let placeQ: String
    let interestQ: String
    let estimateAgain: () async -> Void
    let searchPlaces: () async -> Void
    let searchInterests: () async -> Void

    func body(content: Content) -> some View {
        content
            .task(id: draft) { await estimateAgain() }
            .task(id: placeQ) { await searchPlaces() }
            .task(id: interestQ) { await searchInterests() }
    }
}
