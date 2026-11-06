import XCTest
@testable import ERPCore

/// src/lib/analytics/books.test.ts, case for case, on the same made-up fixture. Zoneless date-times are Karachi's clock.
final class BooksTests: XCTestCase {
    private let NOW = ERPDate.karachiCalendar.date(from: DateComponents(year: 2026, month: 11, day: 5, hour: 12))!
    private func d(_ s: String) -> Date { JS.parseISO(s)! }
    private lazy var NOV = Period(from: d("2026-11-01T00:00:00"), to: d("2026-11-05T00:00:00"))
    private var opts: BooksOptions { BooksOptions(now: NOW) }

    private func item(_ o: [String: Any]) -> [String: Any] {
        var base: [String: Any] = [
            "sku": "X", "name": "Piece", "categoryId": "cat001", "metalType": "gold", "karat": "22k", "metalWeightG": 0,
            "stoneWeightG": 0, "quantity": 1, "unitPrice": 0, "itemTotal": 0, "metalCost": 0, "wastageCost": 0,
            "wastagePercentage": 0, "makingCharges": 0, "diamondChargesIfAny": 0, "stoneChargesIfAny": 0, "miscChargesIfAny": 0,
        ]
        for (k, v) in o { base[k] = v }
        return base
    }

    private func invoiceDoc(_ o: [String: Any]) -> [String: Any] {
        var base: [String: Any] = [
            "customerName": "", "items": [], "subtotal": 0, "discountAmount": 0, "grandTotal": 0, "amountPaid": 0, "balanceDue": 0,
            "createdAt": "2026-11-01T10:00:00", "paymentHistory": [], "status": "Paid",
        ]
        for (k, v) in o { base[k] = v }
        return base
    }
    private func invoice(_ o: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: invoiceDoc(o))! }

    // Last month: one ring, Ayesha's first purchase, paid in full on the day.
    private lazy var INV_OCT = invoice([
        "id": "INV-0", "createdAt": "2026-10-03T10:00:00", "customerId": "c1", "customerName": "Ayesha",
        "items": [item(["sku": "R0", "name": "Old ring", "metalWeightG": 5, "itemTotal": 40000])],
        "subtotal": 40000, "grandTotal": 40000, "amountPaid": 40000, "balanceDue": 0,
        "paymentHistory": [["date": "2026-10-03T10:00:00", "amount": 40000, "method": "Cash"]],
    ])
    // A 22k ring of 10 g for 100,000, 60,000 paid, 40,000 owed.
    private let INV_1_DOC: [String: Any] = [
        "id": "INV-1", "createdAt": "2026-11-02T10:00:00", "customerId": "c1", "customerName": "Ayesha",
        "subtotal": 100000, "grandTotal": 100000, "amountPaid": 60000, "balanceDue": 40000,
    ]
    private func inv1(_ extra: [String: Any] = [:]) -> Invoice {
        var doc = INV_1_DOC
        doc["items"] = [item(["sku": "R1", "name": "Ring A", "metalWeightG": 10, "itemTotal": 100000])]
        doc["paymentHistory"] = [["date": "2026-11-02T10:00:00", "amount": 60000, "method": "Cash"]]
        for (k, v) in extra { doc[k] = v }
        return invoice(doc)
    }
    // One bill for a 21k ring of 5 g (50,000) and a gold coin of 8 g (200,000): 20% jewellery, 80% coin, paid in full.
    private lazy var INV_2 = invoice([
        "id": "INV-2", "createdAt": "2026-11-03T11:00:00", "customerId": "c2", "customerName": "Bilal",
        "items": [
            item(["sku": "R2", "name": "Ring B", "karat": "21k", "metalWeightG": 5, "itemTotal": 50000]),
            item(["sku": "C1", "name": "Coin", "categoryId": "cat017", "karat": "24k", "metalWeightG": 8, "itemTotal": 200000]),
        ],
        "subtotal": 250000, "grandTotal": 250000, "amountPaid": 250000, "balanceDue": 0,
        "paymentHistory": [["date": "2026-11-03T11:00:00", "amount": 250000, "method": "Cash"]],
    ])
    // An order taken on the 4th, not invoiced: 80,000 with 20,000 down.
    private lazy var ORD_1 = ERPDecode.model(Order.self, from: [
        "id": "ORD-1", "createdAt": "2026-11-04T09:00:00", "status": "New", "items": [], "subtotal": 80000, "grandTotal": 60000,
        "advancePayment": 20000, "advanceMethod": "Cash", "customerId": "c1", "customerName": "Ayesha",
    ] as [String: Any])!
    private lazy var EXTRA = ERPDecode.model(AdditionalRevenue.self, from: ["id": "X1", "date": "2026-11-04T15:00:00", "description": "Repair", "amount": 10000] as [String: Any])!
    private func expense(_ id: String, _ date: String, _ category: String, _ description: String, _ amount: Double) -> Expense {
        ERPDecode.model(Expense.self, from: ["id": id, "date": date, "category": category, "description": description, "amount": amount] as [String: Any])!
    }
    private lazy var RENT = expense("E1", "2026-11-01T09:00:00", "Rent", "Shop rent", 30000)
    private lazy var DRAWINGS = expense("E2", "2026-11-02T09:00:00", "Partner Drawings", "Draw", 15000)

    private lazy var input = BooksInput(
        invoices: [INV_OCT, inv1(), INV_2], orders: [ORD_1], customers: [],
        expenses: [RENT, DRAWINGS], additionalRevenues: [EXTRA]
    )

    // MARK: computeBooks

    func testRevenueCoinApartOrderAtSubtotalExtraAdded() {
        let b = computeBooks(input, range: NOV, options: opts)
        // INV-1 100,000 + INV-2's jewellery 20% of 250,000 = 50,000; order 80,000; extra revenue 10,000.
        XCTAssertEqual(b.invoiceSales, 150000)
        XCTAssertEqual(b.orderSales, 80000)
        XCTAssertEqual(b.extraRevenue, 10000)
        XCTAssertEqual(b.totalSales, 240000)
        XCTAssertEqual(b.coinSummary, CoinSummary(invoices: 1, coins: 1, grams: 8, revenue: 200000, ratePerGram: 25000, outstanding: 0))
        XCTAssertTrue(b.hasCoins)
        // Two invoices and one order; the average is over those, not over extra revenue.
        XCTAssertEqual(b.totalOrders, 3)
        XCTAssertEqual(b.averageOrderValue, 230000.0 / 3, accuracy: 1e-6)
        XCTAssertEqual(b.totalItemsSold, 2)
        XCTAssertEqual(b.totalUnpaid, 40000)
    }

    func testProfitTenPercentNetIsLessRunningCostsOnly() {
        let b = computeBooks(input, range: NOV, options: opts)
        XCTAssertEqual(b.estProfit, 24000, accuracy: 1e-6)
        XCTAssertEqual(b.salesCount, 3)
        XCTAssertEqual(b.salesCosted, 0)
        XCTAssertEqual(b.estProfitAdj, 24000, accuracy: 1e-6)
        XCTAssertEqual(b.costOfPieces, 216000, accuracy: 1e-6)
        XCTAssertEqual(b.runningExpenses, 30000)
        XCTAssertEqual(b.drawingsExpenses, 15000)
        XCTAssertEqual(b.goodsExpenses, 0)
        XCTAssertEqual(b.totalExpenses, 45000)
        XCTAssertEqual(b.netProfit, -6000, accuracy: 1e-6)
        XCTAssertEqual(b.netMargin, -2.5, accuracy: 1e-6)
        XCTAssertEqual(b.expensesByCategory, [
            ExpenseByCategory(category: "Rent", amount: 30000, kind: .running),
            ExpenseByCategory(category: "Partner Drawings", amount: 15000, kind: .drawings),
        ])
    }

    func testCashPaymentsOnTheDayAdvanceExtraExpensesOut() {
        let b = computeBooks(input, range: NOV, options: opts)
        // 60,000 + the jewellery 20% of 250,000 = 110,000 on invoices; 20,000 advance; 10,000 extra.
        XCTAssertEqual(b.cashInFromInvoicePayments, 110000)
        XCTAssertEqual(b.cashInFromOrderAdvances, 20000)
        XCTAssertEqual(b.cashInFromExtraRevenue, 10000)
        XCTAssertEqual(b.cashIn, 140000)
        XCTAssertEqual(b.cashOut, 45000)
        XCTAssertEqual(b.cashOutRunning, 30000)
        XCTAssertEqual(b.cashOutDrawings, 15000)
        XCTAssertEqual(b.netCashFlow, 95000)
        // Earned 240,000, collected 140,000: 40,000 on the bill and 60,000 on the order.
        XCTAssertEqual(b.accrualVsCashGap, 100000)
    }

    func testMetalTheHousesMetalByKaratCoinsLeftOut() {
        let b = computeBooks(input, range: NOV, options: opts)
        XCTAssertEqual(b.metalGrams, 15)
        XCTAssertEqual(b.metalPieces, 2)
        XCTAssertEqual(b.metalByKarat, [MetalKaratRow(karat: "22k", grams: 10, pieces: 1), MetalKaratRow(karat: "21k", grams: 5, pieces: 1)])
        XCTAssertEqual(computeBooks(input, range: NOV, options: BooksOptions(now: NOW, metal: "silver")).metalGrams, 0)
    }

    func testSeriesAndRankings() {
        let b = computeBooks(input, range: NOV, options: opts)
        XCTAssertEqual(b.salesOverTime, [
            SalesDay(date: "2026-11-02", sales: 100000, orders: 1, itemsSold: 1),
            SalesDay(date: "2026-11-03", sales: 50000, orders: 1, itemsSold: 1),
            SalesDay(date: "2026-11-04", sales: 90000, orders: 1, itemsSold: 0),
        ])
        XCTAssertEqual(b.topProductsByRevenue.map(\.sku), ["R1", "R2"])
        XCTAssertEqual(b.receivables.map(\.id), ["INV-1"])
        XCTAssertEqual(b.receivables.first?.balanceDue, 40000)
        XCTAssertEqual(b.receivables.first?.coinDue, 0)
        XCTAssertEqual(b.receivablesTotal, 40000)
        XCTAssertEqual(b.revenueMix.map(\.value), [150000, 80000, 10000])
        XCTAssertEqual(b.largestExpenses.map(\.id), ["E1", "E2"])
        XCTAssertFalse(b.rangeEmpty)
    }

    func testByWeekdayAverageOverTheWeekdaysTheRangeHolds() {
        let b = computeBooks(input, range: NOV, options: opts)
        // 1-5 Nov 2026 is Sunday to Thursday, each once; the 2nd is a Monday.
        let w = Dictionary(uniqueKeysWithValues: b.byWeekday.map { ($0.label, $0) })
        XCTAssertEqual(w["Mon"]?.revenue, 100000)
        XCTAssertEqual(w["Mon"]?.days, 1)
        XCTAssertEqual(w["Mon"]?.avg, 100000)
        XCTAssertEqual(w["Mon"]?.count, 1)
        XCTAssertEqual(w["Tue"]?.avg, 50000)
        XCTAssertEqual(w["Wed"]?.avg, 90000)
        XCTAssertEqual(w["Fri"]?.days, 0)
        XCTAssertEqual(w["Fri"]?.avg, 0)
    }

    func testNewVsReturningFirstEverSaleInTheRangeWalkInsLeftOut() {
        let b = computeBooks(input, range: NOV, options: opts)
        // Bilal's first sale is the 3rd (new); Ayesha bought in October (returning), twice this month.
        XCTAssertEqual(b.newCustomers, 1)
        XCTAssertEqual(b.returningCustomers, 1)
        XCTAssertEqual(b.revenueFromNew, 50000)
        XCTAssertEqual(b.revenueFromReturning, 180000)
        let flow = bucketCustomerFlow(b.customerDays, .day, range: NOV, now: NOW)
        let third = flow.first { $0.key == "2026-11-03" }
        XCTAssertEqual(third?.newCustomers, 1)
        XCTAssertEqual(third?.returningCustomers, 0)
        let second = flow.first { $0.key == "2026-11-02" }
        XCTAssertEqual(second?.newCustomers, 0)
        XCTAssertEqual(second?.returningCustomers, 1)
    }

    func testAllTimeEveryoneIsNewAndNoRangeBehavesTheSame() {
        let all = computeBooks(input, range: nil, options: opts)
        XCTAssertEqual(all.totalSales, 280000)
        XCTAssertEqual(all.returningCustomers, 0)
        XCTAssertEqual(computeBooks(input, range: Period(from: nil, to: nil), options: opts).totalSales, 280000)
    }

    func testAnEmptyRangeIsFlagged() {
        let none = computeBooks(input, range: Period(from: d("2025-01-01T00:00:00"), to: d("2025-01-31T00:00:00")), options: opts)
        XCTAssertTrue(none.rangeEmpty)
        XCTAssertEqual(none.totalSales, 0)
    }

    func testCashShowsMoneyCollectedOnOlderBillsInAMonthWithNoNewSale() {
        let october = Period(from: d("2026-10-01T00:00:00"), to: d("2026-10-02T00:00:00"))
        let bare = BooksInput(invoices: input.invoices, orders: input.orders)
        XCTAssertEqual(computeBooks(bare, range: october, options: opts).totalSales, 0)
        let later = inv1(["id": "INV-L", "paymentHistory": [["date": "2026-10-02T10:00:00", "amount": 5000, "method": "Cash"]]])
        let collected = computeBooks(BooksInput(invoices: [later]), range: october, options: opts)
        XCTAssertEqual(collected.cashIn, 5000)
    }

    func testCreditHandedBackIsMoneyOutAndAddedBackToMoneyIn() {
        let given = inv1(["paymentHistory": [
            ["date": "2026-11-02T10:00:00", "amount": 60000, "method": "Cash"],
            ["date": "2026-11-04T10:00:00", "amount": -5000, "method": "Cash", "kind": "credit-payback"],
        ]])
        let b = computeBooks(BooksInput(invoices: [given]), range: NOV, options: opts)
        XCTAssertEqual(b.creditPaidBack, 5000)
        XCTAssertEqual(b.cashOut, 5000)
        // 60,000 - 5,000 net on the bill, plus the 5,000 added back to money in; out is the 5,000: the net is the same.
        XCTAssertEqual(b.cashIn, 60000)
        XCTAssertEqual(b.netCashFlow, 55000)
    }

    // MARK: previous period

    private func day(_ s: String) -> Date { d("\(s)T00:00:00") }
    private func endOf(_ s: String) -> Date { d("\(s)T00:00:00").addingTimeInterval(86_400 - 0.001) }

    func testPreviousIsTheSameLengthImmediatelyBefore() {
        let p = previousRange(Period(from: day("2026-11-08"), to: day("2026-11-14")), now: NOW)!
        XCTAssertEqual(p.from, day("2026-11-01"))
        XCTAssertEqual(JS.ms(p.to), JS.ms(endOf("2026-11-07")))
        XCTAssertEqual(previousPeriod(Period(from: day("2026-11-08"), to: day("2026-11-14")), now: NOW)?.label, "previous 7 days")
    }

    func testPreviousComparesAMonthWithTheSameDaysOfTheMonthBefore() {
        let mtd = previousPeriod(Period(from: day("2026-11-01"), to: day("2026-11-05")), now: NOW)!
        XCTAssertEqual(mtd.label, "last month")
        XCTAssertEqual(mtd.range.from, day("2026-10-01"))
        XCTAssertEqual(JS.ms(mtd.range.to), JS.ms(endOf("2026-10-05")))
        // March has 31 days, February 28: the whole of it.
        let march = previousPeriod(Period(from: day("2026-03-01"), to: day("2026-03-31")), now: NOW)!
        XCTAssertEqual(march.range.from, day("2026-02-01"))
        XCTAssertEqual(JS.ms(march.range.to), JS.ms(endOf("2026-02-28")))
    }

    func testPreviousComparesAYearWithTheYearBefore() {
        let y = previousPeriod(Period(from: day("2026-01-01"), to: day("2026-11-05")), now: NOW)!
        XCTAssertEqual(y.label, "last year")
        XCTAssertEqual(y.range.from, day("2025-01-01"))
        XCTAssertEqual(JS.ms(y.range.to), JS.ms(endOf("2025-11-05")))
    }

    func testPreviousIsNilForAllTime() {
        XCTAssertNil(previousRange(nil, now: NOW))
        XCTAssertNil(previousRange(Period(from: nil, to: nil), now: NOW))
    }

    func testLastMonthsBooksAreWhatTheOverviewComparesWith() {
        let prev = computeBooks(input, range: Period(previousRange(NOV, now: NOW)), options: opts)
        XCTAssertEqual(prev.totalSales, 40000)
    }

    func testDeltaOf() {
        XCTAssertNil(deltaOf(10, nil))
        XCTAssertNil(deltaOf(10, 0))
        XCTAssertEqual(deltaOf(150, 100)?.pct ?? 0, 50, accuracy: 1e-9)
        XCTAssertEqual(deltaOf(150, 100)?.better, true)
        XCTAssertEqual(deltaOf(50, 100, upIsGood: false)?.better, true)
        // A loss that shrank is up against its absolute size.
        XCTAssertEqual(deltaOf(-50, -100)?.pct ?? 0, 50, accuracy: 1e-9)
    }

    // MARK: bucketSeries

    private func row(_ date: String, _ sales: Double) -> SalesDay { SalesDay(date: date, sales: sales, orders: 1, itemsSold: 1) }

    func testWeeksStartOnMonday() {
        // 2026-10-31 is a Saturday, 11-01 a Sunday, 11-02 a Monday, 11-08 a Sunday, 11-09 a Monday.
        let rows = bucketSeries([row("2026-10-31", 1), row("2026-11-01", 2), row("2026-11-02", 4), row("2026-11-08", 8), row("2026-11-09", 16)], .week)
        XCTAssertEqual(rows.map(\.key), ["2026-10-26", "2026-11-02", "2026-11-09"])
        XCTAssertEqual(rows.map(\.sales), [3, 12, 16])
        XCTAssertEqual(rows[1].tip, "Week of Nov 2")
    }

    func testQuietBucketsAreKeptAsZerosAndWidenToTheRange() {
        let days = bucketSeries([row("2026-11-02", 5), row("2026-11-05", 7)], .day)
        XCTAssertEqual(days.map(\.sales), [5, 0, 0, 7])
        let ranged = bucketSeries([row("2026-11-03", 5)], .day, range: NOV)
        XCTAssertEqual(ranged.map(\.key), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"])
        XCTAssertEqual(ranged[0].label, "Nov 1")
        XCTAssertEqual(ranged[0].tip, "Sun, Nov 1")
    }

    func testMonthBuckets() {
        let rows = bucketSeries([row("2026-09-30", 1), row("2026-11-01", 2), row("2026-11-20", 3)], .month)
        XCTAssertEqual(rows.map(\.key), ["2026-09-01", "2026-10-01", "2026-11-01"])
        XCTAssertEqual(rows.map(\.sales), [1, 0, 5])
        XCTAssertEqual(rows[2].label, "Nov 26")
        XCTAssertEqual(rows[2].tip, "November 2026")
    }

    func testThePreviousPeriodLinesUpBucketForBucket() {
        let cur = bucketSeries([row("2026-11-02", 5)], .day, range: NOV)
        let prev = bucketSeries([row("2026-10-03", 3)], .day, range: previousRange(NOV, now: NOW).map { Period($0) }, now: NOW)
        let both = compareSeries(cur, prev)
        XCTAssertEqual(both.count, 5)
        XCTAssertEqual(both[0].prev, 0)
        XCTAssertEqual(both[2].prev, 3)
        XCTAssertEqual(both[2].value, 0)
    }

    func testAutoBucket() {
        func r(_ days: Int) -> Period { Period(from: day("2026-01-01"), to: day("2026-01-01").addingTimeInterval(Double(days - 1) * 86_400)) }
        XCTAssertEqual(autoBucket(r(45), now: NOW), .day)
        XCTAssertEqual(autoBucket(r(46), now: NOW), .week)
        XCTAssertEqual(autoBucket(Period(from: day("2026-01-01"), to: day("2026-07-19")), now: NOW), .week)
        XCTAssertEqual(autoBucket(Period(from: day("2026-01-01"), to: day("2026-07-20")), now: NOW), .month)
        XCTAssertEqual(autoBucket(nil, now: NOW), .month)
    }

    // MARK: month by month

    func testEachMonthIsTheBooksOfThatMonth() {
        let rows = monthlySeries(input, months: 2, options: opts)
        XCTAssertEqual(rows.map(\.key), ["2026-10", "2026-11"])
        let oct = rows[0], nov = rows[1]
        XCTAssertEqual(oct.revenue, 40000)
        XCTAssertEqual(oct.estProfit, 4000, accuracy: 1e-6)
        XCTAssertEqual(oct.running, 0)
        XCTAssertEqual(oct.net, 4000, accuracy: 1e-6)
        XCTAssertEqual(oct.cashIn, 40000)
        XCTAssertEqual(oct.cashOut, 0)
        XCTAssertEqual(oct.metalGrams, 5)
        XCTAssertEqual(nov.revenue, 240000)
        XCTAssertEqual(nov.running, 30000)
        XCTAssertEqual(nov.drawings, 15000)
        XCTAssertEqual(nov.cashIn, 140000)
        XCTAssertEqual(nov.cashOut, 45000)
        XCTAssertEqual(nov.metalGrams, 15)
        XCTAssertEqual(nov.coinRevenue, 200000)
        XCTAssertEqual(nov.coinCount, 1)
        XCTAssertEqual(nov.net, -6000, accuracy: 1e-6)
        XCTAssertEqual(nov.month, "Nov 26")
        XCTAssertEqual(nov.metalByKarat, ["22k": 10, "21k": 5])
        XCTAssertEqual(karatsOf(rows), ["22k", "21k"])
    }

    func testAllStartsAtTheFirstRecordAndKeepsQuietMonths() {
        XCTAssertEqual(monthlySeries(input, months: nil, options: opts).map(\.key), ["2026-10", "2026-11"])
        XCTAssertEqual(monthlySeries(BooksInput(), months: nil, options: opts), [])
        XCTAssertEqual(monthlySeries(input, months: 3, options: opts).map(\.key), ["2026-09", "2026-10", "2026-11"])
    }

    func testMonthlyRevenueAndYearlySummaryKeepTheOldArithmetic() {
        let m = monthlyRevenue(input, options: opts)
        XCTAssertEqual(m.data.map(\.key), ["2026-10", "2026-11"])
        XCTAssertEqual(m.data.map(\.month), ["Oct 26", "Nov 26"])
        XCTAssertEqual(m.data.map(\.revenue), [40000, 240000])
        XCTAssertEqual(m.data.map(\.sales), [1, 4])
        XCTAssertEqual(m.average, 140000)
        XCTAssertEqual(m.best, "2026-11")
        // Drawings are not a cost of earning the profit: only the 30,000 of rent comes off.
        let y = yearlySummary(input, options: opts)[0]
        XCTAssertEqual(y.year, 2026)
        XCTAssertEqual(y.revenue, 280000)
        XCTAssertEqual(y.expenses, 30000)
        XCTAssertEqual(y.unpaid, 40000)
        XCTAssertEqual(y.profit, 28000, accuracy: 1e-6)
        XCTAssertEqual(y.netProfit, -2000, accuracy: 1e-6)
    }

    // MARK: A house that records its goods (Mina) and sells silver

    func testMinaTakesProfitAsRevenueLessGoodsAndCountsSilverWeight() {
        let silverRing = inv1(["items": [item(["sku": "S1", "metalType": "silver", "karat": NSNull(), "metalWeightG": 12, "itemTotal": 100000])]])
        let goods = expense("E3", "2026-11-02T09:00:00", "Stock & Karigars", "Stock", 60000)
        let mina = BooksOptions(now: NOW, metal: "silver", margin: .mina, goods: ["Stock & Karigars", "Custom Orders"])
        let b = computeBooks(BooksInput(invoices: [silverRing], orders: [ORD_1], expenses: [RENT, goods], additionalRevenues: [EXTRA]), range: NOV, options: mina)
        // Revenue 100,000 + 80,000 + 10,000 = 190,000, less 60,000 of goods = 130,000; less 30,000 rent = 100,000.
        XCTAssertEqual(b.totalSales, 190000)
        XCTAssertEqual(b.goodsExpenses, 60000)
        XCTAssertEqual(b.estProfitAdj, 130000)
        XCTAssertEqual(b.netProfit, 100000)
        XCTAssertEqual(b.runningExpenses, 30000)
        XCTAssertEqual(b.drawingsExpenses, 0)
        XCTAssertEqual(b.metalGrams, 12)
        XCTAssertEqual(b.metalByKarat, [MetalKaratRow(karat: "unknown", grams: 12, pieces: 1)])
    }
}
