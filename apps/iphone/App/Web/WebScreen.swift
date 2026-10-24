import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif

/// An ERP page inside the app, for every place without a native screen yet (CONVENTIONS.md
/// rule 5). Signed in with the app's own sign-in, shown without the ERP's sidebar and top bar
/// (the page reads "ERPNative/" in the user agent), its downloads, share sheet and live words
/// handed to the phone through WebBridge — the same calls the ERP made to the Capacitor shell.
struct WebScreen: View {
    let path: String
    @State private var loading = true
    @State private var failed: String?
    /// A link on the page to a place with a native screen: that screen, pushed over the page.
    @State private var native: Route?

    var body: some View {
        ZStack {
            WebView(path: path, loading: $loading, failed: $failed, native: $native)
                .ignoresSafeArea(edges: .bottom)
            if loading { SkeletonLoading().controlSize(.large) }
            if let failed {
                ContentUnavailableView {
                    Label("Couldn't open this page", systemImage: "wifi.exclamationmark")
                } description: { Text(failed) } actions: {
                    Button("Try again") { self.failed = nil; loading = true }.buttonStyle(.glass)
                }
                .background(.background)
            }
        }
        .navigationDestination(item: $native) { PlaceScreen(path: $0.path) }
    }

    /// Whether a link the page follows has a native screen. The page's own path never does here: it was opened as
    /// the ERP's page on purpose (`?web=1`, or no screen yet), and its tabs and filters change only its query.
    static func nativePath(_ to: String, from page: String) -> Bool {
        guard to.hasPrefix("/"), ScreenRoute.bare(to) != ScreenRoute.bare(page) else { return false }
        return ScreenRegistry.hasNative(to)
    }
}

#if os(iOS)
private struct WebView: UIViewRepresentable {
    let path: String
    @Binding var loading: Bool
    @Binding var failed: String?
    @Binding var native: Route?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "Mobile/15E148 ERPApp/2 (\(House.id)) ERPNative/1"
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let bridge = WebBridge()
        config.userContentController.addUserScript(WKUserScript(source: WebBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "erp")
        let web = WKWebView(frame: .zero, configuration: config)
        bridge.webView = web
        let page = path, go = $native
        bridge.openNative = { to in
            guard WebScreen.nativePath(to, from: page) else { return false }
            go.wrappedValue = Route(path: to)
            return true
        }
        context.coordinator.bridge = bridge
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        #if DEBUG
        web.isInspectable = true
        #endif
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        web.load(URLRequest(url: URL(string: path, relativeTo: House.serverURL)!))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        if failed == nil, loading, !web.isLoading, web.url == nil {
            web.load(URLRequest(url: URL(string: path, relativeTo: House.serverURL)!))
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "erp", contentWorld: .page)
        coordinator.bridge?.stop()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: WebView
        var bridge: WebBridge?
        init(_ parent: WebView) { self.parent = parent }

        @objc func reload(_ sender: UIRefreshControl) {
            (sender.superview?.superview as? WKWebView)?.reload()
            sender.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.loading = false
            parent.failed = error.localizedDescription
        }

        /// The ERP's own addresses stay here; any other site opens in its own app or Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let mine = url.host == House.serverURL.host || ["about", "blob", "data"].contains(url.scheme ?? "")
            if mine || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
            Self.openOutside(url)
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { Self.openOutside(url) }
            return nil
        }

        /// What leaves the ERP for another app: a web page, a call, a mail, a text or WhatsApp, as the ERP's
        /// own links are. Any other scheme (another app's private link) is never followed from a page.
        private static let outside: Set<String> = ["https", "http", "tel", "mailto", "sms", "whatsapp"]

        private static func openOutside(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), outside.contains(scheme) else { return }
            UIApplication.shared.open(url)
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == House.serverURL.host ? .grant : .prompt)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

        // The ERP's confirm() and alert() as the phone's own.
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            Presenter.top?.present(a, animated: true) ?? completionHandler(false)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            Presenter.top?.present(a, animated: true) ?? completionHandler()
        }
    }
}

#else
/// The Mac's twin of the phone's page view: the same web view, user agent and bridge in an NSView. Its differences:
/// no pull to refresh (the Mac has "Try again" and the page's own links), no "Mobile" in the user agent (a wide
/// window should get the wide page, still without the ERP's own bars), the page's alerts as the Mac's sheets, and
/// the page's file fields answered by the Mac's open panel.
private struct WebView: NSViewRepresentable {
    let path: String
    @Binding var loading: Bool
    @Binding var failed: String?
    @Binding var native: Route?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "ERPApp/2 (\(House.id)) ERPNative/1"
        config.mediaTypesRequiringUserActionForPlayback = []
        let bridge = WebBridge()
        config.userContentController.addUserScript(WKUserScript(source: WebBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "erp")
        let web = WKWebView(frame: .zero, configuration: config)
        bridge.webView = web
        let page = path, go = $native
        bridge.openNative = { to in
            guard WebScreen.nativePath(to, from: page) else { return false }
            go.wrappedValue = Route(path: to)
            return true
        }
        context.coordinator.bridge = bridge
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        #if DEBUG
        web.isInspectable = true
        #endif
        web.load(URLRequest(url: URL(string: path, relativeTo: House.serverURL)!))
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {
        if failed == nil, loading, !web.isLoading, web.url == nil {
            web.load(URLRequest(url: URL(string: path, relativeTo: House.serverURL)!))
        }
    }

    static func dismantleNSView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "erp", contentWorld: .page)
        coordinator.bridge?.stop()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: WebView
        var bridge: WebBridge?
        init(_ parent: WebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.loading = false
            parent.failed = error.localizedDescription
        }

        /// The ERP's own addresses stay here; any other site opens in its own app or the browser.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let mine = url.host == House.serverURL.host || ["about", "blob", "data"].contains(url.scheme ?? "")
            if mine || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
            Self.openOutside(url)
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { Self.openOutside(url) }
            return nil
        }

        /// Same short list as the phone's: what leaves the ERP for another app. Any other scheme is never followed.
        private static let outside: Set<String> = ["https", "http", "tel", "mailto", "sms", "whatsapp"]

        private static func openOutside(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), outside.contains(scheme) else { return }
            UIApplication.shared.open(url)
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == House.serverURL.host ? .grant : .prompt)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

        // The ERP's confirm() and alert() as the Mac's own sheet on the window (a panel when there is none).
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = NSAlert()
            alert.messageText = message
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Cancel")
            if let window = webView.window {
                alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
            } else {
                completionHandler(alert.runModal() == .alertFirstButtonReturn)
            }
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = NSAlert()
            alert.messageText = message
            alert.addButton(withTitle: "OK")
            if let window = webView.window {
                alert.beginSheetModal(for: window) { _ in completionHandler() }
            } else {
                alert.runModal()
                completionHandler()
            }
        }

        /// A file field on the page (the photos of a piece, a bill): the Mac's open panel, many files when the field allows.
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.canChooseDirectories = parameters.allowsDirectories
            if let window = webView.window {
                panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
            } else {
                completionHandler(panel.runModal() == .OK ? panel.urls : nil)
            }
        }
    }
}
#endif

#if os(iOS)
/// The view controller on top, for UIKit sheets (share, alerts, scanner).
enum Presenter {
    @MainActor static var top: UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var vc = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }
}
#endif
