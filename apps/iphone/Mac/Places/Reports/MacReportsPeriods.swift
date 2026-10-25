#if os(macOS)
import SwiftUI
import ERPCore

// The periods Analytics adds on the Mac, and what it compares them with (docs/features/mac-design.md, "Analytics"). ERPCore's
// `AnalyticsPeriod` is not changed: Last month and This quarter are written as the custom period (its from and to days),
// and a comparison is only another range handed to the same `AnaFigures`.

/// Compare with ▸ : the previous period, the same period last year, none.
enum MacReportsCompare: String {
    case none, previous, lastYear

    var label: String {
        switch self {
        case .none: return "None"
        case .previous: return "Previous period"
        case .lastYear: return "Same period last year"
        }
    }

    /// The words a change is "on": "+12% on previous period", "+12% on last year".
    var words: String {
        switch self {
        case .none: return ""
        case .previous: return "previous period"
        case .lastYear: return "last year"
        }
    }
}

/// One choice of the period pop-up.
struct MacReportsPeriodChoice: Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

enum MacReportsPeriods {
    /// The pop-up's choices: ERPCore's quick ranges in its order, with Last month after This month and This quarter after
    /// Last 90 days.
    static var choices: [MacReportsPeriodChoice] {
        var out: [MacReportsPeriodChoice] = []
        for q in AnaPeriod.quick {
            out.append(MacReportsPeriodChoice(key: q.key, label: q.label))
            if q.key == "this-month" { out.append(MacReportsPeriodChoice(key: "last-month", label: "Last month")) }
            if q.key == "last-90" { out.append(MacReportsPeriodChoice(key: "this-quarter", label: "This quarter")) }
        }
        return out
    }

    /// The first of the month before `now`'s to its last day.
    static func lastMonth(_ now: Date) -> AnaRange {
        let cal = AnaDate.karachi
        let thisStart = monthStart(now)
        let lastStart = cal.date(byAdding: .month, value: -1, to: thisStart) ?? thisStart
        let lastEnd = cal.date(byAdding: .day, value: -1, to: thisStart) ?? thisStart
        return AnaRange(from: lastStart, to: AnaDate.endOfDay(lastEnd))
    }

    /// The quarter `now` is in, its first day to its last.
    static func thisQuarter(_ now: Date) -> AnaRange {
        let cal = AnaDate.karachi
        let c = cal.dateComponents([.year, .month], from: now)
        let month = ((((c.month ?? 1) - 1) / 3) * 3) + 1
        let start = cal.date(from: DateComponents(year: c.year, month: month, day: 1)) ?? now
        let after = cal.date(byAdding: .month, value: 3, to: start) ?? start
        let end = cal.date(byAdding: .day, value: -1, to: after) ?? start
        return AnaRange(from: start, to: AnaDate.endOfDay(end))
    }

    /// Whether two ranges cover the same days.
    static func same(_ a: AnaRange, _ b: AnaRange) -> Bool {
        AnaDate.dayKey(a.from) == AnaDate.dayKey(b.from) && AnaDate.dayKey(a.to) == AnaDate.dayKey(b.to)
    }

    private static func monthStart(_ d: Date) -> Date {
        let cal = AnaDate.karachi
        return cal.date(from: cal.dateComponents([.year, .month], from: d)) ?? AnaDate.startOfDay(d)
    }

    private static func lastDay(ofMonthContaining d: Date) -> Date {
        let cal = AnaDate.karachi
        let start = monthStart(d)
        let next = cal.date(byAdding: .month, value: 1, to: start) ?? start
        return cal.date(byAdding: .day, value: -1, to: next) ?? start
    }

    private static func shifted(_ r: AnaRange, years: Int) -> AnaRange {
        let cal = AnaDate.karachi
        let from = cal.date(byAdding: .year, value: years, to: r.from) ?? r.from
        let to = cal.date(byAdding: .year, value: years, to: AnaDate.startOfDay(r.to)) ?? r.to
        return AnaRange(from: AnaDate.startOfDay(from), to: AnaDate.endOfDay(to))
    }

    /// The range a comparison reads; nil for none (and for all time, which has nothing before it).
    ///
    /// Previous period: a year to date or a whole year is last year's same days; a run of months from the 1st (this month so
    /// far, last month, a quarter) is the same run of months before it, to the same day of the month so far; anything else
    /// is the same number of days straight before it.
    static func compared(_ r: AnaRange?, mode: MacReportsCompare) -> AnaRange? {
        guard let r else { return nil }
        switch mode {
        case .none: return nil
        case .lastYear: return shifted(r, years: -1)
        case .previous: return previous(r)
        }
    }

