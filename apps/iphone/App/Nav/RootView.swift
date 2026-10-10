import WidgetKit
import SwiftUI
import Observation

/// Signed in or not, owner or karigar: which app this person gets.
struct RootGate: View {
    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @AppStorage("deviceTheme") private var deviceTheme = ""

    private var preferredScheme: ColorScheme? {
        let theme = deviceTheme.isEmpty ? (book.settings.value?.theme ?? "") : deviceTheme
        if theme == "default" { return .light }
        if theme == "taheri" || theme == "slate" { return .dark }
        return nil
    }

    var body: some View {
        Group {
            switch session.state {
            case .starting:
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.ground)
            case .signedOut, .signingIn, .needsSetup:
                SignInView()
            case .signedIn:
                if session.role == "karigar" {
                    // A karigar's own work, native (MyWorkScreen reads the portal's /api/karigar/me; the ERP's /my-work).
                    NavigationStack { MyWorkScreen(path: "/my-work") }
                } else {
                    RootView()
                }
            }
        }
        .preferredColorScheme(preferredScheme)
    }
}

/// The app: the shop's four most-used places as tabs, the ERP's whole map under Search, and New sale / New order / Scan always one tap away above the tab bar.
/// A marketing account gets its own three (Posts, Website, Ads) and no bar: the ERP gives it nothing else.
/// Liquid Glass comes with the system's TabView, toolbars and sheets (CONVENTIONS.md rule 4).
struct RootView: View {
    @Environment(Session.self) private var session
    // The simulator check opens each tab in turn (`-ERPDemoTab orders`).
    @State private var tab = UserDefaults.standard.string(forKey: "ERPDemoTab") ?? "home"
    @State private var creating: Route?
    @State private var voice = false

    private var map: NavMap { NavMap.current.visible(to: session.role) }
    private static let primary = ["home", "orders", "invoices", "customers"]
    private var online: OnlineInbox { .shared }

    /// The tabs before Search. Marketing has no dashboard: the ERP sends it to Posts, the first page it may open.
    private func tabEntries(_ map: NavMap) -> [NavEntry] {
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

    var body: some View {
        let map = map
        let entries = tabEntries(map)
        TabView(selection: selection(entries)) {
            ForEach(entries) { e in
                Tab(e.id == "home" ? "Home" : e.label, systemImage: NavIcon.symbol(for: e.icon), value: e.id) {
                    NavigationStack {
                        PlaceScreen(path: e.href, isRoot: true)
                            .modifier(CreateAccessory(map: map, shown: session.role != "marketing", voiceShown: session.isOwner,
                                                      open: { creating = Route(path: $0) }, talk: { voice = true }))
                            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
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
            }
        }
        .sheet(isPresented: $voice) {
            NavigationStack {
                NativeVoiceScreen { path in voice = false; creating = Route(path: path) }
            }
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
        }
        // The one poll of the online-orders count (the dashboard and the Orders badge both read it).
        .task(id: watchesOnline) {
            if watchesOnline { await OnlineInbox.shared.keep() }
        }
        // The simulator check opens one page over the tabs (`-ERPDemoOpen /invoices/INV-D0002`).
        .task {
            if House.isDemo, let p = UserDefaults.standard.string(forKey: "ERPDemoOpen"), p.hasPrefix("/") { creating = Route(path: p) }
        }
        // A tapped notification opens its page over whatever is showing.
        .onChange(of: AppRouter.shared.open) { _, r in
            if let r { creating = r; AppRouter.shared.open = nil }
        }
    }
}

/// Two floating controls leave the page itself free of repeated shortcuts.
private struct CreateAccessory: ViewModifier {
    let map: NavMap
    let shown: Bool
    let voiceShown: Bool
    let open: (String) -> Void
    let talk: () -> Void
    @State private var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .safeAreaPadding(.bottom, shown ? 76 : 0)
            .onScrollPhaseChange { _, phase in
                if phase != .idle { compact = true }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > 24
            } action: { _, scrolled in
                compact = scrolled
            }
            .overlay(alignment: .bottomTrailing) {
            if shown {
                GlassEffectContainer(spacing: compact ? 8 : 12) {
                    HStack(spacing: compact ? 8 : 12) {
                        if voiceShown {
                            Button(action: talk) {
                                Image(systemName: "mic.fill")
                                    .font(.system(size: compact ? 16 : 20))
                                    .frame(width: compact ? 44 : 52, height: compact ? 44 : 52)
                            }
                            .buttonStyle(.glass).buttonBorderShape(.circle)
                            .accessibilityLabel("Voice assistant")
                        }
                        Menu {
                            if let sale = map.newSale {
                                Button("New sale", systemImage: "banknote") { open(sale.href) }
                            }
                            Button("New order", systemImage: "list.clipboard") { open("/orders/add") }
                            Button("Scan", systemImage: "qrcode.viewfinder") { open("/scan") }
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: compact ? 18 : 22, weight: .semibold))
                                .frame(width: compact ? 44 : 52, height: compact ? 44 : 52)
                                .foregroundStyle(Theme.onAccent)
                        }
                        .buttonStyle(.glassProminent).buttonBorderShape(.circle)
                        .accessibilityLabel("Create: new sale, new order or scan")
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 8)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: compact)
            }
        }
    }
}

