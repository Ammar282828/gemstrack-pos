import SwiftUI

/// Visitors and Live have two sources where the house's public store is Shopify (House of Mina; docs/decisions.md "Shopify
/// analytics (House of Mina)"): the Shopify store's own analytics, and the catalogue's counters. This is their route: the
/// catalogue screen alone where the house has no Shopify analytics, otherwise a "Shopify / Catalogue" switch above whichever
/// is chosen, remembered per page on this device (the web keeps `erp.websiteView.<page>` too; Shopify is the first).
///
/// Whether the house has Shopify analytics: `session.shop.shopifyAnalytics` (/api/app/me), when the ERP says it. Until it does,
/// an owner's phone asks the route itself once (200: yes, 404: no), and keeps the answer per business; staff, whom the route
/// refuses either way, see the catalogue.
struct ShopifySwitchHost<Catalogue: View, Shopify: View>: View {
    private enum Mode: String { case shopify, catalogue }
    private enum Probe: String { case unknown, checking, yes, no }

    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    let page: String
    let catalogue: () -> Catalogue
    let shopify: () -> Shopify
    @State private var mode: Mode
    @State private var probe: Probe

    private static var probeKey: String { BizKey("erp.shopifyAnalytics.available") }

    init(page: String, @ViewBuilder catalogue: @escaping () -> Catalogue, @ViewBuilder shopify: @escaping () -> Shopify) {
        self.page = page
        self.catalogue = catalogue
        self.shopify = shopify
        let saved = UserDefaults.standard.string(forKey: BizKey("erp.websiteView." + page))
        _mode = State(initialValue: saved == Mode.catalogue.rawValue ? .catalogue : .shopify)
        let known = UserDefaults.standard.string(forKey: Self.probeKey)
        _probe = State(initialValue: known == "1" ? .yes : (known == "0" ? .no : .unknown))
    }

    /// The ERP's word if it sent one, else what the probe found.
    private var available: Bool {
        if let flag = session.shop.shopifyAnalytics { return flag }
        return probe == .yes
    }

    /// An owner's phone that has not yet found out: the first look is a skeleton rather than the catalogue flashing by.
    private var waiting: Bool {
        session.shop.shopifyAnalytics == nil && session.isOwner && (probe == .unknown || probe == .checking) && !probeFailed
    }

    @State private var probeFailed = false

    var body: some View {
        inner
            .safeAreaInset(edge: .top, spacing: 0) {
                if available { switchBar }
            }
            .task { await findOut() }
            .onChange(of: mode) { _, new in
                UserDefaults.standard.set(new.rawValue, forKey: BizKey("erp.websiteView." + page))
            }
    }

    @ViewBuilder
    private var inner: some View {
        if available && mode == .shopify {
            shopify()
        } else if waiting {
            SkeletonPage(shape: .figures)
        } else {
            catalogue()
        }
    }

    private var switchBar: some View {
        let choice = Binding<Mode>(get: { mode }, set: { (m: Mode) in
            Motion.run(reduce: reduceMotion) { mode = m }
        })
        return Group {
            if typeSize.isAccessibilitySize {
                Picker("Source", selection: choice) {
                    Text("Shopify").tag(Mode.shopify)
                    Text("Catalogue").tag(Mode.catalogue)
                }
                .pickerStyle(.menu)
            } else {
                Picker("Source", selection: choice) {
                    Text("Shopify").tag(Mode.shopify)
                    Text("Catalogue").tag(Mode.catalogue)
                }
                .pickerStyle(.segmented)
            }
        }
        .labelsHidden()
        .selectionFeedback(trigger: mode)
        .padding(.horizontal, pt(16))
        .padding(.vertical, pt(8))
        .frame(maxWidth: .infinity)
        .background(Theme.ground)
    }

    /// One look at the route, only where the ERP has not said and the answer is not known: 200 is yes, 404 no. A failed look
    /// (no line, a slow Shopify) is not an answer: the catalogue shows and the next visit asks again.
    private func findOut() async {
        guard session.shop.shopifyAnalytics == nil, session.isOwner, probe == .unknown else { return }
        probe = .checking
        do {
            _ = try await ERPAPI.shared.data("/api/website/shopify-analytics/live")
            UserDefaults.standard.set("1", forKey: Self.probeKey)
            probe = .yes
        } catch let e as ERPAPI.Failure where e.status == 404 {
            UserDefaults.standard.set("0", forKey: Self.probeKey)
            probe = .no
        } catch {
            probe = .unknown
            probeFailed = true
        }
    }
}

/// Website → Visitors.
struct WebsiteVisitorsHost: View {
    var body: some View {
        ShopifySwitchHost(page: "visitors", catalogue: { WebsiteInterestScreen() }, shopify: { ShopifyVisitorsView() })
    }
}

/// Website → Visitors → Live.
struct WebsiteLiveHost: View {
    var body: some View {
        ShopifySwitchHost(page: "live", catalogue: { WebsiteLiveScreen() }, shopify: { ShopifyLiveView() })
    }
}
