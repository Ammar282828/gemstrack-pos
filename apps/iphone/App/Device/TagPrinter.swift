import Foundation
import ERPCore

/// Printing the shop's own tag (Settings → Labels, ERPCore `LabelLayout`) straight to a Zebra, without Label LIVE: the
/// tag is drawn as ZPL by ERPCore (`Zpl.render`, the web's zebra-zpl.ts case for case) and sent by the way this device
/// is set to (`TagPrinter.Route`). Label LIVE stays the other way (`LabelLivePrinter`); which one a print uses is this
/// device's choice (`TagPrinter.method`).
///
/// The designer, ⌘P on a piece, Stock's selection and a piece's tag sheet all print through `TagPrinter.print`.
enum TagPrinter {
    /// How a tag reaches the printer.
    enum Method: String, Codable, CaseIterable, Identifiable {
        /// Label LIVE's design (its Integrate link), as before.
        case labelLive
        /// The shop's own tag as ZPL, straight to a Zebra.
        case zebra
        var id: String { rawValue }
    }

    /// Where ZPL goes.
    enum Route: Codable, Hashable {
        /// Zebra Browser Print, Zebra's free helper on this Mac (127.0.0.1:9100): any Zebra it sees, USB or network.
        case browserPrint(deviceUID: String?)
        /// A printer macOS knows (System Settings → Printers), sent raw (a ZPL queue, or a Zebra added as "Generic").
        case systemQueue(name: String)
        /// A Zebra on the shop's network, by its address (port 9100, raw).
        case network(host: String, port: Int)
    }

    struct Job: Hashable {
        var copies = 1
        /// Blank labels first, for a roll that is part used.
        var skip = 0
        /// The first number a `{counter}` takes; nil keeps the design's own.
        var counterStart: Int?
    }

    struct Outcome: Equatable {
        let ok: Bool
        let message: String
    }

    /// This device's choice of method, per business (the web's print history is per browser too).
    static var method: Method {
        get { Method(rawValue: UserDefaults.standard.string(forKey: BizKey("erp.tagPrinter.method")) ?? "") ?? .labelLive }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: BizKey("erp.tagPrinter.method")) }
    }

    /// This device's Zebra, per business; nil until chosen.
    static var route: Route? {
        get {
            guard let data = UserDefaults.standard.data(forKey: BizKey("erp.tagPrinter.route")) else { return nil }
            return try? JSONDecoder().decode(Route.self, from: data)
        }
        set {
            let key = BizKey("erp.tagPrinter.route")
            if let newValue, let data = try? JSONEncoder().encode(newValue) { UserDefaults.standard.set(data, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }

    /// The pieces' values a tag is filled from (Label LIVE's fields and the Tag CSV's columns, as the web fills them).
    static func values(for pieces: [Product], settings: Settings) -> [LabelValues] {
        // valuesFor carries the CSV's columns too, as `csv:<column>`, which is how Zpl reads `{SKU}` / `{METAL_WEIGHT_G_1}`.
        pieces.map { LabelLive.valuesFor($0, settings) }
    }

    /// The ZPL for these pieces on this layout.
    static func zpl(layout: LabelLayout, pieces: [Product], settings: Settings, job: Job = Job(), now: Date = Date()) -> String {
        Zpl.render(layout, pieces: values(for: pieces, settings: settings), copies: job.copies, skip: job.skip,
                   counterStart: job.counterStart, now: now)
    }

    /// Prints these pieces' tags by this device's method: the shop's tag as ZPL to its Zebra, or Label LIVE.
    /// Each piece is noted in this device's print history either way.
    @MainActor
    static func print(pieces: [Product], settings: Settings, job: Job = Job()) async -> Outcome {
        switch method {
        case .labelLive:
            guard let config = settings.labelLiveConfig else {
                return Outcome(ok: false, message: "Label LIVE isn't set up. Paste the design's Integrate link in Settings → Labels → Label LIVE.")
            }
            let o = await LabelLivePrinter.print(pieces: pieces, settings: settings, config: config, copies: job.copies)
            return Outcome(ok: o.ok, message: o.message)
        case .zebra:
            let layout = settings.labelLayout ?? LabelLayout.standard
            let outcome = await send(zpl(layout: layout, pieces: pieces, settings: settings, job: job))
            LabelPrintHistory.note(skus: pieces.map(\.sku), design: layout.name,
                                   outcome: LabelLivePrinter.Outcome(ok: outcome.ok, route: .api, message: outcome.message))
            return outcome
        }
    }

    /// ZPL to this device's Zebra (the designer's test print sends its own).
    @MainActor
    static func send(_ zpl: String) async -> Outcome {
        guard let route else {
            return Outcome(ok: false, message: "Choose the Zebra first: Settings → Labels → Printer.")
        }
        return await ZebraTransport.send(zpl, to: route)
    }
}
