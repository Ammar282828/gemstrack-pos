import WidgetKit
import SwiftUI
import Observation

/// Signed in or not, owner or karigar: which app this person gets.
struct RootGate: View {
    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @AppStorage("deviceTheme") private var deviceTheme = ""
    /// The shop's theme as the settings last said, so a cold start opens in it before the settings are read
    /// again (otherwise a shop set to light flips from the phone's dark a moment after launch).
    @AppStorage("erp.lastShopTheme") private var lastShopTheme = ""

    private var preferredScheme: ColorScheme? {
        #if os(macOS)
        // A Mac follows its own appearance (System Settings › Appearance) unless This Mac picks one: a Mac app does not
        // take its light or dark from a shop setting (2026-10-25 design, rule 9).
        let theme = deviceTheme
        #else
        let theme = deviceTheme.isEmpty ? (book.settings.value?.theme ?? lastShopTheme) : deviceTheme
        #endif
        if theme == "default" { return .light }
        if theme == "taheri" || theme == "slate" { return .dark }
        return nil
    }

    var body: some View {
        Group {
            switch session.state {
            case .starting:
                // Only while the ERP is asked who a new account is (Session opens on its last answer otherwise):
                // the page's outline under an empty bar, on the ground the launch screen was drawn in.
                NavigationStack {
                    SkeletonLoading().controlSize(.large)
                        .background(Theme.ground.ignoresSafeArea())
                        .navigationBarTitleDisplayMode(.inline)
                }
                .transition(.opacity)
            case .signedOut, .signingIn, .needsSetup:
                SignInView().transition(.opacity)
            case .signedIn:
                Group {
                    if session.role == "karigar" {
                        // A karigar's own work, native (MyWorkScreen reads the portal's /api/karigar/me; the ERP's /my-work).
                        // PlaceStack would add the rate chip and the team note, which are not a karigar's; so the
                        // stack is its own, with the same Route destination and zoom scope as every other.
                        NavigationStack {
                            MyWorkScreen(path: "/my-work")
                                .toolbar { ToolbarItem(placement: .topBarLeading) { BusinessChip() } }
                                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                        }
                        .zoomScope()
                    } else {
                        #if os(macOS)
                        // The Mac's sidebar, windows and menus (Mac/MacShell.swift) over the same places.
                        MacShell()
                        #else
                        RootView()
                        #endif
                    }
                }
                .transition(.opacity)
            }
        }
        .background(Theme.ground.ignoresSafeArea())
        .motion(session.state, Motion.travel)
        .preferredColorScheme(preferredScheme)
        .onChange(of: book.settings.value?.theme) { _, theme in
            if let theme { lastShopTheme = theme }
        }
    }
}

