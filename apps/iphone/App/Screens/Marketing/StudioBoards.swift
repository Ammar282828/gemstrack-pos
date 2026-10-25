import SwiftUI
import ERPCore

/// Studio → Board (src/app/ads/studio/board.tsx), native: an endless canvas of designs side by side and sticky
/// notes, over the same transactional board the browser and a connected agent use. On an iPad the chosen
/// design's tools sit in a column beside the canvas; on an iPhone they rise as a sheet the canvas stays usable
/// behind.
struct StudioBoards: View {
    let model: StudioModel
    @State private var board = StudioBoardModel()
    @State private var selected = ""
    @State private var zoom = 0.55
    @GestureState private var pinch = 1.0
    @GestureState private var dragOffset = CGSize.zero
    @State private var draggingID = ""
    @State private var viewport = CGSize(width: 390, height: 600)
    @State private var position = ScrollPosition()
    @State private var fitted = ""
    @State private var inspectorShown = false
    /// The board's own width: below this the inspector covers the canvas (iPad mini, Split View), so it opens only for a choice.
    @State private var width = 0.0
    @State private var sheet: BoardSheet?
    @State private var asking: BoardQuestion?
    @State private var nameText = ""
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var note: Note?
    #if os(macOS)
    /// A design or note the Delete key or the right-click menu asked to remove (asks first).
    @State private var removing: BoardRemoval?
    #endif

    private var compact: Bool { sizeClass == .compact }
    private var z: Double { min(1.5, max(0.08, zoom * pinch)) }
    private var selFrame: MarketingValue? { board.frame(selected) }
    private var selNote: MarketingValue? { board.note(selected) }
    /// On an iPhone the inspector is itself a sheet: what it opens must open from it, not from under it.
    private var inspectorIsSheet: Bool { compact && inspectorShown }
    /// Too narrow to keep the inspector beside the canvas: it comes with a chosen design or note, as on an iPhone.
    private var narrow: Bool { compact || width < 1000 }

    var body: some View {
        presentations(screen, active: !inspectorIsSheet)
    }

