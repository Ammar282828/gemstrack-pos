import SwiftUI
import UIKit
import ERPCore

/// Website → Interest (src/app/website/interest/page.tsx): which of the site's pieces visitors save, ask about on
/// WhatsApp, open and stay on, counted anonymously by the house's own site since 22 October. One read
/// (GET /api/website/interest?days=7|30|0); the web's rules, here as four short lists instead of its four tabs.

/// One piece's counts, as /api/website/interest sends them. Any number may be missing.
struct WebsiteInterestPiece: Decodable, Identifiable, Hashable {
    let piece: String
    let name: String
    let thumb: String
    let url: String
    let collection: String
    let views: Int
    let saves: Int
    let unsaves: Int
    let netSaves: Int
    let enquiries: Int
    let dwellMs: Double
    let dwellN: Int
    let avgDwellMs: Double
    var id: String { piece }

    private enum K: String, CodingKey { case piece, name, thumb, url, collection, views, saves, unsaves, netSaves, enquiries, dwellMs, dwellN, avgDwellMs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        piece = c.string(.piece, default: "")
        name = c.string(.name, default: "")
        thumb = c.string(.thumb, default: "")
        url = c.string(.url, default: "")
        collection = c.string(.collection, default: "")
        views = c.int(.views) ?? 0
        saves = c.int(.saves) ?? 0
        unsaves = c.int(.unsaves) ?? 0
        netSaves = c.int(.netSaves) ?? 0
        enquiries = c.int(.enquiries) ?? 0
        dwellMs = c.double(.dwellMs, default: 0)
        dwellN = c.int(.dwellN) ?? 0
        avgDwellMs = c.double(.avgDwellMs, default: 0)
    }
}

struct WebsiteInterestAnswer: Decodable {
    let pieces: [WebsiteInterestPiece]

    private enum K: String, CodingKey { case pieces }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        pieces = c.list(.pieces, of: WebsiteInterestPiece.self)
    }
}

/// The four lists, with the web's ranking and wording (LISTS in the page).
enum WebsiteInterestList: String, CaseIterable, Identifiable {
    case saved, asked, longest, opened
    var id: String { rawValue }

    var title: String {
        switch self {
        case .saved: return "Saved"
        case .asked: return "Asked about"
        case .longest: return "Looked at longest"
        case .opened: return "Opened"
        }
    }

    /// What ranks the piece; 0 keeps it out. A minimum of three looks, so one long stare doesn't top the list.
    func rank(_ r: WebsiteInterestPiece) -> Double {
        switch self {
        case .saved: return Double(r.netSaves)
        case .asked: return Double(r.enquiries)
        case .longest: return r.dwellN >= 3 ? r.avgDwellMs : 0
        case .opened: return Double(r.views)
        }
    }

    var emptyTitle: String {
        switch self {
        case .saved: return "No saves in this period"
        case .asked: return "No enquiries in this period"
        case .longest: return "Nothing looked at long enough in this period"
        case .opened: return "No opens in this period"
        }
    }

    func say(_ r: WebsiteInterestPiece) -> String {
        switch self {
        case .saved: return "\(r.netSaves) saved"
        case .asked: return "\(r.enquiries) on WhatsApp"
        case .longest: return "\(Self.secs(r.avgDwellMs)) on average · \(r.dwellN) looks"
        case .opened: return "\(r.views) opens"
        }
    }

    /// The web's `secs`: "1m 20s" from a minute up, else "45s".
    static func secs(_ ms: Double) -> String {
        if ms >= 60_000 { return "\(Int(ms / 60_000))m \(Int(((ms.truncatingRemainder(dividingBy: 60_000)) / 1000).rounded()))s" }
        return "\(Int((ms / 1000).rounded()))s"
    }

    /// Ranked, highest first, ties in the server's order, the top 40 (as the web).
    func ranked(_ all: [WebsiteInterestPiece]) -> [WebsiteInterestPiece] {
        let kept = all.enumerated().filter { (e: (offset: Int, element: WebsiteInterestPiece)) in rank(e.element) > 0 }
        let sorted = kept.sorted { (a: (offset: Int, element: WebsiteInterestPiece), b: (offset: Int, element: WebsiteInterestPiece)) in
            let ra = rank(a.element)
            let rb = rank(b.element)
            return ra == rb ? a.offset < b.offset : ra > rb
        }
        return Array(sorted.prefix(40).map { (e: (offset: Int, element: WebsiteInterestPiece)) in e.element })
    }
}

