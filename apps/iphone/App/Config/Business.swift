import SwiftUI
import FirebaseCore
import ERPCore

/// One business the app can open: a house with its own ERP address, Firebase project, look and margin.
/// The JSON is exactly the ERP's `GET /api/app/business` (src/app/api/app/business/route.ts), so a business
/// is added by typing its address and the built-ins (Resources/businesses.json) are the same shape.
/// Lenient, as the models are: a missing or odd field gives a default; `Businesses.add` then judges whether
/// what is left is usable.
struct Business: Codable, Sendable, Equatable, Identifiable {
    var version: Int
    /// The brand id ("taheri", "mina"), or a slug for an added business. Keys the keychain, the Firebase app,
    /// the per-business settings and, for the built-ins, the bundled art.
    var id: String
    /// The shop's own name ("TAHERI"): for what a customer or a karigar reads.
    var name: String
    /// The ERP's name on the home screen ("Taheri ERP").
    var shortName: String
    /// Only the built-ins carry one ("House of Mina ERP"); an added business is "<name> ERP".
    var storeName: String?
    /// The ERP's origin, `https://erp.example.shop`, no path.
    var serverURL: String
    var metal: String
    var margin: Margin
    var palette: Palette
    var logo: Logo
    var icon: String?
    var ios: IOS
    var flags: Flags?
    /// The oldest build (CFBundleVersion) the ERP still takes (`APP_MIN_BUILD`); 0 or absent: any.
    var minBuild: Int?

    /// This app is older than the ERP allows: the UI says "Update from TestFlight" and keeps money screens shut.
    var needsUpdate: Bool {
        guard let need = minBuild, need > 0 else { return false }
        let have = Int((Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "") ?? Int.max
        return have < need
    }

    /// lib/margin.ts: Taheri costs a sale at 24K less so many ratti; a house with no costing has a percent.
    enum Margin: Codable, Sendable, Equatable {
        case rattiLess(Double)
        case percent(Double)

        private enum K: String, CodingKey { case kind, ratti, percent }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            if (try? c.decode(String.self, forKey: .kind)) == "percent" {
                self = .percent((try? c.decode(Double.self, forKey: .percent)) ?? 10)
            } else {
                self = .rattiLess((try? c.decode(Double.self, forKey: .ratti)) ?? 6)
            }
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: K.self)
            switch self {
            case .rattiLess(let r): try c.encode("rattiLess", forKey: .kind); try c.encode(r, forKey: .ratti)
            case .percent(let p): try c.encode("percent", forKey: .kind); try c.encode(p, forKey: .percent)
            }
        }

