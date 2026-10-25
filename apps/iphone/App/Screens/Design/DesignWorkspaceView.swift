import SwiftUI
import PhotosUI

struct DesignEditTarget: Identifiable {
    let pageId: String
    var id: String { pageId }
}

/// The workspace (src/app/design/workspace.tsx): the page strip (the master and its other sizes), the active page drawn by the
/// bundled engine and edited in the existing layer editor (ArtworkEditor), the piece card's words, the photograph, Save and Publish.
/// Resize, Publish and the smart input are phase-2 hooks (DesignHooks).
struct DesignWorkspaceView: View {
    @Bindable var model: DesignWorkspaceModel
    let access: DesignAccess
    let onClose: () -> Void
    /// To the Photos section, which hands a photograph back.
    let onChangePhoto: () -> Void

    @State private var editing: DesignEditTarget?
    @State private var picked: PhotosPickerItem?
    @State private var morePicked: [PhotosPickerItem] = []
    @State private var sitePicker = false
    @State private var camera = false
    @State private var devicePicker = false
    @State private var removing: DesignPageState?
    @State private var safe = true
    #if os(macOS)
    @State private var inspectorOn = true
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    /// An iPad's wide window: the page and its strip stay in sight on the left, the words and the photograph scroll on the right.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        Group {
            if let w = model.work {
                if w.fresh { SkeletonLoading("Laying it out").controlSize(.large).padding(16).frame(maxHeight: .infinity, alignment: .top) }
                else { content(w) }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .sheet(item: $editing, onDismiss: { model.endEditing() }) { target in
            ArtworkEditor(doc: model.docBinding(target.pageId), photos: model.photos, fields: model.work?.fields ?? [:], ad: model.work?.kind == "ad")
                .macSheetSize(minWidth: 980, minHeight: 700)
        }
        .sheet(item: $model.sheet) { $0.shown }
        .photosPicker(isPresented: $devicePicker, selection: $picked, matching: .images)
        .sheet(isPresented: $sitePicker) {
            NativeSitePhotoPicker { piece, data in
                sitePicker = false
                let p = DesignPhotoSources.site(piece, data: data)
                model.replacePhoto(data, label: p.label, fields: p.fields, source: p.source, marked: p.marked)
            }
            .presentationSizing(.page)
        }
        #if os(iOS)
        .sheet(isPresented: $camera) {
            NewOrderCamera { image in
                camera = false
                if let image, let data = WebsitePhoto.jpeg(image) { model.replacePhoto(data, label: "Camera photo") }
            }.ignoresSafeArea()
        }
        #endif
        .onChange(of: picked) { _, item in if let item { Task { await take(item) } } }
        .onChange(of: morePicked) { _, items in if !items.isEmpty { Task { await takeMore(items) } } }
        .confirmDestructive(isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            title: "Take “\(removing?.label ?? "this size")” out of this design?",
                            message: "Its layout is removed; the other sizes stay.", action: "Take it out") {
            if let p = removing { model.removePage(p.id) }
        }
    }

    private func content(_ w: DesignWork) -> some View {
        #if os(macOS)
        macContent(w)
        #else
        phoneContent(w)
        #endif
    }

    private func phoneContent(_ w: DesignWork) -> some View {
        Group {
            if wide { wideContent(w) } else { narrowContent(w) }
        }
        // The one primary action stays at the foot where it never scrolls away (rule 16): Publish, with Save beside it.
        .actionBar(
            primary: .init("Publish", systemImage: "paperplane", isDisabled: model.saving) { DesignHooks.shared.publish(model) },
            secondary: [.init("Save", systemImage: "square.and.arrow.down", isBusy: model.saving || model.uploading) { Task { await model.saveInBackground() } }],
            summary: w.dirty ? "Not saved" : "Saved")
    }