    private var screen: some View {
        VStack(spacing: 0) {
            banners
            GeometryReader { geo in
                canvas
                    .onAppear { viewport = geo.size }
                    .onChange(of: geo.size) { _, size in viewport = size }
            }
        }
        .accessibilityIdentifier("studio.board")
        // The strip of tools is the control layer: pinned at the foot, in reach of a thumb, not scrolling with the page.
        #if os(macOS)
        .toolbar { macToolbar }
        .confirmDestructive(isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            title: removing?.note == true ? "Remove this note?" : "Remove this design?",
                            message: removing?.note == true ? nil : "It comes off the board.", action: "Remove") {
            if let r = removing {
                if selected == r.id { selected = "" }
                Task { await board.change([["op": r.note ? "noteRemove" : "remove", "id": r.id]]) }
            }
            removing = nil
        }
        .navigationSubtitle(board.value.s("name"))
        #else
        .safeAreaBar(edge: .bottom, spacing: 0) { controls }
        #endif
        .noteToast($note)
        .onChange(of: board.said) { _, said in
            guard let said else { return }
            Note.show(Note(title: said), in: $note, reduce: reduceMotion)
            board.said = nil
        }
        .inspector(isPresented: $inspectorShown) {
            presentations(inspector, active: inspectorIsSheet)
                .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
                .presentationDetents([.height(340), .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .height(340)))
        }
        .task {
            board.catalogue = model.catalogue
            await board.loadList(initial: true)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(board.agentBusy ? 1.5 : 4)) } catch { break }
                // Not while a piece is held, nor while the app is in the background (no one is looking).
                if draggingID.isEmpty && scenePhase == .active { await board.refresh() }
            }
        }
        .onGeometryChange(for: Double.self) { $0.size.width } action: { w in
            // Measured with the inspector away (it takes its column from the board): the window's own room.
            let first = width == 0
            if first || !inspectorShown || narrow == false && w >= 1000 { width = w }
            if first && !narrow { inspectorShown = true }
        }
        .onChange(of: model.catalogue) { _, c in board.catalogue = c }
        .onChange(of: board.current) { _, _ in selected = "" }
        .onChange(of: selected) { _, id in if narrow { inspectorShown = !id.isEmpty } }
        .onChange(of: inspectorShown) { _, shown in if narrow && !shown { selected = "" } }
        .onChange(of: board.value.s("id")) { _, id in
            guard !id.isEmpty, fitted != id else { return }
            // After the canvas has its size: fitted against the default size, a big iPad board sat small.
            fitted = id
            Task { try? await Task.sleep(for: .milliseconds(300)); fit() }
            // The simulator check opens the designer on the demo board's first design (`-ERPDemoBoardEditor text`).
            if House.isDemo, UserDefaults.standard.string(forKey: "ERPDemoBoardEditor") != nil, let first = board.frames.first?.s("id") {
                Task { try? await Task.sleep(for: .milliseconds(900)); selected = first; sheet = .editor(first) }
            }
        }
        .websiteBusy(board.busy)
    }

    // MARK: Controls

    private var controls: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer {
                HStack(spacing: pt(10)) {
                    Menu {
                        ForEach(board.boards.map { $0.s("id") }, id: \.self) { id in
                            Button { Task { await board.choose(id) } } label: {
                                let b = board.boards.first { $0.s("id") == id } ?? .null
                                if id == board.current { Label(b.s("name"), systemImage: "checkmark") } else { Text(b.s("name")) }
                            }
                        }
                        Divider()
                        Button("New board…", systemImage: "plus") { nameText = "New board"; asking = .create }
                    } label: {
                        Label(board.value.s("name", board.current.isEmpty ? "Choose a board" : "Board"), systemImage: "rectangle.3.group")
                            .lineLimit(1).frame(maxWidth: 180)
                    }
                    .accessibilityLabel("Board")
                    Button("Add a photo", systemImage: "photo.badge.plus") { sheet = .picker }.labelStyle(.iconOnly).disabled(board.current.isEmpty)
                    Button("Add a note", systemImage: "note.text.badge.plus") { Task { if let id = await board.addNote() { selected = id } } }.labelStyle(.iconOnly).disabled(board.current.isEmpty)
                    HStack(spacing: 2) {
                        Button("Zoom out", systemImage: "minus.magnifyingglass") { zoom = max(0.08, zoom / 1.25) }.labelStyle(.iconOnly)
                        Text("\(Int((z * 100).rounded()))%").font(.caption).monospacedDigit().frame(minWidth: 40)
                        Button("Zoom in", systemImage: "plus.magnifyingglass") { zoom = min(1.5, zoom * 1.25) }.labelStyle(.iconOnly)
                    }
                    Button("Fit the board", systemImage: "arrow.up.left.and.arrow.down.right") { fit() }.labelStyle(.iconOnly).disabled(board.current.isEmpty)
                    Menu {
                        Button("This week’s board", systemImage: "calendar") { asking = .weekly }
                        Button("Connect an agent", systemImage: "key") { sheet = .agents }
                        Button("Tidy up", systemImage: "square.grid.2x2") { Task { await board.tidy() } }.disabled(board.frames.count < 2)
                        Button("Rename board", systemImage: "pencil") { nameText = board.value.s("name"); asking = .rename }.disabled(board.current.isEmpty)
                        Button("Refresh", systemImage: "arrow.clockwise") { Task { await board.refresh(force: true) } }
                        if !compact { Button(inspectorShown ? "Hide details" : "Show details", systemImage: "sidebar.trailing") { inspectorShown.toggle() } }
                        Divider()
                        Button("Delete board", systemImage: "trash", role: .destructive) { asking = .delete }.disabled(board.current.isEmpty)
                    } label: { Label("Board tools", systemImage: "ellipsis.circle").labelStyle(.iconOnly) }
                }
                .buttonStyle(.houseGlass)
                .padding(.horizontal, pt(16)).padding(.vertical, pt(6))
            }
        }
    }

    @ViewBuilder private var banners: some View {
        VStack(spacing: pt(6)) {
            if let working = board.working {
                banner(HStack(spacing: pt(10)) { SkeletonLoading(working); Text(working) })
            }
            if let offer = board.offer, offer.s("id") != board.current {
                banner(HStack {
                    Image(systemName: offer.s("by").hasPrefix("agent:") ? "sparkles" : "plus.rectangle.on.rectangle").foregroundStyle(Theme.accent)
                    Text((offer.s("by").hasPrefix("agent:") ? "The agent made a new board: " : "A new board: ") + offer.s("name"))
                    Spacer()
                    Button("Open it") { Task { await board.choose(offer.s("id")) } }.buttonStyle(.bordered)
                    Button("Not now", systemImage: "xmark") { board.offer = nil }.labelStyle(.iconOnly)
                })
            }
            if board.agentBusy {
                banner(Label("The agent is working on this board. Its designs appear as they come; keep the board open to draw them for it.", systemImage: "sparkles"))
            }
        }
        .padding(.horizontal, pt(16))
    }

    private func banner(_ content: some View) -> some View {
        content.font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
            .ledgerCard(padding: 10)
            .padding(.bottom, pt(4))
    }

    // MARK: The canvas

    private var canvas: some View {
        ScrollView([.horizontal, .vertical]) {
            if board.current.isEmpty {
                VStack(spacing: pt(16)) {
                    if !board.loaded { SkeletonLoading("Loading the boards") }
                    else if let problem = board.listProblem {
                        ErrorState(problem) { Task { await board.loadList(initial: true) } }
                    } else {
                        ContentUnavailableView("A place for your ideas", systemImage: "rectangle.3.group", description: Text("A board holds designs side by side — your own, the AI’s variants and an agent’s — with notes beside them."))
                        Button("Make the first board", systemImage: "plus") { nameText = "New board"; asking = .create }.buttonStyle(.bordered)
                    }
                }
                .frame(width: viewport.width, height: max(viewport.height, 300))
            } else if board.value == .null {
                SkeletonLoading("Opening the board").frame(width: viewport.width, height: max(viewport.height, 300))
            } else {
                let b = board.bounds
                ZStack(alignment: .topLeading) {
                    Color.clear.frame(width: max(b.width * z, viewport.width), height: max(b.height * z, viewport.height))
                        .contentShape(Rectangle())
                        .onTapGesture { selected = "" }
                    ForEach(board.frames.map { $0.s("id") }, id: \.self) { id in
                        if let f = board.frame(id) { frameCard(f, bounds: b) }
                    }
                    ForEach(board.notes.map { $0.s("id") }, id: \.self) { id in
                        if let n = board.note(id) { noteCard(n, bounds: b) }
                    }
                    if board.frames.isEmpty && board.notes.isEmpty {
                        Text("Add a photo to start, or connect an agent and ask it to fill the board.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            .frame(width: viewport.width, height: viewport.height)
                    }
                }
            }
        }
        .scrollPosition($position)
        .background(Theme.ground)
        .simultaneousGesture(
            MagnifyGesture()
                .updating($pinch) { v, s, _ in s = v.magnification }
                .onEnded { v in zoom = min(1.5, max(0.08, zoom * v.magnification)) }
        )
        #if os(macOS)
        // ⌘ and scroll zoom; Delete removes the chosen design or note, after asking.
        .macScrollZoom { (factor: Double) in zoom = min(1.5, max(0.08, zoom * factor)) }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(keys: [.delete, .deleteForward]) { _ in
            guard !selected.isEmpty else { return .ignored }
            removing = BoardRemoval(id: selected, note: selNote != nil)
            return .handled
        }
        #endif
    }

    private func fit() {
        zoom = board.fitZoom(in: viewport)
        position.scrollTo(point: .zero)
    }

    private func offset(_ item: MarketingValue, bounds b: CGRect, top: Double = 0) -> CGSize {
        let moving = draggingID == item.s("id") ? dragOffset : .zero
        return CGSize(width: (item.n("x") - b.minX) * z + moving.width, height: (item.n("y") - top - b.minY) * z + moving.height)
    }

    private func frameCard(_ f: MarketingValue, bounds b: CGRect) -> some View {
        let id = f.s("id"), px = board.pixels(f)
        let w = px.width * StudioBoardModel.scale * z, h = px.height * StudioBoardModel.scale * z
        let isSelected = selected == id
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: pt(4)) {
                if f.s("by") == "agent" { Image(systemName: "cpu") }
                if f.s("by") == "ai" { Image(systemName: "sparkles") }
                Text(f.s("label", "Design")).lineLimit(1)
            }
            .font(.system(size: max(9, 13 * z))).foregroundStyle(.secondary)
            .frame(width: w, height: StudioBoardModel.label * z, alignment: .leading)
            ZStack {
                Rectangle().fill(Theme.card)
                if let image = board.pictures[id] { Image(uiImage: image).resizable().scaledToFill() }
                else if let problem = board.problems[id] { Text("Couldn’t draw it: " + problem).font(.caption2).foregroundStyle(.secondary).padding(pt(6)) }
                else { SkeletonLoading("Drawing") }
            }
            .frame(width: w, height: h).clipped()
            .overlay {
                Rectangle().strokeBorder(isSelected ? Theme.accent : board.fresh.contains(id) ? Color.cyan : Color.secondary.opacity(0.2), lineWidth: isSelected ? 3 : board.fresh.contains(id) ? 6 : 0.5)
            }
            .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
        }
        .offset(offset(f, bounds: b, top: StudioBoardModel.label))
        .onTapGesture(count: 2) { selected = id; sheet = .editor(id) }
        .onTapGesture { selected = id }
        .gesture(moveGesture(id: id, isNote: false, origin: f), including: isSelected ? .all : .subviews)
        #if os(macOS)
        .contextMenu { macFrameMenu(f) }
        #endif
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Design: " + f.s("label", "Design"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { selected = id }
        .accessibilityAction(named: "Edit design") { selected = id; sheet = .editor(id) }
    }

    private func noteCard(_ n: MarketingValue, bounds b: CGRect) -> some View {
        let id = n.s("id"), agent = n.s("by") == "agent"
        let isSelected = selected == id
        return VStack(alignment: .leading, spacing: pt(4) * z) {
            Text(agent ? "AGENT" : "NOTE").font(.system(size: max(8, 11 * z), weight: .semibold)).opacity(0.6)
            Text(n.s("text")).font(.system(size: max(9, 15 * z))).lineLimit(10)
        }
        .padding(12 * z)
        .frame(width: StudioBoardModel.noteSize.width * z, alignment: .topLeading)
        // A sticky note's own paper (blue for the agent's, yellow for a person's): content colours that are the note's
        // data, like a design's pixels, so they stay the same in light and dark.
        .foregroundStyle(agent ? Color(red: 0.03, green: 0.18, blue: 0.29) : Color(red: 0.27, green: 0.18, blue: 0.05))
        .background(agent ? Color(red: 0.88, green: 0.95, blue: 1.0) : Color(red: 0.99, green: 0.93, blue: 0.71), in: .rect(cornerRadius: Radius.thumb, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).strokeBorder(isSelected ? Theme.accent : .clear, lineWidth: 3) }
        .shadow(color: .black.opacity(0.1), radius: 3, y: 1)
        .offset(offset(n, bounds: b))
        .onTapGesture { selected = id }
        .gesture(moveGesture(id: id, isNote: true, origin: n), including: isSelected ? .all : .subviews)
        #if os(macOS)
        .contextMenu {
            Button("Show its details", systemImage: "sidebar.trailing") { selected = id; inspectorShown = true }
            Divider()
            Button("Remove the note…", systemImage: "trash", role: .destructive) { removing = BoardRemoval(id: id, note: true) }
        }
        #endif
        .accessibilityElement(children: .combine)
        .accessibilityLabel((agent ? "Note from the agent: " : "Note: ") + n.s("text"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { selected = id }
    }

    /// Dragging a chosen design or note moves it; the board itself scrolls under an unchosen one.
    private func moveGesture(id: String, isNote: Bool, origin: MarketingValue) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .updating($dragOffset) { v, s, _ in s = v.translation }
            .onChanged { _ in if draggingID != id { draggingID = id } }
            .onEnded { v in
                let x = origin.n("x") + v.translation.width / z, y = origin.n("y") + v.translation.height / z
                draggingID = ""
                Task { await board.change([["op": isNote ? "noteMove" : "move", "id": id, "x": Double(x), "y": Double(y)]]) }
            }
    }

    // MARK: The inspector

    private var inspector: some View {
        Form {
            if let f = selFrame {
                StudioFramePanel(frame: f, board: board,
                                 edit: { sheet = .editor(f.s("id")) },
                                 share: { share(f) },
                                 queue: { sheet = .queue(f.s("id")) },
                                 newAd: { Task { if let route = await board.newAd(f) { model.route = route } } },
                                 removed: { selected = "" })
                    .id(f.s("id"))
            } else if let n = selNote {
                StudioNotePanel(note: n, board: board, removed: { selected = "" }).id(n.s("id"))
            } else {
                boardPanel
            }
        }
        .modifier(HouseGround())
        #if os(macOS)
        .formStyle(.grouped)
        #endif
        .navigationTitle(selFrame != nil ? "Design" : selNote != nil ? "Note" : "Board")
    }

    @ViewBuilder private var boardPanel: some View {
        if board.current.isEmpty {
            Section { Text("Make or choose a board to begin.").foregroundStyle(.secondary) }.houseRows()
        } else {
            Section {
                StudioBoardNameField(value: board.value.s("name")) { name in Task { await board.rename(name) } }
                Text(boardLine).font(.footnote).foregroundStyle(.secondary)
            } header: { LedgerHeading(title: "This board") }.houseRows()
            Section {
                #if os(macOS)
                Text("Click a design to edit it, cook variants of it, or make it in another shape. Double-click opens the designer; right-click for more. Drag a chosen design or note to move it; pinch, or hold ⌘ and scroll, to zoom. Delete removes the chosen one.")
                    .font(.footnote).foregroundStyle(.secondary)
                #else
                Text("Tap a design to edit it, cook variants of it, or make it in another shape. Double-tap opens the designer. Drag a chosen design or note to move it; pinch to zoom.")
                    .font(.footnote).foregroundStyle(.secondary)
                #endif
                Button("Delete board", systemImage: "trash", role: .destructive) { asking = .delete }
            }.houseRows()
        }
    }

    private var boardLine: String {
        let v = board.value
        var s = "\(v["frames"].array.count) designs · \(v["notes"].array.count) notes"
        if let at = ERPDate.parse(v.s("updated")) { s += " · changed " + ShopDate.stamp(at, withTime: true) }
        if v.s("by").hasPrefix("agent:") { s += " by the agent" }
        return s
    }

    private func share(_ f: MarketingValue) {
        Task { await board.run("Drawing…") {
            let rendered = try await board.render(f)
            let base = (board.fields(f)["headline"] ?? "").isEmpty ? f.s("label", "design") : board.fields(f)["headline"] ?? "design"
            let url = try SettingsFiles.save(rendered.jpeg, named: base + "-" + f.s("format", "design") + ".jpg")
            sheet = .share(MarketingFileShare(items: [url]))
        } }
    }

    // MARK: Sheets and questions

    /// Every sheet and question of the board, attached where it can be shown: the inspector when it is a sheet,
    /// the board otherwise (a sheet can't open from under another).
    private func presentations<V: View>(_ content: V, active: Bool) -> some View {
        content
            .sheet(item: Binding(get: { active ? sheet : nil }, set: { sheet = $0 })) { s in
                switch s {
                case .editor(let id): StudioBoardEditor(frameID: id, board: board)
                case .queue(let id): if let f = board.frame(id) { StudioBoardQueueSheet(frame: f, board: board).presentationSizing(.form) }
                case .picker: StudioBoardPhotoPicker(board: board) { item, format in
                    sheet = nil
                    Task { if let id = await board.add(item, format: format) { selected = id } }
                }
                .presentationSizing(.page)
                case .agents: StudioAgentSettings()
                case .share(let files): MarketingShareSheet(items: files.items)
                }
            }
            .alert(asking == .rename ? "Rename board" : "New board", isPresented: Binding(get: { active && (asking == .create || asking == .rename) }, set: { if !$0 { asking = nil } })) {
                TextField("Name", text: $nameText)
                Button(asking == .rename ? "Rename" : "Create") {
                    let name = nameText.trimmingCharacters(in: .whitespacesAndNewlines), renaming = asking == .rename
                    Task { if renaming { await board.rename(name) } else { await board.create(name) } }
                }
                .disabled(nameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete “\(board.value.s("name"))” and its \(board.frames.count) designs?", isPresented: Binding(get: { active && asking == .delete }, set: { if !$0 { asking = nil } }), titleVisibility: .visible) {
                Button("Delete board", role: .destructive) { selected = ""; Task { await board.delete() } }
            }
            .confirmationDialog("Make this week’s board now? It designs up to six of the week’s new pieces (about a minute each).", isPresented: Binding(get: { active && asking == .weekly }, set: { if !$0 { asking = nil } }), titleVisibility: .visible) {
                Button("Make it") { Task { await board.weekly() } }
            }
            .failureAlert(Binding(get: { active ? board.error : nil }, set: { board.error = $0 }), title: "Could not finish")
    }
}

enum BoardSheet: Identifiable {
    case editor(String), queue(String), picker, agents, share(MarketingFileShare)
    var id: String {
        switch self {
        case .editor(let id): "editor-" + id
        case .queue(let id): "queue-" + id
        case .picker: "picker"
        case .agents: "agents"
        case .share(let s): "share-" + s.id.uuidString
        }
    }
}

enum BoardQuestion { case create, rename, delete, weekly }

// MARK: The chosen design

private struct StudioFramePanel: View {
    let frame: MarketingValue
    let board: StudioBoardModel
    let edit: () -> Void
    let share: () -> Void
    let queue: () -> Void
    let newAd: () -> Void
    let removed: () -> Void
    @State private var label = ""
    @State private var count = 4
    @State private var brief = ""
    /// Removed: its name isn't saved on the way out (that would be sent for a design that is gone).
    @State private var gone = false

    private var ownNotes: [MarketingValue] {
        board.notes.filter { $0.s("by") == "page" && !$0.s("text").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.s("text").trimmingCharacters(in: .whitespaces) != "Note" }
    }

    var body: some View {
        Section {
            TextField("Design name", text: $label).font(.headline)
                .onSubmit { save() }
            Text(info).font(.footnote).foregroundStyle(.secondary)
            if !frame.s("why").isEmpty { Text(frame.s("why")).font(.footnote).italic().foregroundStyle(.secondary) }
            Button("Edit design", systemImage: "slider.horizontal.3", action: edit)
            Button("Download or share", systemImage: "square.and.arrow.up", action: share)
            Button("Duplicate", systemImage: "plus.square.on.square") { Task { await board.duplicate(frame) } }
            Button("Remove design", systemImage: "trash", role: .destructive) {
                let id = frame.s("id"); gone = true; removed()
                Task { await board.change([["op": "remove", "id": id]]) }
            }
        } header: { LedgerHeading(title: "Design") }.houseRows()
        .task(id: frame.s("label")) { label = frame.s("label") }
        .onDisappear { save() }

        Section {
            Button("Queue a post — WhatsApp, Instagram", systemImage: "paperplane", action: queue)
            Button("Use in a new Meta ad", systemImage: "megaphone", action: newAd)
            Button("Save to Saved ads", systemImage: "folder") { Task { await board.saveToSaved(frame) } }
        } header: { LedgerHeading(title: "Use it") }.houseRows()

        Section {
            Text("The AI designs variants of this one, each from a different angle, side by side.").font(.footnote).foregroundStyle(.secondary)
            TextField("Aim (optional) — e.g. Eid gifting", text: $brief, axis: .vertical).lineLimit(2...5)
            if !ownNotes.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: pt(6)) {
                        ForEach(ownNotes.prefix(4).map { $0.s("text") }, id: \.self) { text in
                            Button("Use note: " + String(text.prefix(40))) { brief = text }
                                .font(.caption).buttonStyle(.bordered)
                        }
                    }
                }
            }
            Stepper("\(count) variants", value: $count, in: 2...6)
            Button("Cook \(count)", systemImage: "sparkles") { Task { await board.cook(frame, count: count, brief: brief) } }
                .buttonStyle(.bordered)
                .disabled(board.working != nil || frame.s("assetId").isEmpty)
            if frame.s("assetId").isEmpty { Text("This design has no photo to work from.").font(.footnote).foregroundStyle(.secondary) }
        } header: { LedgerHeading(title: "Let it cook") }.houseRows()

        Section {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: pt(8))], spacing: pt(8)) {
                ForEach(board.formats.map { $0.s("id") }.filter { $0 != frame.s("format") }, id: \.self) { id in
                    Button(board.formatInfo(id).s("short", id)) { Task { await board.duplicate(frame, format: id) } }
                        .buttonStyle(.bordered).frame(maxWidth: .infinity)
                        .accessibilityLabel("Make it " + board.formatInfo(id).s("label", id))
                }
            }
            .padding(.vertical, pt(4))
        } header: { LedgerHeading(title: "In another shape") }.houseRows()
    }

    private var info: String {
        var parts = [board.formatInfo(frame.s("format", "portrait")).s("label", frame.s("format")), board.templateLabel(frame.s("template"))]
        if frame.s("by") == "agent" { parts.append("by the agent") } else if frame.s("by") == "ai" { parts.append("by the AI") }
        return parts.joined(separator: " · ")
    }

    private func save() {
        let clean = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !gone else { return }
        // An emptied name goes back to the one it had rather than leaving the design unnamed.
        if clean.isEmpty { label = frame.s("label"); return }
        guard clean != frame.s("label") else { return }
        let id = frame.s("id")
        Task { await board.change([["op": "put", "id": id, "patch": ["label": clean]]]) }
    }
}

