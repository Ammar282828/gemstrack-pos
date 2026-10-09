import SwiftUI

/// Every place the ERP has, in its own groups (src/lib/nav.ts), when nothing is typed; the places
/// that match, by name or by the words people use for them, when something is.
struct SearchView: View {
    @Environment(Session.self) private var session
    let map: NavMap
    @State private var text = ""

    var body: some View {
        let q = text.trimmingCharacters(in: .whitespaces).lowercased()
        List { Group {
            if q.isEmpty { everything } else { results(q) }
            }
            .houseRows()
        }
        .navigationTitle("Everything")
        .searchable(text: $text, prompt: "Places in the ERP")
    }

    @ViewBuilder
    private var everything: some View {
        ForEach(map.groups.filter { !$0.label.isEmpty }, id: \.key) { g in
            let entries = map.entries.filter { $0.group == g.key }
            if !entries.isEmpty {
                Section(g.label) {
                    ForEach(entries) { e in
                        NavigationLink(value: Route(path: e.href)) { Label(e.label, systemImage: NavIcon.symbol(for: e.icon)) }
                    }
                }
            }
        }
        // The map is already this person's: Settings is in it for owners only.
        if let settings = map.settings {
            Section {
                NavigationLink(value: Route(path: settings.href)) {
                    Label(settings.label, systemImage: NavIcon.symbol(for: settings.icon))
                }
            }
        }
        Section {
            if session.isOwner {
                NavigationLink(value: Route(path: "/app/phone")) { Label("This phone", systemImage: "iphone") }
            }
            LabeledContent("Signed in", value: session.me?.email ?? "")
            Button("Sign out", role: .destructive) { session.signOut() }
        } footer: {
            Text("\(House.storeName) · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
        }
    }

    @ViewBuilder
    private func results(_ q: String) -> some View {
        let hits = map.allPlaces.filter { item in
            item.place.label.lowercased().contains(q) || (item.place.keywords ?? []).contains { $0.lowercased().contains(q) }
                || (item.entry?.label.lowercased().contains(q) ?? false)
        }
        if hits.isEmpty {
            ContentUnavailableView.search(text: text)
        }
        ForEach(hits) { item in
            NavigationLink(value: Route(path: item.place.href)) {
                Label {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.place.label)
                        if let e = item.entry, e.label != item.place.label { Text(e.label).font(.caption).foregroundStyle(.secondary) }
                    }
                } icon: { Image(systemName: NavIcon.symbol(for: item.place.icon)) }
            }
        }
    }
}

/// Sign in with Google, on the house's own ground.
struct SignInView: View {
    @Environment(Session.self) private var session

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image("LaunchMark-\(House.id)").resizable().scaledToFit().frame(width: 96, height: 96)
            VStack(spacing: 6) {
                Text(House.storeName).font(.title.weight(.semibold))
                Text("Sign in with the Gmail the shop has for you.").font(.subheadline).foregroundStyle(.secondary)
            }
            if session.state == .needsSetup {
                Text("This build can't reach the shop's book yet: its Firebase iOS app is not registered.")
                    .font(.footnote).multilineTextAlignment(.center).padding(.horizontal, 32)
            } else {
                Button {
                    Task { await session.signIn() }
                } label: {
                    HStack {
                        if session.state == .signingIn { ProgressView() } else { Image(systemName: "person.crop.circle.badge.checkmark") }
                        Text("Sign in with Google")
                    }
                    .frame(maxWidth: 280)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
                .disabled(session.state == .signingIn)
            }
            if let e = session.error {
                Text(e).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center).padding(.horizontal, 32)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.opacity(0.08).ignoresSafeArea())
    }
}