    private func narrowContent(_ w: DesignWork) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(w)
                    strip(w)
                    DesignCandidateBanner(model: model).id("candidate")
                    stage(w)
                    words(w)
                    photograph
                    if w.kind == "ad" || !(w.copy["adText"] ?? "").isEmpty { adCopy }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            // An AI picture that waits for a look appears above the tools that made it: bring it into view.
            .onChange(of: model.candidate?.id) { _, id in
                if id != nil { Motion.run(Motion.travel, reduce: reduceMotion) { proxy.scrollTo("candidate", anchor: .top) } }
            }
        }
    }

    /// The device the photograph can come from.
    private static var deviceName: String {
        #if os(macOS)
        "This Mac"
        #else
        "This device"
        #endif
    }
    private static var deviceSymbol: String {
        #if os(macOS)
        "desktopcomputer"
        #else
        "iphone"
        #endif
    }

    /// The page and its sizes on the left (each scrolls on its own), the name, words and photograph on the right.
    private func wideContent(_ w: DesignWork) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        strip(w)
                        DesignCandidateBanner(model: model).id("candidate")
                        stage(w)
                    }
                    .padding(.horizontal, 24).padding(.vertical, 12)
                }
                .onChange(of: model.candidate?.id) { _, id in
                    if id != nil { Motion.run(Motion.travel, reduce: reduceMotion) { proxy.scrollTo("candidate", anchor: .top) } }
                }
            }
            .frame(maxWidth: .infinity)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(w)
                    words(w)
                    photograph
                    if w.kind == "ad" || !(w.copy["adText"] ?? "").isEmpty { adCopy }
                }
                .padding(.horizontal, 24).padding(.vertical, 12)
            }
            .frame(width: min(480, max(380, width * 0.4)))
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Name and kind (Save and Publish are the action bar)

    private func header(_ w: DesignWork) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button(action: onClose) { Label("Designs", systemImage: "chevron.left").font(.subheadline.weight(.medium)).frame(minHeight: Metrics.tap) }.buttonStyle(.plain)
                Pill(DesignKinds.label(w.kind), tone: .house)
                Spacer(minLength: 0)
            }
            TextField(w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? "Name this design", text: Binding(get: { model.work?.name ?? "" }, set: { model.rename($0) }))
                .font(.title3.weight(.semibold)).submitLabel(.done)
            if let at = model.draftSaved {
                Text("Draft kept on \(DesignDraftLine.device) " + ShopDate.stamp(at, withTime: true)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .ledgerCard()
    }

    // MARK: The page strip

    private func strip(_ w: DesignWork) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(w.pages) { p in PageCell(model: model, work: w, page: p, removing: $removing) }
                // PHASE 2: "Resize…" makes the master's design on another shape (DesignHooks.resize).
                Button { DesignHooks.shared.resize(model) } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "plus").font(.title3)
                        Text("Size").font(.caption)
                    }
                    .foregroundStyle(.secondary).frame(width: 84, height: 104)
                    .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                }.buttonStyle(.plain).accessibilityLabel("Resize: add a size")
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: The active page

    private func stage(_ w: DesignWork) -> some View {
        let page = w.activePage
        let zone = DesignSizes.safeZone(h: page.h)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(page.label).font(.subheadline.weight(.semibold))
                Text("\(Int(page.w))×\(Int(page.h))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    .contentTransition(.numericText()).motion(page.id)
                Spacer(minLength: 0)
                if zone.top > 0 { Toggle("Safe zones", isOn: $safe).font(.caption).fixedSize() }
            }
            Group {
                if let image = model.previews[page.id] {
                    Image(uiImage: image).resizable().scaledToFit()
                        .overlay { if safe && zone.top > 0 { SafeZones(top: zone.top / page.h, bottom: zone.bottom / page.h) } }
                } else { SkeletonLoading("Drawing the page").frame(maxWidth: .infinity, minHeight: 220) }
            }
            .frame(maxWidth: .infinity)
            .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            .task(id: "\(page.id)-\(page.rev)-\(model.tick)") { await model.refreshPreview(page.id) }
            HStack(spacing: 10) {
                Button { model.beginEditing(page.id); editing = DesignEditTarget(pageId: page.id) } label: {
                    Label("Edit design", systemImage: "slider.horizontal.3").frame(maxWidth: .infinity)
                }.buttonStyle(.bordered).tint(Theme.accent).largeOnPhone()
                Menu {
                    let layouts = model.templates
                    ForEach(layouts) { t in Button(t.label) { Task { await model.applyTemplate(t.id) } } }
                    if layouts.isEmpty { Text("Layouts are loading") }
                } label: { Label("Layout", systemImage: "rectangle.3.group").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered).largeOnPhone()
            }
            if w.stale.contains(page.id) {
                Text("This size is behind the master. Re-do it from the master, or leave it as it is.").font(.footnote).foregroundStyle(Tone.owed.color)
            }
        }
        .ledgerCard()
    }

    // MARK: Words (design-piece.tsx WordsPanel)

    private func words(_ w: DesignWork) -> some View {
        SectionCard("Words") {
            DesignField(label: "Kicker", prompt: "The Emerald Edit", text: model.fieldBinding("kicker", limit: 60))
            DesignField(label: "Headline", prompt: "", text: model.fieldBinding("headline", limit: 140))
            DesignField(label: "Specs", prompt: "21K Yellow Gold · Ruby · 45.35g", text: model.fieldBinding("weight", limit: 120))
            DesignField(label: "Button line", prompt: "", text: model.fieldBinding("details", limit: 80))
            DesignField(label: "Price (optional)", prompt: "", text: model.copyBinding("price", limit: 40))
        }
    }

    private var adCopy: some View {
        SectionCard("The ad’s words") {
            DesignField(label: "Primary text", prompt: "", text: model.copyBinding("adText", limit: 2000), lines: 3...8)
            DesignField(label: "Headline", prompt: "", text: model.copyBinding("adHeadline", limit: 60))
        }
    }

    // MARK: The photograph (design-piece.tsx PicturesPanel, the choosing half)

    private var photograph: some View {
        SectionCard("The photograph") {
            HStack(spacing: 12) {
                DesignPhotoThumb(model: model)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.photos["photo"] == nil ? "No photograph" : "The design’s photograph").font(.subheadline.weight(.medium))
                    Text("Your layouts stay; the new picture shows in them.").font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            Menu {
                Button { onChangePhoto() } label: { Label("Browse photos", systemImage: "photo.on.rectangle") }
                Button { sitePicker = true } label: { Label("From the website", systemImage: "globe") }
                // A PhotosPicker inside a Menu loses its sheet when the menu closes: the picker is presented from the screen (`.photosPicker`).
                Button { devicePicker = true } label: { Label(Self.deviceName, systemImage: Self.deviceSymbol) }
                if MarketingCamera.available { Button { camera = true } label: { Label("Camera", systemImage: "camera") } }
            } label: { Label(model.photos["photo"] == nil ? "Choose a photograph" : "Change the photograph", systemImage: "photo.badge.plus").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered).largeOnPhone()
            moreRow
            DesignAITools(model: model, access: access)
        }
    }

    /// Other angles of the piece: they go out with it as squares of their own (publish.ts `more`).
    private var moreRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("More photos of this piece").font(.subheadline.weight(.medium))
                Spacer(minLength: 0)
                PhotosPicker(selection: $morePicked, maxSelectionCount: 8, matching: .images) { Label("Add", systemImage: "plus") }.buttonStyle(.bordered)
            }
            if !model.moreIds.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.moreIds, id: \.self) { id in
                            ZStack(alignment: .topTrailing) {
                                Group {
                                    if let data = model.photos[id], let image = WebsitePhoto.thumbnail(data, maxPixel: 160) { Image(uiImage: image).resizable().scaledToFill() }
                                    else { Rectangle().fill(Theme.ground) }
                                }
                                .frame(width: 56, height: 56).clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                                Button { model.removePhoto(id) } label: { Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.7)).frame(minWidth: Metrics.tap, minHeight: Metrics.tap) }
                                    .buttonStyle(.plain).offset(x: 5, y: -5).accessibilityLabel("Take this photo out")
                            }
                        }
                    }.padding(.top, 5)
                }
            }
            Text(model.moreIds.isEmpty ? "Other angles of the same piece go out with it as squares of their own." : "Publish sends each to the website and WhatsApp as a square of its own, on the same page design.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func takeMore(_ items: [PhotosPickerItem]) async {
        defer { morePicked = [] }
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self), WebsitePhoto.jpegCopy(data) != nil { model.addMore(data) }
        }
    }

    private func take(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), WebsitePhoto.jpegCopy(data) != nil else {
                throw ERPAPI.Failure(status: 0, message: "Choose a readable photo, or save it to Photos first.")
            }
            model.replacePhoto(data, label: DesignPhotoSources.deviceLabel)
        } catch { model.error = error.localizedDescription }
    }
}