private struct StudioNotePanel: View {
    let note: MarketingValue
    let board: StudioBoardModel
    let removed: () -> Void
    @State private var text = ""
    @State private var gone = false
    @State private var removing = false

    var body: some View {
        Section {
            TextField("Note", text: $text, axis: .vertical).lineLimit(3...12)
            Button("Save note") { save() }.disabled(text == note.s("text"))
            Text("A note is a brief for Let it cook, and the first thing a connected agent reads.").font(.footnote).foregroundStyle(.secondary)
        } header: { LedgerHeading(title: note.s("by") == "agent" ? "Note from the agent" : "Note") }.houseRows()
        .task(id: note.s("text")) { text = note.s("text") }
        .onDisappear { save() }
        Section {
            Button("Remove the note", systemImage: "trash", role: .destructive) { removing = true }
        }.houseRows()
        .confirmDestructive(isPresented: $removing, title: "Remove this note?", action: "Remove") {
            let id = note.s("id"); gone = true; removed()
            Task { await board.change([["op": "noteRemove", "id": id]]) }
        }
    }

    private func save() {
        guard !gone, text != note.s("text") else { return }
        let id = note.s("id"), words = text
        Task { await board.change([["op": "noteText", "id": id, "text": words]]) }
    }
}

private struct StudioBoardNameField: View {
    let value: String
    let save: (String) -> Void
    @State private var name = ""
    var body: some View {
        TextField("Board name", text: $name).font(.headline)
            .onSubmit { save(name) }
            .task(id: value) { name = value }
    }
}

