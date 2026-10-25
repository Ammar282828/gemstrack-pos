import SwiftUI

// The phase-2 hooks. Design's phase 1 is the shell (start screen, page strip, the existing layer editor, Save, Saved, drafts); each hook below
// is a button the shell shows, and its action is a sheet from this package:
//   resize / redoFromMaster   DesignResize.swift   (resize-sheet.tsx, lib/design/resize*.ts, POST /api/design/resize)
//   startWithAnything          DesignSmart.swift    (smart-input.tsx, POST /api/design/{parse,analyze,layers}, GET /api/design/fetch)
//   publish                    DesignPublish*.swift (publish-sheet.tsx, lib/design/{destinations,publish}.ts, GET /api/design/destinations)
// The AI picture tools are the photograph card's own (DesignAI.swift). A screen replaces a closure to open something else:
//
//     DesignHooks.shared.publish = { model in model.sheet = DesignSheet(title: "Publish") { DesignPublishSheet(model: model) } }
//
// What a sheet can use on `DesignWorkspaceModel`:
//   work / photos          the design (pages with their `doc`, fields, copy) and its photographs by id ("photo" is the main one)
//   addPages(_:)           pages from the resize sheet (design-state.ts addPages)       setDoc / redoFromMaster(_:_:)
//   render(pageId:px:)     a page as JPEG data (the same engine call Save uses)         renderWith(pageId:photoId:px:)
//   saveToShop()           Save, returning the record                                   recordPublish(...)  PATCH { published }
//   finish()               the draft goes once it is sent                               say(_:detail:failed:)  the Note toast

/// A sheet a hook asks the screen to show.
struct DesignSheet: Identifiable {
    let id = UUID()
    let title: String
    let content: AnyView
    /// A big workspace (Resize's grid of shapes) takes the iPad's page sheet; the rest are forms.
    let wide: Bool
    init<V: View>(title: String, wide: Bool = false, @ViewBuilder content: () -> V) {
        self.title = title
        self.wide = wide
        self.content = AnyView(content())
    }

    /// The content at the iPad's sheet size for what it is.
    @ViewBuilder var shown: some View {
        #if os(macOS)
        // A Mac sheet opens at the size its content needs (the wide ones, Resize and Layers, a window's worth) and is never
        // bound to more than 560 x 520, so it fits the smallest screen.
        content.frame(minWidth: wide ? 560 : 520, idealWidth: wide ? 1000 : 640, minHeight: wide ? 520 : 480, idealHeight: wide ? 700 : 560)
        #else
        if wide { content.presentationSizing(.page) } else { content.presentationSizing(.form) }
        #endif
    }
}

@MainActor
final class DesignHooks {
    /// Replaced, not cleared, when the person switches business (Businesses.switch): none of it is the next one's.
    static var shared = DesignHooks()
    static func reset() { shared = DesignHooks() }

    /// "Resize…" in the workspace and "Size" in the page strip: the master's design on another shape (AI resize).
    var resize: (DesignWorkspaceModel) -> Void = { model in
        model.sheet = DesignSheet(title: "Resize", wide: true) { DesignResizeSheet(model: model) }
    }
    /// "Re-do from the master" on a resized page that is behind it (resize engine, one page).
    var redoFromMaster: (DesignWorkspaceModel, String) -> Void = { model, pageId in
        Task { await model.redoPage(pageId) }
    }
    /// "Publish": the one sheet that sends a design anywhere (website, WhatsApp, Instagram, Meta ad, queue, download).
    var publish: (DesignWorkspaceModel) -> Void = { model in
        guard model.work?.fresh == false else { return }
        model.sheet = DesignSheet(title: "Publish") { DesignPublishSheet(model: model) }
    }
    /// "Start with anything" on the start screen: paste a caption, a forwarded message, a link or a SKU, or choose photos. The sheet fills the
    /// form through `DesignStartModel.apply(fields:price:photo:kind:)`.
    var startWithAnything: (DesignStartModel) -> Void = { start in
        start.sheet = DesignSheet(title: "Start with anything") { DesignSmartSheet(start: start, allowLayers: start.adsAllowed) }
    }
}

/// A sheet takes the screen's toasts while it is up (the screen's own is behind it) and gives them back when it goes.
struct DesignSpeech: ViewModifier {
    let get: () -> ((Note) -> Void)?
    let set: (((Note) -> Void)?) -> Void
    @Binding var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var previous: ((Note) -> Void)?

    func body(content: Content) -> some View {
        content
            .noteToast($note)
            .onAppear {
                previous = get()
                set({ n in Note.show(n, in: $note, reduce: reduceMotion) })
            }
            .onDisappear { set(previous) }
    }
}
