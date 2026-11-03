import Foundation
import MetricKit
#if canImport(UIKit)
import UIKit
#endif

/// Crashes, hangs and CPU or disk-write kills, reported by iOS itself (MetricKit) at the next launch and sent to the
/// ERP (`/api/app/diagnostics`, Firestore `app_diagnostics`): TestFlight shows crashes in App Store Connect, but a
/// hang or a watchdog kill on a money screen is otherwise invisible. Only code signatures go: exception and signal
/// numbers, the termination reason, the heaviest call stack as "Binary+offset", the build, the OS and the model.
/// Nothing the person typed, no names, no amounts. A report that cannot be sent (signed out, offline) waits on the
/// phone and goes with the next launch.
final class Diagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = Diagnostics()
    private static let pendingKey = "erp.diagnostics.pending"
    private static let keep = 20

    /// Call once at launch (ERPApp.init / AppDelegate): subscribes, and sends what waited from before.
    static func start() {
        MXMetricManager.shared.add(shared)
        Task { await shared.flush() }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let made = payloads.flatMap { Self.reports($0) }
        guard !made.isEmpty else { return }
        Self.queue(made)
        Task { await self.flush() }
    }

    #if os(iOS)
    /// The day's numbers (MetricKit sends one payload a day): how fast the app draws, how long it hangs, how many
    /// frames hitch while scrolling, how much memory it peaks at. A summary, sent as a "metrics" report with the
    /// crash and hang ones; the screens that speed matters on are judged by these, not by a guess.
    func didReceive(_ payloads: [MXMetricPayload]) {
        let made = payloads.compactMap { Self.metrics($0) }
        guard !made.isEmpty else { return }
        Self.queue(made)
        Task { await self.flush() }
    }

    private static func metrics(_ p: MXMetricPayload) -> [String: Any]? {
        var r: [String: Any] = ["kind": "metrics"]
        let m: MXMetaData? = p.metaData
        r["appVersion"] = m?.applicationBuildVersion ?? ""
        r["osVersion"] = m?.osVersion ?? ""
        r["device"] = m?.deviceType ?? ""
        var out: [String: Any] = [:]
        if let launch = p.applicationLaunchMetrics {
            if let v = percentileMs(launch.histogrammedTimeToFirstDraw, 0.5) { out["firstDrawP50Ms"] = v }
            if let v = percentileMs(launch.histogrammedTimeToFirstDraw, 0.9) { out["firstDrawP90Ms"] = v }
            if let v = buckets(launch.histogrammedTimeToFirstDraw) { out["firstDrawBuckets"] = v }
            if let v = percentileMs(launch.histogrammedApplicationResumeTime, 0.5) { out["resumeP50Ms"] = v }
            if let v = percentileMs(launch.histogrammedApplicationResumeTime, 0.9) { out["resumeP90Ms"] = v }
        }
        if let hang = p.applicationResponsivenessMetrics?.histogrammedApplicationHangTime {
            if let v = percentileMs(hang, 0.5) { out["hangP50Ms"] = v }
            if let v = percentileMs(hang, 0.9) { out["hangP90Ms"] = v }
            if let v = buckets(hang) { out["hangBuckets"] = v }
        }
        if let hitch = p.animationMetrics?.scrollHitchTimeRatio {
            // Milliseconds of hitch per second scrolled, as MetricKit reports it (a ratio, rounded to 0.01).
            out["scrollHitchRatio"] = (hitch.value * 100).rounded() / 100
        }
        if let peak = p.memoryMetrics?.peakMemoryUsage {
            out["peakMemoryMb"] = Int(peak.converted(to: .megabytes).value.rounded())
        }
        guard !out.isEmpty else { return nil }
        r["metrics"] = out
        r["periodHours"] = Int((p.timeStampEnd.timeIntervalSince(p.timeStampBegin) / 3600).rounded())
        return r
    }

    /// The bucket the given share of the samples falls in, as its midpoint in milliseconds.
    private static func percentileMs(_ h: MXHistogram<UnitDuration>, _ share: Double) -> Int? {
        let all = sortedBuckets(h)
        let total = all.reduce(0) { $0 + $1.bucketCount }
        guard total > 0 else { return nil }
        var seen = 0
        for b in all {
            seen += b.bucketCount
            if Double(seen) >= Double(total) * share {
                let lo = b.bucketStart.converted(to: .milliseconds).value
                let hi = b.bucketEnd.converted(to: .milliseconds).value
                return Int(((lo + hi) / 2).rounded())
            }
        }
        return nil
    }

    /// The histogram as [startMs, endMs, count], at most twelve buckets: the shape of the day beside its median.
    private static func buckets(_ h: MXHistogram<UnitDuration>) -> [[Int]]? {
        let all = sortedBuckets(h).filter { $0.bucketCount > 0 }.prefix(12)
        guard !all.isEmpty else { return nil }
        return all.map { [Int($0.bucketStart.converted(to: .milliseconds).value.rounded()),
                          Int($0.bucketEnd.converted(to: .milliseconds).value.rounded()), $0.bucketCount] }
    }

    private static func sortedBuckets(_ h: MXHistogram<UnitDuration>) -> [MXHistogramBucket<UnitDuration>] {
        ((h.bucketEnumerator.allObjects as? [MXHistogramBucket<UnitDuration>]) ?? [])
            .sorted { $0.bucketStart < $1.bucketStart }
    }
    #endif

    // MARK: Reading a payload

    private static func reports(_ p: MXDiagnosticPayload) -> [[String: Any]] {
        var out: [[String: Any]] = []
        func base(_ kind: String, _ d: MXDiagnostic, _ tree: MXCallStackTree) -> [String: Any] {
            var r: [String: Any] = ["kind": kind]
            let m = d.metaData
            r["appVersion"] = m.applicationBuildVersion
            r["osVersion"] = m.osVersion
            r["device"] = m.deviceType
            let stack = frames(of: tree)
            if !stack.isEmpty { r["frames"] = stack }
            return r
        }
        for d in p.crashDiagnostics ?? [] {
            var r = base("crash", d, d.callStackTree)
            if let v = d.exceptionType { r["exceptionType"] = v.intValue }
            if let v = d.exceptionCode { r["exceptionCode"] = v.intValue }
            if let v = d.signal { r["signal"] = v.intValue }
            if let v = d.terminationReason { r["terminationReason"] = String(v.prefix(200)) }
            out.append(r)
        }
        for d in p.hangDiagnostics ?? [] {
            var r = base("hang", d, d.callStackTree)
            r["durationMs"] = Int(d.hangDuration.converted(to: .milliseconds).value)
            out.append(r)
        }
        for d in p.cpuExceptionDiagnostics ?? [] {
            var r = base("cpu", d, d.callStackTree)
            r["durationMs"] = Int(d.totalCPUTime.converted(to: .milliseconds).value)
            out.append(r)
        }
        for d in p.diskWriteExceptionDiagnostics ?? [] {
            out.append(base("disk", d, d.callStackTree))
        }
        #if os(iOS)
        for d in p.appLaunchDiagnostics ?? [] {
            var r = base("launch", d, d.callStackTree)
            r["durationMs"] = Int(d.launchDuration.converted(to: .milliseconds).value)
            out.append(r)
        }
        #endif
        return out.map { Breadcrumb.attached(to: $0) }
    }

    /// The call stack that carries the most samples, root to leaf, as "Binary+offset" (twelve frames at most).
    private static func frames(of tree: MXCallStackTree) -> [String] {
        guard let json = try? JSONSerialization.jsonObject(with: tree.jsonRepresentation()) as? [String: Any],
              let stacks = json["callStacks"] as? [[String: Any]] else { return [] }
        let stack = stacks.first { ($0["threadAttributed"] as? Bool) == true } ?? stacks.first
        var node = (stack?["callStackRootFrames"] as? [[String: Any]])?.first
        var out: [String] = []
        while let n = node, out.count < 12 {
            let name = (n["binaryName"] as? String) ?? "?"
            let offset = (n["offsetIntoBinaryTextSegment"] as? Int) ?? 0
            out.append("\(name)+\(offset)")
            let subs = n["subFrames"] as? [[String: Any]]
            node = subs?.max { ($0["sampleCount"] as? Int ?? 0) < ($1["sampleCount"] as? Int ?? 0) }
        }
        return out
    }

    // MARK: Waiting and sending

    private static func queue(_ add: [[String: Any]]) {
        let kept = ((UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]]) ?? []) + add
        UserDefaults.standard.set(Array(kept.suffix(keep)), forKey: pendingKey)
    }

    private var sending = false

    @MainActor private func flush() async {
        guard !sending, !House.isDemo, let waiting = UserDefaults.standard.array(forKey: Self.pendingKey) as? [[String: Any]],
              !waiting.isEmpty else { return }
        sending = true
        defer { sending = false }
        let info = Bundle.main.infoDictionary
        let body: [String: Any] = [
            "reports": waiting,
            "business": House.business.id,
            "build": "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))",
        ]
        // Kept on the phone until the ERP says yes; a refusal (signed out, not staff) leaves it for the next launch.
        if (try? await ERPAPI.shared.send("/api/app/diagnostics", body, timeout: 15)) != nil {
            UserDefaults.standard.removeObject(forKey: Self.pendingKey)
        }
    }
}

