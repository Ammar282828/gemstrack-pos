#if os(macOS)
import SwiftUI
import CryptoKit

/// Today's figures in the menu bar, for every business signed in on this Mac (Taheri and House of Mina side by side):
/// the widget's own summary (/api/widget/summary, read with the widget's key of each business, ERPWidgetLink), so the
/// menu bar shows exactly what the iPhone's widget shows and opens the books of nobody who signed out.
struct MacTodayMenu: View {
    @State private var summaries: [String: ERPSummary] = [:]
    @State private var failed: Set<String> = []
    @State private var loading = false
    @Environment(\.openWindow) private var openWindow

    private var links: [ERPWidgetLink.Link] { ERPWidgetLink.all() }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if links.isEmpty {
                ContentUnavailableView("Not signed in", systemImage: "diamond",
                                       description: Text("Open the ERP and sign in: each business's figures show here."))
                    .frame(width: 320)
            } else {
                ForEach(links, id: \.id) { link in
                    business(link)
                    if link.id != links.last?.id { Divider() }
                }
            }
            Divider()
            HStack {
                Button("Open ERP") {
                    openWindow(id: MacWindows.main)
                    NSApp.activate()
                }
                Spacer()
                if loading { ProgressView().controlSize(.small) }
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
                    .labelStyle(.iconOnly)
                    .disabled(loading)
                    .help("Refresh the figures")
            }
        }
        .padding(16)
        .frame(width: 360)
        .task { await load() }
    }

    @ViewBuilder
    private func business(_ link: ERPWidgetLink.Link) -> some View {
        let look = ERPWidgetLook(link)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(link.name).font(.headline).foregroundStyle(look.accent)
                Spacer()
                if let s = summaries[link.id] { Text(s.updated).font(.caption).foregroundStyle(.secondary) }
            }
            if let s = summaries[link.id] {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(s.figures.prefix(6), id: \.self) { f in
                        GridRow {
                            Text(f.label).foregroundStyle(.secondary)
                            Text(f.value).font(.body.monospacedDigit().weight(.semibold))
                                .gridColumnAlignment(.trailing)
                            Text(f.detail ?? "").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                }
                if let needs = s.extras?.needs, !needs.isEmpty {
                    Text("Needs you").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4)
                    ForEach(needs.prefix(3), id: \.self) { n in
                        Button {
                            MacWindows.openLink(look.url(n.path) ?? URL(string: "shoperp://open")!)
                            openWindow(id: MacWindows.main)
                            NSApp.activate()
                        } label: {
                            HStack {
                                Text(n.title)
                                Spacer()
                                Text(n.detail).foregroundStyle(n.tone == "late" ? Color.red : Color.orange)
                            }
                            .font(.callout)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if failed.contains(link.id) {
                Text("The ERP could not be reached.").font(.callout).foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        await withTaskGroup(of: (String, ERPSummary?).self) { group in
            for link in links {
                group.addTask { (link.id, await Self.fetch(link)) }
            }
            for await (id, s) in group {
                if let s { summaries[id] = s; failed.remove(id) } else if summaries[id] == nil { failed.insert(id) }
            }
        }
    }

    /// As the widget asks (Widget/ERPWidget.swift): the business's own address, its widget key, never cached by HTTP.
    private static func fetch(_ link: ERPWidgetLink.Link) async -> ERPSummary? {
        guard let url = URL(string: link.url + "/api/widget/summary"), url.scheme == "https" else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("Widget \(link.key)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession(configuration: .ephemeral).data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(ERPSummary.self, from: data)
    }
}
#endif
