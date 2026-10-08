import Foundation

// The ERP's fixed lists (src/lib/store.ts, materials.ts, website/types.ts) as words that never
// fail a document: see `LenientRaw`. The fallback case is `.unknown(raw)` everywhere (not
// `.other`), because three of the lists have a real "other" of their own.

/// `ORDER_STATUSES`. A refunded order is `Refunded`; a lapsed website order is `Cancelled`.
public enum OrderStatus: LenientRaw {
    case pending, inProgress, completed, cancelled, refunded
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "Pending": self = .pending
        case "In Progress": self = .inProgress
        case "Completed": self = .completed
        case "Cancelled": self = .cancelled
        case "Refunded": self = .refunded
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .pending: return "Pending"
        case .inProgress: return "In Progress"
        case .completed: return "Completed"
        case .cancelled: return "Cancelled"
        case .refunded: return "Refunded"
        case .unknown(let s): return s
        }
    }
}

/// `PAYMENT_TYPES`: how the money actually arrived. Absent on records older than payment types.
public enum PaymentType: LenientRaw {
    case cash, card, bankTransfer, cheque
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "Cash": self = .cash
        case "Card": self = .card
        case "Bank Transfer": self = .bankTransfer
        case "Cheque": self = .cheque
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .cash: return "Cash"
        case .card: return "Card"
        case .bankTransfer: return "Bank Transfer"
        case .cheque: return "Cheque"
        case .unknown(let s): return s
        }
    }
}

/// `MetalType` (materials.ts).
public enum MetalType: LenientRaw {
    case gold, palladium, platinum, silver
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "gold": self = .gold
        case "palladium": self = .palladium
        case "platinum": self = .platinum
        case "silver": self = .silver
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .gold: return "gold"
        case .palladium: return "palladium"
        case .platinum: return "platinum"
        case .silver: return "silver"
        case .unknown(let s): return s
        }
    }
}

/// `KaratValue` (materials.ts). Platinum and silver carry none.
public enum KaratValue: LenientRaw {
    case k12, k18, k21, k22, k24
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "12k": self = .k12
        case "18k": self = .k18
        case "21k": self = .k21
        case "22k": self = .k22
        case "24k": self = .k24
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .k12: return "12k"
        case .k18: return "18k"
        case .k21: return "21k"
        case .k22: return "22k"
        case .k24: return "24k"
        case .unknown(let s): return s
        }
    }
}

/// `CUSTOMER_SOURCES`: where a customer or sale came from.
public enum CustomerSource: LenientRaw {
    case taheriSpillover, referral, walkin, socialMedia, website, other
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "taheri_spillover": self = .taheriSpillover
        case "referral": self = .referral
        case "walkin": self = .walkin
        case "social_media": self = .socialMedia
        case "website": self = .website
        case "other": self = .other
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .taheriSpillover: return "taheri_spillover"
        case .referral: return "referral"
        case .walkin: return "walkin"
        case .socialMedia: return "social_media"
        case .website: return "website"
        case .other: return "other"
        case .unknown(let s): return s
        }
    }
}

/// `HisaabEntityType`: whose ledger a hisaab row belongs to.
public enum HisaabEntityType: LenientRaw {
    case customer, karigar
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "customer": self = .customer
        case "karigar": self = .karigar
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .customer: return "customer"
        case .karigar: return "karigar"
        case .unknown(let s): return s
        }
    }
}

/// `PaidBy`: who fronted the cash for an expense. Absent means the business.
public enum PaidBy: LenientRaw {
    case business, ammar, mina
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "business": self = .business
        case "ammar": self = .ammar
        case "mina": self = .mina
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .business: return "business"
        case .ammar: return "ammar"
        case .mina: return "mina"
        case .unknown(let s): return s
        }
    }
}

/// `KARIGAR_JOB_STATUSES` (lower-case, with a hyphen, unlike the order statuses).
public enum KarigarJobStatus: LenientRaw {
    case pending, inProgress, completed
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "pending": self = .pending
        case "in-progress": self = .inProgress
        case "completed": self = .completed
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .pending: return "pending"
        case .inProgress: return "in-progress"
        case .completed: return "completed"
        case .unknown(let s): return s
        }
    }
}

/// `REPAIR_STATUSES`: in the shop, ready, collected, cancelled.
public enum RepairStatus: LenientRaw {
    case received, ready, collected, cancelled
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "received": self = .received
        case "ready": self = .ready
        case "collected": self = .collected
        case "cancelled": self = .cancelled
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .received: return "received"
        case .ready: return "ready"
        case .collected: return "collected"
        case .cancelled: return "cancelled"
        case .unknown(let s): return s
        }
    }
}

/// `GivenItemStatus`.
public enum GivenItemStatus: LenientRaw {
    case out, returned
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "out": self = .out
        case "returned": self = .returned
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .out: return "out"
        case .returned: return "returned"
        case .unknown(let s): return s
        }
    }
}

/// `GivenItemRecipientType`.
public enum GivenItemRecipientType: LenientRaw {
    case karigar, customer, other
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "karigar": self = .karigar
        case "customer": self = .customer
        case "other": self = .other
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .karigar: return "karigar"
        case .customer: return "customer"
        case .other: return "other"
        case .unknown(let s): return s
        }
    }
}

/// `WebsitePaymentStatus` (website/types.ts): where a taheri.shop order's transfer stands.
public enum WebsitePaymentStatus: LenientRaw {
    case awaitingTransfer, slipSent, transferReceived, refunded, expired
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "awaiting_transfer": self = .awaitingTransfer
        case "slip_sent": self = .slipSent
        case "transfer_received": self = .transferReceived
        case "refunded": self = .refunded
        case "expired": self = .expired
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .awaitingTransfer: return "awaiting_transfer"
        case .slipSent: return "slip_sent"
        case .transferReceived: return "transfer_received"
        case .refunded: return "refunded"
        case .expired: return "expired"
        case .unknown(let s): return s
        }
    }
}

/// An invoice's `status`: only ever `Refunded`, and absent on every live invoice.
public enum InvoiceStatus: LenientRaw {
    case refunded
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "Refunded": self = .refunded
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .refunded: return "Refunded"
        case .unknown(let s): return s
        }
    }
}
