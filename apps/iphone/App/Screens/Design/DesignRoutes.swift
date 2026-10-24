import SwiftUI

/// Design (docs/features/design.md): one place to make anything and keep it. `/design` and its `?v=` sections are native
/// here, every section of them. The old Post a piece and Studio screens keep their routes (`/website/post`, `/ads/studio`) in
/// Marketing; nothing in the app goes to `/design/classic/{post,ad}`: the photograph's AI tools and "Make the ad with AI"
/// are the workspace's own (DesignAI).
enum DesignRoutes {
    static var all: [ScreenRoute] {
        [ScreenRoute(matches: { (path: String) in ScreenRoute.bare(path) == "/design" }, make: { (path: String) in AnyView(DesignScreen(path: path)) })]
    }
}

/// The screen: the section chip row exactly as the web's (Make · Photos · Board · Saved), and the section under it. Board and the
/// photo library are for owner and marketing (designGate 'ads'); staff get Make, Saved and the website's photographs.
struct DesignScreen: View {
    let path: String
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sectionRaw: String
    @State private var partRaw: String
    @State private var workspace = DesignWorkspaceModel()
    @State private var start = DesignStartModel()
    @State private var shelf = DesignShelf()
    @State private var note: Note?
    @State private var booted = false

    init(path: String) {
        self.path = path
        _sectionRaw = State(initialValue: AdsQuery.value("v", in: path) ?? "make")
        _partRaw = State(initialValue: AdsQuery.value("s", in: path) ?? "site")
    }

    private var access: DesignAccess { DesignAccess(role: session.role) }
    private var current: DesignSection { DesignSection.of(sectionRaw, access) }
    private var part: Binding<DesignPhotoPart> {
        Binding(get: { DesignPhotoPart.of(partRaw, access) }, set: { partRaw = $0.rawValue })
    }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        Group {
            if !access.post {
                NotAvailableState("Design is for the shop’s team", why: "Sign in with an owner, staff or marketing account to make posts and ads.", symbol: "lock")
            } else {
                VStack(spacing: 0) {
                    ChipRow {
                        ForEach(DesignSection.offered(access)) { s in FilterChip(title: s.title, chosen: current == s) { go(s) } }
                    }
                    .padding(.vertical, 4)
                    if workspace.isOpen && current != .make { openBanner }
                    page
                }
            }
        }
        .modifier(HouseGround())
        .navigationTitle("Design").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The web page's sections are all here (Make, Photos, Board, Saved, and the workspace's Resize, Publish and AI
            // tools), so there is no ERP page to fall back on; the menu is the open design's.
            if workspace.isOpen && current == .make {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        // PHASE 2: DesignHooks.resize.
                        Button { go(.make); DesignHooks.shared.resize(workspace) } label: { Label("Resize…", systemImage: "arrow.up.left.and.arrow.down.right") }
                        Divider()
                        Button { Task { await workspace.close(); await shelf.loadDrafts(); go(.make) } } label: { Label("Close this design", systemImage: "xmark") }
                    } label: { Label("More", systemImage: "ellipsis") }
                }
            }
        }
        .noteToast($note)
        .navigationDestination(item: $workspace.route) { PlaceScreen(path: $0.path) }
        .failureAlert($workspace.error, title: "Could not finish")
        .websiteBusy(workspace.starting ? "Opening…" : nil)
        .task { await boot() }
        .onAppear {
            workspace.speak = { n in Note.show(n, in: $note, reduce: reduceMotion) }
            start.speak = workspace.speak
            // A design started from elsewhere (a flat picture rebuilt as layers) lands in the workspace like any other.
            start.launch = { req in Task { if await workspace.start(req) { start.photo = nil; start.fields = [:]; start.price = ""; go(.make) } } }
        }
        .onDisappear { Task { await workspace.flush() } }
    }

    // MARK: Sections

    @ViewBuilder private var page: some View {
        switch current {
        case .make:
            if workspace.isOpen {
                DesignWorkspaceView(model: workspace, access: access, onClose: { Task { await workspace.close(); await shelf.loadDrafts() } }, onChangePhoto: { go(.photos) })
            } else {
                DesignStartView(start: start, access: access, role: session.role, shelf: shelf, starting: workspace.starting,
                                onBrowse: { go(.photos) }, onBegin: begin, onOpenDraft: openDraft, onOpenSaved: openSaved, onSeeAll: { go(.saved) })
            }
        case .photos:
            DesignPhotosView(access: access, part: part, onPick: pick)
        case .board:
            DesignBoardSection()
        case .saved:
            DesignSavedView(shelf: shelf, onOpen: openSaved, onOpenDraft: openDraft, adsOk: access.ads)
        }
    }

    private var openBanner: some View {
        HStack(spacing: 10) {
            Text("“\(workspace.work?.displayName ?? "")” is open.").font(.subheadline).lineLimit(1)
            Spacer(minLength: 0)
            Button("Back to it") { go(.make) }.buttonStyle(.bordered)
        }
        .ledgerCard().padding(.horizontal, 16).padding(.bottom, 8)
    }

    // MARK: Doing

    private func go(_ s: DesignSection) { Motion.run(Motion.enter, reduce: reduceMotion) { sectionRaw = s.rawValue } }

    /// Continue on the start screen.
    private func begin() {
        guard access.ads || start.kind != "ad" else { return }
        Task {
            if await workspace.start(start.request) { start.photo = nil; start.fields = [:]; start.price = ""; go(.make) }
        }
    }

    /// A photograph chosen in Photos: into the open design, else it waits on the start screen.
    private func pick(_ photo: DesignStartPhoto) {
        if workspace.isOpen {
            Task {
                do {
                    let data = try await photo.load()
                    workspace.replacePhoto(data, label: photo.label, fields: photo.fields, source: photo.source, marked: photo.marked)
                    go(.make)
                } catch { workspace.error = error.localizedDescription }
            }
        } else {
            start.photo = photo
            go(.make)
        }
    }

    private func openSaved(_ r: DesignRecord) {
        Task { if await workspace.open(r) { go(.make) } }
    }

    private func openDraft(_ row: DesignDraftRow) {
        Task {
            let ok: Bool
            if let old = row.old { ok = workspace.openOld(old) } else { ok = await workspace.openDraft(row.id) }
            if ok { go(.make) }
        }
    }

    /// The first time the screen opens: the engine's layouts, the shelf, then what the address asks for (?kind=, ?draft=, ?site=,
    /// ?new=1, as the web answers them), else the design left open on this phone comes back.
    private func boot() async {
        guard !booted, access.post else { return }
        booted = true
        Task { await workspace.loadCatalogue() }
        await shelf.loadDrafts()
        if let kind = AdsQuery.value("kind", in: path), DesignKinds.valid.contains(kind), access.ads || kind != "ad" { start.choose(kind) }
        // Ads → Plan's "Make this" (?play=): the Ad starts at the play's shape(s), layout and goal (the engine's own plays, as the web's PLAYS).
        if let id = AdsQuery.value("play", in: path), access.ads {
            await workspace.loadCatalogue()
            if let play = workspace.catalogue["plays"].array.first(where: { $0.s("id") == id }) { start.usePlay(play) }
        }
        if let id = AdsQuery.value("draft", in: path) {
            if let row = shelf.draftRows.first(where: { $0.id == id }) { openDraft(row) }
            else { workspace.error = "That draft could not be opened. It may have been cleared from this phone." }
        } else if let site = AdsQuery.value("site", in: path) {
            await startFromSite(site)
        } else if AdsQuery.value("new", in: path) == "1" {
            await workspace.close()
        } else if AdsQuery.value("kind", in: path) == nil && AdsQuery.value("play", in: path) == nil {
            // A kind or a play asked for the start screen; only a plain visit brings the design left open back.
            await workspace.resume()
        }
    }

    private func startFromSite(_ id: String) async {
        do {
            let pieces = try await MarketingRequest.get("/api/website/site-pieces")["pieces"].array
            guard let piece = pieces.first(where: { $0.s("id") == id }) else { throw ERPAPI.Failure(status: 0, message: "That piece is no longer on the website.") }
            let sizes = DesignKinds.card("piece").sizes.map { DesignSizeChoice(id: $0) }
            if await workspace.start(DesignStartRequest(kind: "piece", sizes: sizes, photo: DesignPhotoSources.site(piece))) { go(.make) }
        } catch { workspace.error = "Couldn’t bring the piece in. " + error.localizedDescription }
    }
}

