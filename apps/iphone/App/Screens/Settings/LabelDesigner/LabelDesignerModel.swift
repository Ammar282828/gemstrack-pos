import SwiftUI
import ERPCore

/// The tag designer's state and every change it makes. The arithmetic is ERPCore's (`LabelEditing`, `LabelGeometry`),
/// tested there; this holds the layout being edited, the selection, the undo stack, the view's zoom and the piece the
/// preview is filled from. Every change goes through `edit`, which records undo, marks the layout changed and tells
/// the screen to save it a second later.
@MainActor @Observable
final class LabelDesignerModel {
    var layout: LabelLayout
    var selection: Set<String> = []
    private(set) var history = LabelHistory()
    /// Staff read the tag; only owners change it.
    var readOnly = false
    var edited = false

    // The view
    var gridOn = false
    /// Dots: 8 is a millimetre at 203 dpi.
    var gridDots = 8
    var showRulers = true
    /// Points a dot; nil fits the label to the window.
    var zoom: CGFloat?
    var pan: CGSize = .zero
    /// iPhone: a drag on the background pans (instead of drawing a marquee).
    var panMode = false
    /// iPhone: taps add to the selection (the Mac uses ⇧).
    var multiSelect = false
    @ObservationIgnored var stage: CGSize = .zero

    // The preview
    var previewValues: [LabelValues] = []
    var previewNames: [String] = []
    var previewNow = Date()

    @ObservationIgnored var onChange: ((LabelLayout) -> Void)?

    var measure: LabelMeasure { LabelMeasurer.measure }

    init(layout: LabelLayout) { self.layout = layout }

    // MARK: Reading

    /// The values the preview fills the tag from: the chosen pieces, else made-up ones.
    var pieces: [LabelValues] {
        previewValues.isEmpty ? (1...layout.tagsPerLabel).map { LabelPlaceholders.sampleValues(piece: $0) } : previewValues
    }

    /// The fields with their text filled, as they print: what the canvas draws and measures.
    var resolved: [LabelLayoutField] { Zpl.resolveFields(layout, pieces: pieces, now: previewNow) }

    var selectedFields: [LabelLayoutField] { layout.fields.filter { selection.contains($0.id) } }
    var primary: LabelLayoutField? { selectedFields.last }
    var canEditSelection: Bool { !readOnly && !selection.isEmpty }
    var canUndo: Bool { !readOnly && history.canUndo }
    var canRedo: Bool { !readOnly && history.canRedo }

    func resolvedField(_ id: String) -> LabelLayoutField? { resolved.first { $0.id == id } }

    var labelBox: LabelBox { LabelBox(x: 0, y: 0, w: Double(layout.widthDots), h: Double(layout.heightDots)) }

    func effectiveZoom(stage: CGSize) -> CGFloat {
        if let zoom { return zoom }
        let m: CGFloat = 44
        let w = max(1, CGFloat(layout.widthDots)), h = max(1, CGFloat(layout.heightDots))
        return max(0.05, min((stage.width - 2 * m) / w, (stage.height - 2 * m) / h))
    }

    // MARK: Changing

    /// One change to the layout: undoable, drawn at once, saved a second later. A run of changes with the same `key`
    /// within a second (a drag, a nudge, typing) is one undo step.
    func edit(key: String? = nil, _ change: (inout LabelLayout) -> Void) {
        guard !readOnly else { return }
        var next = layout
        change(&next)
        guard next != layout else { return }
        history.record(before: layout, key: key)
        layout = next
        edited = true
        onChange?(next)
    }

    /// An arithmetic change (move, resize, turn, align): done on the filled fields, so what is measured is what is
    /// drawn, then written back with each field's own text.
    func geometryEdit(key: String? = nil, _ op: ([LabelLayoutField]) -> [LabelLayoutField]) {
        let out = op(resolved)
        var byId: [String: LabelLayoutField] = [:]
        for f in out { byId[f.id] = f }
        edit(key: key) { l in
            for i in l.fields.indices {
                guard var n = byId[l.fields[i].id] else { continue }
                n.data = l.fields[i].data
                l.fields[i] = n
            }
        }
    }

