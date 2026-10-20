import UIKit

/// Copies of secrets (a customer's invoice link carries its key, a command carries a token): this device only
/// (no Universal Clipboard to the owner's other Apple devices) and gone after five minutes.
enum SecretPasteboard {
    static func copy(_ text: String, minutes: Double = 5) {
        UIPasteboard.general.setItems([["public.utf8-plain-text": text]],
                                      options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(minutes * 60)])
    }

    static func copy(_ url: URL, minutes: Double = 5) { copy(url.absoluteString, minutes: minutes) }
}
