import Foundation

/// How ZPL reaches a Zebra (TagPrinter.Route). The first cut: every route answers that it isn't ready yet, so nothing
/// prints by accident; Mac/iPhone transports replace this.
enum ZebraTransport {
    @MainActor
    static func send(_ zpl: String, to route: TagPrinter.Route) async -> TagPrinter.Outcome {
        TagPrinter.Outcome(ok: false, message: "Printing straight to a Zebra isn't ready in this build yet. Use Label LIVE for now.")
    }
}