    private static func previous(_ r: AnaRange) -> AnaRange {
        let cal = AnaDate.karachi
        let from = cal.dateComponents([.year, .month, .day], from: r.from)
        if from.month == 1 && from.day == 1 { return shifted(r, years: -1) }
        let toDay = AnaDate.startOfDay(r.to)
        if from.day == 1 {
            let to = cal.dateComponents([.year, .month], from: toDay)
            let span = ((to.year ?? 0) - (from.year ?? 0)) * 12 + ((to.month ?? 0) - (from.month ?? 0)) + 1
            if span >= 1 {
                let prevFrom = cal.date(byAdding: .month, value: -span, to: r.from) ?? r.from
                let prevToMonth = cal.date(byAdding: .month, value: -span, to: toDay) ?? toDay
                let edge = lastDay(ofMonthContaining: prevToMonth)
                let wholeMonth = cal.isDate(toDay, inSameDayAs: lastDay(ofMonthContaining: toDay))
                let days = cal.dateComponents([.day], from: r.from, to: toDay).day ?? 0
                let same = cal.date(byAdding: .day, value: days, to: prevFrom) ?? prevFrom
                let end = wholeMonth ? edge : min(same, edge)
                return AnaRange(from: prevFrom, to: AnaDate.endOfDay(end))
            }
        }
        let days = (cal.dateComponents([.day], from: r.from, to: toDay).day ?? 0) + 1
        let prevFrom = cal.date(byAdding: .day, value: -days, to: r.from) ?? r.from
        let prevTo = cal.date(byAdding: .day, value: -1, to: r.from) ?? r.from
        return AnaRange(from: prevFrom, to: AnaDate.endOfDay(prevTo))
    }

    /// The last 24 months, this one first: Monthly PDF's choices ("2026-10" and how it reads).
    static func months(now: Date = Date()) -> [MacReportsMonth] {
        let cal = AnaDate.karachi
        let start = monthStart(now)
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = ERPDate.karachi
        f.dateFormat = "MMMM yyyy"
        var out: [MacReportsMonth] = []
        for back in 0..<24 {
            guard let d = cal.date(byAdding: .month, value: -back, to: start) else { continue }
            let c = cal.dateComponents([.year, .month], from: d)
            let key = String(format: "%04d-%02d", c.year ?? 2000, c.month ?? 1)
            out.append(MacReportsMonth(key: key, label: f.string(from: d) + (back == 0 ? " · so far" : ""), title: f.string(from: d)))
        }
        return out
    }
}

/// A month the monthly PDF can be drawn for.
struct MacReportsMonth: Identifiable {
    let key: String
    let label: String
    let title: String
    var id: String { key }
}

// MARK: - A change

enum MacReportsChange {
    /// "+12% on previous period" and the tone it carries: settled when it moved the good way, owed when the bad way, none
    /// when nothing moved. `upIsGood` is false for expenses and what is owed.
    static func say(_ now: Double, _ before: Double, words: String, upIsGood: Bool = true) -> (text: String, tone: Tone?) {
        if abs(before) < 0.5 {
            if abs(now) < 0.5 { return ("nothing in either", nil) }
            return ("nothing in \(words)", nil)
        }
        let pct = (now - before) / abs(before) * 100
        if abs(pct) < 0.05 { return ("no change on \(words)", nil) }
        let magnitude = abs(pct) >= 10 ? String(format: "%.0f", abs(pct)) : String(format: "%.1f", abs(pct))
        let sign = pct > 0 ? "+" : "\u{2212}"
        let good = (pct > 0) == upIsGood
        return ("\(sign)\(magnitude)% on \(words)", good ? Tone.settled : Tone.owed)
    }

    /// A figure of a report's row: with a comparison its detail is the change; without, `plain`.
    static func figure(_ label: String, _ value: String, now: Double, before: Double?, words: String, upIsGood: Bool = true,
                       plain: String? = nil, tone: Tone? = nil) -> MacFigure {
        guard let before else { return MacFigure(label, value, detail: plain, tone: tone) }
        let c = say(now, before, words: words, upIsGood: upIsGood)
        return MacFigure(label, value, detail: c.text, tone: tone, detailTone: c.tone)
    }
}
#endif
