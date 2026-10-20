import SwiftUI

/// Your businesses (`/app/businesses`, and the sheet the chip opens): the ones this phone holds, which is open, who is
/// signed in to each, and the way to add another by its ERP's address. One app, many businesses (Config/Businesses.swift):
/// Taheri and House of Mina ship in it; a business is added by typing its address, and its ERP describes itself
/// (`GET /api/app/business`). Each keeps its own sign-in, books, drafts, alerts and widget on this phone.
struct BusinessesScreen: View {
    /// In the chip's sheet: it has its own Close, and leaves when a business is chosen.
    var inSheet = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(LaunchPicker.key) private var askAtLaunch = true
    @FocusState private var typing: Bool
    /// The email signed in to each business, by id; read once the screen is up (it makes each business's Firebase app).
    @State private var who: [String: String] = [:]
    @State private var address = ""
    @State private var phase = Phase.idle
    /// What the last look-up found, shown as a card until it is added or dropped.
    @State private var preview: Business?
    @State private var removing: Business?
    @State private var note: Note?
    /// Bumped on the event (a business chosen, one added) so the tap is felt once.
    @State private var chosenTick = 0
    @State private var addedTick = 0

    private enum Phase: Equatable {
        case idle, looking, adding
        case failed(String)
    }

    var body: some View {
        let store = Businesses.shared
        Form {
            Group {
                Section {
                    ForEach(store.list) { b in row(b, open: b.id == store.current.id) }
                        .onDelete { offsets in
                            if let i = offsets.first, store.list.indices.contains(i) { removing = store.list[i] }
                        }
                } header: {
                    LedgerHeading(title: "Your businesses", count: store.list.count)
                } footer: {
                    Text("Each business keeps its own sign-in, books, drafts and alerts on this phone.")
                }
                if store.list.count > 1 && !House.isDemo {
                    Section {
                        Toggle("Ask which business on opening", isOn: $askAtLaunch)
                            .savedFeedback(trigger: askAtLaunch)
                    }
                }
                addSection
            }
            .houseRows()
            if let preview { previewSection(preview) }
        }
        .modifier(HouseGround())
        .navigationTitle("Businesses")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if inSheet {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { store.switcherOpen = false }
                }
            }
            if store.list.count > 1 { ToolbarItem(placement: .primaryAction) { EditButton() } }
        }
        .noteToast($note)
        .selectionFeedback(trigger: chosenTick)
        .savedFeedback(trigger: addedTick)
        .scrollDismissesKeyboard(.interactively)
        .failureAlert(Binding(
            get: { if case .failed(let why) = phase { return why } else { return nil } },
            set: { if $0 == nil { phase = .idle } }
        ), title: "Couldn't add that business")
        .task { refreshWho() }
        .onChange(of: store.list) { _, _ in refreshWho() }
        .confirmationDialog(removing.map { ($0.art != nil ? "Hide " : "Remove ") + $0.displayName + " on this phone?" } ?? "",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button(removing?.art != nil ? "Hide on this phone" : "Remove from this phone", role: .destructive) {
                if let b = removing { remove(b) }
            }
        } message: {
            Text("You are signed out of it here and its books are cleared from this phone. Nothing in the ERP itself changes."
                 + (removing?.art != nil ? " You can add it back by its address." : ""))
        }
    }

    // MARK: Businesses

    private func row(_ b: Business, open isOpen: Bool) -> some View {
        Button { choose(b) } label: {
            HStack(spacing: 14) {
                BusinessBadge(business: b, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(b.displayName).font(.headline).foregroundStyle(.primary).lineLimit(1)
                    Text(b.host).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    status(b)
                }
                Spacer(minLength: 8)
                if isOpen {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent).accessibilityLabel("Open now")
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .deleteDisabled(Businesses.shared.list.count <= 1)
        .contextMenu {
            if Businesses.shared.list.count > 1 {
                Button(b.art != nil ? "Hide on this phone" : "Remove from this phone", systemImage: "trash", role: .destructive) { removing = b }
            }
        }
        .accessibilityIdentifier("business.row.\(b.id)")
        .accessibilityHint(isOpen ? "Open now" : "Opens this business")
    }

    @ViewBuilder private func status(_ b: Business) -> some View {
        if House.isDemo {
            Label("Demo: made-up books", systemImage: "play.circle").font(.caption).foregroundStyle(.secondary)
        } else if b.firebaseOptions == nil {
            Label("iPhone sign-in not set up", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Tone.owed.color)
        } else if let email = who[b.id] {
            // Signed in is the normal state: the email in quiet words, no tick (rule 15).
            Text(email).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        } else {
            Label("Signed out", systemImage: "person.crop.circle.badge.questionmark").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func refreshWho() {
        var next: [String: String] = [:]
        for b in Businesses.shared.list {
            if let user = Businesses.shared.auth(for: b)?.currentUser { next[b.id] = user.email ?? "Signed in" }
        }
        who = next
    }

    private func choose(_ b: Business) {
        let store = Businesses.shared
        guard b.id != store.current.id else {
            if inSheet { store.switcherOpen = false }
            return
        }
        chosenTick += 1
        // The root is rebuilt on the new business (ERPApp); the sheet, which sits above it, goes with the change.
        Motion.run(Motion.travel, reduce: reduceMotion) {
            store.switch(to: b.id)
            store.switcherOpen = false
        }
    }

    private func remove(_ b: Business) {
        removing = nil
        Task {
            await Businesses.shared.remove(b.id)
            Note.show(Note(title: b.art != nil ? "Hidden on this phone" : "Removed from this phone", detail: b.displayName),
                      in: $note, reduce: reduceMotion)
            refreshWho()
        }
    }

    // MARK: Adding

    private var addSection: some View {
        Section {
            TextField("erp.houseofmina.store", text: $address)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textContentType(.URL)
                .submitLabel(.go)
                .focused($typing)
                .onSubmit(lookUp)
                .disabled(House.isDemo || phase == .looking || phase == .adding)
                .accessibilityIdentifier("business.address")
                .onChange(of: address) { _, _ in
                    // Typing again withdraws a preview or an error that belonged to the old address.
                    guard phase != .looking, phase != .adding else { return }
                    Motion.run(reduce: reduceMotion) { phase = .idle; preview = nil }
                }
            Button(phase == .looking ? "Looking…" : "Look up") { lookUp() }
                .disabled(House.isDemo || address.trimmingCharacters(in: .whitespaces).isEmpty || phase == .looking || phase == .adding)
        } header: {
            LedgerHeading(title: "Add a business")
        } footer: {
            Text(House.isDemo ? "The demo can't add a business."
                 : "Type the address of the business's ERP, like erp.houseofmina.store. You'll see its name, logo and colours before it is added, then sign in with the Gmail it has for you.")
        }
    }

    private func lookUp() {
        guard !House.isDemo, phase != .looking, phase != .adding else { return }
        typing = false
        Motion.run(reduce: reduceMotion) { phase = .looking; preview = nil }
        let typed = address
        Task {
            do {
                let found = try await Businesses.shared.describe(address: typed)
                Motion.run(reduce: reduceMotion) { phase = .idle; preview = found }
            } catch {
                Motion.run(reduce: reduceMotion) { phase = .failed(error.localizedDescription) }
            }
        }
    }

    private func previewSection(_ b: Business) -> some View {
        let known = Businesses.shared.business(b.id) != nil
        return Section {
            SectionCard("Found") {
                HStack(spacing: 14) {
                    BusinessBadge(business: b, size: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.displayName).font(.headline)
                        Text(b.host).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                BusinessLogo(business: b)
                HStack(spacing: 8) {
                    ForEach(Array([b.palette.light.accent, b.palette.light.ground, b.palette.dark.accent, b.palette.dark.ground].enumerated()), id: \.offset) { item in
                        Circle().fill(Color(hex: item.element) ?? .gray).frame(width: 22, height: 22)
                            .overlay { Circle().strokeBorder(.primary.opacity(0.18), lineWidth: 0.5) }
                    }
                    Text("Its colours, light and dark").font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                if known {
                    Label("Already on this phone: adding it again refreshes how it looks.", systemImage: "info.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button { add() } label: {
                    Label(phase == .adding ? "Adding…" : known ? "Refresh and open \(b.name)" : "Add \(b.name)", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
                .disabled(phase == .adding)
                Button("Not this one", role: .cancel) {
                    Motion.run(reduce: reduceMotion) { preview = nil }
                }
                .frame(maxWidth: .infinity)
                .disabled(phase == .adding)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .transition(.opacity)
        }
    }

    private func add() {
        guard preview != nil, phase != .adding else { return }
        let typed = address
        Motion.run(reduce: reduceMotion) { phase = .adding }
        Task {
            do {
                let added = try await Businesses.shared.add(address: typed)
                addedTick += 1
                address = ""
                phase = .idle
                preview = nil
                // Opened at once: the next step is signing in to it.
                Motion.run(Motion.travel, reduce: reduceMotion) {
                    Businesses.shared.switch(to: added.id)
                    Businesses.shared.switcherOpen = false
                }
            } catch {
                Motion.run(reduce: reduceMotion) { phase = .failed(error.localizedDescription) }
            }
        }
    }
}
