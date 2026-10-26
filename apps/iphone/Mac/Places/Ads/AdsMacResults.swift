#if os(macOS)
import SwiftUI
import Charts
import ERPCore

// Ads › Ad results on the Mac (docs/features/mac-design.md, "Ads"): a report. A row of figures with their change, the
// days, what needs a look, the ads that spent most, and who saw them, where and in which region as sortable tables.
// The screen (AdsOverview.swift) keeps the loading and the Pause / Run writes; these are the parts it is made of.

/// A block of the report: its heading in the serif (and its quiet line), then the block, on a card.
struct AdsMacSection<Content: View>: View {
    let title: String
    var detail: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        AdsMacCard(title: title, detail: detail, content: content)
    }
}

enum AdsMacResultsFigures {
    /// Spent, people reached, the headline result, click-through, and what the ads sold: each with its change.
    static func head(_ d: AdOverview) -> [MacFigure] {
        let cur = d.account.currency
        let t = d.totals
        let b = d.before
        let main = AdsResults.headlineResult(t)
        var out: [MacFigure] = []
        out.append(MacFigure("Spent", AdsFormat.money(t.spend, cur),
                             detail: AdsFormat.change(t.spend, b?.spend) ?? "\(AdsFormat.money(d.account.amountSpent, cur)) all time"))
        out.append(MacFigure("People reached", AdsFormat.compact(t.reach),
                             detail: AdsFormat.change(t.reach, b?.reach) ?? "\(AdsFormat.compact(t.impressions)) views"))
        if main.key == "reach" {
            out.append(MacFigure("Clicks", AdsFormat.count(t.clicks), detail: t.clicks > 0 ? "\(AdsFormat.money(t.cpc, cur)) each" : nil))
        } else {
            let before = b.map { (m: AdMetrics) in AdsResults.value(m, key: main.key) }
            let each = main.value > 0 ? "\(AdsFormat.money(t.spend / main.value, cur)) each" : nil
            let change = AdsFormat.change(main.value, before)
            out.append(MacFigure(main.label, AdsFormat.count(main.value), detail: change ?? each,
                                 detailTone: change == nil ? nil : AdsMacFormat.changeTone(main.value, before, goodWhenUp: true)))
        }
        out.append(MacFigure("Click-through", AdsFormat.pct(t.ctr), detail: "\(AdsFormat.money(t.cpm, cur)) per 1,000 views"))
        let s = AdsResults.sales(t)
        if s.purchases > 0 || s.value > 0 {
            let beforeSales = b.map { (m: AdMetrics) in AdsResults.sales(m).value }
            let change = AdsFormat.change(s.value, beforeSales)
            out.append(MacFigure("Sales from ads", AdsFormat.money(s.value, cur),
                                 detail: change ?? "\(AdsFormat.count(s.purchases)) order\(s.purchases == 1 ? "" : "s")",
                                 detailTone: change == nil ? nil : AdsMacFormat.changeTone(s.value, beforeSales, goodWhenUp: true)))
            out.append(MacFigure("ROAS", AdsResults.roasText(s.roas),
                                 detail: s.costPerPurchase.map { (c: Double) in "\(AdsFormat.money(c, cur)) per order" } ?? "Sales for every rupee spent"))
        }
        return out
    }

    /// The month so far, against the last, when Meta gave it.
    static func month(_ d: AdOverview) -> [MacFigure] {
        guard let m = d.month, m.spent > 0 || m.lastMonth > 0 else { return [] }
        let cur = d.account.currency
        var out = [MacFigure("Spent this month", AdsFormat.money(m.spent, cur), detail: "Day \(m.dayOfMonth) of \(m.daysInMonth)"),
                   MacFigure("Heading for", AdsFormat.money(m.projected, cur))]
        if m.lastMonth > 0 { out.append(MacFigure("Last month", AdsFormat.money(m.lastMonth, cur))) }
        return out
    }
}

/// A table's height for its rows: the report stacks its tables, each as tall as its rows. 34 points a row and the head's 32:
/// at 28 the last row of a table of two lines in a cell was cut in half at the card's foot.
func adsMacTableHeight(_ rows: Int, row: CGFloat = 34) -> CGFloat {
    CGFloat(max(rows, 1)) * row + 32
}

// MARK: Needs a look

/// What Meta or the ERP flagged, one to a row, with Pause or Run Again where there is one.
struct AdsMacAttentionTable: View {
    let items: [AdAttention]
    let acting: String?
    let pause: (AdAttention) -> Void
    let resume: (AdAttention) -> Void
    let open: (AdAttention) -> Void

