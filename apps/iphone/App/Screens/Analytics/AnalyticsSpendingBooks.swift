import SwiftUI
import ERPCore

/// Analytics → Spending (pages/spending.tsx): "Where did it go?" The expenses by category, each tagged with what kind of
/// money it is (running cost, goods for the pieces, or the owners' drawings), because only the running costs come off
/// profit. Entering an expense is Money › Expenses; this is its analysis.
struct AbSpendingScreen: View {
    var body: some View {
        AbHost(title: "Spending") { (ctx: AbCtx) in
            AbSpendingPage(ctx: ctx)
        }
    }
}

struct AbSpendingPage: View {
    let ctx: AbCtx

    private var b: Books { ctx.books }

    private func detail(_ kind: ExpenseKind) -> String {
        switch kind {
        case .running: return "comes off profit"
        case .goods: return "for the pieces"
        case .drawings: return "owners’ share, not a cost"
        }
    }

    private var takeaway: String {
        guard let top = b.expensesByCategory.first, b.totalExpenses > 0 else { return "No expenses in this period." }
        let share = AbSay.percent(top.amount, b.totalExpenses)
        return "\(top.category) was the biggest at \(Money.pkrLac(top.amount)), \(share)% of \(Money.pkrLac(b.totalExpenses)) spent."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            AbCard(title: "Expenses by category", takeaway: takeaway) {
                VStack(alignment: .leading, spacing: pt(10)) {
                    if b.expensesByCategory.isEmpty {
                        Text("Nothing spent in this period.").font(.house(.subheadline)).foregroundStyle(.secondary)
                    } else {
                        AbHBars(rows: b.expensesByCategory.map { (c: ExpenseByCategory) -> AbHBar in
                            AbHBar(id: c.category, label: c.category, value: c.amount, valueText: Money.lacCrore(c.amount),
                                   color: AbPalette.kind(c.kind), chip: AbPalette.kindLabel(c.kind).lowercased())
                        })
                    }
                    NavigationLink(value: Route(path: "/expenses")) {
                        Label("Open expenses", systemImage: "chevron.right")
                            .labelStyle(.titleAndIcon)
                            .font(.house(.subheadline).weight(.medium))
                    }
                    .buttonStyle(.pressable)
                    .foregroundStyle(Theme.accent)
                }
            }
            AbFigures(items: figures)
            months
            largest
            AbExplain {
                Text("Only the running costs come off profit. Goods are the cost of the pieces, where the house files them as expenses; they are already allowed for in profit (revenue less goods at House of Mina, the margin’s cost at Taheri). Drawings are the owners’ share of the profit, not a cost of earning it.")
                Text("Each category is one kind, by its name. Entering or changing an expense is Money › Expenses.")
            }
        }
    }

    private var figures: [AbFigure] {
        var items = [AbFigure(label: "Spent in all", value: Money.pkrLac(b.totalExpenses))]
        for k in ExpenseKind.allCases where b.expenseKind(k) > 0 {
            items.append(AbFigure(label: AbPalette.kindPlural(k), value: Money.pkrLac(b.expenseKind(k)), detail: detail(k)))
        }
        return items
    }

    // MARK: Month by month

    private var months: some View {
        AbLoad(ctx: ctx, work: { (engine: BooksEngine, _: BooksInput, _: BooksOptions) -> [MonthRow] in
            engine.months(12)
        }) { (rows: [MonthRow]?) in
            if let rows {
                let kinds = ExpenseKind.allCases.filter { (k: ExpenseKind) -> Bool in
                    b.expenseKind(k) > 0 || rows.contains { (m: MonthRow) -> Bool in value(m, k) > 0 }
                }
                let top = rows.reduce(nil as MonthRow?) { (m: MonthRow?, r: MonthRow) -> MonthRow? in
                    total(r) > (m.map { total($0) } ?? 0) ? r : m
                }
                let take = top.map { "Most spent in the last 12 months: \($0.month), \(Money.pkrLac(total($0)))." } ?? "No expenses in the last 12 months."
                AbCard(title: "Month by month", takeaway: take) {
                    if kinds.isEmpty || top == nil {
                        Text("Nothing to draw: no expenses in the last 12 months.").font(.house(.subheadline)).foregroundStyle(.secondary)
                    } else {
                        AbBars(points: rows.flatMap { (m: MonthRow) -> [AbBarPoint] in
                            kinds.map { (k: ExpenseKind) -> AbBarPoint in
                                AbBarPoint(id: m.key + "-" + k.rawValue, plot: AbPlot.month(m.start), tip: m.month,
                                           series: AbPalette.kindPlural(k), value: value(m, k))
                            }
                        }, series: kinds.map { (k: ExpenseKind) -> AbSeries in AbSeries(name: AbPalette.kindPlural(k), color: AbPalette.kind(k)) },
                               grouped: false, height: 260)
                    }
                }
            } else {
                AbCard(title: "Month by month") { ProgressView().frame(maxWidth: .infinity, minHeight: 120) }
            }
        }
    }

    private func value(_ m: MonthRow, _ k: ExpenseKind) -> Double {
        switch k {
        case .running: return m.running
        case .goods: return m.goods
        case .drawings: return m.drawings
        }
    }

    private func total(_ m: MonthRow) -> Double { m.running + m.goods + m.drawings }

    // MARK: Largest expenses

    @ViewBuilder private var largest: some View {
        if b.largestExpenses.isEmpty {
            AbCard(title: "Largest expenses", takeaway: "No expenses in this period.") { EmptyView() }
        } else {
            AbTable(title: "Largest expenses") {
                ForEach(b.largestExpenses) { (e: ExpenseRow) in
                    AbRow(title: e.category, subtitle: AbSay.day(e.date, "d MMM") + (e.description.isEmpty ? "" : " · " + e.description),
                          trailing: Money.lacCrore(e.amount), dot: AbPalette.kind(e.kind))
                }
            }
        }
    }
}
