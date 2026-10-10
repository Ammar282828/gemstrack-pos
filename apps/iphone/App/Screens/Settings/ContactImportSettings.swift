import SwiftUI
import UniformTypeIdentifiers
import ERPCore

/// Settings → Import contacts (src/app/settings/contact-import/page.tsx): customers and karigars from a phone's
/// address book. The web reads an exported .vcf, and so does this: picked in Files, the same file.
///
/// Nothing is written until Import is pressed. The ERP reads the file first (/api/app/imports, lib/contacts/triage.ts)
/// and says what WOULD happen; the half-matches are the point of it: same name with a different number is usually
/// one person with a second phone, same number with a different name usually the same person written more fully.
/// Both are questions, answered here, and neither is safe to answer silently. Import sends the file again with the
/// answers (/api/app/write `importContacts`); the ERP reads it again against the book as it is then and refuses
/// if anything the answers were about has changed (the plan's fingerprint).
///
/// The photos in an address book are left on the phone: the ERP reads only the names and numbers
/// (lib/contacts/vcard.ts), and a whole book's pictures would be megabytes to send for nothing.
struct ContactImportSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Import contacts") { ContactImportPage() }
    }
}

// MARK: The ERP's plan (lib/contacts/triage.ts)

/// Someone already in the book (`ExistingRow`).
struct SettingsContactRow: Decodable, Hashable {
    let id: String
    let kind: String
    let name: String
    let phone: String?
    let altPhone: String?

    private enum K: String, CodingKey { case id, kind, name, phone, altPhone }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        kind = c.string(.kind, default: "customer")
        name = c.string(.name, default: "")
        phone = c.string(.phone)
        altPhone = c.string(.altPhone)
    }
}

/// A contact from the file (`PendingContact`), and for a half-match (`Conflict`) why and with whom.
struct SettingsPendingContact: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let name: String
    let tags: [String]
    let phone: String?
    let extraPhones: [String]
    /// "same_name" or "same_phone"; nil for a new one.
    let reason: String?
    let matches: [SettingsContactRow]

    private enum K: String, CodingKey { case id, kind, name, tags, phone, extraPhones, reason, matches }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        kind = c.string(.kind, default: "customer")
        name = c.string(.name, default: "")
        tags = c.strings(.tags)
        phone = c.string(.phone)
        extraPhones = c.strings(.extraPhones)
        reason = c.string(.reason)
        matches = c.list(.matches, of: SettingsContactRow.self)
    }
}

private struct SettingsContactSettled: Decodable, Hashable {
    let name: String
    private enum K: String, CodingKey { case name }
    init(from decoder: Decoder) throws { name = try decoder.container(keyedBy: K.self).string(.name, default: "") }
}

private struct SettingsContactSummary: Decodable, Hashable {
    let cardsInFile: Int
    let ignoredUntagged: Int
    let mergedDuplicates: Int
    let settled: Int
    let conflicts: Int

    private enum K: String, CodingKey { case cardsInFile, ignoredUntagged, mergedDuplicates, settled, conflicts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        cardsInFile = c.int(.cardsInFile) ?? 0
        ignoredUntagged = c.int(.ignoredUntagged) ?? 0
        mergedDuplicates = c.int(.mergedDuplicates) ?? 0
        settled = c.int(.settled) ?? 0
        conflicts = c.int(.conflicts) ?? 0
    }
}

private struct SettingsContactPlan: Decodable, Hashable {
    let summary: SettingsContactSummary
    let fresh: [SettingsPendingContact]
    let settled: [SettingsContactSettled]
    let conflicts: [SettingsPendingContact]

    private enum K: String, CodingKey { case summary, fresh, settled, conflicts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        guard let s = c.object(.summary, of: SettingsContactSummary.self) else {
            throw DecodingError.dataCorruptedError(forKey: .summary, in: c, debugDescription: "no summary")
        }
        summary = s
        fresh = c.list(.fresh, of: SettingsPendingContact.self)
        settled = c.list(.settled, of: SettingsContactSettled.self)
        conflicts = c.list(.conflicts, of: SettingsPendingContact.self).filter { !$0.matches.isEmpty }
    }
}

/// /api/app/imports `{ kind: 'contacts' }`.
private struct SettingsContactPlanAnswer: Decodable {
    let plan: SettingsContactPlan
    /// The answer each half-match starts on (triage.ts defaultChoice).
    let defaults: [String: String]
    let fingerprint: String

    private enum K: String, CodingKey { case plan, defaults, fingerprint }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        plan = try c.decode(SettingsContactPlan.self, forKey: .plan)
        defaults = (try? c.decodeIfPresent([String: String].self, forKey: .defaults)) ?? [:]
        fingerprint = c.string(.fingerprint, default: "")
    }
}

enum SettingsVCard {
    /// The properties that carry pictures, sounds and keys: never read by the ERP, and most of a file's size.
    private static let media: Set<String> = ["PHOTO", "LOGO", "SOUND", "KEY"]

