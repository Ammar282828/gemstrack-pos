import SwiftUI
import ERPCore

/// Track (the order page's ⋯ menu, "Track <CN>", when the order has a TCS consignment): TCS asked where the
/// parcel is (/api/tcs, action track), read as the page reads it: the summary, the first five checkpoints and
/// the full tracking on TCS's own site. Asked as the sheet opens and again on Refresh; nothing is written.
struct OrderTrackingSheet: View {
    let order: Order

    @Environment(\.dismiss) private var dismiss
    @State private var track: OrderActions.TCSTrack?
    @State private var failure: String?
    @State private var asking = false

    private var cn: String { OrderActions.tcsConsignment(order) ?? "" }

    var body: some View {
        NavigationStack {
            List { Group {
                if asking && track == nil && failure == nil {
                    Section { LoadingRow("Asking TCS\u{2026}") }
                }
                if let track {
                    Section {
                        Text(track.summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        ForEach(Array(track.checkpoints.enumerated()), id: \.offset) { pair in
                            HStack(alignment: .firstTextBaseline, spacing: pt(10)) {
                                Text(pair.element.datetime)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(pair.element.status)
                                    .font(.subheadline)
                            }
                        }
                    } header: {
                        LedgerHeading(title: "TCS tracking \u{2014} \(cn)")
                    }
                }
                if let url = OrderActions.tcsURL(cn) {
                    Section {
                        Link(destination: url) {
                            Label("Full tracking on TCS website", systemImage: "arrow.up.right.square")
                        }
                    }
                }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .houseForm()
            .failureAlert($failure, title: "Tracking failed")
            .navigationTitle("Track \(cn)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .trailingAction) {
                    Button { Task { await ask() } } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(asking)
                }
            }
        }
        #if os(macOS)
        .ordersMacSheet(width: 560, height: 420)
        #else
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        #endif
        .task { await ask() }
    }

    private func ask() async {
        guard !asking, !cn.isEmpty else { return }
        asking = true
        failure = nil
        do {
            let out = try await ERPAPI.shared.send("/api/tcs", ["action": "track", "consignmentNo": cn])
            switch OrderActions.tcsTrack(out) {
            case .success(let t): track = t
            case .failure(let f): failure = f.message
            }
        } catch let f as ERPAPI.Failure {
            // The ERP's own words: TCS not set up, or what TCS refused.
            failure = f.message
        } catch {
            // The line dropped: the page's words.
            failure = "Could not reach TCS API."
        }
        asking = false
    }
}