// MARK: Pieces

/// A page in the strip: a small picture, its label, where it stands against the master, and what can be done to it.
private struct PageCell: View {
    let model: DesignWorkspaceModel
    let work: DesignWork
    let page: DesignPageState
    @Binding var removing: DesignPageState?

    var body: some View {
        let on = page.id == work.active
        VStack(spacing: 5) {
            Button { model.setActive(page.id) } label: {
                Group {
                    if let image = model.thumbs[page.id] { Image(uiImage: image).resizable().scaledToFit() }
                    else { Rectangle().fill(Theme.ground) }
                }
                .frame(width: max(40, min(96, 76 * page.w / page.h)), height: 76)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            }.buttonStyle(.plain)
            Text(page.label).font(.caption2).lineLimit(1).frame(maxWidth: 96)
            HStack(spacing: 3) {
                if page.id == work.master { Image(systemName: "star.fill").imageScale(.small) }
                Text(work.stripNote(page)).font(.caption2)
            }
            .foregroundStyle(work.stale.contains(page.id) ? Tone.owed.color : Color.secondary)
            if on { menu }
        }
        .padding(8)
        .background(on ? Theme.accent.opacity(0.12) : Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(on ? Theme.accent : Color.secondary.opacity(0.18), lineWidth: on ? 1.5 : 1))
        .accessibilityElement(children: .contain)
        .task(id: "\(page.id)-\(page.rev)-\(model.tick)") { await model.refreshThumb(page.id) }
        #if os(macOS)
        .contextMenu { actions }
        #endif
    }

