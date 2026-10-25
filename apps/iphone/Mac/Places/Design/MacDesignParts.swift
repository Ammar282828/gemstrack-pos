#if os(macOS)
import SwiftUI
import AppKit

// The design window's parts (docs/features/mac-design.md, "Marketing › Design"): what the window hands the layer editor so
// the editor is the window's own centre and inspector, the bar for an AI picture waiting for a look, the AI tab (each tool a
// row), and the bands Instagram covers drawn over the page. The logic is the screens': the model's own functions are called,
// nothing is decided here.

/// One tab of the inspector's head. Layer and Page belong to the editor; Words, Photo and AI come from the window.
struct MacArtworkTab: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var content: AnyView?
}

/// A layout the toolbar's Layout menu and the Page tab both offer.
struct MacArtworkLayout: Identifiable {
    let id: String
    let label: String
}

/// What the design window gives the layer editor (`ArtworkEditor(… macEmbed:)`): which page it edits, the tabs the window adds to
/// the inspector, the window's own actions for the menu bar, the layouts, and the bands to draw over the page.
struct MacArtworkEmbed {
    var pageId: String
    var tabs: [MacArtworkTab] = []
    /// The Design menu's first group (Publish…, Save) and its last (Sizes…, Export…).
    var leading: [MacAction] = []
    var trailing: [MacAction] = []
    /// What Share ▾ offers beside "Share This Page…".
    var shareExtras: [MacAction] = []
    var layouts: [MacArtworkLayout] = []
    var applyLayout: (String) -> Void = { _ in }
    /// The bands Instagram covers, as fractions of the page's height; drawn when `showSafe`.
    var showSafe = false
    var safeTop = 0.0
    var safeBottom = 0.0
    var setSafe: (Bool) -> Void = { _ in }
    /// A text layer bound to the piece's words (kicker, headline, weight, details): double-clicking it asks the Words tab to
    /// put the keyboard in that field.
    var focusWord: (String) -> Void = { _ in }
}

/// The bands of a story that Instagram covers, over the page.
struct MacArtworkSafeZones: View {
    let top: Double
    let bottom: Double

    var body: some View {
        GeometryReader { g in
            VStack(spacing: 0) {
                Rectangle().fill(Theme.accent.opacity(0.15)).frame(height: g.size.height * top)
                Spacer(minLength: 0)
                Rectangle().fill(Theme.accent.opacity(0.15)).frame(height: g.size.height * bottom)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// An AI picture waiting for a look, above the page: the check doubted it, so it goes in only when the person says.
struct MacDesignCandidateBar: View {
    let model: DesignWorkspaceModel

    var body: some View {
        if let c = model.candidate {
            let same = c.check.map { DesignAIRules.checkOK($0) }
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    if let image = WebsitePhoto.thumbnail(c.data, maxPixel: 240) {
                        Image(uiImage: image).resizable().scaledToFill()
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(c.label): to look at").font(.headline)
                        Text(verdict(c, same: same)).font(.callout).foregroundStyle(same == true ? Tone.settled.color : Tone.owed.color).lineLimit(2)
                    }
                    Spacer(minLength: 12)
                    Button("Discard") { model.candidate = nil }
                    if same == true {
                        Button("Use It") { model.useCandidate() }.buttonStyle(.borderedProminent)
                    } else {
                        Button("Use It Anyway") { model.useCandidate() }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                Divider()
            }
            .background(.bar)
        }
    }

    private func verdict(_ c: DesignCandidate, same: Bool?) -> String {
        if same == true { return "The same piece as the photograph." }
        if let check = c.check {
            let diffs = check["differences"].array.prefix(3).map(\.string).joined(separator: "; ")
            return "The piece may have changed: " + (diffs.isEmpty ? "compare it with your photograph" : diffs) + "."
        }
        return "Not checked: compare the piece with your photograph."
    }
}

/// The AI tab: each tool a row with its name, one line of what it does, and a Run button. One tool at a time (the model's
/// `aiBusy`); a result the check doubts waits above the page for a look.
struct MacDesignAIPane: View {
    let model: DesignWorkspaceModel
    let access: DesignAccess

    private var hasPhoto: Bool { model.photos["photo"] != nil }
    private var off: Bool { model.aiBusy != nil || !hasPhoto }

    var body: some View {
        Form {
            Section {
                if !hasPhoto { Text("Add a photograph first.").foregroundStyle(.secondary) }
                if let check = model.photoCheck {
                    let ok = DesignAIRules.checkOK(check)
                    Label(ok ? "Same piece" : (check["differences"].array.first?.string ?? "Look closely"), systemImage: ok ? "checkmark.shield" : "exclamationmark.shield")
                        .foregroundStyle(ok ? Tone.settled.color : Tone.owed.color)
                }
                if let busy = model.aiBusy {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text(busy + "…").foregroundStyle(.secondary) }
                }
                if model.canUndoPhoto {
                    Button("Back to the Photo Before") { model.undoPhoto() }.disabled(model.aiBusy != nil)
                }
            } header: {
                Text("With AI the piece stays as it is")
            } footer: {
                Text("Every result is compared with your photo; one that changed the piece waits for your say.")
            }
            Section("Photograph") {
                row("Enhance", "Cleans the photo, evens the colour and adds sparkle.") { Task { await model.photoTool(.enhance) } }
                row("Logo and Labels Off", "Takes the marks and labels off the photograph.") { Task { await model.photoTool(.clean) } }
                row("Extend to This Shape", "Fills the photograph out to the page's shape.") { Task { await model.photoTool(.extend) } }
                row("Retouch", "Cleans the piece, the background and the light.") { Task { await model.photoTool(.retouch) } }
                row("New Setting…", "Photographs the piece again in another setting.") {
                    model.sheet = DesignSheet(title: "New setting") { DesignSettingSheet(model: model) }
                }
                row("Ask AI…", "Say in your own words what should change.") {
                    model.sheet = DesignSheet(title: "Ask AI") { DesignAskSheet(model: model) }
                }
                row("Remove Background", "Cuts the piece out on a clear background.") { Task { await model.cutOut() } }
                Toggle("Also remove tags and strings", isOn: Binding(get: { model.tidy }, set: { model.setTidy($0) }))
            }
            if access.ads {
                Section("The whole design") {
                    row("Flat Image to Layers", "Rebuilds a flat picture as layers you can edit.") { Task { await model.splitLayers() } }
                    if model.work?.kind == "ad" {
                        row("Make the Ad with AI…", "Lays every size out from the photograph and its details.") {
                            model.sheet = DesignSheet(title: "Make it with AI") { DesignMakeAdSheet(model: model) }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func row(_ name: String, _ line: String, _ run: @escaping () -> Void) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                Text(line).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("Run", action: run).disabled(off)
        }
    }
}
#endif
