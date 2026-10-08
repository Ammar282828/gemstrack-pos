import SwiftUI
import WebKit

/// An ERP page inside the app, for every place without a native screen yet (CONVENTIONS.md
/// rule 5). Signed in with the app's own sign-in, shown without the ERP's sidebar and top bar
/// (the page reads "ERPNative/" in the user agent), its downloads, share sheet and live words
/// handed to the phone through WebBridge — the same calls the ERP made to the Capacitor shell.
struct WebScreen: View {
    let path: String
    @State private var loading = true
    @State private var failed: String?

    var body: some View {
        ZStack {
            WebView(path: path, loading: $loading, failed: $failed)
                .ignoresSafeArea(edges: .bottom)
            if loading { ProgressView().controlSize(.large) }
            if let failed {
                ContentUnavailableView {
                    Label("Couldn't open this page", systemImage: "wifi.exclamationmark")
                } description: { Text(failed) } actions: {
                    Button("Try again") { self.failed = nil; loading = true }.buttonStyle(.glass)
                }
                .background(.background)
            }
        }
    }
}

private struct WebView: UIViewRepresentable {
    let path: String
    @Binding var loading: Bool
    @Binding var failed: String?

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
        context.coordinator.bridge = bridge
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.isInspectable = true
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
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
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

/// The view controller on top, for UIKit sheets (share, alerts, scanner).
enum Presenter {
    @MainActor static var top: UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var vc = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }
}