/// Where the person was when the app last stopped: the screen and the business, kept as they change and read at the next launch,
/// so a crash or a hang in `app_diagnostics` says "on /orders/·, mina" and not only a code address (owner, 2026-11-03: fewer
/// crashes). Nothing the person typed and no record's id: a path keeps its first word and a known verb (`add`, `edit`…), every
/// other part is "·". It rides in the report's `terminationReason`, the one free-text field the ERP's route keeps for every kind.
enum Breadcrumb {
    private static let key = "erp.breadcrumb"
    /// What the previous run left, read before this run writes its own.
    static let lastRun: String = UserDefaults.standard.string(forKey: key) ?? ""
    @MainActor private static var written = ""

    private static let verbs: Set<String> = ["add", "new", "edit", "refund", "print", "scan", "pay", "list", "drafts", "all"]

    /// The path without its ids: "/orders/ORD-12/edit" -> "/orders/·/edit".
    static func plain(_ path: String) -> String {
        let bare = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
        let parts = bare.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let first = parts.first else { return "/" }
        let rest = parts.dropFirst().map { verbs.contains($0) ? $0 : "·" }
        return "/" + ([first] + rest).joined(separator: "/")
    }

    /// A screen came to the front.
    @MainActor static func note(_ path: String) {
        _ = lastRun
        let text = "\(plain(path)), \(House.business.id)"
        guard text != written else { return }
        written = text
        UserDefaults.standard.set(text, forKey: key)
    }

    /// The report with the last run's screen added to its reason (200 characters at most, as the route keeps).
    static func attached(to report: [String: Any]) -> [String: Any] {
        guard !lastRun.isEmpty else { return report }
        var r = report
        let reason = (r["terminationReason"] as? String).map { String($0.prefix(120)) } ?? ""
        r["terminationReason"] = String(((reason.isEmpty ? "" : reason + " | ") + "last screen: " + lastRun).prefix(200))
        return r
    }
}
