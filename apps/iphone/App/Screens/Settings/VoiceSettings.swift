import SwiftUI
import ERPCore

/// Settings → Voice (src/app/settings/voice/page.tsx): whether the shop can talk to the book at all, and every
/// name the assistant has been taught. The second is the point: a household's nicknames are private,
/// occasionally wrong, and the shop must be able to see the list and take one back.
///
/// The state is the ERP's own answer (/api/voice/status: the key lives on the server, so asking is the only
/// honest way to know). The names are Firestore `voice_aliases`, read live while this screen is open; "Forget"
/// is /api/app/write `forgetVoiceAlias` (lib/writes/voice-aliases.ts), with no delete code: it is a settings list.
/// The page's line about the microphone needing https is the browser's; the app's microphone is the phone's own.
struct VoiceSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Voice") { VoiceSettingsPage() }
    }
}

/// One name learned (store.ts `VoiceAlias`): what was heard, and who it means now.
struct SettingsVoiceAlias: Decodable, Identifiable, Hashable {
    let id: String
    let heard: String
    let refName: String
    /// "customer" or "karigar".
    let kind: String
    let uses: Int
    let createdAt: String

    private enum K: String, CodingKey { case id, heard, refName, kind, uses, createdAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        heard = c.string(.heard, default: "")
        refName = c.string(.refName, default: "")
        kind = c.string(.kind, default: "customer")
        uses = c.int(.uses) ?? 1
        createdAt = c.string(.createdAt, default: "")
    }
}

/// /api/voice/status: `ready`, and when not, why (no_credit, no_permission, not_configured, unreachable).
private struct SettingsVoiceStatus: Decodable {
    let ready: Bool
    let reason: String?

    private enum K: String, CodingKey { case ready, reason, error }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ready = c.bool(.ready, default: false)
        // A reply with neither is this app refusing the request, not Google failing to answer.
        reason = c.string(.reason) ?? (c.string(.error) != nil ? "refused" : (ready ? nil : "unreachable"))
    }
}

private struct VoiceSettingsPage: View {
    @State private var aliases = Shelf<SettingsVoiceAlias>(Collections.voiceAliases) { $0.createdAt > $1.createdAt }
    /// nil while the ERP is being asked.
    @State private var ready: Bool?
    @State private var reason: String?
    @State private var busy: String?
    /// Names just forgotten: gone from the list before the shelf says so.
    @State private var forgotten: Set<String> = []
    @State private var note: Note?
    @State private var forgetting: SettingsVoiceAlias?
    @State private var confirmingForget = false
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var failure: String?