#if os(macOS)
/// A design or note waiting for the yes that removes it.
struct BoardRemoval: Equatable {
    let id: String
    let note: Bool
}

extension StudioBoards {
    /// The board's tools in the window's toolbar: which board, what to add, the zoom, the rest in a menu.
    @ToolbarContentBuilder
    var macToolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Menu {
                ForEach(board.boards.map { $0.s("id") }, id: \.self) { id in
                    Button { Task { await board.choose(id) } } label: {
                        let b = board.boards.first { $0.s("id") == id } ?? .null
                        if id == board.current { Label(b.s("name"), systemImage: "checkmark") } else { Text(b.s("name")) }
                    }
                }
                Divider()
                Button("New board…", systemImage: "plus") { nameText = "New board"; asking = .create }
            } label: {
                Label(board.value.s("name", board.current.isEmpty ? "Choose a board" : "Board"), systemImage: "rectangle.3.group")
            }
            .help("Which board")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { sheet = .picker } label: { Label("Add a photo", systemImage: "photo.badge.plus") }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(board.current.isEmpty)
                .help("Add a photo as a new design")
            Button { Task { if let id = await board.addNote() { selected = id } } } label: { Label("Add a note", systemImage: "note.text.badge.plus") }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(board.current.isEmpty)
                .help("Add a sticky note")
            ControlGroup {
                Button { zoom = max(0.08, zoom / 1.25) } label: { Label("Zoom out", systemImage: "minus.magnifyingglass") }
                    .keyboardShortcut("-", modifiers: .command)
                    .help("Zoom out")
                Button { zoom = min(1.5, zoom * 1.25) } label: { Label("Zoom in", systemImage: "plus.magnifyingglass") }
                    .keyboardShortcut("=", modifiers: .command)
                    .help("Zoom in")
                Button { fit() } label: { Label("Fit the board", systemImage: "arrow.up.left.and.arrow.down.right") }
                    .keyboardShortcut("0", modifiers: .command)
                    .disabled(board.current.isEmpty)
                    .help("Fit the whole board in the window")
            }
            Menu {
                Button("This week’s board", systemImage: "calendar") { asking = .weekly }
                Button("Connect an agent", systemImage: "key") { sheet = .agents }
                Button("Tidy up", systemImage: "square.grid.2x2") { Task { await board.tidy() } }.disabled(board.frames.count < 2)
                Button("Rename board", systemImage: "pencil") { nameText = board.value.s("name"); asking = .rename }.disabled(board.current.isEmpty)
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await board.refresh(force: true) } }
                    .keyboardShortcut("r", modifiers: .command)
                Divider()
                Button("Delete board…", systemImage: "trash", role: .destructive) { asking = .delete }.disabled(board.current.isEmpty)
            } label: { Label("Board tools", systemImage: "ellipsis.circle") }
            .help("Tidy up, rename, refresh or delete the board")
            Button { inspectorShown.toggle() } label: { Label("Details", systemImage: "sidebar.trailing") }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .help("Show or hide the chosen design's details")
        }
    }

    /// Right-click on a design.
    @ViewBuilder
    func macFrameMenu(_ f: MarketingValue) -> some View {
        let id = f.s("id")
        // Two groups: a ViewBuilder block holds at most ten views.
        Group {
            Button("Edit design", systemImage: "slider.horizontal.3") { selected = id; sheet = .editor(id) }
            Button("Show its details", systemImage: "sidebar.trailing") { selected = id; inspectorShown = true }
            Divider()
            Button("Download or share…", systemImage: "square.and.arrow.up") { share(f) }
            Button("Duplicate", systemImage: "plus.square.on.square") { Task { await board.duplicate(f) } }
            Menu("In another shape", systemImage: "rectangle.on.rectangle") {
                ForEach(board.formats.map { $0.s("id") }.filter { $0 != f.s("format") }, id: \.self) { fid in
                    Button(board.formatInfo(fid).s("label", fid)) { Task { await board.duplicate(f, format: fid) } }
                }
            }
        }
        Group {
            Divider()
            Button("Queue a post…", systemImage: "paperplane") { sheet = .queue(id) }
            Button("Use in a new Meta ad", systemImage: "megaphone") { Task { if let route = await board.newAd(f) { model.route = route } } }
            Button("Save to Saved ads", systemImage: "folder") { Task { await board.saveToSaved(f) } }
            Divider()
            Button("Remove design…", systemImage: "trash", role: .destructive) { removing = BoardRemoval(id: id, note: false) }
        }
    }
}
#endif
