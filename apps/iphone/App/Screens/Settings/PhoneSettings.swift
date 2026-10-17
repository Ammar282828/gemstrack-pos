import SwiftUI
import UserNotifications
import WidgetKit

/// This phone's own settings (owners): which notifications it gets (lib/push, kept on the server per
/// phone, so the ERP's Settings → Alerts switches for WhatsApp are not touched), and the home-screen
/// widget's link. Settings for the whole shop stay the ERP's (/settings).
struct PhoneSettings: View {
    private static let kinds: [(id: String, title: String, detail: String)] = [
        ("sales", "Sales", "A new sale"),
        ("payments", "Payments", "A payment on an invoice, a transfer slip from the website, a payment on Shopify"),
        ("orders", "Orders", "A new order, one finished or cancelled, online orders waiting"),
        ("karigar", "Karigars", "A karigar marking a piece done"),
    ]

    @Environment(\.scenePhase) private var scenePhase
    @State private var providerStatus: String?
    @State private var allowed: UNAuthorizationStatus = .notDetermined
    @State private var off: Set<String> = []
    @State private var loaded = false
    @State private var saving = false
    @State private var testing = false
    @State private var testResult: String?
    @State private var error: String?
    @State private var widgetLinked = ERPWidgetLink.entry(for: House.id) != nil
    @State private var iconBusy = false
    @State private var iconError: String?
    @AppStorage(AppIcon.modeKey) private var iconMode = AppIcon.Mode.erp.rawValue
    @State private var linking = false
    @State private var linkFailed = false
    @AppStorage("deviceTheme") private var deviceTheme = ""
    @State private var lockOn = AppLock.shared.enabled
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form { Group {
            Section {
                switch allowed {
                case .denied:
                    Label("Notifications are off for this app", systemImage: "bell.slash")
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                case .notDetermined:
                    Button("Turn on notifications") { Task { await Push.shared.register(); await refresh() } }
                default:
                    if !loaded {
                        Label(Push.shared.registering ? "Registering this phone…" : "Phone not linked", systemImage: "bell.badge")
                        Button("Register again") { Task { await Push.shared.register(); await refresh() } }
                            .disabled(Push.shared.registering)
                    } else {
                        Label("This phone is linked", systemImage: "checkmark.circle")
                    }
                    if loaded { ForEach(Self.kinds, id: \.id) { k in
                        Toggle(isOn: binding(k.id)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.title)
                                Text(k.detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .disabled(saving)
                    } }
                    if loaded {
                        Button(testing ? "Sending…" : "Send a test notification") {
                            Task {
                                testing = true; testResult = nil; error = nil
                                do {
                                    try await Push.shared.sendTest()
                                    testResult = "Apple accepted the test. Check this phone's notifications."
                                } catch { self.error = error.localizedDescription }
                                testing = false
                            }
                        }.disabled(testing || saving)
                        if let testResult { Text(testResult).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if let providerStatus { Text(providerStatus).font(.caption).foregroundStyle(.secondary) }
                if let problem = Push.shared.registrationError { Text(problem).font(.caption).foregroundStyle(Tone.problem.color) }
            } header: {
                LedgerHeading(title: "Notifications on this phone")
            } footer: {
                Text("The shop's WhatsApp alerts are set in the ERP's Settings → Alerts.")
            }
            if let error { Section { Text(error).foregroundStyle(Tone.problem.color) } }

            // Every business signed in on this phone is told of it, so an alert from any of them arrives (Push.link).
            if Businesses.shared.list.count > 1 && !House.isDemo {
                Section {
                    ForEach(Businesses.shared.list) { b in businessPush(b) }
                } header: {
                    LedgerHeading(title: "Notifications by business")
                } footer: {
                    Text("An alert names its business: tapping one opens that business. Which kinds come is chosen above for the open business; open another to set its own.")
                }
            }


            Section {
                Picker("Appearance", selection: $deviceTheme) {
                    Text("Follow the shop").tag("")
                    Text("Light").tag("default")
                    Text("Dark").tag("taheri")
                }
            } header: {
                LedgerHeading(title: "Appearance")
            } footer: {
                Text("The theme for this phone. If not chosen, it follows the shop's appearance in the ERP.")
            }

            Section {
                Toggle("Lock with Face ID", isOn: Binding(get: { lockOn }, set: { lockOn = $0; AppLock.shared.enabled = $0 }))
                    .disabled(!AppLock.available)
            } footer: {
                Text(AppLock.available
                     ? "Asks for Face ID or the passcode when the app is opened after a minute away. The app switcher never shows the books."
                     : "Set a passcode on this phone to lock the app.")
            }

            Section {
                LabeledContent("Home-screen widget", value: widgetLinked ? "Linked" : "Not linked")
                if ERPWidgetLink.all().count > 1 {
                    LabeledContent("Businesses on the widget", value: ERPWidgetLink.all().map(\.name).joined(separator: ", "))
                }
                NavigationLink(value: Route(path: "/app/widgets")) {
                    Label("Preview widgets", systemImage: "rectangle.on.rectangle")
                }
                Button(linking ? "Linking…" : widgetLinked ? "Link again" : "Link the widget") {
                    Task {
                        linking = true
                        linkFailed = !(await WidgetLinker.link(force: true))
                        widgetLinked = ERPWidgetLink.entry(for: House.id) != nil
                        linking = false
                    }
                }
                .disabled(linking)
                if linkFailed {
                    Text("Couldn't reach the ERP to link the widget. The widget keeps its current link.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } footer: {
                Text("Add it from the home screen: touch and hold, then Edit → Add Widget → ERP. Touch and hold the widget, then Edit Widget, to choose the business it shows. \(House.storeName) is linked when you sign in to it.")
            }

            if AppIcon.supported {
                Section {
                    Picker("App icon", selection: Binding(get: { iconMode }, set: { chooseIcon($0) })) {
                        Text("ERP").tag(AppIcon.Mode.erp.rawValue)
                        Text("Follow the business").tag(AppIcon.Mode.follow.rawValue)
                        Text("Taheri").tag(AppIcon.Mode.taheri.rawValue)
                        Text("House of Mina").tag(AppIcon.Mode.mina.rawValue)
                    }
                    .disabled(iconBusy)
                    if iconMode == AppIcon.Mode.follow.rawValue, AppIcon.currentArt != AppIcon.art(for: House.business) {
                        Button("Change the icon to \(House.business.name)") { chooseIcon(AppIcon.Mode.follow.rawValue, force: true) }
                            .disabled(iconBusy)
                    }
                    if let iconError { Text(iconError).font(.footnote).foregroundStyle(Tone.problem.color) }
                } header: {
                    LedgerHeading(title: "App icon")
                } footer: {
                    Text("Following the business changes the icon to the open business's when you choose it here. iOS shows an alert each time the icon changes, so switching business never changes it on its own.")
                }
            }
            }
            .houseRows()
        }
        .navigationTitle("This phone")
        .task { await refresh() }
        .onChange(of: Push.shared.registeredOnServer) { _, linked in
            if linked { Task { await refresh() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refresh() } }
        }
    }

    /// One business's line: its push state on this phone.
    private func businessPush(_ b: Business) -> some View {
        let signedIn = Businesses.shared.auth(for: b)?.currentUser != nil
        return HStack(spacing: 12) {
            BusinessBadge(business: b, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(b.displayName).lineLimit(1)
                if b.id == House.id { Text("Open now").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            // Linked is the normal state and says nothing (rule 15); only what is not linked gets a word.
            if !signedIn {
                Pill("Signed out", tone: .quiet)
            } else if !(b.id == House.id && Push.shared.registeredOnServer) {
                switch Push.shared.states[b.id] {
                case .linked?: EmptyView()
                case .failed?: Pill("Not linked", tone: .problem, symbol: "bell.slash")
                case nil: Pill("Not linked yet", tone: .owed)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func chooseIcon(_ raw: String, force: Bool = false) {
        guard force || raw != iconMode else { return }
        let mode = AppIcon.Mode(rawValue: raw) ?? .erp
        iconBusy = true
        iconError = nil
        Task {
            do {
                try await AppIcon.apply(mode)
                iconMode = mode.rawValue
            } catch { iconError = "The icon didn't change: \(error.localizedDescription)" }
            iconBusy = false
        }
    }

    private func binding(_ kind: String) -> Binding<Bool> {
        Binding(get: { !off.contains(kind) }, set: { on in
            var next = off
            if on { next.remove(kind) } else { next.insert(kind) }
            Task { await save(next) }
        })
    }

    private func refresh() async {
        allowed = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        // Coming back to the app re-reads quietly: the switches stay up while asking, and only a decided answer
        // changes them (a failed read keeps what was shown, with the error).
        if allowed == .authorized || allowed == .provisional || allowed == .ephemeral {
            do {
                off = Set(try await Push.shared.kindsOff())
                loaded = true
                error = nil
            } catch { self.error = error.localizedDescription }
        } else {
            loaded = false
            error = nil
        }
        do {
            let data = try await ERPAPI.shared.data("/api/push/key")
            let status = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            providerStatus = status["readable"] as? Bool == true ? "Shop's Apple push key is configured."
                : status["set"] as? Bool == true ? "Shop's Apple push key needs attention in Settings → Notifications."
                : "Shop's Apple push key hasn't been configured in Settings → Notifications."
        } catch { providerStatus = "Couldn't check the shop's Apple push configuration." }
    }

    private func save(_ next: Set<String>) async {
        let before = off
        off = next
        saving = true
        error = nil
        do {
            try await Push.shared.setKindsOff(Array(next).sorted())
        } catch {
            off = before
            self.error = error.localizedDescription
        }
        saving = false
    }
}
