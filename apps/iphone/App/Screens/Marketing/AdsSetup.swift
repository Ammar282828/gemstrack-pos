import SwiftUI
import ERPCore

/// Ads → Setup (src/app/ads/setup/page.tsx): what still stands between the shop and running every kind of ad,
/// then each step checked live: the Meta app (what its Live switch asks for, the login configuration), the app
/// secret, the Facebook connection, and which ad account, Instagram account and Page this house advertises from,
/// the chat greeting and the website pixel, each chosen with the web's own route (/api/ads/setup, /api/ads/pixel).
///
/// Connecting is the one step done in Safari: Facebook's login comes back to the ERP in the browser that started
/// it (a cookie keeps a connection nobody started from being finished), so the phone opens Setup there. The long
/// one-time steps in Meta's app dashboard are read on the ERP's own page. Nothing here spends money.
struct AdsSetupScreen: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    @State private var status: AdsStatusAnswer?
    @State private var assets: AdsSetupAssets?
    @State private var assetsProblem: String?
    @State private var pixel: AdsPixelAnswer?
    @State private var pixelProblem: String?
    @State private var problem: String?
    @State private var loading = false
    @State private var busy: String?
    @State private var greeting = ""
    @State private var configId = ""
    @State private var pixelName = "Website"
    @State private var confirmOff = false
    @State private var confirmPixel = false
    @State private var failure: String?

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        dialogs(page)
    }

    private var page: some View {
        Group {
            if !mayUse {
                AdsOwnersOnly()
            } else if let status {
                content(status)
            } else if let problem {
                AdsNotReady(status: nil, problem: problem, retry: load)
            } else {
                ProgressView("Checking…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Setup")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if mayUse && status != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await load() } } label: { Label("Check again", systemImage: "arrow.clockwise") }
                        .disabled(loading)
                }
            }
        }
        .task { if mayUse && status == nil { await load() } }
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog("Disconnect Meta ads?", isPresented: $confirmOff, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { Task { await disconnect() } }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text("The ERP forgets the login. Ads already running keep running; the Ads pages show nothing until it's connected again.")
            }
            .confirmationDialog("Make another pixel?", isPresented: $confirmPixel, titleVisibility: .visible) {
                Button("Make one anyway") { Task { await pixelAct(["action": "create", "name": pixelName], "pixel") } }
                Button("Not now", role: .cancel) {}
            } message: {
                Text("The site already carries pixel \((pixel?.state?.carried ?? []).joined(separator: ", ")). A second pixel splits visits and orders between two.")
            }
            .alert("That didn't work", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: Reading

    private var connected: Bool { status?.connection?.connected == true }
    private var settings: AdsSettingsRow? { assets?.settings ?? status?.settings }
    private var house: String? { status?.houseInstagram }

    private var wrongHouse: Bool {
        guard let house, let ig = settings?.instagramUsername else { return false }
        return ig.lowercased() != house
    }

    /// The ERP's Setup page in Safari, where Facebook's login can come back to the browser that started it.
    private var setupInSafari: URL? { URL(string: "/ads/setup", relativeTo: House.serverURL)?.absoluteURL }

    // MARK: Asking the ERP

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let s = try await AdsAPI.status()
            status = s
            problem = nil
            if let id = s.app?.loginConfigId, configId.isEmpty { configId = id }
            if s.connection?.connected == true {
                await loadAssets()
                if s.settings?.adAccountId != nil { await loadPixel() }
            }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func loadAssets() async {
        do {
            let a = try await AdsAPI.setupAssets()
            assets = a
            greeting = a.settings?.whatsappGreeting ?? ""
            assetsProblem = nil
        } catch {
            assetsProblem = error.localizedDescription
        }
    }

    private func loadPixel() async {
        do {
            pixel = try await AdsAPI.pixel()
            pixelProblem = nil
        } catch {
            pixelProblem = error.localizedDescription
        }
    }

    private func save(_ patch: [String: Any], _ what: String) async {
        busy = what
        defer { busy = nil }
        do {
            _ = try await AdsAPI.saveSetup(patch)
            await load()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func disconnect() async {
        busy = "off"
        defer { busy = nil }
        do {
            try await AdsAPI.disconnect()
            assets = nil
            pixel = nil
            await load()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func pixelAct(_ body: [String: Any], _ what: String) async {
        busy = what
        defer { busy = nil }
        do {
            try await AdsAPI.pixel(body)
            await loadPixel()
            if let s = try? await AdsAPI.status() { status = s }
        } catch {
            failure = "Couldn't change the pixel. \(error.localizedDescription)"
        }
    }

    // MARK: The page

    private func content(_ s: AdsStatusAnswer) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                readinessSection(s)
                Section {
                    MarketingLink(title: "Audiences", subtitle: "The ERP's customers, Instagram engagers, lookalikes", symbol: "person.3", path: "/ads/audiences")
                    MarketingLink(title: "Rules", subtitle: "Meta's automated rules, and every change logged", symbol: "checklist", path: "/ads/rules")
                }
                appSections(s)
                connectSection(s)
                choiceSections(s)
                greetingSection
                pixelSection
            }
            .houseRows()
            .disabled(busy != nil)
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private func stepHeader(_ n: Int, _ title: String, done: Bool?) -> some View {
        let symbol = done == nil ? "circle" : (done == true ? "checkmark.circle.fill" : "xmark.circle.fill")
        let tint: Color = done == nil ? .secondary : (done == true ? .green : .red)
        return HStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text("\(n). \(title)")
        }
    }

    /// What is still wrong, first (readiness.tsx): the app not Live, a login the ERP can't keep, permissions the
    /// login lacks, the website pixel.
    @ViewBuilder
    private func readinessSection(_ s: AdsStatusAnswer) -> some View {
        let lines = readiness(s)
        if !lines.isEmpty {
            Section {
                ForEach(lines, id: \.self) { (l: String) in
                    Label(l, systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(.orange)
                }
            } header: {
                Text("Before every kind of ad can run")
            }
        }
    }

    private func readiness(_ s: AdsStatusAnswer) -> [String] {
        guard s.ready, let app = s.app else { return [] }
        var out: [String] = []
        if let live = app.live, !live.ready {
            out.append("The Meta app is still in Development: new ads from new photos are refused (boosting a post works). Fill the privacy policy, category and icon (step 1), then switch it Live.")
        }
        if !app.tokenStoreWrite {
            out.append("This ERP can't save the Meta login (\(app.tokenSecret)): grant the App Hosting account Secret Version Adder on it. Until then, connect again before each login runs out.")
        }
        let missing = s.connection?.missingScopes ?? []
        if !missing.isEmpty {
            out.append("The Facebook login lacks \(missing.joined(separator: ", ")): add \(missing.count == 1 ? "it" : "them") to the login configuration and connect again.")
        }
        if let px = pixel?.state, !px.live, !px.sites.isEmpty {
            let carried = px.carried
            if px.id != nil {
                out.append("The website pixel hasn't fired this week: the site isn't loading it yet.")
            } else if !carried.isEmpty {
                out.append("The shop's site already carries a Meta pixel (\(carried.joined(separator: ", "))) but ads don't use it yet: choose it in step 8.")
            } else {
                out.append("No website pixel: website ads buy clicks only, and visitors can't be retargeted.")
            }
        }
        return out
    }

    // MARK: Steps 1 and 2: the Meta app and its secret

    @ViewBuilder
    private func appSections(_ s: AdsStatusAnswer) -> some View {
        if let app = s.app {
            Section {
                if let id = app.id {
                    LabeledContent("App", value: id)
                } else {
                    Text("No Meta app is set for this shop (META_APP_ID in apphosting.yaml).").foregroundStyle(.red)
                }
                liveRow("Privacy policy URL", ok: app.live?.privacyPolicyUrl != nil, known: app.live != nil,
                        now: app.live?.privacyPolicyUrl, give: app.privacyPage)
                liveRow("Data deletion instructions URL", ok: false, known: false, now: nil, give: app.deletionPage)
                liveRow("Category", ok: app.live?.category != nil, known: app.live != nil, now: app.live?.category, give: "Business and pages")
                liveRow("App icon (1024 × 1024)", ok: app.live?.icon == true, known: app.live != nil, now: nil, give: "\(House.serverURL.absoluteString)/brand/meta-app-icon-1024.png")
                configRow(app)
                MarketingLink(title: "The one-time steps in Meta's dashboard", subtitle: "Products, domains, redirect addresses, the login configuration",
                              symbol: "list.number", path: "/ads/setup?web=1")
            } header: {
                stepHeader(1, "The Meta app", done: app.id != nil)
            } footer: {
                Text("A new ad's photos and words become a post the app makes, and Meta runs such a post only from a Live app. Fill these in App settings → Basic, then App Mode → Live.")
            }
            Section {
                Text(app.secret ? "Found in Secret Manager (\(app.secretName))." : "Copy the App secret from the Meta app's App settings → Basic and add it as a new version of \(app.secretName) in this project's Secret Manager.")
                    .foregroundStyle(app.secret ? Color.secondary : Color.primary)
                Text(tokenLine(app)).font(.footnote).foregroundStyle(app.tokenStoreWrite ? Color.secondary : Color.red)
            } header: {
                stepHeader(2, "The app secret, kept by this ERP", done: app.secret && app.tokenStoreWrite)
            }
        }
    }

    private func tokenLine(_ app: AdsStatusAnswer.App) -> String {
        if app.tokenStoreWrite { return "Connection store \(app.tokenSecret) is ready." }
        if !app.tokenStoreExists { return "The connection store \(app.tokenSecret) doesn't exist in \(app.project) yet: it needs creating, with Secret Accessor and Secret Version Adder for the App Hosting account." }
        return "This server can't save to \(app.tokenSecret): grant the App Hosting account Secret Version Adder on it."
    }

    /// One thing Meta's Live switch asks for: ticked when the app has it (read from Meta), else the value to give it.
    private func liveRow(_ label: String, ok: Bool, known: Bool, now: String?, give: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: known && ok ? "checkmark.circle.fill" : (known ? "xmark.circle.fill" : "circle"))
                    .foregroundStyle(known && ok ? Color.green : (known ? Color.red : Color.secondary))
                Text(label)
            }
            if known && ok {
                if let now { Text(now).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            } else if !give.isEmpty {
                Text(give).font(.caption.monospaced()).textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func configRow(_ app: AdsStatusAnswer.App) -> some View {
        if app.loginConfigFromEnv {
            LabeledContent("Login configuration", value: app.loginConfigId ?? "")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Facebook Login for Business configuration ID")
                HStack(spacing: 8) {
                    TextField("Configuration ID", text: $configId)
                        .keyboardType(.numberPad)
                        .monospacedDigit()
                    Button(busy == "config" ? "Saving…" : "Save") {
                        let id = configId.filter { (c: Character) in c.isNumber }
                        Task { await save(["loginConfigId": id], "config") }
                    }
                    .buttonStyle(.glass)
                    .disabled(configId.isEmpty || configId == (app.loginConfigId ?? ""))
                }
                Text(app.loginConfigId.map { (id: String) in "Saved: Connect uses configuration \(id)." }
                     ?? "Without one, Facebook answers \"Invalid Scopes\".")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Step 3: the connection

    private func connectSection(_ s: AdsStatusAnswer) -> some View {
        Section {
            if let conn = s.connection {
                if conn.connected {
                    Text(connectedLine(conn))
                    if conn.kind == "user", let days = conn.daysLeft {
                        Text("Good for \(days) more day\(days == 1 ? "" : "s"): connect again before then (running ads are never affected).")
                            .font(.footnote)
                            .foregroundStyle(days <= 10 ? Color.orange : Color.secondary)
                    }
                } else {
                    Text(conn.error ?? "The connection is no longer valid.").foregroundStyle(.red)
                }
                if !conn.missingScopes.isEmpty {
                    Label("Not granted: \(conn.missingScopes.joined(separator: ", ")). Add them to the login configuration (step 1), then connect again.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            } else {
                Text("Log in to Facebook as the person who runs \(session.shop.name)'s ads and approve. The login is kept in this project's Secret Manager, never in the database.")
                    .foregroundStyle(.secondary)
            }
            if let url = setupInSafari {
                Button { openURL(url) } label: {
                    Label(s.connection?.connected == true ? "Connect again in Safari" : "Connect in Safari", systemImage: "safari")
                }
                .disabled(!(s.app?.secret ?? false) || s.app?.id == nil)
            }
            if s.connection != nil {
                Button(role: .destructive) { confirmOff = true } label: {
                    Label(busy == "off" ? "Disconnecting…" : "Disconnect", systemImage: "powerplug")
                }
            }
            if let e = s.connectionError {
                Text(e).font(.footnote).foregroundStyle(.red)
            }
        } header: {
            stepHeader(3, "Connect Facebook", done: s.connection.map { (c: AdsStatusAnswer.Connection) in c.connected })
        } footer: {
            Text("Facebook's login comes back to the ERP in the browser that started it, so it opens Setup in Safari: sign in there, press Connect, then Check again here.")
        }
    }

    private func connectedLine(_ c: AdsStatusAnswer.Connection) -> String {
        var line = "Connected"
        if let n = c.userName { line += " as \(n)" }
        line += c.kind == "system" ? " (a system user: never expires)." : "."
        return line
    }

    // MARK: Steps 4 to 6: the ad account, Instagram, the Page

    @ViewBuilder
    private func choiceSections(_ s: AdsStatusAnswer) -> some View {
        Section {
            if !connected {
                Text("After connecting.").foregroundStyle(.secondary)
            } else if let assetsProblem {
                Label(assetsProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Button("Try again") { Task { await loadAssets() } }
            } else if let assets {
                if assets.accounts.isEmpty {
                    Text("This login can't see any ad account. In Meta Business Settings → Accounts → Ad accounts, give this person access to \(session.shop.name)'s ad account, then Check again.")
                        .foregroundStyle(.red)
                }
                ForEach(assets.accounts) { (a: AdsAccountChoice) in accountRow(a, pinned: s.pinnedAccount) }
                if s.pinnedAccount {
                    Text("Fixed for this shop by META_AD_ACCOUNT_ID.").font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                MarketingReading(text: "Reading what the login can see…")
            }
        } header: {
            stepHeader(4, "The ad account", done: connected ? settings?.adAccountId != nil : nil)
        }
        if let assets, connected {
            instagramSection(assets)
            pageSection(assets)
        }
    }

    private func choiceRow(title: String, line: String, picture: String?, on: Bool) -> some View {
        HStack(spacing: 10) {
            if let picture {
                StockImage(imageUrl: picture, name: title, key: title)
                    .frame(width: 36, height: 36)
                    .clipShape(Circle())
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(.primary)
                if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            if on { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
        }
    }

    private func accountRow(_ a: AdsAccountChoice, pinned: Bool) -> some View {
        let st = AdsStatusWords.ofAccount(a.status)
        let line = [a.business ?? "", "act \(a.id)", a.currency, st.label == "Active" ? "" : st.label].filter { (x: String) in !x.isEmpty }.joined(separator: " · ")
        return Button { Task { await save(["adAccountId": a.id, "adAccountName": a.name], "account") } } label: {
            choiceRow(title: a.name, line: line, picture: nil, on: settings?.adAccountId == a.id)
        }
        .disabled(pinned)
    }

    private func instagramSection(_ assets: AdsSetupAssets) -> some View {
        Section {
            if assets.instagram.isEmpty {
                Text("No Instagram account is linked to a Page or the ad account yet. Existing ads still show here; to make new ones, link \(house.map { (h: String) in "@\(h)" } ?? "the shop's Instagram") to a Facebook Page (step 6).")
                    .foregroundStyle(.secondary)
            }
            ForEach(assets.instagram) { (i: AdsInstagramChoice) in
                let page = i.pageId.flatMap { (id: String) in assets.pages.first { (p: AdsPageChoice) in p.id == id } }
                let via = page.map { (p: AdsPageChoice) in "Linked to the Page “\(p.name)”" } ?? (i.via == "ad account" ? "Added to the ad account" : "Business account")
                let notOurs = house != nil && i.username.lowercased() != house
                Button {
                    var patch: [String: Any] = ["instagramUserId": i.id, "instagramUsername": i.username]
                    if let page {
                        patch["pageId"] = page.id
                        patch["pageName"] = page.name
                    }
                    Task { await save(patch, "ig") }
                } label: {
                    choiceRow(title: "@\(i.username.isEmpty ? i.id : i.username)", line: via + (notOurs ? " · not this shop's" : ""),
                              picture: i.picture, on: settings?.instagramUserId == i.id)
                }
            }
            if wrongHouse, let house {
                Text("This shop is @\(house); ads made here would appear as @\(settings?.instagramUsername ?? "").").font(.footnote).foregroundStyle(.red)
            }
        } header: {
            stepHeader(5, house.map { (h: String) in "Instagram · @\(h)" } ?? "Instagram", done: settings?.instagramUserId != nil && !wrongHouse)
        }
    }

    private func pageSection(_ assets: AdsSetupAssets) -> some View {
        let chosenIg = assets.instagram.first { (i: AdsInstagramChoice) in i.id == settings?.instagramUserId }
        return Section {
            if assets.pages.isEmpty {
                Text("No Facebook Page yet. Create one for \(session.shop.name) at facebook.com/pages/create, then in the Page's Settings → Linked accounts link the shop's Instagram (and WhatsApp, for chat ads). Then Check again.")
                    .foregroundStyle(.orange)
            }
            ForEach(assets.pages) { (p: AdsPageChoice) in
                let line = [p.instagramUsername.map { (u: String) in "@\(u)" } ?? "no Instagram linked",
                            p.whatsapp.map { (w: String) in "WhatsApp \(w)" } ?? "no WhatsApp linked",
                            p.canAdvertise ? "" : "can't advertise"].filter { (x: String) in !x.isEmpty }.joined(separator: " · ")
                Button { Task { await save(["pageId": p.id, "pageName": p.name], "page") } } label: {
                    choiceRow(title: p.name, line: line, picture: p.picture, on: settings?.pageId == p.id)
                }
            }
            if let ig = chosenIg, let linked = ig.pageId, let page = settings?.pageId, linked != page {
                Text("@\(ig.username) is linked to another Page: Meta requires that same Page.").font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            stepHeader(6, "The Facebook Page behind new ads", done: settings?.pageId != nil)
        } footer: {
            Text("Meta runs every new ad through a Facebook Page, even an Instagram-only one (the Page doesn't show on Instagram). Viewing and running existing ads needs none.")
        }
    }

    // MARK: Steps 7 and 8: the chat greeting, the website pixel

    private var greetingSection: some View {
        let page = assets?.pages.first { (p: AdsPageChoice) in p.id == settings?.pageId }
        return Section {
            TextField("Hi! I saw your ad. Can you tell me more about this piece?", text: $greeting, axis: .vertical)
                .lineLimit(2...4)
            Button(busy == "greeting" ? "Saving…" : "Save the message") {
                Task { await save(["whatsappGreeting": greeting], "greeting") }
            }
            .disabled(greeting == (settings?.whatsappGreeting ?? ""))
        } header: {
            stepHeader(7, "Chat ads (optional)", done: nil)
        } footer: {
            Text(page?.whatsapp.map { (w: String) in "Chat ads open WhatsApp to \(w) (linked to the Page). The message they start with is above." }
                 ?? "Chat ads to WhatsApp need a WhatsApp number linked to the Page (Page settings → Linked accounts → WhatsApp). Instagram-message ads need nothing more.")
        }
    }

    private var pixelSection: some View {
        Section {
            if !(connected && settings?.adAccountId != nil) {
                Text("Connect and choose the ad account first.").foregroundStyle(.secondary)
            } else if let pixelProblem {
                Text(pixelProblem).foregroundStyle(.red)
            } else if let pixel, let st = pixel.state {
                pixelRows(pixel, st)
            } else {
                MarketingReading(text: "Reading the ad account's pixels…")
            }
        } header: {
            stepHeader(8, "The website pixel", done: nil)
        } footer: {
            Text("With a pixel on the website, Meta can retarget people who looked at a piece, build audiences of them, buy page views instead of clicks, and, once it records orders, look for people who buy (\"Online orders\" on New ad).")
        }
    }

    @ViewBuilder
    private func pixelRows(_ p: AdsPixelAnswer, _ st: AdsPixelState) -> some View {
        let listed = Set(p.pixels.map { (x: AdsPixelRow) in x.id })
        ForEach(st.carried.filter { (id: String) in id != st.id }, id: \.self) { (id: String) in
            VStack(alignment: .leading, spacing: 6) {
                Label("\(st.sitesCarrying(id)) already carries pixel \(id)", systemImage: "globe").font(.subheadline.weight(.medium))
                Text(listed.contains(id)
                     ? "Use it rather than making another: one pixel keeps every visit and order in one place, and its history is already there."
                     : "It isn't shared with this ad account yet, so Meta won't let ads use it. In Meta Business settings → Data sources → Datasets, open \(id) → Assign assets → this ad account (full control); then it appears below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button(listed.contains(id) ? "Use this pixel" : "Use it anyway (after sharing it)") {
                    Task { await pixelAct(["action": "choose", "id": id], "pixel") }
                }
                .buttonStyle(.glass)
            }
        }
        if let id = st.id {
            VStack(alignment: .leading, spacing: 4) {
                Label("Pixel \(id) \(st.live ? "is receiving from the website" : "has not received anything this week")",
                      systemImage: st.live ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(st.live ? Color.green : Color.orange)
                if let last = st.lastFired { Text("Last received \(ShopDate.say(last, withTime: true)).").font(.caption) }
                if st.onSite == false {
                    Text("\(st.sites.map { (x: AdsPixelSite) in x.host }.joined(separator: " and ")) doesn't load it yet: \(st.carried.isEmpty ? "the website needs its loader (it reads the id from this ERP's /api/public/pixel)" : "the site carries a different pixel (above)").")
                        .font(.caption)
                }
                if st.events != nil { Text("This week: \(st.eventLine).").font(.caption) }
            }
        } else {
            Text("No pixel chosen: website ads buy clicks, and nobody who visits can be retargeted.").font(.footnote).foregroundStyle(.orange)
        }
        ForEach(p.pixels) { (x: AdsPixelRow) in
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(x.name)
                    Text("\(x.id) · \(x.lastFired.map { (l: String) in "last \(ShopDate.say(l))" } ?? "never fired")").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if st.id == x.id {
                    Text("In use").font(.caption.weight(.semibold)).foregroundStyle(.green)
                } else {
                    Button("Use this") { Task { await pixelAct(["action": "choose", "id": x.id], "pixel") } }
                        .buttonStyle(.borderless)
                }
            }
        }
        HStack(spacing: 8) {
            TextField("New pixel's name", text: $pixelName)
            Button(busy == "pixel" ? "Working…" : "Make a new pixel") {
                if st.carried.isEmpty {
                    Task { await pixelAct(["action": "create", "name": pixelName], "pixel") }
                } else {
                    confirmPixel = true
                }
            }
            .buttonStyle(.borderless)
        }
        if st.id != nil {
            Button("Stop using it", role: .destructive) { Task { await pixelAct(["action": "choose", "id": NSNull()], "pixel") } }
        }
    }
}
