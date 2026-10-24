#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Copies of secrets (a customer's invoice link carries its key, a command carries a token): this device only
/// (no Universal Clipboard to the owner's other Apple devices) and gone after five minutes.
enum SecretPasteboard {
    static func copy(_ text: String, minutes: Double = 5) {
        #if os(macOS)
        // The Mac's pasteboard has no expiry: clear it ourselves after the time, but only if it still holds this
        // copy (whatever the person copied since is theirs). The Universal Clipboard is kept off by marking the
        // copy as transient and concealed, which clipboard managers and Handoff honour.
        let board = NSPasteboard.general
        board.clearContents()
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        board.writeObjects([item])
        let mine = board.changeCount
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(minutes * 60))
            if NSPasteboard.general.changeCount == mine { NSPasteboard.general.clearContents() }
        }
        #else
        UIPasteboard.general.setItems([["public.utf8-plain-text": text]],
                                      options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(minutes * 60)])
        #endif
    }

    static func copy(_ url: URL, minutes: Double = 5) { copy(url.absoluteString, minutes: minutes) }
}
