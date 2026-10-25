import SwiftUI
import UniformTypeIdentifiers
import ERPCore

/// Stock › Labels (src/app/settings/printer/page.tsx; its address is still /settings/printer): the shop's tag, designed
/// on a canvas the way Label LIVE does, field by field, in the printer's dots.
///
/// - The layout is the shop's (settings `labelLayout`, the same on every device). It is read live and saved a second
///   after the last change (/api/app/write `saveLabelLayout`, ERPCore `LabelLayout.saveFields()`), owners only; staff
///   see the tag but cannot change it. One being edited is never replaced by the copy arriving from another device
///   until it has been saved. The printer options (`layout.printer`, edited at Printer settings) are always taken
///   from the latest copy when saving, so a save never writes them back stale.
/// - With none saved the standard tag is shown, the ERP's own (/api/app/labels, else ERPCore's copy of it).
/// - Mac and iPad: layers on the left, the canvas in the middle, the inspector on the right. iPhone: the canvas with a
///   panel under it (Field, Layers, Label, Preview).
struct LabelDesigner: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduce

    /// The business this screen was opened in: the layout is saved there even if it closes after a switch.
    @State private var biz = House.business
    @State private var standard: LabelLayout?
    @State private var standardTried = false
    @State private var model: LabelDesignerModel?
    @State private var note: Note?
    @State private var problem: String?

    @State private var confirmingDelete = false
    @State private var confirmingStandard = false
    @State private var confirmingImport = false
    @State private var pendingImport: LabelLayout?
    @State private var importing = false
    @State private var addingPicture = false
    @State private var replacingPicture = false
    @State private var addingCounter = false
    @State private var testing = false
    @State private var panel: Panel = .field

    private enum Panel: String, CaseIterable, Identifiable {
        case field = "Field", layers = "Layers", label = "Label", preview = "Preview"
        var id: String { rawValue }
    }

    private var saved: LabelLayout? { book.settings.value?.labelLayout.flatMap { $0.hasSize ? $0 : nil } }
    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        Group {
            if let model {
                content(model)
            } else if book.settings.loaded, book.settings.error != nil, book.settings.value == nil {
                ErrorState(book.settings.error ?? "The tag could not be read.") { book.settings.reset(); book.settings.need() }
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Labels")
        .navigationBarTitleDisplayMode(.inline)
        .noteToast($note)
        .failureAlert($problem, title: "Not done")
        .onAppear {
            book.settings.need()
            book.products.need()
        }
        .onDisappear {
            // A change made in the last second before leaving is saved rather than dropped with the timer.
            if let model, model.edited { save(model.layout) }
        }
        .task { await loadStandard() }
        // Adopt the saved layout when it arrives (or changes on another device, or at Printer settings) unless one is being edited.
        .onChange(of: saved) { _, _ in adopt() }
        .onChange(of: book.settings.loaded) { _, _ in adopt() }
        .onChange(of: standard) { _, _ in adopt() }
        // Saved a second after the last change.
        .task(id: model?.layout) {
            guard let model, model.edited, !model.readOnly else { return }
            let layout = model.layout
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            save(layout)
        }
    }

    // MARK: Reading and saving

    private func loadStandard() async {
        if let s = try? await ERPAPI.shared.get("/api/app/labels", as: LabelStandardDoc.self).standard, s.hasSize { standard = s }
        standardTried = true
        adopt()
    }

    private func adopt() {
        // A failed read is not "no saved layout": adopting the standard tag then would save it over the shop's own.
        guard book.settings.loaded, book.settings.error == nil || book.settings.value != nil else { return }
        guard let incoming = saved ?? standard ?? (standardTried ? LabelLayout.standard : nil) else { return }
        if let model {
            model.readOnly = !session.isOwner
            if !model.edited {
                if model.layout != incoming { model.adopt(incoming) }
            } else if let s = saved, s.printer != model.layout.printer {
                model.layout.printer = s.printer
            }
        } else {
            let m = LabelDesignerModel(layout: incoming)
            m.readOnly = !session.isOwner
            model = m
        }
    }

    private func save(_ next: LabelLayout) {
        guard session.isOwner else { return }
        var out = next
        // Printer settings are the Printer screen's: take the latest, never write a stale copy back.
        if let s = saved { out.printer = s.printer }
        // `seq` (in saveFields) makes each save its own: a field moved and moved back is a new change, not one sent twice.
        Outbox.shared.send(op: LabelLayout.saveOp, fields: out.saveFields(), business: biz, label: "Label layout")
        if model?.layout == next { model?.edited = false }
    }

    private var saveState: String {
        guard let model else { return "" }
        if model.readOnly { return "Read only" }
        return model.edited || Outbox.shared.status(of: "Label layout") != nil ? "Saving…" : saved != nil ? "Saved" : ""
    }

    // MARK: The page

    @ViewBuilder
    private func content(_ m: LabelDesignerModel) -> some View {
        VStack(spacing: 0) {
            if m.readOnly {
                Text("Only owners can change the tag. This is how it prints.")
                    .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(8)
            }
            #if os(macOS)
            macBody(m)
            #else
            if wide { wideBody(m) } else { compactBody(m) }
            #endif
        }
        .background(Theme.ground)
        #if os(macOS)
        // Field / Label / Preview are the inspector's own header, not a tab row over the content.
        .macInspector { macInspectorPanel(m) }
        #endif
        .toolbar { designerToolbar(m) }
        .sheet(isPresented: $addingPicture) {
            LabelPictureSheet(labelWidthDots: m.layout.widthDots, dpi: m.layout.dpi) { bitmap, w, h, dither, threshold, source in
                m.addPicture(LabelEditing.makePicture(bitmap: bitmap, width: w, height: h, dither: dither, threshold: threshold,
                                                      source: source, in: m.layout, measure: m.measure))
            }
        }
        .sheet(isPresented: $replacingPicture) {
            LabelPictureSheet(labelWidthDots: m.layout.widthDots, dpi: m.layout.dpi) { bitmap, w, h, dither, threshold, source in
                guard let id = m.primary?.id else { return }
                m.edit { l in
                    guard let i = l.fields.firstIndex(where: { $0.id == id }) else { return }
                    l.fields[i].bitmap = bitmap; l.fields[i].width = w; l.fields[i].height = h
                    l.fields[i].dither = dither; l.fields[i].threshold = threshold; l.fields[i].source = source
                }
            }
        }
        .sheet(isPresented: $addingCounter) {
            LabelCounterSheet { start, step, pad in m.add(.counter(start: start, step: step, pad: pad)) }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: Self.importTypes) { result in
            guard case .success(let url) = result else { return }
            importFile(url, m)
        }
        .confirmDestructive(isPresented: $confirmingDelete, title: "Remove \(m.selection.count) fields?",
                            message: "They are taken off the tag. You can undo it.", action: "Remove fields") { m.deleteSelection() }
        .confirmDestructive(isPresented: $confirmingStandard, title: "Back to the standard tag?",
                            message: "The tag on screen is replaced by the ERP’s standard one. You can undo it.", action: "Use the standard tag") {
            var s = standard ?? LabelLayout.standard
            s.printer = m.layout.printer
            m.edit { $0 = s }
            m.clearSelection(); m.zoomFit()
        }
        .confirmDestructive(isPresented: $confirmingImport, title: "Replace this tag?",
                            message: "The imported design takes the place of the tag on screen. You can undo it.", action: "Replace tag") {
            if let l = pendingImport {
                m.edit { $0 = l }
                m.clearSelection(); m.zoomFit()
                note = Note(title: "Design imported", detail: "\(l.fields.count) fields from Label LIVE.")
            }
            pendingImport = nil
        }
    }

    private func requestDelete(_ m: LabelDesignerModel) {
        guard m.canEditSelection else { return }
        if m.selection.count > 3 { confirmingDelete = true } else { m.deleteSelection() }
    }

    private func canvas(_ m: LabelDesignerModel) -> some View {
        LabelCanvas(model: m, requestDelete: { requestDelete(m) }, onDropFile: { url in
            if ["lsc", "json"].contains(url.pathExtension.lowercased()) { importFile(url, m) }
            else { problem = "Drop a Label LIVE design here (a .lsc file)." }
        })
    }

    // MARK: Wide: Mac and iPad

    private func wideBody(_ m: LabelDesignerModel) -> some View {
        columns(
            VStack(spacing: 0) {
                HStack {
                    Text("Layers").font(.headline)
                    Spacer()
                    Text("\(m.layout.fields.count)").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                LabelLayersList(model: m)
            }
            .frame(minWidth: 190, idealWidth: 230, maxWidth: 320),
            VStack(spacing: 0) {
                canvas(m).frame(minWidth: 380, minHeight: 280)
                Divider()
                controlBar(m)
            },
            VStack(spacing: 0) {
                Picker("Inspector", selection: $panel) {
                    Text("Field").tag(Panel.field)
                    Text("Label").tag(Panel.label)
                    Text("Preview").tag(Panel.preview)
                }
                .pickerStyle(.segmented).labelsHidden()
                .padding(10)
                panelBody(m)
            }
            .frame(minWidth: 300, idealWidth: 350, maxWidth: 460)
        )
        .onChange(of: m.selection) { _, s in if !s.isEmpty, panel != .field { panel = .field } }
        .onAppear { if panel == .layers { panel = .field } }
    }

    @ViewBuilder
    private func columns<L: View, C: View, R: View>(_ l: L, _ c: C, _ r: R) -> some View {
        #if os(macOS)
        HSplitView { l; c; r }
        #else
        HStack(spacing: 0) { l; Divider(); c; Divider(); r }
        #endif
    }

    // MARK: Compact: iPhone

    private func compactBody(_ m: LabelDesignerModel) -> some View {
        VStack(spacing: 0) {
            canvas(m).frame(minHeight: 230).layoutPriority(1)
            Divider()
            controlBar(m)
            Picker("Panel", selection: $panel) {
                ForEach(Panel.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden()
            .padding(.horizontal, 12).padding(.bottom, 6)
            panelBody(m).frame(minHeight: 240, maxHeight: 340)
        }
        .onChange(of: m.selection) { old, s in if old.isEmpty, !s.isEmpty, panel == .layers || panel == .field { panel = .field } }
    }

    @ViewBuilder
    private func panelBody(_ m: LabelDesignerModel) -> some View {
        switch panel {
        case .field:
            columnForm {
                LabelInspector(model: m, requestDelete: { requestDelete(m) }, replacePicture: { replacingPicture = true })
            }
        case .layers:
            LabelLayersList(model: m)
        case .label:
            columnForm {
                LabelSettingsSections(model: m)
                Section {
                    Button("Back to the standard tag", systemImage: "arrow.uturn.backward") { confirmingStandard = true }
                        .disabled(m.readOnly)
                }
                LabelCsvSection()
            }
        case .preview:
            columnForm { LabelPreviewSections(model: m) }
        }
    }

    private func columnForm<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        Form { Group { c() }.houseRows() }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            #if os(macOS)
            .formStyle(.grouped)
            #endif
    }

    // MARK: Controls

    private func controlBar(_ m: LabelDesignerModel) -> some View {
        let l = m.layout
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button { m.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                    .disabled(!m.canUndo).keyboardShortcut("z", modifiers: .command).help("Undo").accessibilityLabel("Undo")
                Button { m.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                    .disabled(!m.canRedo).keyboardShortcut("z", modifiers: [.command, .shift]).help("Redo").accessibilityLabel("Redo")
                Divider().frame(height: 18)
                Button { m.zoomOut() } label: { Image(systemName: "minus.magnifyingglass") }
                    .keyboardShortcut("-", modifiers: .command).help("Zoom out").accessibilityLabel("Zoom out")
                Menu(m.zoomText) {
                    Button("Fit to window") { m.zoomFit() }.keyboardShortcut("0", modifiers: .command)
                    ForEach([50, 100, 200, 400, 800], id: \.self) { (p: Int) in Button("\(p)%") { m.zoomPercent(p) } }
                }
                #if os(macOS)
                .menuIndicator(.hidden)
                #else
                .menuIndicator(.hidden).fixedSize()
                #endif
                Button { m.zoomIn() } label: { Image(systemName: "plus.magnifyingglass") }
                    .keyboardShortcut("=", modifiers: .command).help("Zoom in").accessibilityLabel("Zoom in")
                Divider().frame(height: 18)
                Toggle(isOn: Binding(get: { m.gridOn }, set: { m.gridOn = $0 })) { Image(systemName: "grid") }
                    .toggleStyle(.button).help("Grid and snap").accessibilityLabel("Grid")
                if m.gridOn {
                    Menu("\(m.gridDots) dots") {
                        ForEach([2, 4, 8, 16, 24], id: \.self) { (g: Int) in Button("\(g) dots") { m.gridDots = g } }
                    }
                    #if os(macOS)
                    .menuIndicator(.hidden)
                    #else
                    .menuIndicator(.hidden).fixedSize()
                    #endif
                }
                Toggle(isOn: Binding(get: { m.showRulers }, set: { m.showRulers = $0 })) { Image(systemName: "ruler") }
                    .toggleStyle(.button).help("Rulers in millimetres").accessibilityLabel("Rulers")
                #if !os(macOS)
                Toggle(isOn: Binding(get: { m.panMode }, set: { m.panMode = $0 })) { Image(systemName: "hand.draw") }
                    .toggleStyle(.button).accessibilityLabel("Move the view")
                Toggle(isOn: Binding(get: { m.multiSelect }, set: { m.multiSelect = $0 })) { Image(systemName: "checkmark.circle") }
                    .toggleStyle(.button).accessibilityLabel("Select several")
                #endif
                Divider().frame(height: 18)
                Text("\(LabelUnits.mmText(dots: Double(l.widthDots), dpi: l.dpi)) × \(LabelUnits.mmText(dots: Double(l.heightDots), dpi: l.dpi)) mm · \(l.widthDots) × \(l.heightDots) dots · \(l.dpi ?? 203) dpi")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                Text(saveState).font(.caption).foregroundStyle(.secondary).fixedSize()
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 12).padding(.vertical, 6)
        }
    }

    // MARK: Toolbar and menus

    @ToolbarContentBuilder
    private func designerToolbar(_ m: LabelDesignerModel) -> some ToolbarContent {
        ToolbarItemGroup(placement: .trailingAction) {
            LabelAddMenu(model: m, addPicture: { addingPicture = true }, addCounter: { addingCounter = true })
            arrangeMenu(m)
            fileMenu(m)
        }
    }

    private func arrangeMenu(_ m: LabelDesignerModel) -> some View {
        Menu {
            Button("Duplicate", systemImage: "plus.square.on.square") { m.duplicateSelection() }
                .keyboardShortcut("d", modifiers: .command)
            #if os(macOS)
            Button("Copy", systemImage: "doc.on.doc") { m.copySelection() }
            Button("Paste", systemImage: "doc.on.clipboard") { m.paste() }
            #else
            Button("Copy", systemImage: "doc.on.doc") { m.copySelection() }.keyboardShortcut("c", modifiers: .command)
            Button("Paste", systemImage: "doc.on.clipboard") { m.paste() }.keyboardShortcut("v", modifiers: .command)
            #endif
            Button("Select all") { m.selectAll() }
            Divider()
            Menu("Align", systemImage: "align.horizontal.left") {
                Button("Left", systemImage: "align.horizontal.left") { m.align(.left) }
                Button("Centre", systemImage: "align.horizontal.center") { m.align(.centre) }
                Button("Right", systemImage: "align.horizontal.right") { m.align(.right) }
                Divider()
                Button("Top", systemImage: "align.vertical.top") { m.align(.top) }
                Button("Middle", systemImage: "align.vertical.center") { m.align(.middle) }
                Button("Bottom", systemImage: "align.vertical.bottom") { m.align(.bottom) }
            }
            Menu("Distribute", systemImage: "distribute.horizontal.center") {
                Button("Across") { m.distribute(.horizontal) }
                Button("Down") { m.distribute(.vertical) }
            }
            .disabled(m.selection.count < 3)
            Menu("Order", systemImage: "square.2.layers.3d") {
                Button("Bring to front") { m.order(.front) }
                Button("Bring forward") { m.order(.forward) }
                Button("Send backward") { m.order(.backward) }
                Button("Send to back") { m.order(.back) }
            }
            Button("Rotate 90°", systemImage: "rotate.right") { m.rotateSelection() }
                .keyboardShortcut("r", modifiers: .command)
            Divider()
            Button("Remove", systemImage: "trash", role: .destructive) { requestDelete(m) }
        } label: {
            Label("Arrange", systemImage: "square.3.layers.3d")
        }
        .disabled(m.readOnly || m.selection.isEmpty && !m.canPaste)
        .help("Align, order, turn and copy the selected fields")
    }

    private func fileMenu(_ m: LabelDesignerModel) -> some View {
        Menu {
            Button("Import a Label LIVE design…", systemImage: "square.and.arrow.down") { importing = true }
                .disabled(m.readOnly)
            Divider()
            Button("Copy ZPL", systemImage: "doc.on.doc") { copyZpl(m) }
            Button("Test print", systemImage: "printer") { Task { await testPrint(m) } }
                .disabled(testing)
            Divider()
            Button("Back to the standard tag", systemImage: "arrow.uturn.backward") { confirmingStandard = true }
                .disabled(m.readOnly)
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    // MARK: Import, export, test print

    private static var importTypes: [UTType] {
        [UTType(filenameExtension: "lsc"), UTType.json, UTType.data].compactMap { $0 }
    }

    private func importFile(_ url: URL, _ m: LabelDesignerModel) {
        guard !m.readOnly else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { problem = "That file could not be read."; return }
        guard var design = LabelLSC.importDesign(data, id: m.layout.id.isEmpty ? nil : m.layout.id,
                                                 name: url.deletingPathExtension().lastPathComponent,
                                                 imageDecoder: LabelPicture.importDecoder), design.hasSize else {
            problem = "That is not a Label LIVE design."
            return
        }
        if design.fields.isEmpty { problem = "That design has nothing on it the tag can print."; return }
        design.printer = m.layout.printer
        pendingImport = design
        confirmingImport = true
    }

    private func zpl(_ m: LabelDesignerModel) -> String {
        Zpl.render(m.layout, pieces: m.pieces, counterStart: m.previewCounter, now: m.previewNow)
    }

    private func copyZpl(_ m: LabelDesignerModel) {
        UIPasteboard.general.string = zpl(m)
        Motion.run(reduce: reduce) { note = Note(title: "ZPL copied", detail: "The tag as the printer reads it.") }
    }

    private func testPrint(_ m: LabelDesignerModel) async {
        testing = true
        let outcome = await TagPrinter.send(zpl(m))
        testing = false
        if outcome.ok {
            Motion.run(reduce: reduce) { note = Note(title: "Test tag sent", detail: outcome.message) }
        } else {
            problem = outcome.message
        }
    }
}

/// /api/app/labels: the standard tag.
private struct LabelStandardDoc: Decodable {
    let standard: LabelLayout?
    private enum K: String, CodingKey { case standard }
    init(from decoder: Decoder) throws {
        standard = try decoder.container(keyedBy: K.self).object(.standard, of: LabelLayout.self)
    }
}

#if os(macOS)
// The Mac's designer (docs/features/mac-design.md, "Stock"): the layers at the left and the canvas with its controls, as before;
// the right-hand pane is the window's inspector (View › Show Inspector, ⌥⌘I) with Field / Label / Preview as its header switch.
extension LabelDesigner {
    fileprivate func macBody(_ m: LabelDesignerModel) -> some View {
        HSplitView {
            VStack(spacing: 0) {
                HStack {
                    Text("Layers").font(.headline)
                    Spacer()
                    Text("\(m.layout.fields.count)").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                LabelLayersList(model: m)
            }
            .frame(minWidth: 150, idealWidth: 210, maxWidth: 280)
            VStack(spacing: 0) {
                canvas(m).frame(minWidth: 300, minHeight: 240)
                Divider()
                controlBar(m)
            }
        }
        .onChange(of: m.selection) { _, s in if !s.isEmpty, panel != .field { panel = .field } }
        .onAppear { if panel == .layers { panel = .field } }
    }

    fileprivate func macInspectorPanel(_ m: LabelDesignerModel) -> some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $panel) {
                Text("Field").tag(Panel.field)
                Text("Label").tag(Panel.label)
                Text("Preview").tag(Panel.preview)
            }
            .pickerStyle(.segmented).labelsHidden()
            .padding(10)
            Divider()
            panelBody(m)
        }
    }
}
#endif
