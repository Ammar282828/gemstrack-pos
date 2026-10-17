// Ported from src/lib/social/queue-plan.ts (tests: QueuePlanTests): when each queued piece goes when the counter
// spreads the queue over the day. Pure, so the phone's Spread over the day lays the times out as the web's does;
// the queue's tick on the server sends them, whoever set them.

import Foundation

/// Times for `n` pieces spread evenly from `from` to `to` (both included when n > 1). A window already over, or
/// backwards, puts them all at `from`.
public func spreadTimes(_ n: Int, from: Date, to: Date) -> [Date] {
    if n <= 0 { return [] }
    let span = to.timeIntervalSince(from)
    if n == 1 || span <= 0 { return Array(repeating: from, count: n) }
    let step = span / Double(n - 1)
    // To the minute: a time the counter reads as "4:35", not "4:35:17".
    return (0..<n).map { (i: Int) -> Date in
        let ms = from.timeIntervalSince1970 * 1000 + step * 1000 * Double(i)
        return Date(timeIntervalSince1970: JS.round(ms / 60_000) * 60)
    }
}

/// The end of today's posting window, Karachi's time: half an hour before closing (Sat–Thu 21:00, Friday 20:00,
/// the shop's hours).
public func defaultSpreadEnd(_ now: Date) -> Date {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = ERPDate.karachi
    let friday = cal.component(.weekday, from: now) == 6
    return cal.date(bySettingHour: friday ? 19 : 20, minute: 30, second: 0, of: now) ?? now
}
