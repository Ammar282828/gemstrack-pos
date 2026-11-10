import SwiftUI
import ERPCore

/// Book with TCS (components/order/tcs-shipping.tsx BookTcsDialog; owners and staff; owner, 2026-11-09): the parcel is booked
/// with TCS straight from the order (op bookTcs, ops-courier.ts), which writes the consignment number onto the order and
/// fulfils its Shopify order with it. The form starts from GET /api/app/courier (the Shopify shipping address, else the
/// order's delivery, else its notes; the cash to collect is what is still owed). A booking is never kept to send later:
/// TCS answers with the number, so it needs the line. The 4x6 shipping slip is the web's (no PDF route for the apps yet).
struct OrderTcsBookSheet: View {
    let order: Order
    /// Called once the parcel is booked, so the page asks for its tracking.
    var booked: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var info: CourierInfo?
    @State private var loadError: String?
    @State private var form = TcsShipping.BookingForm()
    @State private var busy = false
    @State private var failure: String?
    @State private var done: Done?
    @State private var savedTick = 0

    struct Done {
        let cn: String
        let shopify: String?
    }

    var body: some View {
        NavigationStack {
            Group {
                if let done {
                    doneForm(done)
                } else if let info {
                    bookForm(info)
                } else if let loadError {
                    ErrorState(loadError, retry: { Task { await load() } })
                } else {
                    BusySpinner("Reading the order\u{2026}")
                }
            }
            .navigationTitle(done == nil ? "Book with TCS" : "Booked")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if done == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(role: .cancel) { dismiss() }
                            .disabled(busy)
                    }
                }
            }
            .failureAlert($failure, title: "Not booked")
            .savedFeedback(trigger: savedTick)
        }
        #if os(macOS)
        .ordersMacSheet(width: 560, height: 640)
        #else
        .presentationDetents([.large])
        .presentationSizing(.form)
        #endif
        .interactiveDismissDisabled(busy)
        .task { await load() }
    }

    // MARK: The form

    private func bookForm(_ info: CourierInfo) -> some View {
        let problem = TcsShipping.bookingProblem(form)
        return Form { Group {
            if !info.ready {
                Section {
                    Label("TCS booking isn't switched on yet.", systemImage: "info.circle")
                        .font(.house(.subheadline))
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                TextField("Name", text: $form.name)
                    .textInputAutocapitalization(.words)
                TextField("Address", text: $form.address, axis: .vertical)
                    .lineLimit(2...4)
                TextField("Mobile", text: $form.mobile)
                    .keyboardType(.phonePad)
                TextField("Email (optional)", text: $form.email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
            } header: {
                LedgerHeading(title: "Deliver to")
            }
            Section {
                if info.cities.isEmpty {
                    TextField("City", text: $form.city)
                        .textInputAutocapitalization(.words)
                } else {
                    NavigationLink {
                        TcsCityPicker(cities: info.cities, selection: $form.city)
                    } label: {
                        LabeledContent("City", value: form.city.isEmpty ? "Choose" : form.city)
                    }
                }
                LabeledContent("Weight (kg)") {
                    TextField("0.5", text: $form.weightText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
                LabeledContent("Pieces") {
                    TextField("1", text: $form.piecesText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
                LabeledContent("Cash to collect (PKR)") {
                    TextField("0", text: $form.codText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
                TextField("Remarks (optional)", text: $form.remarks, axis: .vertical)
                    .lineLimit(1...3)
            } header: {
                LedgerHeading(title: "Parcel")
            } footer: {
                Text("Booked from \(info.originCity). Leave the cash to collect empty when the parcel is paid.")
            }
            if order.shopifyOrderId != nil {
                Section {
                    Toggle("Also mark fulfilled on Shopify", isOn: $form.fulfilShopify)
                } footer: {
                    Text("Untick if Universal Courier books every fulfilment.")
                }
            }
            }
            .houseRows()
        }
        .houseForm()
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .actionBar(primary: ActionBar.Action("Book with TCS", systemImage: "truck.box", isBusy: busy,
                                             isDisabled: problem != nil || !info.ready) {
            Task { await book() }
        }, summary: info.ready ? problem : nil)
    }

    private func doneForm(_ done: Done) -> some View {
        Form { Group {
            Section {
                LabeledContent("Consignment number") {
                    Button {
                        CustomerContactLinks.copy(done.cn)
                    } label: { Label(done.cn, systemImage: "doc.on.doc") }
                        .buttonStyle(.borderless)
                }
                if let shopify = done.shopify, !shopify.isEmpty {
                    Text(shopify).font(.house(.subheadline)).foregroundStyle(.secondary)
                }
            } footer: {
                Text("Print the shipping slip from the web ERP and tape it on the parcel.")
            }
            }
            .houseRows()
        }
        .houseForm()
        .actionBar(primary: ActionBar.Action("Done", systemImage: "checkmark") { dismiss() })
    }

    // MARK: Asking and booking

    private func load() async {
        guard info == nil else { return }
        loadError = nil
        do {
            let got: CourierInfo = try await ERPAPI.shared.get("/api/app/courier?order=" + InvoiceFacts.encode(order.id), as: CourierInfo.self)
            var f = TcsShipping.BookingForm()
            f.name = got.name
            f.address = got.address
            f.mobile = got.mobile
            f.email = got.email
            f.city = got.destinationCity
            f.weightText = Self.say(got.weight > 0 ? got.weight : 0.5)
            f.piecesText = String(max(1, got.pieces))
            f.codText = got.codAmount >= 1 ? Self.say(got.codAmount.rounded()) : ""
            f.remarks = got.remarks
            form = f
            info = got
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func book() async {
        guard !busy, TcsShipping.bookingProblem(form) == nil else { return }
        if Connection.shared.isOffline {
            failure = "Needs a connection. TCS gives the number when it is booked, so it can't wait for the line to come back."
            return
        }
        busy = true
        defer { busy = false }
        do {
            let out = try await ERPAPI.shared.write("bookTcs", TcsShipping.bookFields(orderId: order.id, form: form), queueOffline: false)
            let cn = (out["cn"] as? String) ?? ""
            let shopify = (out["shopify"] as? [String: Any]).flatMap { $0["message"] as? String }
            done = Done(cn: cn, shopify: shopify)
            savedTick += 1
            booked()
        } catch {
            failure = error.localizedDescription
        }
    }

    /// 0.5 and 2, never 2.0.
    private static func say(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(d) }
}

/// What GET /api/app/courier answers (lib/tcs-booking.ts `BookingPrefill`, the account's state, TCS's cities).
struct CourierInfo: Decodable {
    var ready = false
    var originCity = "Karachi"
    var name = ""
    var address = ""
    var mobile = ""
    var email = ""
    var destinationCity = ""
    var weight = 0.0
    var pieces = 1
    var codAmount = 0.0
    var remarks = ""
    var cities: [String] = []

    private enum K: String, CodingKey { case booking, prefill, cities }
    private enum B: String, CodingKey { case ready, originCity }
    private enum P: String, CodingKey { case consignee, destinationCity, weight, pieces, codAmount, remarks }
    private enum C: String, CodingKey { case name, address, mobile, email }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        if let b = try? c.nestedContainer(keyedBy: B.self, forKey: .booking) {
            ready = b.bool(.ready, default: false)
            originCity = b.string(.originCity, default: "Karachi")
        }
        if let p = try? c.nestedContainer(keyedBy: P.self, forKey: .prefill) {
            destinationCity = p.string(.destinationCity, default: "")
            weight = p.double(.weight, default: 0)
            pieces = p.int(.pieces) ?? 1
            codAmount = p.double(.codAmount, default: 0)
            remarks = p.string(.remarks, default: "")
            if let k = try? p.nestedContainer(keyedBy: C.self, forKey: .consignee) {
                name = k.string(.name, default: "")
                address = k.string(.address, default: "")
                mobile = k.string(.mobile, default: "")
                email = k.string(.email, default: "")
            }
        }
        cities = c.strings(.cities)
    }
}

/// TCS's cities, searchable; choosing one closes the list.
struct TcsCityPicker: View {
    let cities: [String]
    @Binding var selection: String

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let shown = TcsShipping.filterCities(cities, query: query)
        List(shown, id: \.self) { city in
            Button {
                selection = city
                dismiss()
            } label: {
                HStack {
                    Text(city).foregroundStyle(.primary)
                    Spacer()
                    if city == selection { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .houseForm()
        .searchable(text: $query, prompt: "Search cities")
        .overlay {
            if shown.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .navigationTitle("City")
        .navigationBarTitleDisplayMode(.inline)
    }
}