    var body: some View {
        if items.isEmpty {
            Label("Nothing needs attention.", systemImage: "checkmark.circle").foregroundStyle(Tone.settled.color)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { i, a in
                    if i > 0 { Divider() }
                    row(a)
                }
            }
        }
    }

    private func row(_ a: AdAttention) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: a.severity == "tip" ? "lightbulb" : "exclamationmark.triangle.fill")
                .foregroundStyle(a.severity == "bad" ? Tone.problem.color : (a.severity == "warn" ? Tone.owed.color : Color.secondary))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(a.title).font(.body.weight(.medium))
                Text(a.why).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if a.doing == "pause" {
                Button("Pause") { pause(a) }.disabled(acting != nil)
            } else if a.doing == "resume" {
                Button("Run Again…") { resume(a) }.disabled(acting != nil)
            } else if a.doing == "open", !a.href.isEmpty {
                Button("Open") { open(a) }
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: The ads that spent most

struct AdsMacTopRow: Identifiable {
    let id: String
    let name: String
    let campaign: String
    let thumb: String?
    let spend: Double
    let results: Double
    let resultLabel: String
    let each: Double
    let roas: Double
    let sales: Double
    let reach: Double

    init(_ a: AdTop) {
        id = a.id
        name = a.name
        campaign = a.campaign
        thumb = a.thumbnail
        spend = a.metrics.spend
        let r = AdsResults.of(a.metrics, goal: a.goal)
        results = r?.value ?? 0
        resultLabel = r?.label ?? ""
        each = (r?.value ?? 0) > 0 ? a.metrics.spend / (r?.value ?? 1) : 0
        roas = AdsResults.sales(a.metrics).roas ?? -1
        sales = AdsResults.sales(a.metrics).value
        reach = a.metrics.reach
    }
}

/// The top ads as the iPhone's rows on a card: the picture, the ad over its campaign, what it spent over what it brought.
/// A click or Return opens the ad (one step, not two); right-click offers it too.
struct AdsMacTopAdsTable: View {
    let ads: [AdTop]
    let currency: String
    let open: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(ads.enumerated()), id: \.element.id) { i, a in
                if i > 0 { Divider().padding(.leading, 60) }
                MacDashRow { open(a.id) } label: { row(a) }
                    .contextMenu { Button("Open Ad", systemImage: "arrow.up.forward.square") { open(a.id) } }
            }
        }
    }

    private func row(_ a: AdTop) -> some View {
        HStack(spacing: 12) {
            StockImage(imageUrl: a.thumbnail, name: a.name, key: a.id)
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).font(.body).lineLimit(1)
                Text(a.campaign).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(AdsFormat.money(a.metrics.spend, currency)).font(.body.weight(.semibold)).monospacedDigit()
                Text(resultLine(a)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private func resultLine(_ a: AdTop) -> String {
        let s = AdsResults.sales(a.metrics)
        let roas = s.value > 0 ? " · \(AdsResults.roasText(s.roas)) ROAS" : ""
        guard let r = AdsResults.of(a.metrics, goal: a.goal) else { return "\(AdsFormat.compact(a.metrics.reach)) reached\(roas)" }
        let each = r.value > 0 ? " · \(AdsFormat.money(a.metrics.spend / r.value, currency)) each" : ""
        return "\(AdsFormat.count(r.value)) \(r.label.lowercased())\(each)\(roas)"
    }
}

// MARK: Who, where, which region

struct AdsMacSplitRow: Identifiable {
    let id: String
    let label: String
    let spend: Double
    let share: Double
    let views: Double
    let reach: Double
}

/// One breakdown (who saw them, where, region) as a sortable table: spend and its share, views and reach.
struct AdsMacSplitTable: View {
    let heading: String
    let rows: [AdSplit]
    let currency: String
    @State private var sort = [KeyPathComparator(\AdsMacSplitRow.spend, order: .reverse)]

    private var made: [AdsMacSplitRow] {
        let spent = rows.reduce(0.0) { (sum: Double, r: AdSplit) in sum + r.metrics.spend }
        let seen = rows.reduce(0.0) { (sum: Double, r: AdSplit) in sum + r.metrics.impressions }
        let bySpend = spent > 0
        return rows.map { (r: AdSplit) -> AdsMacSplitRow in
            let part = bySpend ? (r.metrics.spend / spent) : (seen > 0 ? r.metrics.impressions / seen : 0)
            return AdsMacSplitRow(id: r.key, label: r.label, spend: r.metrics.spend, share: part, views: r.metrics.impressions, reach: r.metrics.reach)
        }
    }

    var body: some View {
        let list = made.sorted(using: sort)
        Table(list, sortOrder: $sort) {
            TableColumn(heading, value: \.label) { (r: AdsMacSplitRow) in Text(r.label).lineLimit(1) }
                .width(min: 120, ideal: 200)
            TableColumn(AdsMacMoney.header("Spent", currency), value: \.spend) { (r: AdsMacSplitRow) in
                AdsMacMoney(r.spend)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Share", value: \.share) { (r: AdsMacSplitRow) in
                Text("\(Int((r.share * 100).rounded()))%").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 50, ideal: 64)
            TableColumn("Views", value: \.views) { (r: AdsMacSplitRow) in
                Text(AdsFormat.compact(r.views)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 80)
            TableColumn("Reach", value: \.reach) { (r: AdsMacSplitRow) in
                Text(AdsFormat.compact(r.reach)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 80)
        }
        .scrollContentBackground(.hidden)
        .frame(height: adsMacTableHeight(list.count))
    }
}

// MARK: What it brought

struct AdsMacBroughtTable: View {
    let lines: [AdsResults.Line]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(lines.sorted { (x: AdsResults.Line, y: AdsResults.Line) in x.value > y.value }.enumerated()), id: \.element.id) { i, l in
                if i > 0 { Divider() }
                HStack {
                    Text(l.label)
                    Spacer(minLength: 8)
                    Text(AdsFormat.count(l.value)).monospacedDigit()
                }
                .padding(.vertical, 7)
            }
        }
    }
}
#endif