#if os(iOS)
/// The app: the shop's four most-used places as tabs, the ERP's whole map under Search, and New sale / New order / Scan always one tap away above the tab bar.
/// A marketing account gets its own three (Posts, Website, Ads) and no bar: the ERP gives it nothing else.
/// Liquid Glass comes with the system's TabView, toolbars and sheets (CONVENTIONS.md rule 4).
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(\.layoutWidthClass) private var sizeClass
    // The simulator check opens each tab in turn (`-ERPDemoTab orders`).
    @State private var tab = UserDefaults.standard.string(forKey: "ERPDemoTab") ?? "home"
    @State private var creating: Route?
    @State private var voice = false
    /// The page the voice assistant chose, opened once its sheet has gone (two sheets in one update can drop the second).
    @State private var pendingRoute: Route?

    private var map: NavMap { NavMap.current.visible(to: session.role) }
    private static let primary = ["home", "orders", "invoices", "customers"]
    private var online: OnlineInbox { .shared }

    /// The tabs before Search. Marketing has no dashboard: the ERP sends it to Posts, the first page it may open.
    private func tabEntries(_ map: NavMap) -> [NavEntry] {
        if sizeClass.isPadLayout { return map.entries }
        if session.role == "marketing" { return Array(map.entries.prefix(4)) }
        return Self.primary.compactMap { id in map.entries.first { $0.id == id } }
    }

    /// The chosen tab, or the first one when the remembered choice is not this person's (no Home for marketing).
    private func selection(_ entries: [NavEntry]) -> Binding<String> {
        Binding(
            get: { (entries.map(\.id) + ["search"]).contains(tab) ? tab : (entries.first?.id ?? "search") },
            set: { tab = $0 })
    }

    /// Online orders waiting beside Orders, as the web's sidebar counts them (nav.ts `count: 'online'`). Owners confirm them.
    private func badge(for e: NavEntry) -> Int {
        guard e.count == "online", session.isOwner, session.shop.websiteSelling else { return 0 }
        return online.waiting
    }

    /// Owners and staff are the accounts the server tells about online orders; marketing is refused.
    private var watchesOnline: Bool {
        session.shop.websiteSelling && (session.role == "owner" || session.role == "staff")
    }

    /// Opens the voice sheet when Siri, the Action button or a control asked for it. Only an owner has voice; for anyone
    /// else the request is dropped (the app simply opened). Another sheet is closed first: two in one update can drop one.
    private func openVoiceIfAsked() {
        guard VoiceLaunch.requested, !AppLock.shared.locked else { return }
        VoiceLaunch.requested = false
        guard session.isOwner, !voice else { return }
        Task {
            if creating != nil {
                creating = nil
                try? await Task.sleep(for: .milliseconds(450))
            }
            voice = true
        }
    }

    /// A menu command or shortcut (⌘1…⌘5, ⌘N, ⇧⌘N, ⌘F).
    private func perform(_ kind: ShellCommands.Kind, entries: [NavEntry], map: NavMap) {
        guard creating == nil, !voice else { return }
        switch kind {
        case .tab(let i):
            if entries.indices.contains(i) { tab = entries[i].id }
        case .newSale:
            if session.isOwner, map.newSale != nil { creating = Route(path: "/invoices/new") }
        case .newOrder:
            if session.role != "marketing" { creating = Route(path: "/orders/add") }
        case .search:
            ShellCommands.shared.searchWanted = true
            tab = "search"
        }
    }

    var body: some View {
        let map = map
        let entries = tabEntries(map)
        TabView(selection: selection(entries)) {
            ForEach(entries) { e in
                Tab(e.id == "home" ? "Home" : e.label, systemImage: NavIcon.symbol(for: e.icon), value: e.id) {
                    if sizeClass.isPadLayout, session.role != "marketing", let prompt = HubSplitKind.prompt(for: e.href) {
                        // Orders, Invoices, Customers, Stock, Repairs on an iPad: the list with the item beside it.
                        HubSplit(prompt: prompt) {
                            PlaceScreen(path: e.href, isRoot: true)
                                .modifier(CreateAccessory(map: map, shown: true, voiceShown: session.isOwner,
                                                          open: { creating = Route(path: $0) }, talk: { voice = true }))
                        }
                    } else {
                        NavigationStack {
                            PlaceScreen(path: e.href, isRoot: true)
                                .modifier(CreateAccessory(map: map, shown: session.role != "marketing", voiceShown: session.isOwner,
                                                          open: { creating = Route(path: $0) }, talk: { voice = true }))
                                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                        }
                        // Outside the stack, so its pages see the same namespace as the rows they zoom from.
                        .zoomScope()
                    }
                }
                .badge(badge(for: e))
            }
            // Search is also the way to everything else: idle, it lists the ERP's whole map (the web's
            // sidebar) with Settings and the account; typed into, it finds any place by name or by the
            // words people use. An iPhone shows five tabs at most, and a sixth would fold both away.
            Tab("Search", systemImage: "magnifyingglass", value: "search", role: .search) {
                NavigationStack {
                    SearchView(map: map).modifier(TeamNotePresentation())
                        .modifier(CreateAccessory(map: map, shown: session.role != "marketing", voiceShown: session.isOwner,
                                                  open: { creating = Route(path: $0) }, talk: { voice = true }))
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                }
                .zoomScope()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        // The bar folds down while a page scrolls, giving the page its height back.
        .tabBarMinimizeBehavior(.onScrollDown)
        // An iPad's sidebar is headed by the business chip alone: which business this is and the way to the others
        // (the house's whole wordmark here was too big for a sidebar, owner 2026-10-23).
        .tabViewSidebarHeader {
            BusinessChip(wide: true)
                .padding(.vertical, pt(6))
        }
        .onChange(of: ShellCommands.shared.request) { _, r in
            if let r { perform(r.kind, entries: entries, map: map) }
        }
        .onAppear { ShellCommands.shared.tabTitles = entries.prefix(5).map { $0.id == "home" ? "Home" : $0.label } }
        .onChange(of: entries.map(\.id)) { _, _ in
            ShellCommands.shared.tabTitles = entries.prefix(5).map { $0.id == "home" ? "Home" : $0.label }
        }
        .sheet(isPresented: $voice, onDismiss: {
            if let p = pendingRoute { pendingRoute = nil; creating = p }
        }) {
            NavigationStack {
                NativeVoiceScreen { path in pendingRoute = Route(path: path); voice = false }
            }
            // The whole height: a voice surface, not a form (the orb, the words, then the plan). An iPad keeps the form's width.
            .presentationSizing(.form)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $creating) { r in
            NavigationStack {
                PlaceScreen(path: r.path)
                    .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { creating = nil }
                        }
                    }
            }
            // No zoomScope here: a page opened inside the sheet has no row to grow from (it would zoom out of a bubble).
            .presentationSizing(.page)
        }
        // The one poll of the online-orders count (the dashboard and the Orders badge both read it).
        .task(id: watchesOnline) {
            if watchesOnline { await OnlineInbox.shared.keep() }
        }
        // The mic is on this screen for an owner: the speech model, the audio session and the engine are made ready
        // now, so the tap only starts them (VoiceEngine.warm). Permissions are asked at the first use, not here.
        .task(id: session.isOwner) {
            if session.isOwner, !House.isDemo { VoiceEngine.shared.warm() }
        }
        // "Talk to ERP" from Siri, the Action button, Spotlight or Control Center (Shared/VoiceLaunch.swift): the
        // request waits for Face ID, then the voice sheet opens listening. Cold starts find it set already.
        .onReceive(NotificationCenter.default.publisher(for: VoiceLaunch.notification)) { _ in openVoiceIfAsked() }
        .onChange(of: AppLock.shared.locked) { _, locked in if !locked { openVoiceIfAsked() } }
        .task { openVoiceIfAsked() }
        // The simulator check opens one page over the tabs (`-ERPDemoOpen /invoices/INV-D0002`).
        .task {
            if House.isDemo, let p = UserDefaults.standard.string(forKey: "ERPDemoOpen"), p.hasPrefix("/") { creating = Route(path: p) }
            // A notification of another business switched to it: the page it named was set before this screen existed.
            if let r = AppRouter.shared.open { creating = r; AppRouter.shared.open = nil }
        }
        // A tapped notification opens its page over whatever is showing.
        .onChange(of: AppRouter.shared.open) { _, r in
            if let r { creating = r; AppRouter.shared.open = nil }
        }
    }
}

