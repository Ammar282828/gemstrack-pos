import SwiftUI
import WebKit

/// How the ad will look on Instagram before anything is made: Meta's own rendering of the unsaved ad
/// (/api/ads/preview, generatepreviews), feed, story and reels, each a facebook.com frame shown as Meta draws it.
struct AdsPreviewSheet: View {
    let previews: [AdsPreview]

    @Environment(\.dismiss) private var dismiss
    @State private var chosen: String

    init(previews: [AdsPreview]) {
        self.previews = previews
        _chosen = State(initialValue: previews.first?.format ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: pt(12)) {
                if previews.count > 1 {
                    Picker("Where", selection: $chosen) {
                        ForEach(previews) { (p: AdsPreview) in Text(p.label).tag(p.format) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, pt(16))
                }
                if let p = previews.first(where: { (x: AdsPreview) in x.format == chosen }), let url = URL(string: p.src) {
                    AdsFrame(url: url)
                        .id(p.format)
                        .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                        .padding(.horizontal, pt(16))
                } else {
                    ContentUnavailableView("Meta gave no preview", systemImage: "eye.slash")
                }
            }
            .padding(.top, pt(8))
            .modifier(HouseGround())
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 760)
        #endif
    }
}

/// One of Meta's preview frames. Only Facebook's own addresses load in it; a tap that would leave them is
/// kept from opening anything.
private struct AdsFrame: MarketingWebRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func make(_ coordinator: Coordinator) -> WKWebView {
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.navigationDelegate = coordinator
        web.load(URLRequest(url: url))
        return web
    }

    #if os(iOS)
    func makeUIView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateUIView(_ web: WKWebView, context: Context) {}
    #else
    func makeNSView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateNSView(_ web: WKWebView, context: Context) {}
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let host = url.host ?? ""
            let facebook = host == "facebook.com" || host.hasSuffix(".facebook.com") || host.hasSuffix(".fbcdn.net")
            let inner = ["about", "blob", "data"].contains(url.scheme ?? "")
            decisionHandler(facebook || inner || action.targetFrame?.isMainFrame == false ? .allow : .cancel)
        }
    }
}