    /// A layout from the books (another device, the printer screen): no undo step, and the selection kept where it can be.
    func adopt(_ l: LabelLayout) {
        layout = l
        edited = false
        selection = selection.filter { id in l.fields.contains { $0.id == id } }
    }

    func undo() {
        guard !readOnly, let previous = history.undo(current: layout) else { return }
        layout = previous
        edited = true
        selection = selection.filter { id in previous.fields.contains { $0.id == id } }
        onChange?(previous)
    }

    func redo() {
        guard !readOnly, let next = history.redo(current: layout) else { return }
        layout = next
        edited = true
        selection = selection.filter { id in next.fields.contains { $0.id == id } }
        onChange?(next)
    }

    func resetHistory() { history.clear() }

    // MARK: Selecting

    func select(_ ids: Set<String>) { selection = ids }
    func selectAll() { selection = Set(layout.fields.map(\.id)) }
    func clearSelection() { selection = [] }

    func toggleSelected(_ id: String) {
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    // MARK: Adding and removing

    func add(_ kind: LabelNewKind) {
        let f = LabelEditing.make(kind, in: layout, measure: measure)
        edit { $0.fields.append(f) }
        selection = [f.id]
    }

    func addPicture(_ f: LabelLayoutField) {
        edit { $0.fields.append(f) }
        selection = [f.id]
    }

    func deleteSelection() {
        let ids = selection
        edit { $0.fields = LabelEditing.removed($0.fields, ids: ids) }
        selection = selection.filter { id in layout.fields.contains { $0.id == id } }
    }

    func duplicateSelection() {
        guard canEditSelection else { return }
        var made: [String] = []
        edit { l in
            let r = LabelEditing.duplicated(l.fields, ids: selection)
            l.fields = r.fields
            made = r.ids
        }
        if !made.isEmpty { selection = Set(made) }
    }

    func copySelection() {
        guard let text = LabelEditing.clipboardText(selectedFields) else { return }
        UIPasteboard.general.string = text
    }

    /// Whether the pasteboard holds fields from a designer.
    var canPaste: Bool { !readOnly && !LabelEditing.fields(fromClipboard: UIPasteboard.general.string).isEmpty }

    func paste() {
        let copies = LabelEditing.fields(fromClipboard: UIPasteboard.general.string)
        guard !copies.isEmpty, !readOnly else { return }
        var made: [String] = []
        edit { l in
            let r = LabelEditing.inserting(copies, into: l.fields)
            l.fields = r.fields
            made = r.ids
        }
        selection = Set(made)
    }

    func cut() { copySelection(); deleteSelection() }

    // MARK: Moving, turning, arranging

    /// Arrow keys: whole dots (⇧ for ten).
    func nudge(dx: Int, dy: Int) {
        guard canEditSelection else { return }
        let ids = selection
        edit(key: "nudge") { l in l.fields = LabelEditing.moved(l.fields, ids: ids, dx: dx, dy: dy) }
    }

    /// A drag's position: every dragged field at its start plus the offset.
    func place(origins: [String: (x: Int, y: Int)], dx: Int, dy: Int, key: String) {
        edit(key: key) { l in l.fields = LabelEditing.placed(l.fields, origins: origins, dx: dx, dy: dy) }
    }

    /// A handle's drag: the field as it was when the drag began, resized to the box.
    func resize(_ start: LabelLayoutField, handle: LabelHandle, to box: LabelBox, key: String) {
        let startResolved = Zpl.resolveFields(LabelLayout(id: "", name: "", widthDots: 1, heightDots: 1, fields: [start]), pieces: pieces, now: previewNow)[0]
        var out = LabelEditing.resized(startResolved, handle: handle, to: box, measure: measure)
        out.data = start.data
        if start.type == .image, let bmp = start.bitmap, let ow = start.width, let oh = start.height, let nw = out.width, let nh = out.height {
            out.bitmap = LabelEditing.resampledBitmap(bmp, fromWidth: ow, fromHeight: oh, toWidth: nw, toHeight: nh) ?? bmp
        }
        edit(key: key) { l in
            if let i = l.fields.firstIndex(where: { $0.id == start.id }) { l.fields[i] = out }
        }
    }

    func rotateSelection(by degrees: Int = 90) {
        guard canEditSelection else { return }
        let ids = selection
        geometryEdit { fields in fields.map { ids.contains($0.id) ? LabelEditing.rotated($0, by: degrees, measure: self.measure) : $0 } }
    }

    func align(_ edge: LabelAlign) {
        guard canEditSelection else { return }
        let ids = selection, label = labelBox
        let within: LabelBox? = ids.count == 1 ? label : nil
        geometryEdit { LabelEditing.aligned($0, ids: ids, edge: edge, within: within, measure: self.measure) }
    }

    func distribute(_ axis: LabelAxis) {
        guard selection.count >= 3 else { return }
        let ids = selection
        geometryEdit { LabelEditing.distributed($0, ids: ids, axis: axis, measure: self.measure) }
    }

    func order(_ o: LabelOrder) {
        guard canEditSelection else { return }
        let ids = selection
        edit { $0.fields = LabelEditing.reordered($0.fields, ids: ids, o) }
    }

    func moveLayers(from: IndexSet, to: Int) {
        edit { $0.fields = LabelEditing.reorderedByLayerList($0.fields, from: from, to: to) }
    }

    func setHidden(_ id: String, _ v: Bool) { edit { l in if let i = l.fields.firstIndex(where: { $0.id == id }) { l.fields[i].hidden = v } } }
    func setLocked(_ id: String, _ v: Bool) { edit { l in if let i = l.fields.firstIndex(where: { $0.id == id }) { l.fields[i].locked = v } } }

    // MARK: Bindings for the inspector

    /// A property of the selected fields of the same kind as the last one picked.
    func binding<T>(_ key: String, fallback: T, get: @escaping (LabelLayoutField) -> T, set: @escaping (inout LabelLayoutField, T) -> Void) -> Binding<T> {
        Binding(
            get: { self.primary.map(get) ?? fallback },
            set: { value in
                guard let type = self.primary?.type else { return }
                let ids = self.selection
                self.edit(key: "prop-\(key)-\(ids.sorted().joined(separator: ","))") { l in
                    for i in l.fields.indices where ids.contains(l.fields[i].id) && l.fields[i].type == type { set(&l.fields[i], value) }
                }
            })
    }

    /// The field's box on the label (x, y, w, h in dots), read from the filled field.
    func boxOfPrimary() -> LabelBox? {
        guard let id = primary?.id, let f = resolvedField(id) else { return nil }
        return LabelGeometry.bounds(f, measure: measure)
    }

    func setX(_ v: Int) { setCorner(x: v, y: nil) }
    func setY(_ v: Int) { setCorner(x: nil, y: v) }

    private func setCorner(x: Int?, y: Int?) {
        let ids = selection
        edit(key: "pos-\(ids.sorted().joined(separator: ","))") { l in
            for i in l.fields.indices where ids.contains(l.fields[i].id) && !l.fields[i].locked {
                if let x { l.fields[i].x = x }
                if let y { l.fields[i].y = y }
            }
        }
    }

    /// Width or height typed in dots: a text's block width, a QR's magnification, a bar code's modules and height, a
    /// shape's size (the handle that would change it).
    func setBoxSize(w: Int? = nil, h: Int? = nil) {
        guard let id = primary?.id, let f = layout.fields.first(where: { $0.id == id }), let b = boxOfPrimary() else { return }
        let nb = LabelBox(x: b.x, y: b.y, w: Double(w ?? Int(b.w.rounded())), h: Double(h ?? Int(b.h.rounded())))
        resize(f, handle: w != nil && h != nil ? .bottomRight : w != nil ? .right : .bottom, to: nb, key: "size-\(id)")
    }
}
