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
        return out
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
