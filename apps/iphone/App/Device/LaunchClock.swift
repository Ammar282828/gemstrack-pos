import Foundation
import Darwin

/// How long a cold start takes on the shop's own phones, step by step (owner, 2026-10-20: "the app's boot up is
/// extremely slow"). Each step is stamped in milliseconds from the moment iOS started the process; once the open
/// business's first page has its books (or 20 s pass) the list is sent once to the ERP (`/api/app/launch`, kept
/// in Firestore `app_launches`), so a slow launch says where its seconds went instead of being guessed at.
@MainActor
enum LaunchClock {
    struct Mark { let step: String; let ms: Int; let detail: String }

    private(set) static var marks: [Mark] = []
    private static var sent = false

    /// When iOS started this process (before `main`), or, failing that, when this was first read.
    nonisolated static let processStart: Date = {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return Date() }
        let t = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: Double(t.tv_sec) + Double(t.tv_usec) / 1_000_000)
    }()

    static var elapsedMs: Int { Int(Date().timeIntervalSince(processStart) * 1000) }

    /// Stamps a step once (the first time it happens on this launch); `detail` says what it was (a count, a source).
    static func mark(_ step: String, _ detail: String = "") {
        guard !sent, !marks.contains(where: { $0.step == step }) else { return }
        marks.append(Mark(step: step, ms: elapsedMs, detail: detail))
    }

    /// Sends the launch's steps, once. `ready` is the step that ended it ("home", "picker", "timeout").
    static func finish(_ ready: String) {
        guard !sent, !House.isDemo else { return }
        mark("ready:" + ready)
        sent = true
        let info = Bundle.main.infoDictionary
        let body: [String: Any] = [
            "marks": marks.map { ["step": $0.step, "ms": $0.ms, "detail": $0.detail] as [String: Any] },
            "business": House.business.id,
            "build": "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))",
            "device": deviceModel(),
        ]
        Task { _ = try? await ERPAPI.shared.send("/api/app/launch", body, timeout: 8) }
    }

    /// The launch gives up waiting for its books after 20 s and says so: a launch that never got there is the one to see.
    static func armTimeout() {
        Task {
            try? await Task.sleep(for: .seconds(20))
            finish("timeout")
        }
    }

    private static func deviceModel() -> String {
        var sys = utsname()
        uname(&sys)
        return withUnsafeBytes(of: &sys.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}