/// Two floating controls leave the page itself free of repeated shortcuts.
@MainActor
private struct CreateAccessory: ViewModifier {
    let map: NavMap
    let shown: Bool
    let voiceShown: Bool
    let open: (String) -> Void
    let talk: () -> Void
    /// The + at its small size (the page is scrolled). Held while the choices are open.
    @State private var compact = false
    @State private var expanded = false
    @State private var scrolled = false
    @State private var offsetY: CGFloat = 0
    @State private var openedAt: CGFloat = 0
    @Namespace private var glassSpace

    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if sizeClass.isPadLayout {
            // An iPad has a toolbar to spare: New and the voice assistant sit in it, so nothing floats over a
            // form or the last row, and the page keeps its whole height. They go beside the rate chip, leaving
            // the trailing side to the page's own actions (filters, Settings), which would otherwise fold away.
            content.environment(\.createMenuShown, shown).toolbar {
                if shown {
                    // One control, the voice assistant inside it: beside the tab bar an iPad's toolbar holds about
                    // two things a side before it folds them all behind "More".
                    ToolbarItem(placement: .topBarLeading) {
                        createMenu(voice: true) {
                            Label("New", systemImage: "plus")
                        }
                        .accessibilityLabel(voiceShown ? "Create: new sale, new order, scan or voice" : "Create: new sale, new order or scan")
                    }
                }
            }
        } else {
            floating(content)
        }
    }

    private func createMenu<L: View>(voice: Bool = false, @ViewBuilder label: () -> L) -> some View {
        Menu {
            if map.newSale != nil {
                // Straight to the sale, not the New chooser (which asks Sale / Order / Repair again).
                Button("New sale", systemImage: "banknote") { open("/invoices/new") }
            }
            Button("New order", systemImage: "list.clipboard") { open("/orders/add") }
            Button("Scan", systemImage: "qrcode.viewfinder") { open("/scan") }
            if voice && voiceShown {
                Divider()
                Button("Voice assistant", systemImage: "mic", action: talk)
            }
        } label: { label() }
    }

    /// New sale, New order, Scan: a tap on the + spreads them as glass buttons out of the + itself, one tap each.
    /// (A system Menu here, its label resizing as the page scrolled, was dismissed and re-presented while it was
    /// open and sat in a glass morph that would not take taps: owner, 2026-10-25, "opens a menu that doesn't tap
    /// properly which opens another menu".) New sale goes straight to the sale: the New chooser it used to open
    /// asked Sale / Order / Repair again, though the owner had just said which.
    private struct Action: Identifiable {
        let id: String, title: String, symbol: String, path: String
    }

    private var actions: [Action] {
        var out: [Action] = []
        if map.newSale != nil { out.append(Action(id: "sale", title: "New sale", symbol: "banknote", path: "/invoices/new")) }
        out.append(Action(id: "order", title: "New order", symbol: "list.clipboard", path: "/orders/add"))
        out.append(Action(id: "scan", title: "Scan", symbol: "qrcode.viewfinder", path: "/scan"))
        return out
    }

    private func collapse() {
        guard expanded else { return }
        Motion.run(Motion.exit, reduce: reduceMotion) {
            expanded = false
            compact = scrolled  // the size that was held while open catches up once it is closed
        }
    }

    private func toggle() {
        if expanded { collapse(); return }
        openedAt = offsetY
        Motion.run(Motion.travel, reduce: reduceMotion) { expanded = true }
    }

    private func floating(_ content: Content) -> some View {
        content
            .safeAreaPadding(.bottom, shown ? 76 : 0)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                (geometry.contentOffset.y + geometry.contentInsets.top).rounded()
            } action: { _, y in
                offsetY = y
                scrolled = y > 24
                if expanded {
                    // Scrolling closes it; the size stays as it was until then, so the + never changes under a finger.
                    if abs(y - openedAt) > 12 { collapse() }
                } else if compact != scrolled {
                    compact = scrolled
                }
            }
            .overlay {
                if shown && expanded {
                    // Anywhere else on the page: a tap or a drag closes.
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { collapse() }
                        .gesture(DragGesture(minimumDistance: 10).onChanged { _ in collapse() })
                        .accessibilityHidden(true)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if shown {
                    let side: CGFloat = compact ? 44 : 52
                    GlassEffectContainer(spacing: pt(12)) {
                        VStack(alignment: .trailing, spacing: pt(10)) {
                            if expanded {
                                ForEach(actions) { a in
                                    Button { collapse(); open(a.path) } label: {
                                        Label(a.title, systemImage: a.symbol)
                                            .font(.body.weight(.semibold))
                                            .padding(.horizontal, pt(18))
                                            .frame(minHeight: 48)
                                            .contentShape(Capsule())
                                            .glassEffect(.regular.interactive(), in: .capsule)
                                            .glassEffectID(a.id, in: glassSpace)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(a.title)
                                }
                            }
                            HStack(spacing: compact ? 8 : 12) {
                                if voiceShown {
                                    Button { collapse(); talk() } label: {
                                        Image(systemName: "mic.fill")
                                            .font(.system(size: compact ? 16 : 20))
                                            .frame(width: side, height: side)
                                    }
                                    .buttonStyle(.houseGlass).buttonBorderShape(.circle)
                                    .accessibilityLabel("Voice assistant")
                                }
                                Button(action: toggle) {
                                    Image(systemName: expanded ? "xmark" : "plus")
                                        .font(.system(size: compact ? 18 : 22, weight: .semibold))
                                        .contentTransition(.symbolEffect(.replace))
                                        .foregroundStyle(Theme.onAccent)
                                        .frame(width: side, height: side)
                                        .contentShape(Circle())
                                        .glassEffect(.regular.tint(Theme.accent).interactive(), in: .circle)
                                        .glassEffectID("plus", in: glassSpace)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Create")
                                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                                .accessibilityHint(expanded ? "Closes the choices" : "New sale, new order or scan")
                            }
                        }
                    }
                    .padding(.horizontal, pt(20)).padding(.vertical, pt(8))
                    .motion(compact, Motion.enter)
                    // One tap on opening, none on closing (the page that opens gives its own).
                    .sensoryFeedback(.impact(flexibility: .soft), trigger: expanded) { _, now in now }
                    .accessibilityAction(.escape) { collapse() }
                }
            }
    }
}

#endif

/// A tab's own stack, starting at an ERP place.
struct PlaceStack: View {
    let root: String
    var body: some View {
        NavigationStack {
            PlaceScreen(path: root, isRoot: true)
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
        }
        .zoomScope()
    }
}

/// One ERP place: its tabs (the ERP's "one tab row per screen") as the title's menu, and the
/// screen for the chosen tab, native or the ERP page.
struct PlaceScreen: View {
    let path: String
    /// A tab's first screen: it carries the rate chip, as every page of the ERP does in its top bar (for everyone;
    /// an owner's opens the form, anyone else's a page to read).
    var isRoot = false
    @Environment(Session.self) private var session
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var chosen: String?

    var body: some View {
        let bare = ScreenRoute.bare(path)
        // The map as this person sees it: staff are not offered Today's cash among Home's tabs.
        let entry = NavMap.current.visible(to: session.role).entry(for: path)
        let atTab = entry.map { e in bare == e.href || (e.tabs ?? []).contains { $0.href == bare } } ?? false
        let tabs = atTab ? (entry?.tabs ?? []) : []
        let current = chosen ?? path
        // An entry whose tabs are sectioned (Analytics): a picker of the sections on top, and the title menu holds
        // the open section's pages. Settings is its own sectioned list, so it takes neither.
        let sections = entry?.id == "settings" ? [] : (entry?.sections ?? [])
        let openSection = tabs.first { $0.href == ScreenRoute.bare(current) }?.section ?? sections.first
        let menuTabs = SectionedTabs.menu(tabs, sections: sections, open: openSection)
        let title = tabs.first { $0.href == ScreenRoute.bare(current) }?.title
            ?? (entry?.href == ScreenRoute.bare(current) ? (entry?.heading ?? entry?.label) : nil)
        ScreenRegistry.view(for: current)
            .id(current)
            // The sub-tab swap fades rather than cuts (the `.id` stays: it is the routing).
            .transition(.opacity)
            .motion(current, Motion.enter)
            // A native screen names itself (and a hub keeps its large title); an ERP page is named from the map.
            .modifier(WebTitle(title: ScreenRegistry.hasNative(current) ? nil : (title ?? "")))
            #if os(iOS)
            // On a Mac the sidebar lists every tab and section (docs/features/mac-design.md, rule 2): no title menu,
            // no picker of sections above the page.
            .modifier(TabsMenu(tabs: menuTabs, section: sections.count > 1 ? openSection : nil, current: ScreenRoute.bare(current), chosen: $chosen))
            .modifier(SectionPicker(tabs: tabs, sections: sections, open: openSection, chosen: $chosen))
            #endif
            .environment(\.inSectionedEntry, sections.count > 1)
            // Native screens sit on the house's ground; an ERP page brings its own (the same palette).
            .modifier(OptionalGround(on: ScreenRegistry.hasNative(current), width: ScreenRegistry.readableWidth(for: current)))
            #if os(macOS)
            // Today draws the note itself on a Mac (a strip at the head of its page).
            .modifier(TeamNotePresentation(shown: isRoot && bare != "/"))
            #else
            .modifier(TeamNotePresentation(shown: isRoot))
            #endif
            #if os(iOS)
            .toolbar {
                // The business at the top of every tab (an iPad keeps it in the sidebar's header).
                if isRoot && !sizeClass.isPadLayout {
                    ToolbarItem(placement: .topBarLeading) { BusinessChip() }
                }
                if isRoot {
                    ToolbarItem(placement: .topBarLeading) { RateChip() }
                }
                // The account, top right of Home as the system's own apps keep it: Settings (owners; anyone else
                // signs out from Search).
                if isRoot && bare == "/" && session.isOwner {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink(value: Route(path: "/settings")) {
                            Initials(name: session.shop.person ?? session.me?.email ?? "", size: 32)
                        }
                        .accessibilityLabel("Settings")
                    }
                }
            }
            #endif
    }
}