        /// ERPCore's settings: the 10% estimate beside a ratti figure is the code's default (STORE_EST_MARGIN);
        /// a percent is the estimate itself and nothing is costed by gold (Mina: 40).
        var settings: MarginSettings {
            switch self {
            case .rattiLess(let r): return MarginSettings(rattiLess: r, assumedMargin: 0.10)
            case .percent(let p): return MarginSettings(rattiLess: nil, assumedMargin: p / 100)
            }
        }
    }

    struct Side: Codable, Sendable, Equatable {
        var accent: String
        var ground: String
        var card: String
        var onAccent: String
        /// Sheets, popovers and the grouped rows inside a card (a lifted surface in dark; white in light). Older
        /// servers don't send it: the card stands in.
        var elevated: String?
    }

    struct Palette: Codable, Sendable, Equatable {
        var light: Side
        var dark: Side
    }

    struct Logo: Codable, Sendable, Equatable {
        /// For the light palette, for the dark palette (an off-white wordmark where the first is dark on dark).
        var light: String?
        var dark: String?
        var aspect: Double

        init(light: String?, dark: String?, aspect: Double) {
            self.light = light; self.dark = dark; self.aspect = aspect
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            light = try? c.decode(String.self, forKey: .light)
            dark = try? c.decode(String.self, forKey: .dark)
            aspect = (try? c.decode(Double.self, forKey: .aspect)) ?? 4
        }
    }

    struct IOS: Codable, Sendable, Equatable {
        var googleClientId: String
        var firebase: Firebase
    }

    struct Firebase: Codable, Sendable, Equatable {
        var apiKey: String
        var appId: String
        var projectId: String
        var senderId: String
        var storageBucket: String
    }

    /// The house's switches (lib/app-shop.ts shopFlags). The ERP's /api/app/me says the same once signed in;
    /// these only stand in before that.
    struct Flags: Codable, Sendable, Equatable {
        var partnership: Bool?
        var websiteSelling: Bool?
        var invoiceByCustomer: Bool?
        var invoiceWhatsappPdf: Bool?
        var sizeToProfile: Bool?
        var workshopStart: String?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        shortName = (try? c.decode(String.self, forKey: .shortName)) ?? name
        storeName = try? c.decode(String.self, forKey: .storeName)
        serverURL = try c.decode(String.self, forKey: .serverURL)
        metal = (try? c.decode(String.self, forKey: .metal)) == "silver" ? "silver" : "gold"
        margin = (try? c.decode(Margin.self, forKey: .margin)) ?? .rattiLess(6)
        palette = try c.decode(Palette.self, forKey: .palette)
        logo = (try? c.decode(Logo.self, forKey: .logo)) ?? Logo(light: nil, dark: nil, aspect: 4)
        icon = try? c.decode(String.self, forKey: .icon)
        ios = try c.decode(IOS.self, forKey: .ios)
        flags = try? c.decode(Flags.self, forKey: .flags)
        minBuild = try? c.decode(Int.self, forKey: .minBuild)
    }

    // MARK: Derived

    /// The built-ins with art in the app (colour sets, BrandLogo-<id>, nav-<id>.json, design-<id>.js); the
    /// demo wears Taheri's. Any other business is drawn from its palette and logo URLs.
    static let bundledIDs: Set<String> = ["taheri", "mina"]
    static let demoID = "demo"

    /// The id of the bundled art this business wears, nil for an added business.
    var art: String? {
        if Self.bundledIDs.contains(id) { return id }
        return id == Self.demoID ? "taheri" : nil
    }

    var url: URL { URL(string: serverURL) ?? URL(string: "https://erp.taheri.shop")! }
    var host: String { url.host ?? "" }
    var isDemo: Bool { id == Self.demoID }
    /// The first letter, for a badge where the logo is not at hand.
    var initial: String { String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased() }
    /// What the app calls this business where it says "<Name> ERP".
    var displayName: String { storeName ?? (name.lowercased().hasSuffix("erp") ? name : "\(name) ERP") }

    /// Nil until the house's iOS app is registered in Firebase (an empty or odd app id): the app then says so.
    var firebaseOptions: FirebaseOptions? {
        let f = ios.firebase
        guard f.appId.contains(":ios:") else { return nil }
        let o = FirebaseOptions(googleAppID: f.appId, gcmSenderID: f.senderId)
        o.apiKey = f.apiKey
        o.projectID = f.projectId
        o.storageBucket = f.storageBucket
        o.bundleID = Bundle.main.bundleIdentifier ?? ""
        return o
    }

    /// Why this descriptor cannot be used, or nil. `Businesses.add` refuses on it; the checks are what the app
    /// would otherwise fail on later (a colour that is not a hex, a Firebase app that is not an iOS one).
    var problem: String? {
        if id.isEmpty || id.range(of: "^[a-z0-9][a-z0-9-]{0,40}$", options: .regularExpression) == nil { return "That ERP's id isn't one this app can use." }
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return "That ERP has no name." }
        guard let u = URL(string: serverURL), u.scheme == "https", u.host != nil else { return "That ERP's address isn't a secure one." }
        if !ios.googleClientId.hasSuffix(".apps.googleusercontent.com") || !ios.firebase.appId.contains(":ios:")
            || ios.firebase.apiKey.isEmpty || ios.firebase.projectId.isEmpty {
            return "\(name) hasn't set up its iPhone sign-in yet. Ask the shop to register the app in Firebase."
        }
        for s in [palette.light, palette.dark] {
            for hex in [s.accent, s.ground, s.card, s.onAccent, s.elevated ?? s.card] where UIColor(hex: hex) == nil { return "That ERP's colours aren't readable." }
        }
        return nil
    }
}

// UIColor(hex:) is Shared/ERPWidgetLink.swift's: the widget reads the same hex palettes.

extension Business.Palette {
    /// One colour that follows the phone's appearance (the device's choice wins, decision "Light and dark").
    func dynamic(_ pick: @escaping @Sendable (Business.Side) -> String) -> UIColor {
        let l = UIColor(hex: pick(light)) ?? .gray, d = UIColor(hex: pick(dark)) ?? .gray
        return UIColor { $0.userInterfaceStyle == .dark ? d : l }
    }
}

// MARK: Per-business settings

/// A setting that belongs to one business, not to the phone: its key is the old one with the business id after it
/// ("erp.orderDraft" → "erp.orderDraft.taheri"), so a draft started in one business is never opened in another.
/// `Businesses.migrateLegacyKeys` moves what the single-house builds kept under the old names.
func BizKey(_ base: String, _ id: String? = nil) -> String { base + "." + (id ?? House.id) }