#if os(macOS)
extension DesignScreen {
    /// Design as a Mac app window: the sections (Make, Photos, Board, Saved) are a segmented control in the toolbar, not a row
    /// of chips in the page; the open design's own tools are the workspace's toolbar.
    @ViewBuilder
    fileprivate var macBody: some View {
        Group {
            if !access.post {
                NotAvailableState("Design is for the shop’s team", why: "Sign in with an owner, staff or marketing account to make posts and ads.", symbol: "lock")
            } else {
                VStack(spacing: 0) {
                    if workspace.isOpen && current != .make { openBanner }
                    page
                }
            }
        }
        .modifier(HouseGround())
        .navigationTitle("Design")
        .toolbar {
            if access.post {
                ToolbarItem(placement: .principal) {
                    Picker("Section", selection: Binding(get: { current }, set: { go($0) })) {
                        ForEach(DesignSection.offered(access)) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(minWidth: 260)
                    .help("Make, Photos, Board or Saved")
                }
            }
        }
        .noteToast($note)
        .navigationDestination(item: $workspace.route) { PlaceScreen(path: $0.path) }
        .failureAlert($workspace.error, title: "Could not finish")
        .websiteBusy(workspace.starting ? "Opening…" : nil)
        .task { await boot() }
        .onAppear {
            workspace.speak = { n in Note.show(n, in: $note, reduce: reduceMotion) }
            start.speak = workspace.speak
            start.launch = { req in Task { if await workspace.start(req) { start.photo = nil; start.fields = [:]; start.price = ""; go(.make) } } }
        }
        .onDisappear { Task { await workspace.flush() } }
    }
}
#endif

/// Board (owner and marketing): the Ad studio's board, native (StudioBoards), mounted in place as the web mounts it.
struct DesignBoardSection: View {
    @State private var studio = StudioModel()
    var body: some View {
        StudioBoards(model: studio)
            .task { await studio.load(path: "/ads/studio?v=board") }
            .navigationDestination(item: $studio.route) { PlaceScreen(path: $0.path) }
            .failureAlert($studio.error, title: "Could not finish")
            .websiteBusy(studio.busy)
    }
}
