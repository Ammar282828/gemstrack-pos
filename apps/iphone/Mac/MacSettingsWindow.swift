#if os(macOS)
import SwiftUI

/// ERP › Settings… (⌘,): the shop's settings in a window of their own, as a Mac app keeps them, beside This Mac (the
/// lock, notifications) and Label LIVE. The same screens as the sidebar's Settings; staff and marketing, who have no
/// shop settings, see This Mac and Labels only.
struct MacSettingsWindow: View {
    private enum Pane: Hashable { case shop, labels, device, businesses }
    @State private var pane: Pane = .shop

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if session.state == .signedIn {
                TabView(selection: $pane) {
                    if session.isOwner {
                        NavigationStack {
                            PlaceScreen(path: "/settings")
                                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                        }
                        .tabItem { Label("Shop", systemImage: "storefront") }
                        .tag(Pane.shop)
                    }
                    NavigationStack { LabelLiveSettingsScreen() }
                        .tabItem { Label("Labels", systemImage: "tag") }
                        .tag(Pane.labels)
                    NavigationStack {
                        PlaceScreen(path: "/app/phone")
                            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                    .tabItem { Label("This Mac", systemImage: "desktopcomputer") }
                    .tag(Pane.device)
                    NavigationStack { BusinessesScreen(inSheet: false) }
                        .tabItem { Label("Businesses", systemImage: "building.2") }
                        .tag(Pane.businesses)
                }
                .onAppear { if !session.isOwner { pane = .labels } }
            } else {
                ContentUnavailableView("Sign in first", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("Settings open once you have signed in in the main window."))
            }
        }
        .environment(session)
        .environment(Book.shared)
        .tint(Theme.accent)
        .modifier(MacLockCover())
        .environment(\.locale, Locale(identifier: "en_PK"))
        .frame(minWidth: 720, idealWidth: 820, minHeight: 560, idealHeight: 680)
    }
}
#endif