    var body: some View {
        Form { Group {
            statusSection
            namesSection
            }
            .houseRows()
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
        .noteToast($note)
        .confirmDestructive(isPresented: $confirmingForget,
                            title: "Forget “\(forgetting?.heard ?? "this name")”?",
                            message: "It will no longer mean \(forgetting?.refName ?? "that person"). It can be taught again by correcting it.",
                            action: "Forget") {
            if let a = forgetting { Task { await forget(a) } }
        }
        .failureAlert($failure, title: "Could not forget that")
        .task { await check() }
        .onAppear { aliases.need() }
        .onDisappear { aliases.reset() }
        .refreshable { await check() }
    }

    // MARK: Whether voice works

    private var statusSection: some View {
        Section {
            Label {
                Text(ready == nil ? "Checking…" : ready == true ? "Voice is ready" : "Voice is not set up").font(.headline)
            } icon: {
                Image(systemName: ready == true ? "mic.fill" : "mic.slash")
            }
            if ready == false {
                VStack(alignment: .leading, spacing: 6) {
                    Text(problemTitle).font(.subheadline.weight(.semibold))
                    Text(problemDetail + " Everything else works meanwhile — every entry voice could make can still be made from the ordinary forms.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
            Text("Nothing spoken is written down until it has been read back and confirmed. When two people sound alike, it asks which rather than choosing.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } footer: {
            Text("Voice is paid for by this shop’s own Google account. There is no key to keep.")
        }
    }

    private var problemTitle: String {
        switch reason {
        case "no_credit": return "The shop’s Google account is out of credit"
        case "no_permission": return "Voice cannot reach Google"
        case "not_configured": return "Voice is not set up for this shop"
        case "refused": return "The app did not allow that"
        default: return "Could not reach Google"
        }
    }

    private var problemDetail: String {
        switch reason {
        case "no_credit":
            return "Voice and the scanner are paid for from this shop’s Google account, and it has nothing left. Top it up and both start working again; nothing needs changing here."
        case "no_permission":
            return "The shop’s Google account has not allowed voice to run. Ask whoever set up the ERP to allow it."
        case "not_configured":
            return "No Google account has been linked to voice for this shop yet."
        case "refused":
            return "Voice needs a signed-in owner and did not find one. Google was never contacted, so this is not an outage. Sign in again."
        default:
            return "Google did not answer. This is usually the connection rather than the set-up; it will be checked again shortly."
        }
    }

    private func check() async {
        do {
            let s = try await ERPAPI.shared.get("/api/voice/status", as: SettingsVoiceStatus.self)
            ready = s.ready
            reason = s.reason
        } catch let f as ERPAPI.Failure where f.status == 401 || f.status == 403 {
            ready = false
            reason = "refused"
        } catch {
            ready = false
            reason = "unreachable"
        }
    }

    // MARK: Names it has learned

    private var namesSection: some View {
        Section {
            if !aliases.loaded {
                HStack { Spacer(); SkeletonLoading(); Spacer() }
            } else if let error = aliases.error, aliases.items.isEmpty {
                Label(error, systemImage: "exclamationmark.icloud").foregroundStyle(.secondary)
            } else if aliases.items.isEmpty {
                Text("Nothing learned yet.").foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center)
            } else {
                ForEach(aliases.items.filter { !forgotten.contains($0.id) }) { (a: SettingsVoiceAlias) in
                    row(a)
                }
            }
        } header: {
            LedgerHeading(title: "Names it has learned")
        } footer: {
            Text("Each one is a time it picked the wrong person and was told which was meant. It gets that name right from then on.")
        }
    }

    private func row(_ a: SettingsVoiceAlias) -> some View {
        var sub = a.kind == "karigar" ? "Karigar" : "Customer"
        if a.uses > 1 { sub += " · corrected \(a.uses) times" }
        let day = OwnerText.shortDate(a.createdAt)
        if !day.isEmpty { sub += " · \(day)" }
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("“\(a.heard)”").italic().foregroundStyle(.secondary).lineLimit(1)
                    Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                    Text(a.refName).fontWeight(.medium).lineLimit(1)
                }
                Text(sub).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if busy == a.id { SkeletonLoading() }
        }
        .swipeActions {
            Button(role: .destructive) { askToForget(a) } label: { Label("Forget", systemImage: "trash") }
                .disabled(busy != nil)
        }
        .contextMenu {
            Button(role: .destructive) { askToForget(a) } label: { Label("Forget", systemImage: "trash") }
        }
        .accessibilityAction(named: "Forget") { askToForget(a) }
    }

    private func askToForget(_ a: SettingsVoiceAlias) {
        forgetting = a
        confirmingForget = true
    }

    /// Not money: the name leaves the list at once; the Outbox tells the ERP (a 409 there means it was already gone).
    private func forget(_ a: SettingsVoiceAlias) async {
        Motion.run(reduce: reduce) {
            forgotten.insert(a.id)
            note = Note(title: "Forgotten", detail: "“\(a.heard)” no longer means \(a.refName).")
        }
        SaveTap.play()
        Outbox.shared.send(op: "forgetVoiceAlias", fields: ["aliasId": a.id], business: House.business, label: "Forget “\(a.heard)”")
    }
}
