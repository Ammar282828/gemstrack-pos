import Foundation

/// Where an online order's WhatsApp stands, written onto its invoice by the server (`Invoice.whatsappOrder`;
/// src/lib/shopify-whatsapp.ts). Only `state` is read here; a missing or odd one is nil, never a failure.
public struct WhatsAppOrder: Decodable, Hashable {
    public let state: String?

    private enum K: String, CodingKey { case state }

    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: K.self)
        state = try? c?.decodeIfPresent(String.self, forKey: .state)
    }
}

/// The colour word a chip is drawn in; the app maps each to its `Tone` of the same name.
public enum WhatsAppOrderTone: String, Hashable {
    case late, owed, settled, working, quiet
}

/// A chip's words and tone.
public struct WhatsAppOrderChip: Equatable {
    public let label: String
    public let tone: WhatsAppOrderTone
}

/// The chip for a WhatsApp state, as the web's `whatsappOrderChip`; nil for no state or one not known.
public func whatsappOrderChip(_ state: String?) -> WhatsAppOrderChip? {
    switch state {
    case "awaiting-confirmation": return WhatsAppOrderChip(label: "Awaiting confirmation", tone: .working)
    case "confirmed": return WhatsAppOrderChip(label: "Confirmed on WhatsApp", tone: .settled)
    case "declined": return WhatsAppOrderChip(label: "Cancel requested", tone: .late)
    case "awaiting-payment": return WhatsAppOrderChip(label: "Awaiting transfer", tone: .working)
    case "slip-received": return WhatsAppOrderChip(label: "Screenshot sent", tone: .owed)
    case "paid": return WhatsAppOrderChip(label: "Paid \u{00B7} thanked on WhatsApp", tone: .settled)
    case "sent": return WhatsAppOrderChip(label: "Thanked on WhatsApp", tone: .quiet)
    case "failed": return WhatsAppOrderChip(label: "WhatsApp did not send", tone: .late)
    case "no-whatsapp": return WhatsAppOrderChip(label: "No WhatsApp", tone: .late)
    default: return nil
    }
}
