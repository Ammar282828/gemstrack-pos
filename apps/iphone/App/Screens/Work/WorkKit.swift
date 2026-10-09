import SwiftUI
import UIKit
import ERPCore

/// What the Work screens (Drafts, Calendar, Activity, My work) share: addresses, the lock for what is not a
/// person's to see, the day range of a filter, and the made-up books the demo shows.

enum WorkPaths {
    /// One part of a path: an id with a "/" or "?" in it must not split the address.
    private static func part(_ s: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// What JavaScript's encodeURIComponent leaves alone (a query value).
    private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
    }

    static func order(_ id: String) -> String { "/orders/" + part(id) }

    static func invoice(_ id: String) -> String { "/invoices/" + part(id) }

    /// A value in a path's query ("/my-work?preview=KAR-1"), decoded.
    static func query(_ name: String, in path: String) -> String? {
        URLComponents(string: path)?.queryItems?.first { $0.name == name }?.value
    }
}

/// A place the signed-in person is not let into (the ERP's menu does not offer it to them either).
struct WorkNotYours: View {
    let title: String
    var detail = "The ERP does not show this to your account."

    var body: some View {
        ContentUnavailableView(title, systemImage: "lock", description: Text(detail))
            .navigationTitle(title)
    }
}

// MARK: A range of days

enum WorkDays {
    /// The day the person picked on the phone's own calendar ("6 Oct" is the 6th wherever the phone is), as a
    /// "yyyy-MM-dd" day; a picker's time of day does not matter.
    static func pickedDay(_ picked: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: picked)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 1, c.day ?? 1)
    }
}

/// What the person chose for a range of days, as the web's range picker works: nothing is bound until a start date
/// is chosen, and with no end date the range runs to the end of today.
struct WorkRange: Equatable {
    var useFrom = false
    /// Offered as the first of this month once "From a date" is turned on.
    var from: Date = Calendar.current.dateInterval(of: .month, for: Date())?.start ?? Date()
    var useTo = false
    var to = Date()

    var fromDay: String? { useFrom ? WorkDays.pickedDay(from) : nil }
    var toDay: String? { useFrom && useTo ? WorkDays.pickedDay(to) : nil }
}

/// The range's dates, as rows of a form (put them in a Section).
struct WorkRangeFields: View {
    @Binding var range: WorkRange

    var body: some View {
        Group {
            Toggle("From a date", isOn: $range.useFrom)
            if range.useFrom {
                DatePicker("From", selection: $range.from, in: ...Date(), displayedComponents: .date)
                    .onChange(of: range.from) { _, picked in
                        if range.to < picked { range.to = picked }
                    }
                Toggle("To a date", isOn: $range.useTo)
                if range.useTo {
                    DatePicker("To", selection: $range.to, in: range.from...max(Date(), range.from), displayedComponents: .date)
                }
            }
        }
    }
}

// MARK: A picture inside a document

/// A piece's sample picture as the ERP holds it, a base64 data address: decoded once, off the main thread, shrunk
/// to the screen, and kept for the next visit (the same decoder the Stock pages use).
struct WorkSamplePhoto: View {
    let uri: String
    /// Names this picture, so a view reused for another piece decodes again.
    let key: String

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(.rect(cornerRadius: 10))
            } else if !failed {
                ProgressView().frame(maxWidth: .infinity, minHeight: 60)
            }
        }
        .task(id: key) {
            let text: String = uri
            let cacheKey: String = "work-" + key
            let decoded: UIImage? = await Task.detached(priority: .userInitiated) { () -> UIImage? in
                StockImageDecoder.image(text, key: cacheKey, maxPixel: 1200)
            }.value
            if let decoded {
                image = decoded
            } else {
                failed = true
            }
        }
    }
}

// MARK: The demo's books

/// Made-up drafts, activity and portal for `-ERPDemo YES` (CONVENTIONS.md rule 3). The demo book holds orders and
/// invoices (Resources/demo.json) but neither drafts nor a log nor a karigar's portal, which the ERP's server keeps.
enum WorkDemo {
    private static func ago(_ seconds: TimeInterval) -> String { ERPDate.iso(Date().addingTimeInterval(-seconds)) }

    static func drafts() -> [WorkDraft] {
        [
            WorkDraft(id: "order-demo01aa-ab12c", kind: "order", title: "Sana Demo", detail: "Plain band, matte finish · advance PKR 20,000",
                      items: 1, total: 148_000, device: "iPhone", createdAt: ago(3_600), updatedAt: ago(1_500)),
            WorkDraft(id: "order-demo02bb-cd34e", kind: "order", title: "No customer yet", detail: "Bangle pair with filigree, Matching studs",
                      items: 2, total: 760_000, device: "Mac", createdAt: ago(90_000), updatedAt: ago(86_400)),
            WorkDraft(id: "sale-demo03cc-ef56g", kind: "sale", title: "Bilal Example", detail: "Gents ring, Chain 22k · discount PKR 5,000",
                      items: 2, total: 214_000, device: "iPhone", createdAt: ago(7_200), updatedAt: ago(5_400)),
        ]
    }