private struct OptionalGround: ViewModifier {
    let on: Bool
    /// The page's readable column on an iPad (nil: the page lays out the whole window itself).
    var width: CGFloat?
    func body(content: Content) -> some View {
        if on, let width {
            content.modifier(HouseGround()).readableColumn(width)
        } else if on {
            content.modifier(HouseGround())
        } else {
            content
        }
    }
}

private struct WebTitle: ViewModifier {
    let title: String?

    func body(content: Content) -> some View {
        if let title {
            content.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        } else {
            content
        }
    }
}

enum SectionedTabs {
    /// The pages the title menu lists: all of them, or only the open section's when the entry has sections to pick.
    static func menu(_ tabs: [NavPlace], sections: [String], open: String?) -> [NavPlace] {
        guard sections.count > 1, let open else { return tabs }
        return tabs.filter { $0.section == open }
    }
}

/// The web's top row of a sectioned entry: its sections, each opening its first page.
private struct SectionPicker: ViewModifier {
    let tabs: [NavPlace]
    let sections: [String]
    let open: String?
    @Binding var chosen: String?

    private var selection: Binding<String> {
        Binding(
            get: { open ?? sections.first ?? "" },
            set: { name in
                if let first = tabs.first(where: { $0.section == name }) { chosen = first.href }
            })
    }

