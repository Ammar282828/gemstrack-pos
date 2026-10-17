import SwiftUI
import ERPCore

/// Settings → Data → Import the Taheri Software book (src/app/settings/import-taheri/page.tsx): the one-off migration
/// from the shop's previous app. The book is the extracted file the ERP ships (lib/import/taheri-book.json), as the page
/// reads it, so there is nothing to pick.
///
/// Nothing is written until Import is pressed. The ERP says what it WOULD do against the books as they are now
/// (/api/app/write `importTaheriBook` with `preview`, lib/writes/taheri-book-import.ts): who is new, who is already
/// here, and the half-matches, each with the ledger its namesake carries. Half-matches are left out unless the shop
/// says to add them as separate records, as on the page. Import plans again on the ERP and refuses if anything changed
/// since the preview (its fingerprint); run again, it adds nobody.
struct TaheriBookImportSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Import Taheri Software book") { TaheriBookImportPage() }
    }
}

// MARK: The ERP's preview

/// A name or a number already in the book, but not both (taheri-book-import.ts `BookHalfMatch`).
struct SettingsBookHalfMatch: Identifiable, Hashable {
    let id: String
    /// "customer" or "karigar".
    let kind: String
    let name: String
    /// "same_name" or "same_phone".
    let verdict: String
    let matches: [String]
    /// The ledger entries those already carry.
    let carried: Int

    init(_ d: [String: Any]) {
        id = d["id"] as? String ?? UUID().uuidString
        kind = d["kind"] as? String ?? "customer"
        name = d["name"] as? String ?? ""
        verdict = d["verdict"] as? String ?? "same_name"
        matches = (d["matches"] as? [Any] ?? []).compactMap { $0 as? String }
        carried = (d["carried"] as? NSNumber)?.intValue ?? 0
    }

    /// The page's line under the name: "Same name as Demo — which carries 3 ledger entries".
    var line: String {
        var s = (verdict == "same_name" ? "Same name as " : "Same number as ") + matches.joined(separator: ", ")
        if carried > 0 { s += " — which carries \(carried) ledger entr\(carried == 1 ? "y" : "ies")" }
        return s
    }
}

/// `importTaheriBook`'s preview: what is in the file, the plan's tallies and its fingerprint.
struct SettingsBookPreview {
    let source: String
    let customersInFile: Int
    let karigarsInFile: Int
    let counts: [String: Int]
    let halfMatches: [SettingsBookHalfMatch]
    private let addsOnly: Int
    private let addsWithHalfMatches: Int
    let fingerprint: String

    init(_ out: [String: Any]) {
        let int = { (v: Any?) in (v as? NSNumber)?.intValue ?? 0 }
        source = out["source"] as? String ?? ""
        let inFile = out["inFile"] as? [String: Any] ?? [:]
        customersInFile = int(inFile["customers"])
        karigarsInFile = int(inFile["karigars"])
        counts = (out["counts"] as? [String: Any] ?? [:]).mapValues { int($0) }
        halfMatches = (out["halfMatches"] as? [Any] ?? []).compactMap { ($0 as? [String: Any]).map(SettingsBookHalfMatch.init) }
        let adds = out["willAdd"] as? [String: Any] ?? [:]
        addsOnly = int(adds["only"])
        addsWithHalfMatches = int(adds["withHalfMatches"])
        fingerprint = out["fingerprint"] as? String ?? ""
    }

    func count(_ key: String) -> Int { counts[key] ?? 0 }

    /// What Import adds (the page's `willAdd`), as the ERP counted it.
    func adds(takingHalfMatches: Bool) -> Int { takingHalfMatches ? addsWithHalfMatches : addsOnly }
}

// MARK: The page