    static func activity() -> [ActivityLogEntry] {
        func entry(_ n: Int, _ type: String, _ what: String, _ details: String, _ id: String, _ seconds: TimeInterval) -> ActivityLogEntry {
            ActivityLogEntry(id: "log-demo-\(n)", timestamp: ago(seconds), eventType: type, description: what, details: details, entityId: id)
        }
        return [
            entry(1, "invoice.create", "Created invoice INV-D0003", "Sana Demo | By: Demo", "INV-D0003", 1_800),
            entry(2, "invoice.payment", "Payment of PKR 40,000 on INV-D0002", "Bilal Example | Cash", "INV-D0002", 7_000),
            entry(3, "order.create", "Created order ORD-D0004", "Sana Demo | By: Demo", "ORD-D0004", 20_000),
            entry(4, "order.update", "Marked ORD-D0002 In Progress", "Karigar assigned", "ORD-D0002", 90_000),
            entry(5, "expense.create", "Added expense: Workshop electricity", "PKR 12,500 | Utilities", "EXP-D0001", 100_000),
            entry(6, "product.update", "Updated product: DEMO-0007", "Price changed", "DEMO-0007", 180_000),
            entry(7, "customer.create", "Added customer: Example Customer", "By: Counter Two", "CUST-D09", 260_000),
            entry(8, "repair.status", "Repair REP-D0001 is Ready", "Chain clasp", "REP-D0001", 300_000),
            entry(9, "rates.update", "Gold rates updated", "24k: 38,500 per gram", "rates", 400_000),
            entry(10, "order.delete", "Removed order ORD-D0000", "Duplicate", "ORD-D0000", 520_000),
        ]
    }

    /// A karigar's portal, as /api/karigar/me would answer it for "Ustad Demo".
    static func portal() -> KarigarPortal? {
        let json = """
        {"role":"karigar","preview":false,"karigar":{"id":"KAR-D1","name":"Ustad Demo"},
         "summary":{"active":4,"inProgress":3,"late":1,"critical":1,"oldestDays":16},
         "jobs":[
          {"id":"order:ORD-D0002:0","source":"order","description":"Bangle pair with filigree","category":"Bangles","metalType":"gold","karat":"21k",
           "weightG":22.5,"quantity":1,"size":"2.6","sampleGiven":true,"status":"in-progress","assignedDate":"\(ago(16 * 86_400))",
           "ageDays":16,"urgency":"critical","orderId":"ORD-D0002","notes":"Fine filigree on the outer face.\\nSatin finish inside."},
          {"id":"order:ORD-D0002:1","source":"order","description":"Matching studs","category":"Earrings","metalType":"gold","karat":"21k",
           "weightG":3.1,"quantity":1,"status":"in-progress","assignedDate":"\(ago(16 * 86_400))","ageDays":16,"urgency":"critical","orderId":"ORD-D0002"},
          {"id":"order:ORD-D0005:0","source":"order","description":"Plain band, matte finish","category":"Rings","metalType":"gold","karat":"21k",
           "weightG":4.2,"quantity":1,"size":"11","status":"in-progress","assignedDate":"\(ago(8 * 86_400))","ageDays":8,"urgency":"warning","orderId":"ORD-D0005"},
          {"id":"job:JOB-D1","source":"manual","description":"Polish the stock chains","category":"Chains","metalType":"gold","karat":"22k",
           "quantity":4,"status":"pending","assignedDate":"\(ago(2 * 86_400))","ageDays":2,"urgency":"ok"},
          {"id":"order:ORD-D0001:0","source":"order","description":"Ring resize","category":"Rings","status":"completed",
           "assignedDate":"\(ago(12 * 86_400))","ageDays":12,"urgency":"ok","orderId":"ORD-D0001"}
         ],
         "account":{"goldGiven":48.5,"goldReceived":22.25,"goldNet":26.25,"totalPaid":185000,
          "ledger":[{"date":"\(ago(3 * 86_400))","description":"Gold given for ORD-D0005","goldOut":6.5,"goldIn":0},
                    {"date":"\(ago(9 * 86_400))","description":"Finished bangles returned","goldOut":0,"goldIn":22.25}],
          "payments":[{"date":"\(ago(5 * 86_400))","amount":120000,"description":"Part payment"},
                      {"date":"\(ago(20 * 86_400))","amount":65000,"description":"Month end"}]}}
        """
        return try? JSONDecoder().decode(KarigarPortal.self, from: Data(json.utf8))
    }
}
