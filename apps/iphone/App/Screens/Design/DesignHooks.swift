import SwiftUI

// PHASE 2 HOOKS. Design's phase 1 is the shell (start screen, page strip, the existing layer editor, Save, Saved, drafts). The
// pieces below are the buttons the web's workspace has and the shell shows, with their actions left as stubs for the next
// package: AI resize (resize-sheet.tsx, lib/design/resize*.ts), the smart input (smart-input.tsx, lib/design/parse*.ts)
// and the Publish sheet (publish-sheet.tsx, lib/design/{destinations,publish}.ts).
//
// To fill one in, replace its closure (at app start, or in `DesignRoutes`) with one that opens a sheet:
//
//     DesignHooks.shared.publish = { model in model.sheet = DesignSheet(title: "Publish") { PublishSheet(model: model) } }
//
// What a phase-2 view can use on `DesignWorkspaceModel`:
//   work / photos          the design (pages with their `doc`, fields, copy) and its photographs by id ("photo" is the main one)
//   addPages(_:)           pages from the resize sheet (design-state.ts addPages)       setDoc / redoFromMaster(_:_:)
//   render(pageId:px:)     a page as JPEG data (the same engine call Save uses)         renderWith(pageId:photoId:px:)
//   saveToShop()           Save, returning the record (Publish saves first, as the web's sheet does)
//   recordPublish(...)     PATCH { published } on the saved design                      finish()  the draft goes once it is sent
//   say(_:detail:failed:)  the Note toast                                               error  the failure alert

/// A sheet a hook asks the screen to show.
struct DesignSheet: Identifiable {
    let id = UUID()
    let title: String
    let content: AnyView
    init<V: View>(title: String, @ViewBuilder content: () -> V) {
        self.title = title
        self.content = AnyView(content())
    }
}

@MainActor
final class DesignHooks {
    static let shared = DesignHooks()

    /// "Resize…" in the workspace and "Size" in the page strip: the master's design on another shape (AI resize).
    var resize: (DesignWorkspaceModel) -> Void = { model in
        model.say("Resize comes to the phone next", detail: "For now, add the size on the web: Posts › Design.")
    }
    /// "Re-do from the master" on a resized page that is behind it (resize engine, one page).
    var redoFromMaster: (DesignWorkspaceModel, String) -> Void = { model, _ in
        model.say("Re-doing a size comes to the phone with Resize", detail: "The page keeps its own layout until then.")
    }
    /// "Publish": the one sheet that sends a design anywhere (website, WhatsApp, Instagram, Meta ad, queue, download).
    var publish: (DesignWorkspaceModel) -> Void = { model in
        model.say("Publish comes to the phone next", detail: "Save the design, then publish it from Posts › Design on the web.")
    }
    /// "Start with anything" on the start screen: paste a caption, a forwarded message, a link or a SKU. A phase-2 sheet
    /// fills the form through `DesignStartModel.apply(fields:price:photo:kind:)`.
    var startWithAnything: (DesignStartModel) -> Void = { model in
        model.say("Start with anything comes to the phone next", detail: "Choose a kind, a size and a photograph below.")
    }
}