    /// The address book without its pictures: each such property and the folded lines that continue it (they
    /// start with a space or a tab) are left out; every other line goes as it was, line endings and all.
    static func withoutMedia(_ text: String) -> String {
        var kept: [String] = []
        var skipping = false
        // Split on the line feed itself: a phone's export ends its lines "\r\n", which Swift reads as one
        // character, so splitting the text by characters would find no lines at all. The "\r" stays on its line.
        for scalars in text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = ""
            line.unicodeScalars.append(contentsOf: scalars)
            if line.hasPrefix(" ") || line.hasPrefix("\t") {
                if !skipping { kept.append(line) }
                continue
            }
            let head = line.prefix { $0 != ":" && $0 != ";" }.uppercased()
            // "item1.PHOTO": a grouped property is named after its dot.
            let name = head.split(separator: ".").last.map(String.init) ?? head
            skipping = media.contains(name)
            if !skipping { kept.append(line) }
        }
        return kept.joined(separator: "\n")
    }
}

// MARK: The page

private struct ContactImportPage: View {
    @State private var picking = false
    @State private var reading = false
    @State private var fileName = ""
    @State private var vcf = ""
    @State private var answer: SettingsContactPlanAnswer?
    @State private var error: String?
    @State private var dropped: Set<String> = []
    @State private var choices: [String: String] = [:]
    @State private var importing = false
    @State private var note: OwnerNote?
    @State private var stopped: String?

    private var plan: SettingsContactPlan? { answer?.plan }
    private var willAdd: Int { plan.map { p in p.fresh.filter { !dropped.contains($0.id) }.count } ?? 0 }
    private var willResolve: Int { plan.map { p in p.conflicts.filter { (choices[$0.id] ?? "skip") != "skip" }.count } ?? 0 }