struct WebsiteInterestScreen: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var days = 30
    @State private var list: WebsiteInterestList = .saved
    @State private var pieces: [WebsiteInterestPiece]?
    @State private var problem: String?

    private let periods: [(days: Int, label: String)] = [(7, "7 days"), (30, "30 days"), (0, "All time")]

    var body: some View {
        let rows = list.ranked(pieces ?? [])
        List {
            Section {
                ChipRow {
                    ForEach(periods, id: \.days) { (p: (days: Int, label: String)) in
                        FilterChip(title: p.label, chosen: days == p.days) { choose(p.days) }
                    }
                }
                .chipRowInList()
                picker
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if !rows.isEmpty {
                Section {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { (i: Int, r: WebsiteInterestPiece) in
                        row(r, rank: i + 1, in: list)
                    }
                } header: {
                    LedgerHeading(title: list.title)
                }
                .houseRows()
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .listStyle(.insetGrouped)
        .modifier(HouseGround())
        .motion(days)
        .motion(list)
        .overlay { stateOverlay(wholeEmpty: pieces != nil && shownCount == 0, listEmpty: pieces != nil && rows.isEmpty) }
        .navigationTitle("Interest")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: days) { await load() }
        .onAppear { remember() }
        .onChange(of: list) { _, new in
            UserDefaults.standard.set(new.rawValue, forKey: BizKey("erp.interestList"))
        }
    }

    @ViewBuilder
    private var picker: some View {
        let choice = Binding<WebsiteInterestList>(get: { list }, set: { (l: WebsiteInterestList) in
            Motion.run(reduce: reduceMotion) { list = l }
        })
        if typeSize.isAccessibilitySize {
            Picker("List", selection: choice) {
                ForEach(WebsiteInterestList.allCases) { (l: WebsiteInterestList) in Text(l.title).tag(l) }
            }
            .pickerStyle(.menu)
            .selectionFeedback(trigger: list)
        } else {
            Picker("List", selection: choice) {
                ForEach(WebsiteInterestList.allCases) { (l: WebsiteInterestList) in Text(l.title).tag(l) }
            }
            .pickerStyle(.segmented)
            .selectionFeedback(trigger: list)
        }
    }

    /// The list last chosen on this device, per business.
    private func remember() {
        if let raw = UserDefaults.standard.string(forKey: BizKey("erp.interestList")), let l = WebsiteInterestList(rawValue: raw) { list = l }
    }

    private var shownCount: Int {
        let all = pieces ?? []
        return WebsiteInterestList.allCases.reduce(0) { (n: Int, l: WebsiteInterestList) in n + l.ranked(all).count }
    }

    @ViewBuilder
    private func stateOverlay(wholeEmpty: Bool, listEmpty: Bool) -> some View {
        if pieces == nil, let problem {
            ErrorState(problem) { Task { await load() } }
        } else if pieces == nil {
            SkeletonLoading("Loading…").controlSize(.large)
        } else if wholeEmpty {
            EmptyState("Nothing counted yet", symbol: "heart",
                       message: "The website counts anonymously what visitors save, ask about on WhatsApp, open and stay on, since 22 October. It fills as people use the website.")
        } else if listEmpty {
            EmptyState(list.emptyTitle, symbol: "heart", message: "It fills as people use the website.")
                .padding(.top, 120)
        }
    }

    private func choose(_ d: Int) {
        guard d != days else { return }
        Motion.run(reduce: reduceMotion) { days = d }
    }

    private func row(_ r: WebsiteInterestPiece, rank: Int, in list: WebsiteInterestList) -> some View {
        Button {
            if let u = URL(string: r.url), !r.url.isEmpty { openURL(u) }
        } label: {
            HStack(spacing: 12) {
                Text("\(rank)")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .frame(minWidth: 22)
                StockImage(imageUrl: r.thumb, name: r.name, key: r.piece)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.name.isEmpty ? r.piece : r.name).foregroundStyle(.primary)
                    Text(list.say(r)).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                    if !r.collection.isEmpty {
                        Text(r.collection).font(.caption).foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let u = URL(string: r.url), !r.url.isEmpty {
                Button { openURL(u) } label: { Label("Open on the website", systemImage: "safari") }
                Button { UIPasteboard.general.string = r.url } label: { Label("Copy link", systemImage: "link") }
            }
        }
    }

    /// The previous list stays while the next period loads; a failure shows only when there is nothing to show.
    private func load() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/interest?days=\(days)", as: WebsiteInterestAnswer.self)
            pieces = a.pieces
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if pieces == nil { problem = error.localizedDescription }
        }
    }
}