/// A tab's own stack, starting at an ERP place.
struct PlaceStack: View {
    let root: String
    var body: some View {
        NavigationStack {
            PlaceScreen(path: root, isRoot: true)
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
        }
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
    @State private var chosen: String?

    var body: some View {
        let bare = ScreenRoute.bare(path)
        // The map as this person sees it: staff are not offered Today's cash among Home's tabs.
        let entry = NavMap.current.visible(to: session.role).entry(for: path)
        let atTab = entry.map { e in bare == e.href || (e.tabs ?? []).contains { $0.href == bare } } ?? false
        let tabs = atTab ? (entry?.tabs ?? []) : []
        let current = chosen ?? path
        let title = tabs.first { $0.href == ScreenRoute.bare(current) }?.title
            ?? (entry?.href == ScreenRoute.bare(current) ? (entry?.heading ?? entry?.label) : nil)
        ScreenRegistry.view(for: current)
            .id(current)
            // A native screen names itself (and a hub keeps its large title); an ERP page is named from the map.
            .modifier(WebTitle(title: ScreenRegistry.hasNative(current) ? nil : (title ?? "")))
            .modifier(TabsMenu(tabs: tabs, chosen: $chosen))
            // Native screens sit on the house's ground; an ERP page brings its own (the same palette).
            .modifier(OptionalGround(on: ScreenRegistry.hasNative(current)))
            .modifier(TeamNotePresentation())
            .toolbar {
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
    }
}

private struct OptionalGround: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.modifier(HouseGround()) } else { content }
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

private struct TabsMenu: ViewModifier {
    let tabs: [NavPlace]
    @Binding var chosen: String?

    func body(content: Content) -> some View {
        if tabs.count > 1 {
            content.toolbarTitleMenu {
                ForEach(tabs) { t in
                    Button { chosen = t.href } label: { Label(t.label, systemImage: NavIcon.symbol(for: t.icon)) }
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

struct TeamNotePresentation: ViewModifier {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var reading = false
    @State private var editing = false
    private var text: String { TeamNoteEditor.current(book) }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if !text.isEmpty {
                    HStack(alignment: .top, spacing: 12) {
                        Button { reading = true } label: {
                            VStack(alignment: .leading, spacing: 5) {
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
                                .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                        }
                    }
                    .padding(12)
                    .background(Theme.card, in: .rect(cornerRadius: 16))
                    .overlay(alignment: .leading) { Capsule().fill(Theme.accent).frame(width: 3).padding(.vertical, 12) }
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .background(Theme.ground)
                }
            }
            .task { book.settings.need() }
            .sheet(isPresented: $editing) { TeamNoteEditor() }
            .sheet(isPresented: $reading) {
                NavigationStack {
                    ScrollView { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding(20) }
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
                    Text("Visible to everyone until cleared. Up to 600 characters.")
                }
                .houseRows()
                if !Self.current(book).isEmpty {
                    Section {
                        Button("Clear note", role: .destructive) { save("") }
                            .disabled(saving)
                    }.houseRows()
                }
                if let failure { Section { Text(failure).foregroundStyle(.red) }.houseRows() }
            }
            .modifier(HouseGround())
            .navigationTitle("Urgent note").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
                        .disabled(!loaded || saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 600 || !session.isOwner)
                }
            }
            .onAppear { book.settings.need(); seed() }
            .onChange(of: book.settings.loaded) { _, _ in seed() }
        }
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
                dismiss()
            } catch { failure = error.localizedDescription }
            saving = false
        }
    }
}