    var body: some View {
        Form { Group {
            fileSection
            if let plan {
                summarySection(plan)
                if !plan.conflicts.isEmpty { conflictsSection(plan) }
                if !plan.fresh.isEmpty { freshSection(plan) }
                if !plan.settled.isEmpty { settledSection(plan) }
            }
            }
            .houseRows()
        }
        .navigationTitle("Import contacts")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if plan != nil { importBar }
        }
        .ownerNote($note)
        .alert("Import stopped", isPresented: Binding(get: { stopped != nil }, set: { if !$0 { stopped = nil } })) {
            Button("OK") { stopped = nil }
        } message: {
            Text(stopped ?? "")
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.vCard]) { result in
            switch result {
            case .success(let url): Task { await read(url) }
            case .failure(let e): error = e.localizedDescription
            }
        }
    }

    // MARK: Choose the file

    private var fileSection: some View {
        Section {
            Button { picking = true } label: {
                HStack(spacing: 8) {
                    if reading { SkeletonLoading() }
                    Label(fileName.isEmpty ? "Choose a .vcf file" : fileName, systemImage: "doc.badge.plus")
                }
            }
            .disabled(reading || importing)
            if let error {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Could not read that").font(.subheadline.weight(.semibold))
                    Text(error).font(.subheadline)
                }
                .foregroundStyle(.red)
            }
        } header: {
            LedgerHeading(title: "Choose the file")
        } footer: {
            Text("On iPhone: Contacts → select all → Share → Save to Files. Only entries marked TJ, HOM, TC or Karigar in the name are taken. The mark is stripped, so “Altaf TJ” is saved as Altaf. Nothing is written until you press Import.")
        }
    }

    private func read(_ url: URL) async {
        error = nil
        answer = nil
        dropped = []
        choices = [:]
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
        guard text.contains("BEGIN:VCARD") else {
            error = "That does not look like a contacts file. Export a .vcf from your phone."
            return
        }
        let body = SettingsVCard.withoutMedia(text)
        do {
            let a = try await ERPAPI.shared.post("/api/app/imports", ["kind": "contacts", "vcf": body], as: SettingsContactPlanAnswer.self)
            vcf = body
            choices = a.defaults
            answer = a
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: What would happen

    private func summarySection(_ p: SettingsContactPlan) -> some View {
        Section {
            FigureRow(spacing: 10) {
                FigureTile(label: "Already saved", value: "\(p.summary.settled)")
                FigureTile(label: "New", value: "\(willAdd)")
                FigureTile(label: "Needs you", value: "\(p.summary.conflicts)")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } header: {
            LedgerHeading(title: "What would happen")
        } footer: {
            Text("\(p.summary.cardsInFile) contacts in the file · \(p.summary.ignoredUntagged) personal contacts ignored\(p.summary.mergedDuplicates > 0 ? " · \(p.summary.mergedDuplicates) duplicate(s) merged" : "")")
        }
    }

    // MARK: Needs you

    /// One answer the page offers a half-match, in its words.
    private struct Answer: Hashable {
        let value: String
        let label: String
        let hint: String
    }

    /// The page's answers for each kind of half-match (its ConflictRow).
    private func options(_ c: SettingsPendingContact) -> [Answer] {
        if c.reason == "same_name" {
            return [
                Answer(value: "add_phone", label: "Same person, second phone", hint: "Adds the number to the spare slot"),
                Answer(value: "add_separately", label: "Different people", hint: "Adds this one separately"),
                Answer(value: "skip", label: "Leave the book alone", hint: "Nothing changes"),
            ]
        }
        return [
            Answer(value: "adopt_name", label: "Same person, fuller name", hint: "Renames to “\(c.name)”"),
            Answer(value: "add_separately", label: "Different people", hint: "Adds this one separately"),
            Answer(value: "skip", label: "Leave the book alone", hint: "Nothing changes"),
        ]
    }

    private func conflictsSection(_ p: SettingsContactPlan) -> some View {
        Section {
            ForEach(p.conflicts) { (c: SettingsPendingContact) in
                conflictRow(c)
            }
        } header: {
            Label("Needs you", systemImage: "questionmark.circle")
        } footer: {
            Text("Half-matches — the only kind that can go wrong. Anything you leave alone stays exactly as it is in the book.")
        }
    }

    private func conflictRow(_ c: SettingsPendingContact) -> some View {
        let target = c.matches[0]
        let opts = options(c)
        let chosen = choices[c.id] ?? "skip"
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("IN THE BOOK").font(.caption2).foregroundStyle(.secondary)
                    Text(target.name).font(.subheadline.weight(.medium))
                    Text([target.phone, target.altPhone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").ifEmpty("no number"))
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ON THE PHONE").font(.caption2).foregroundStyle(.secondary)
                    Text(c.name).font(.subheadline.weight(.medium))
                    Text(c.phone ?? "no number").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Picker("Answer", selection: Binding(get: { chosen }, set: { choices[c.id] = $0 })) {
                ForEach(opts, id: \.value) { (o: Answer) in Text(o.label).tag(o.value) }
            }
            .pickerStyle(.menu)
            .disabled(importing)
            if let hint = opts.first(where: { $0.value == chosen })?.hint {
                Text(hint).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: New

    private func freshSection(_ p: SettingsContactPlan) -> some View {
        Section {
            ForEach(p.fresh) { (f: SettingsPendingContact) in
                let off = dropped.contains(f.id)
                HStack(spacing: 12) {
                    Image(systemName: f.kind == "karigar" ? "hammer" : "person.2").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.name).fontWeight(.medium).strikethrough(off).lineLimit(1)
                        Text("\(f.phone ?? "no number")\(f.extraPhones.isEmpty ? "" : " (+\(f.extraPhones.count) more)")")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    ForEach(f.tags, id: \.self) { (t: String) in StatusBadge(t.uppercased(), color: .secondary) }
                    Button {
                        if off { dropped.remove(f.id) } else { dropped.insert(f.id) }
                    } label: {
                        Image(systemName: off ? "checkmark" : "xmark")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(off ? Color.green : Color.secondary)
                    .accessibilityLabel(off ? "Put back" : "Drop")
                    .disabled(importing)
                }
                .opacity(off ? 0.45 : 1)
            }
        } header: {
            LedgerHeading(title: "New")
        } footer: {
            Text("Nothing in the book matches these. Drop any you do not want.")
        }
    }

    // MARK: Already saved

    private func settledSection(_ p: SettingsContactPlan) -> some View {
        Section {
            Text(p.settled.prefix(30).map(\.name).joined(separator: ", ") + (p.settled.count > 30 ? " and \(p.settled.count - 30) more" : ""))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } header: {
            LedgerHeading(title: "Already saved")
        } footer: {
            Text("Name and number both match somebody you have. Skipped, no question asked.")
        }
    }

    // MARK: Import

    private var importBar: some View {
        HStack(spacing: 12) {
            Text("\(willAdd) to add, \(willResolve) to resolve.").font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Button { Task { await runImport() } } label: {
                HStack(spacing: 6) {
                    if importing { SkeletonLoading() }
                    Label("Import", systemImage: "square.and.arrow.down")
                }
            }
            .buttonStyle(.houseProminent)
            .disabled(importing || (willAdd == 0 && willResolve == 0))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private func runImport() async {
        guard let answer else { return }
        importing = true
        do {
            let out = try await ERPAPI.shared.write("importContacts", [
                "vcf": vcf,
                "fingerprint": answer.fingerprint,
                "dropped": Array(dropped),
                "choices": choices,
            ])
            let added = out["added"] as? Int ?? 0
            let updated = out["updated"] as? Int ?? 0
            let settled = out["settled"] as? Int ?? answer.plan.settled.count
            withAnimation { note = OwnerNote(title: "Import finished", detail: "\(added) added, \(updated) updated. \(settled) were already saved.") }
            self.answer = nil
            vcf = ""
            fileName = ""
            dropped = []
            choices = [:]
        } catch {
            stopped = error.localizedDescription
        }
        importing = false
    }
}

private extension String {
    func ifEmpty(_ other: String) -> String { isEmpty ? other : self }
}