    @ViewBuilder private var actions: some View {
        if work.stale.contains(page.id) {
            // PHASE 2: DesignHooks.redoFromMaster.
            Button { DesignHooks.shared.redoFromMaster(model, page.id) } label: { Label("Re-do from the master", systemImage: "arrow.clockwise") }
        }
        if page.id != work.master { Button { model.setMaster(page.id) } label: { Label("Make this the master", systemImage: "star") } }
        if work.pages.count > 1 { Button(role: .destructive) { removing = page } label: { Label("Take this size out", systemImage: "trash") } }
    }

    private var menu: some View {
        Menu {
            actions
        } label: { Image(systemName: "ellipsis.circle").font(.footnote) }
            .accessibilityLabel("This size")
    }
}

/// Instagram covers a story's top and bottom bands: keep what must be read out of them.
private struct SafeZones: View {
    let top: Double
    let bottom: Double
    var body: some View {
        GeometryReader { g in
            VStack(spacing: 0) {
                Rectangle().fill(Theme.accent.opacity(0.15)).frame(height: g.size.height * top)
                Spacer(minLength: 0)
                Rectangle().fill(Theme.accent.opacity(0.15)).frame(height: g.size.height * bottom)
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}

private struct DesignField: View {
    let label: String
    let prompt: String
    @Binding var text: String
    var lines: ClosedRange<Int> = 1...3

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(prompt, text: $text, axis: .vertical)
                .lineLimit(lines)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
        }
    }
}

private struct DesignPhotoThumb: View {
    let model: DesignWorkspaceModel
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFill() }
            else { Image(systemName: "photo").foregroundStyle(.secondary) }
        }
        .frame(width: 64, height: 64).background(Theme.ground)
        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
        .task(id: model.tick) { image = model.photos["photo"].flatMap { WebsitePhoto.thumbnail($0, maxPixel: 160) } }
    }
}

