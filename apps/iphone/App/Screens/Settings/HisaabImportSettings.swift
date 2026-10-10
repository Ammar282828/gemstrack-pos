import SwiftUI
import UniformTypeIdentifiers
import ERPCore

/// Settings → Import hisaab (src/app/settings/hisaab-import/page.tsx): one customer's or karigar's old ledger,
/// from a CSV such as Easy Khata exports, picked in Files as the page takes the file.
///
/// The ERP reads the file (/api/app/imports, lib/import/hisaab-csv.ts: the page's own columns, date formats and
/// amounts) and the rows are shown before anything is written. Import sends the file again for the person chosen
/// (/api/app/write `importHisaab`), and the ERP reads it again and refuses it while any row has a date that did
/// not read or no amount, as the page refuses it. The same file imported again for the same person writes over
/// its own rows rather than adding the ledger twice.
struct HisaabImportSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Import hisaab") { HisaabImportPage() }
    }
}

/// One row of the file as the ERP read it (hisaab-csv.ts `HisaabCsvRow`).
private struct SettingsHisaabRow: Decodable, Hashable {
    let date: String
    let isValidDate: Bool
    let description: String
    let cashIn: Double
    let cashOut: Double

    private enum K: String, CodingKey { case date, isValidDate, description, cashIn, cashOut }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        isValidDate = c.bool(.isValidDate, default: false)
        description = c.string(.description, default: "")
        cashIn = c.double(.cashIn, default: 0)
        cashOut = c.double(.cashOut, default: 0)
    }

    var fine: Bool { isValidDate && (cashIn != 0 || cashOut != 0) }
}

/// /api/app/imports `{ kind: 'hisaab' }`.
private struct SettingsHisaabRead: Decodable {
    let rows: [SettingsHisaabRow]
    /// The page's refusal when a row is wrong; nil when every row is fine.
    let refusal: String?

    private enum K: String, CodingKey { case rows, refusal }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        rows = c.list(.rows, of: SettingsHisaabRow.self)
        refusal = c.string(.refusal)
    }
}

/// Whose hisaab: a customer or a karigar on file (the page's one list of both, by name).
private struct SettingsHisaabPerson: Identifiable, Hashable {
    let id: String
    let name: String
    /// "customer" or "karigar".
    let type: String
}

private struct HisaabImportPage: View {
    @Environment(Book.self) private var book

    @State private var picking = false
    @State private var choosingPerson = false
    @State private var reading = false
    @State private var fileName = ""
    @State private var csv = ""
    @State private var read: SettingsHisaabRead?
    @State private var error: String?
    @State private var person: SettingsHisaabPerson?
    @State private var importing = false
    @State private var note: OwnerNote?
    @State private var failure: String?