    func body(content: Content) -> some View {
        if sections.count > 1 {
            content.safeAreaInset(edge: .top, spacing: 0) {
                Picker("Section", selection: selection) {
                    ForEach(sections, id: \.self) { name in Text(name).tag(name) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, pt(16)).padding(.vertical, pt(8))
                .background(Theme.ground)
                .selectionFeedback(trigger: selection.wrappedValue)
            }
        } else {
            content
        }
    }
}

private struct TabsMenu: ViewModifier {
    let tabs: [NavPlace]
    /// The open section's name when the entry's sections are picked above; the menu heads its pages with it.
    var section: String?
    /// The sub-tab showing now, ticked in the menu.
    let current: String
    @Binding var chosen: String?

    @ViewBuilder private var items: some View {
        ForEach(tabs) { t in
            Button { chosen = t.href } label: {
                Label(t.label, systemImage: t.href == current ? "checkmark" : NavIcon.symbol(for: t.icon))
            }
        }
    }

    func body(content: Content) -> some View {
        if tabs.count > 1 {
            content.toolbarTitleMenu {
                if let section {
                    Section(section) { items }
                } else {
                    items
                }
            }
        } else {
            content
        }
    }
}

/// Demo edits stay on this phone; real notes always use the shared settings write.
@MainActor @Observable
final class DemoTeamNote {
    static let shared = DemoTeamNote()
    var text: String?
}

/// The banner heads each tab's first screen only: on pushed pages and forms it would repeat at every level and
/// take room from the fields (the sheets built on `PlaceScreen(path:)` are not roots either).
struct TeamNotePresentation: ViewModifier {
    var shown = true
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var reading = false
    @State private var editing = false
    private var text: String { TeamNoteEditor.current(book) }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if shown && !text.isEmpty {
                    HStack(alignment: .top, spacing: pt(12)) {
                        Button { reading = true } label: {
                            VStack(alignment: .leading, spacing: pt(5)) {
                                Label("Urgent note", systemImage: "pin.fill")
                                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                                Text(text).font(.subheadline).foregroundStyle(.primary)
                                    .lineLimit(2).multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the full team note")
                        if session.isOwner {
                            Button("Edit note", systemImage: "pencil") { editing = true }
                                .labelStyle(.iconOnly).frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
                        }
                    }
                    .padding(pt(12))
                    .background(Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
                    .overlay(alignment: .leading) { Capsule().fill(Theme.accent).frame(width: 3).padding(.vertical, pt(12)) }
                    .padding(.horizontal, pt(16)).padding(.vertical, pt(6))
                    .background(Theme.ground)
                }
            }
            .task { book.settings.need() }
            .sheet(isPresented: $editing) { TeamNoteEditor() }
            .sheet(isPresented: $reading) {
                NavigationStack {
                    ScrollView { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding(pt(20)) }
                        .modifier(HouseGround())
                        .navigationTitle("Urgent note").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { reading = false } } }
                }
                .presentationDetents([.medium, .large])
            }
    }
}