private struct TaheriBookImportPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var preview: SettingsBookPreview?
    @State private var loading = false
    @State private var error: String?
    /// Half-matches are opt-in. The safe default is to leave the live book alone.
    @State private var takeHalfMatches = false
    @State private var importing = false
    @State private var done: (customers: Int, karigars: Int)?
    @State private var note: Note?
    @State private var stopped: String?

    private var willAdd: Int { preview?.adds(takingHalfMatches: takeHalfMatches) ?? 0 }

    var body: some View {
        Form { Group {
            if let preview {
                fileSection(preview)
                if !preview.halfMatches.isEmpty { halfMatchSection(preview) }
                if let done {
                    Section {
                        Label("\(done.customers) customers and \(done.karigars) karigars added", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(Tone.settled.color)
                    } header: {
                        LedgerHeading(title: "Imported")
                    } footer: {
                        Text("Re-running now adds nobody — they all count as already here.")
                    }
                }
            } else if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
                    Button("Try again") { Task { await look() } }
                }
            } else {
                Section { SkeletonLoading("Reading the book") }
            }
            }
            .houseRows()
        }
        .navigationTitle("Import Taheri Software book")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if preview != nil && done == nil { importBar }
        }
        .noteToast($note)
        .failureAlert($stopped, title: "Import stopped")
        .task { if preview == nil { await look() } }
        .refreshable { await look() }
    }

    // MARK: What is in the file

    private func fileSection(_ p: SettingsBookPreview) -> some View {
        Section {
            tallies("Customers", symbol: "person.2", new: p.count("customersNew"), here: p.count("customersSettled"), half: p.count("customersConflict"))
            tallies("Karigars", symbol: "hammer", new: p.count("karigarsNew"), here: p.count("karigarsSettled"), half: p.count("karigarsConflict"))
        } header: {
            LedgerHeading(title: "What is in the file", trailing: p.source.isEmpty ? nil : p.source)
        } footer: {
            Text("\(p.customersInFile) customers and \(p.karigarsInFile) karigars. These go into the live book; nothing is written until you press Import, and anyone already here is skipped.")
        }
    }

    private func tallies(_ title: String, symbol: String, new: Int, here: Int, half: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.medium))
            FigureRow(spacing: 10) {
                FigureTile(label: "New", value: "\(new)")
                FigureTile(label: "Already here", value: "\(here)")
                FigureTile(label: "Half-matches", value: "\(half)", tint: half > 0 ? Tone.owed.color : .primary)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
    }

    // MARK: Half-matches

    private func halfMatchSection(_ p: SettingsBookPreview) -> some View {
        Section {
            ForEach(p.halfMatches) { (h: SettingsBookHalfMatch) in
                VStack(alignment: .leading, spacing: 2) {
                    Text(h.name).fontWeight(.medium).lineLimit(1)
                    Text(h.line).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
            Toggle(isOn: $takeHalfMatches) {
                Text("Add these as separate records too")
            }
            .disabled(importing || done != nil)
        } header: {
            LedgerHeading(title: "Half-matches")
        } footer: {
            Text("The name or the number is already here, but not both: usually the same person. Adding them makes a second copy without the ledger the first one carries, and the copy looks newer in a list. Usually the wrong thing.")
        }
    }

    // MARK: Import

    private var importBar: some View {
        HStack(spacing: 12) {
            Text("\(willAdd) record\(willAdd == 1 ? "" : "s") would be added.").font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Button { Task { await runImport() } } label: {
                HStack(spacing: 6) {
                    if importing { SkeletonLoading() }
                    Label("Import \(willAdd)", systemImage: "square.and.arrow.down")
                }
            }
            .buttonStyle(.houseProminent)
            .disabled(importing || loading || willAdd == 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.card))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    /// The ERP's preview: read-only, so each look is its own (`seq`: ERPAPI names a change by its content).
    private func look() async {
        loading = true
        defer { loading = false }
        do {
            let out = try await ERPAPI.shared.write("importTaheriBook", ["preview": true, "seq": UUID().uuidString])
            preview = SettingsBookPreview(out)
            error = nil
        } catch {
            if preview == nil { self.error = error.localizedDescription } else { stopped = error.localizedDescription }
        }
    }

    private func runImport() async {
        guard let preview else { return }
        importing = true
        defer { importing = false }
        do {
            let out = try await ERPAPI.shared.write("importTaheriBook", [
                "fingerprint": preview.fingerprint,
                "takeConflicts": takeHalfMatches,
            ])
            let added = (customers: (out["customers"] as? NSNumber)?.intValue ?? 0, karigars: (out["karigars"] as? NSNumber)?.intValue ?? 0)
            done = added
            Note.show(Note(title: "Import finished", detail: "\(added.customers) customers and \(added.karigars) karigars added."), in: $note, reduce: reduceMotion)
            await look()
        } catch {
            stopped = error.localizedDescription
            // A book changed since the preview is refused: look again, so the next Import is about what is there now.
            await look()
        }
    }
}
