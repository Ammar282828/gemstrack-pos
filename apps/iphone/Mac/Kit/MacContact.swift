#if os(macOS)
import AppKit
import SwiftUI
import ERPCore

// The one Contact order (App/UI/CustomerContact.swift, lib/customer-contact.ts; owner, 2026-11-02: "organize the pdf
// and whatsapp and phone and messaging for customers properly") as Mac actions, for the places that declare their
// actions once (MacAction: the menu bar's record menu, the right-click menu, a record window's More):
//
//   Call · WhatsApp Chat · Message · [the record's Send PDF on WhatsApp… · its PDF] · Copy Number
//
// The number is the shared normaliser's (CustomerContactLinks.e164: 0300… → +92300…). A walk-in has none to call, so
// its actions stay in the menu, shut, as the record menus do with nothing picked. Call opens FaceTime (iPhone calls on
// the Mac), Message opens Messages, WhatsApp Chat opens wa.me. Not tied to the main actor: the Order menu's declarations
// (MacOrdersMenu) are not, and nothing here needs it.
enum MacContact {
    /// The number the actions use: "" for a walk-in or nothing dialable.
    static func number(_ phone: String?, customerId: String?, customerName: String?) -> String {
        CustomerContactLinks.isWalkIn(customerId: customerId, customerName: customerName) ? "" : CustomerContactLinks.e164(phone)
    }

    /// Call, WhatsApp Chat and Message, then `document` (the record's own PDF actions), then Copy Number.
    static func actions(_ number: String, document: [MacAction] = []) -> [MacAction] {
        let has = !number.isEmpty
        var out: [MacAction] = [
            MacAction("Call", symbol: "phone", enabled: has, id: "call") { open(CustomerContactLinks.callURL(number)) },
            MacAction("WhatsApp Chat", symbol: "bubble.left.and.text.bubble.right", enabled: has, id: "whatsapp") {
                open(CustomerContactLinks.whatsAppURL(number))
            },
            MacAction("Message", symbol: "text.bubble", enabled: has, id: "text") { open(CustomerContactLinks.messageURL(number)) },
        ]
        out.append(contentsOf: document)
        out.append(copyNumber(number))
        return out
    }

    static func copyNumber(_ number: String) -> MacAction {
        MacAction("Copy Number", symbol: "doc.on.doc", enabled: !number.isEmpty, id: "copyNumber") {
            CustomerContactLinks.copy(number)
        }
    }

    private static func open(_ url: URL?) {
        if let url { NSWorkspace.shared.open(url) }
    }
}
#endif