struct TeamNoteEditor: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var failure: String?
    @State private var confirmingClear = false
    /// Counted, so the save is felt once.
    @State private var saved = 0

    private static let limit = 600
    private var over: Bool { text.count > Self.limit }

    static func current(_ book: Book) -> String {
        (House.isDemo ? DemoTeamNote.shared.text : nil) ?? book.settings.value?.teamNote ?? ""
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What everyone needs to know", text: $text, axis: .vertical)
                        .lineLimit(4...10)
                        .disabled(saving)
                } header: { LedgerHeading(title: "Team note") } footer: {
                    // The field never cuts the text; Save stays off until it fits, so say so rather than leave it grey.
                    VStack(alignment: .leading, spacing: pt(4)) {
                        Text("Visible to everyone until cleared.")
                        Text(over ? "Keep it under \(Self.limit) characters: \(text.count) / \(Self.limit)" : "\(text.count) / \(Self.limit)")
                            .foregroundStyle(over ? Tone.problem.color : Color.secondary)
                            .monospacedDigit()
                    }
                }
                .houseRows()
                if !Self.current(book).isEmpty {
                    Section {
                        Button("Clear note", role: .destructive) { confirmingClear = true }
                            .disabled(saving)
                    }.houseRows()
                }
            }
            .modifier(HouseGround())
            .navigationTitle("Urgent note").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
                        .disabled(!loaded || saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || over || !session.isOwner)
                }
            }
            .onAppear { book.settings.need(); seed() }
            .onChange(of: book.settings.loaded) { _, _ in seed() }
            .failureAlert($failure)
            .confirmDestructive(isPresented: $confirmingClear, title: "Clear the note?",
                                message: "Everyone stops seeing it.", action: "Clear note") { save("") }
            .interactiveDismissDisabled(saving)
        }
        .presentationDetents([.medium, .large])
        .savedFeedback(trigger: saved)
    }

    private func seed() {
        guard !loaded, House.isDemo || book.settings.loaded else { return }
        text = Self.current(book); loaded = true
    }

    private func save(_ value: String) {
        guard session.isOwner, loaded, !saving else { return }
        saving = true
        Task { @MainActor in
            do {
                if House.isDemo {
                    DemoTeamNote.shared.text = value
                } else {
                    _ = try await ERPAPI.shared.write("updateSettings", ["patch": ["teamNote": value]])
                }
                WidgetCenter.shared.reloadAllTimelines()
                saved += 1
                dismiss()
            } catch { failure = error.localizedDescription }
            saving = false
        }
    }
}
