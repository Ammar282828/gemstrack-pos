// Ported from src/lib/analytics/gold-apart.ts (tests: GoldApartTests, from gold-apart.test.ts).
//
// Gold apart from silver (owner, 2026-11-09, House of Mina): each sale's value is split by its pieces' metal; silver's
// profit is not changed: gold's estimate at the house's margin is only a caption beside its revenue. On by the business
// descriptor's `goldApartMargin` (a percent; nil: one revenue, as Taheri keeps).

import Foundation

public enum GoldApart {
    /// The share of a sale that is gold, by its lines' values (0 with no lines or no value).
    public static func goldShare(_ lines: [(String, Double)]) -> Double {
        var gold = 0.0, all = 0.0
        for l in lines {
            let v = max(0, l.1.isNaN ? 0 : l.1)
            all += v
            if l.0.lowercased() == "gold" { gold += v }
        }
        return all > 0 ? gold / all : 0
    }

    /// An invoice's gold part of `saleValue`, by its lines' totals.
    public static func invoiceGoldPart(_ inv: Invoice, _ saleValue: Double) -> Double {
        saleValue * goldShare(inv.items.map { ($0.metalType.rawValue, $0.itemTotal) })
    }

    /// An order's gold part of `amount`, by its pieces' prices.
    public static func orderGoldPart(_ order: Order, _ amount: Double) -> Double {
        saleShare(order, amount)
    }

    private static func saleShare(_ order: Order, _ amount: Double) -> Double {
        let lines = order.items.map { i -> (String, Double) in
            let price = i.isManualPrice ? (i.manualPrice ?? i.totalEstimate ?? 0) : (i.totalEstimate ?? 0)
            return (i.metalType.rawValue, price)
        }
        return amount * goldShare(lines)
    }

    public static let silverRevenueLabel = "Silver revenue"

    /// "Gold revenue (est. 10% margin)": the gold figure always carries its estimated margin.
    public static func goldRevenueLabel(_ percent: Double) -> String {
        "Gold revenue (est. \(percentText(percent))% margin)"
    }

    /// 10 -> "10", 7.5 -> "7.5" (as JS prints the number).
    public static func percentText(_ percent: Double) -> String {
        percent == percent.rounded() ? String(Int(percent)) : String(percent)
    }
}

/// Gold per bucket, by the same grain and frame as `bucketSeries` (silver is each row's sales less this).
public func goldBucketSeries(_ series: [SalesDay], _ bucket: BooksBucket, range: Period? = nil, now: Date = Date()) -> [BucketRow] {
    bucketSeries(series.map { var r = $0; r.sales = r.gold; return r }, bucket, range: range, now: now)
}

/// Rows for a stacked chart: silver then gold per bucket.
public struct SilverGoldRow: Equatable, Identifiable {
    public let key: String
    public let label: String
    public let tip: String
    public let start: Date
    public let silver: Double
    public let gold: Double
    public var id: String { key }
}

public func silverGoldRows(_ series: [SalesDay], _ bucket: BooksBucket, range: Period? = nil, now: Date = Date()) -> [SilverGoldRow] {
    let all = bucketSeries(series, bucket, range: range, now: now)
    let gold = goldBucketSeries(series, bucket, range: range, now: now)
    return all.enumerated().map { i, r in
        let g = min(r.sales, i < gold.count ? gold[i].sales : 0)
        return SilverGoldRow(key: r.key, label: r.label, tip: r.tip, start: r.start, silver: max(0, r.sales - g), gold: g)
    }
}
