import SwiftUI

/// Every place the ERP has, in its own groups (src/lib/nav.ts): the sidebar, as a list.
struct MoreView: View {
    @Environment(Session.self) private var session
    let map: NavMap

    var body: some View {
        List {
            ForEach(map.groups.filter { !$0.label.isEmpty }, id: \.key) { g in
                let entries = map.entries.filter { $0.group == g.key }
                if !entries.isEmpty {
                    Section(g.label) {
                        ForEach(entries) { e in
                            NavigationLink(value: Route(path: e.href)) {
                                Label(e.label, systemImage: NavIcon.symbol(for: e.icon))
                            }
                        }
                    }
                }
            }
            if session.isOwner {
                Section {
                    NavigationLink(value: Route(path: map.settings.href)) {
                        Label(map.settings.label, systemImage: NavIcon.symbol(for: map.settings.icon))
                    }
                }
            }
            Section {
                LabeledContent("Signed in", value: session.me?.email ?? "")
                Button("Sign out", role: .destructive) { session.signOut() }
            } footer: {
                Text("\(House.storeName) · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
            }
        }
        .navigationTitle("More")
    }
}

/// The ERP's palette: every place by its name or the words people use for it.
struct SearchView: View {
    let map: NavMap
    @State private var text = ""

    var body: some View {
        let q = text.trimmingCharacters(in: .whitespaces).lowercased()
        let places = map.allPlaces.filter { item in
            q.isEmpty || item.place.label.lowercased().contains(q) || (item.place.keywords ?? []).contains { $0.lowercased().contains(q) }
                || (item.entry?.label.lowercased().contains(q) ?? false)
        }
        List(places, id: \.place.id) { item in
            NavigationLink(value: Route(path: item.place.href)) {
                Label {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.place.label)
                        if let e = item.entry, e.label != item.place.label { Text(e.label).font(.caption).foregroundStyle(.secondary) }
                    }
                } icon: { Image(systemName: NavIcon.symbol(for: item.place.icon)) }
            }
        }
        .navigationTitle("Search")
        .searchable(text: $text, prompt: "Places in the ERP")
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
                .buttonStyle(.glassProminent)
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
