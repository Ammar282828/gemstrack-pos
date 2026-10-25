#if os(macOS)
import SwiftUI
import AppKit

// Edit order: closing its window with changes not yet saved asks "Save / Don't Save / Cancel", as a document does
// (docs/features/mac-design.md, "New order"). SwiftUI has no hook for a window's close, so this reaches the window by its
// delegate: it answers `windowShouldClose` and hands every other message to the delegate SwiftUI put there. The window also
// shows the dot in its close button while there are changes (`isDocumentEdited`). It does nothing while `changed` is false.

struct MacNewOrderCloseGuard: NSViewRepresentable {
    /// The form has been changed and not saved.
    let changed: Bool
    /// The question's first line: "Do you want to save the changes to ORD-000123?"
    let question: String
    /// Save (the form's own save: when it works, the form closes itself).
    let save: () -> Void

    func makeNSView(context: Context) -> MacNewOrderCloseView {
        MacNewOrderCloseView()
    }

    func updateNSView(_ view: MacNewOrderCloseView, context: Context) {
        view.proxy.changed = changed
        view.proxy.question = question
        view.proxy.save = save
        view.window?.isDocumentEdited = changed
    }
}

/// An invisible view that sits in the window and puts the proxy in front of its delegate.
final class MacNewOrderCloseView: NSView {
    let proxy = MacNewOrderCloseProxy()
    private weak var installed: NSWindow?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let w = window {
            if w.delegate !== proxy {
                proxy.original = w.delegate
                w.delegate = proxy
                installed = w
            }
            w.isDocumentEdited = proxy.changed
        } else {
            release()
        }
    }

    /// Puts the window's own delegate back.
    private func release() {
        if let w = installed {
            if w.delegate === proxy { w.delegate = proxy.original }
            w.isDocumentEdited = false
        }
        installed = nil
    }
}

final class MacNewOrderCloseProxy: NSObject, NSWindowDelegate {
    weak var original: NSWindowDelegate?
    var changed = false
    var question = ""
    var save: () -> Void = {}
    private var asking = false

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return original?.responds(to: aSelector) ?? false
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let original, original.responds(to: aSelector) { return original }
        return nil
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if !changed { return original?.windowShouldClose?(sender) ?? true }
        if asking { return false }
        asking = true
        let alert = NSAlert()
        alert.messageText = question
        alert.informativeText = "Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don't Save")
        alert.beginSheetModal(for: sender) { [weak self] response in
            guard let self else { return }
            self.asking = false
            if response == .alertFirstButtonReturn {
                self.save()
            } else if response == .alertThirdButtonReturn {
                self.changed = false
                sender.close()
            }
        }
        return false
    }
}
#endif
