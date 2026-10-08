// Ported from src/lib/rates.ts (tests: RatesTests, from rates.test.ts). Named RatesLogic.swift
// because Models/Rates.swift holds the `Rates` document type and two files of one name cannot
// share a module.
//
// The shop's live rates: which one is "the" rate, when it was set and by whom, and what a
// sale may write back to it.
//
// The rates in app_settings/global are what every new sale starts from and what the website
// quotes and takes orders at (website/config.ts). Until 2026-10-01 the cart wrote its rates
// back after every save, new or edited — and editing an old invoice first loads that invoice's
// own rates, and a scanned bill sets the paper's — so re-saving a July invoice made July's rate
// today's (the audit of 1 Oct). Now only a new invoice writes back, and only the rates typed by
// hand in that cart (`ratesToKeep`).

import Foundation

/// Every rate the settings document holds, PKR per gram. The cases are in `RATE_KEYS`' order, which
/// is the order `changedRates` answers in.
public enum RateKey: String, CaseIterable, Hashable {
    case goldRatePerGram24k, goldRatePerGram22k, goldRatePerGram21k, goldRatePerGram18k
    case palladiumRatePerGram, palladiumRatePerGram18k, palladiumRatePerGram12k
    case platinumRatePerGram, silverRatePerGram

    /// The metal this rate prices (TS `RATE_METAL`).
    public var metal: MetalType {
        switch self {
        case .goldRatePerGram24k, .goldRatePerGram22k, .goldRatePerGram21k, .goldRatePerGram18k: return .gold
        case .palladiumRatePerGram, .palladiumRatePerGram18k, .palladiumRatePerGram12k: return .palladium
        case .platinumRatePerGram: return .platinum
        case .silverRatePerGram: return .silver
        }
    }
}

public let RATE_KEYS: [RateKey] = RateKey.allCases

/// TS `Rates = Partial<Record<RateKey, number>>`: whichever rates are given.
public typealias RateValues = [RateKey: Double]

/// The cart's rate boxes, by the names it uses.
public enum RateInputKey: String, CaseIterable, Hashable {
    case gold24k, gold22k, gold21k, gold18k, palladium, palladium18k, palladium12k, platinum, silver

    /// TS `INPUT_TO_RATE`.
    public var rateKey: RateKey {
        switch self {
        case .gold24k: return .goldRatePerGram24k
        case .gold22k: return .goldRatePerGram22k
        case .gold21k: return .goldRatePerGram21k
        case .gold18k: return .goldRatePerGram18k
        case .palladium: return .palladiumRatePerGram
        case .palladium18k: return .palladiumRatePerGram18k
        case .palladium12k: return .palladiumRatePerGram12k
        case .platinum: return .platinumRatePerGram
        case .silver: return .silverRatePerGram
        }
    }
}

public extension Rates {
    /// The rates this sale carried (a rate it did not carry is absent, never 0).
    var values: RateValues {
        var out: RateValues = [:]
        let all: [(RateKey, Double?)] = [
            (.goldRatePerGram24k, goldRatePerGram24k), (.goldRatePerGram22k, goldRatePerGram22k),
            (.goldRatePerGram21k, goldRatePerGram21k), (.goldRatePerGram18k, goldRatePerGram18k),
            (.palladiumRatePerGram, palladiumRatePerGram), (.palladiumRatePerGram18k, palladiumRatePerGram18k),
            (.palladiumRatePerGram12k, palladiumRatePerGram12k), (.platinumRatePerGram, platinumRatePerGram),
            (.silverRatePerGram, silverRatePerGram),
        ]
        for (key, value) in all { if let value { out[key] = value } }
        return out
    }
}

public extension Settings {
    /// The shop's rates as stored (a rate never set reads 0 here, as in the model).
    var rates: RateValues {
        [
            .goldRatePerGram24k: goldRatePerGram24k, .goldRatePerGram22k: goldRatePerGram22k,
            .goldRatePerGram21k: goldRatePerGram21k, .goldRatePerGram18k: goldRatePerGram18k,
            .palladiumRatePerGram: palladiumRatePerGram, .palladiumRatePerGram18k: palladiumRatePerGram18k,
            .palladiumRatePerGram12k: palladiumRatePerGram12k, .platinumRatePerGram: platinumRatePerGram,
            .silverRatePerGram: silverRatePerGram,
        ]
    }
}

public struct MainRate: Equatable {
    public let key: RateKey
    public let label: String
}

/// The one rate a house watches: 21K for a gold house, silver for a silver one.
public func mainRate(_ defaultMetal: MetalType) -> MainRate {
    defaultMetal == .silver
        ? MainRate(key: .silverRatePerGram, label: "Silver")
        : MainRate(key: .goldRatePerGram21k, label: "21K")
}

/// What a saved invoice may write back to the shop's rates: nothing for an edit, and for a new
/// invoice only the boxes typed by hand in this cart, for a metal the sale carries, when the
/// figure is a real rate and differs from the one stored. A rate loaded from an invoice or read
/// off a scanned bill is never "typed" (the cart forgets a box when either sets it).
/// Nil when nothing is to be written.
public func ratesToKeep(
    isNew: Bool,
    typed: Set<RateInputKey>,
    inputs: [RateInputKey: String],
    metals: Set<MetalType>,
    current: RateValues
) -> RateValues? {
    if !isNew { return nil }
    var out: RateValues = [:]
    // The TS walks a Set in insertion order; no two boxes write the same rate, so the order cannot show.
    for input in typed {
        let key = input.rateKey
        if !metals.contains(key.metal) { continue }
        let v = JS.parseFloat(inputs[input] ?? "")
        if !v.isFinite || v <= 0 { continue }
        if abs(v - (current[key] ?? 0)) < 0.005 { continue }
        out[key] = v
    }
    return out.isEmpty ? nil : out
}

/// The rate keys in a settings change whose value actually moves.
public func changedRates(_ patch: RateValues, _ current: RateValues) -> [RateKey] {
    RATE_KEYS.filter { k in
        guard let v = patch[k], v.isFinite else { return false }
        return abs(v - (current[k] ?? 0)) >= 0.005
    }
}

/// Karachi's calendar date, yyyy-mm-dd.
public func karachiDay(_ d: Date) -> String { ERPDate.karachiDay(d) }

/// Whether the rates were set on Karachi's today. An unknown time is never today.
public func ratesSetToday(_ updatedAt: String?, now: Date = Date()) -> Bool {
    guard let t = JS.newDate(updatedAt) else { return false }
    return karachiDay(t) == karachiDay(now)
}

/// "9:40" today, "Tue 9:40" this week, "28 Sept" before: Karachi time. (The browser's en-GB:
/// 24-hour clock with the hour unpadded, "0:30" after midnight, and September short as "Sept".)
public func whenSet(_ updatedAt: String?, now: Date = Date()) -> String {
    guard let t = JS.newDate(updatedAt) else { return "not dated" }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = ERPDate.karachi
    let parts = calendar.dateComponents([.hour, .minute, .weekday, .day, .month], from: t)
    let time = "\(parts.hour ?? 0):" + (parts.minute.map { $0 < 10 ? "0\($0)" : "\($0)" } ?? "00")
    if karachiDay(t) == karachiDay(now) { return time }
    let days = (now.timeIntervalSince1970 - t.timeIntervalSince1970) * 1000 / 86_400_000
    if days < 6 { return "\(JS.shortWeekdays[(parts.weekday ?? 1) - 1]) \(time)" }
    return "\(parts.day ?? 1) \(JS.shortMonths[(parts.month ?? 1) - 1])"
}