    private var people: [SettingsHisaabPerson] {
        let customers = book.customers.items.filter { $0.deletedAt == nil }.map { SettingsHisaabPerson(id: $0.id, name: $0.name, type: "customer") }
        let karigars = book.karigars.items.filter { $0.deletedAt == nil }.map { SettingsHisaabPerson(id: $0.id, name: $0.name, type: "karigar") }
        return (customers + karigars).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var rows: [SettingsHisaabRow] { read?.rows ?? [] }

    var body: some View {
        Form { Group {
            instructionsSection
            fileSection
            personSection
            if let error {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Error Reading File").font(.subheadline.weight(.semibold))
                        Text(error).font(.subheadline)
                    }
                    .foregroundStyle(.red)
                }
            }
            if !rows.isEmpty { previewSection }
            importSection
            }
            .houseRows()
        }
        .navigationTitle("Import hisaab")
        .navigationBarTitleDisplayMode(.inline)
        .ownerNote($note)
        .alert("Import stopped", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            switch result {
            case .success(let url): Task { await readFile(url) }
            case .failure(let e): error = e.localizedDescription
            }
        }
        .sheet(isPresented: $choosingPerson) {
            HisaabPersonPicker(people: people) { person = $0 }
        }
        .onAppear {
            book.customers.need()
            book.karigars.need()
        }
    }

    // MARK: Instructions & Required Format

    private var instructionsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Your CSV file must contain the following exact column headers: Date, Details, Cash IN, Cash OUT.")
                Text("The date format should be one of dd-MMM-yy, dd/MM/yyyy, or yyyy-MM-dd.")
                Text("‘Cash IN’ represents money you received from the person.")
                Text("‘Cash OUT’ represents money you gave to the person.")
                Text("This tool does not support importing gold transactions. They must be added manually.")
                Text("You can only import data for one person at a time. Upload a separate file for each person.")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        } header: {
            LedgerHeading(title: "Instructions & Required Format")
        } footer: {
            Text("Import historical transactions for a customer or karigar from a CSV file (e.g., exported from Easy Khata).")
        }
    }

    // MARK: 1. Upload CSV File

    private var fileSection: some View {
        LedgerSection("1. Upload CSV File") {
            Button { picking = true } label: {
                HStack(spacing: 8) {
                    if reading { SkeletonLoading() }
                    Label(fileName.isEmpty ? "Choose File" : "Change File", systemImage: "doc.badge.plus")
                }
            }
            .disabled(reading || importing)
            if !fileName.isEmpty {
                Text(fileName).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private func readFile(_ url: URL) async {
        error = nil
        read = nil
        csv = ""
        fileName = url.lastPathComponent
        reading = true
        defer { reading = false }
        let text: String
        do {
            text = try SettingsFiles.text(at: url)
        } catch {
            self.error = "Could not read that file."
            return
        }
        do {
            let r = try await ERPAPI.shared.post("/api/app/imports", ["kind": "hisaab", "csv": text], as: SettingsHisaabRead.self)
            csv = text
            read = r
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: 2. Select Person to Import For

    private var personSection: some View {
        LedgerSection("2. Select Person to Import For") {
            Button { choosingPerson = true } label: {
                HStack {
                    if let person {
                        Label(person.name, systemImage: person.type == "karigar" ? "hammer" : "person")
                            .foregroundStyle(.primary)
                    } else {
                        Text("Select a customer or karigar...")
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
            }
            .disabled(importing)
        }
    }

    // MARK: Preview Data

    private var previewSection: some View {
        Section {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: row.isValidDate ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(row.isValidDate ? Color.green : Color.red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.description.isEmpty ? "—" : row.description).lineLimit(2)
                        Text(row.isValidDate ? OwnerText.shortDate(row.date) : "Invalid Date")
                            .font(.caption)
                            .foregroundStyle(row.isValidDate ? Color.secondary : Color.red)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        if row.cashIn != 0 { Text("IN \(PaymentText.pkr(row.cashIn))").font(.subheadline).monospacedDigit() }
                        if row.cashOut != 0 { Text("OUT \(PaymentText.pkr(row.cashOut))").font(.subheadline).monospacedDigit() }
                        if row.cashIn == 0 && row.cashOut == 0 { Text("No amount").font(.caption).foregroundStyle(.red) }
                    }
                }
            }
        } header: {
            LedgerHeading(title: "Preview Data (\(rows.count) rows)")
        }
    }

    // MARK: Import

    private var importSection: some View {
        Section {
            Button { Task { await runImport() } } label: {
                HStack(spacing: 8) {
                    if importing { SkeletonLoading() }
                    Label(importing ? "Importing \(rows.count) Transactions..." : "Import for \(person?.name ?? "...")", systemImage: "square.and.arrow.down")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(rows.isEmpty || person == nil || importing || error != nil || read?.refusal != nil)
        } footer: {
            if let refusal = read?.refusal {
                Text(refusal).foregroundStyle(.red)
            }
        }
    }

    private func runImport() async {
        guard let person, !rows.isEmpty, !csv.isEmpty else {
            failure = "Please upload a valid file and select a person."
            return
        }
        importing = true
        do {
            let out = try await ERPAPI.shared.write("importHisaab", ["csv": csv, "entityId": person.id, "entityType": person.type])
            let n = out["imported"] as? Int ?? rows.count
            withAnimation { note = OwnerNote(title: "Import Complete", detail: "\(n) transactions imported successfully. 0 failed.") }
            read = nil
            csv = ""
            fileName = ""
            self.person = nil
        } catch {
            failure = error.localizedDescription
        }
        importing = false
    }
}

/// The page's "Select a customer or karigar…", as a searchable list: a shop's book is too long for a menu.
private struct HisaabPersonPicker: View {
    let people: [SettingsHisaabPerson]
    let pick: (SettingsHisaabPerson) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var shown: [SettingsHisaabPerson] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? people : people.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(shown) { (p: SettingsHisaabPerson) in
                    Button {
                        pick(p)
                        dismiss()
                    } label: {
                        Label(p.name, systemImage: p.type == "karigar" ? "hammer" : "person").foregroundStyle(.primary)
                    }
                }
                .houseRows()
            }
            .modifier(HouseGround())
            .searchable(text: $query, prompt: "Name")
            .navigationTitle("Whose hisaab?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }
}