#if os(macOS)
extension DesignWorkspaceView {
    /// The workspace as a Mac editor: the sizes down the left, the page large in the middle, the name, words and photograph in
    /// an inspector column on the right (⌥⌘I hides it). Edit design ⌘E, Save ⌘S and Publish ⌘↩ are in the toolbar; a picture
    /// dropped on the window becomes the photograph.
    fileprivate func macContent(_ w: DesignWork) -> some View {
        let page = w.activePage
        let zone = DesignSizes.safeZone(h: page.h)
        return HStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(w.pages) { p in PageCell(model: model, work: w, page: p, removing: $removing) }
                    Button { DesignHooks.shared.resize(model) } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "plus").font(.title3)
                            Text("Size").font(.caption)
                        }
                        .foregroundStyle(.secondary).frame(width: 84, height: 64)
                        .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                    }
                    .buttonStyle(.plain).help("Add a size: the master's design on another shape")
                    .accessibilityLabel("Resize: add a size")
                }
                .padding(10)
            }
            .frame(width: 124)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DesignCandidateBanner(model: model)
                    HStack {
                        Text(page.label).font(.headline)
                        Text("\(Int(page.w))×\(Int(page.h))").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        Spacer(minLength: 0)
                    }
                    Group {
                        if let image = model.previews[page.id] {
                            Image(uiImage: image).resizable().scaledToFit()
                                .overlay { if safe && zone.top > 0 { SafeZones(top: zone.top / page.h, bottom: zone.bottom / page.h) } }
                        } else { SkeletonLoading("Drawing the page").frame(maxWidth: .infinity, minHeight: 320) }
                    }
                    .frame(maxWidth: .infinity, maxHeight: 760)
                    .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
                    .onTapGesture(count: 2) { model.beginEditing(page.id); editing = DesignEditTarget(pageId: page.id) }
                    .help("Double-click to edit the design")
                    .task(id: "\(page.id)-\(page.rev)-\(model.tick)") { await model.refreshPreview(page.id) }
                    if w.stale.contains(page.id) {
                        Text("This size is behind the master. Re-do it from the master, or leave it as it is.").font(.footnote).foregroundStyle(Tone.owed.color)
                    }
                }
                .padding(24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .frame(minWidth: 380, maxWidth: .infinity)
        }
        .inspector(isPresented: $inspectorOn) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    macInspectorHeader(w)
                    words(w)
                    photograph
                    if w.kind == "ad" || !(w.copy["adText"] ?? "").isEmpty { adCopy }
                }
                .padding(16)
            }
            .inspectorColumnWidth(min: 300, ideal: 350, max: 460)
        }
        .navigationSubtitle(w.dirty ? "Not saved" : "Saved")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button(action: onClose) { Label("Designs", systemImage: "chevron.left") }
                    .help("Back to all designs")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { model.beginEditing(page.id); editing = DesignEditTarget(pageId: page.id) } label: {
                    Label("Edit design", systemImage: "slider.horizontal.3")
                }
                .keyboardShortcut("e", modifiers: .command)
                .help("Edit this page's layers (⌘E)")
                Menu {
                    let layouts = model.templates
                    ForEach(layouts) { t in Button(t.label) { Task { await model.applyTemplate(t.id) } } }
                    if layouts.isEmpty { Text("Layouts are loading") }
                } label: { Label("Layout", systemImage: "rectangle.3.group") }
                .help("Lay this page out again")
                if zone.top > 0 {
                    Toggle(isOn: $safe) { Label("Safe zones", systemImage: "rectangle.split.1x2") }
                        .help("Show the bands Instagram covers")
                }
                Button { DesignHooks.shared.resize(model) } label: { Label("Resize", systemImage: "arrow.up.left.and.arrow.down.right") }
                    .keyboardShortcut("r", modifiers: [.command, .option])
                    .help("Make the design on another shape (⌥⌘R)")
                Button { inspectorOn.toggle() } label: { Label("Inspector", systemImage: "sidebar.trailing") }
                    .keyboardShortcut("i", modifiers: [.command, .option])
                    .help("Show or hide the words and photograph (⌥⌘I)")
            }
            ToolbarItemGroup(placement: .confirmationAction) {
                Button { Task { await model.saveInBackground() } } label: {
                    if model.saving || model.uploading { ProgressView().controlSize(.small) } else { Label("Save", systemImage: "square.and.arrow.down") }
                }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(model.saving || model.uploading)
                .help("Save to the shelf (⌘S)")
                Button { DesignHooks.shared.publish(model) } label: { Label("Publish", systemImage: "paperplane") }
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(model.saving)
                    .help("Send it to the website, WhatsApp, Instagram or an ad (⌘↩)")
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            let open = url.startAccessingSecurityScopedResource()
            defer { if open { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), WebsitePhoto.jpegCopy(data) != nil else {
                model.error = "That is not a picture the ERP can read. Drop a photograph (JPEG, PNG or HEIC)."
                return true
            }
            model.replacePhoto(data, label: url.lastPathComponent)
            return true
        }
    }

    private func macInspectorHeader(_ w: DesignWork) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Pill(DesignKinds.label(w.kind), tone: .house)
            TextField(w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? "Name this design", text: Binding(get: { model.work?.name ?? "" }, set: { model.rename($0) }))
                .font(.title3.weight(.semibold))
                .textFieldStyle(.roundedBorder)
            if let at = model.draftSaved {
                Text("Draft kept on this Mac " + ShopDate.stamp(at, withTime: true)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
#endif
