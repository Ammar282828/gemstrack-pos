import UIKit
import WebKit

/// What an ERP page inside the app asks of the phone: the same calls it made to the Capacitor
/// shell (src/lib/native-app.ts — `Capacitor.nativePromise(plugin, method, options)` and
/// `Capacitor.addListener`), answered natively. A rejection carries "code|message", which the
/// script turns back into an Error with `.code` ("cancelled" is a person closing a sheet).
final class WebBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    private lazy var speech = SpeechEngine { [weak self] event, data in self?.emit("ERPNative", event, data) }

    static let script = """
    (() => {
      if (window.Capacitor && window.Capacitor.__erpNative) return;
      const listeners = {};
      const fail = (e) => { const m = String((e && e.message) || e); const i = m.indexOf('|'); const err = new Error(i > 0 ? m.slice(i + 1) : m); err.code = i > 0 ? m.slice(0, i) : 'failed'; throw err; };
      window.Capacitor = {
        __erpNative: true,
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        nativePromise: (plugin, method, options) => window.webkit.messageHandlers.erp.postMessage({ plugin, method, options: options || {} }).catch(fail),
        addListener: (plugin, event, cb) => {
          const k = plugin + ':' + event; (listeners[k] = listeners[k] || []).push(cb);
          return { remove: () => { listeners[k] = (listeners[k] || []).filter((f) => f !== cb); } };
        },
      };
      window.__erpEmit = (plugin, event, data) => (listeners[plugin + ':' + event] || []).slice().forEach((f) => { try { f(data); } catch (e) {} });
    })();
    """

    func stop() { speech.stop(notify: false) }

    private func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: data), let s = String(data: json, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.webView?.evaluateJavaScript("window.__erpEmit && window.__erpEmit('\(plugin)','\(event)',\(s))") }
    }

    @MainActor
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let plugin = body["plugin"] as? String, let method = body["method"] as? String else {
            return replyHandler(nil, "invalid|Not a call")
        }
        let o = body["options"] as? [String: Any] ?? [:]
        let ok: (Any?) -> Void = { replyHandler($0 ?? [String: Any](), nil) }
        let no: (String, String) -> Void = { code, msg in replyHandler(nil, "\(code)|\(msg)") }

        switch (plugin, method) {
        case ("ERPNative", "info"):
            let info = Bundle.main.infoDictionary ?? [:]
            ok(["bundleId": Bundle.main.bundleIdentifier ?? "", "version": info["CFBundleShortVersionString"] ?? "", "build": info["CFBundleVersion"] ?? "",
                "googleSignIn": true, "speech": true, "features": Self.features] as [String: Any])
        case ("ERPNative", "googleSignIn"):
            Task { @MainActor in
                do { let t = try await GoogleAuth.shared.idToken(); ok(["idToken": t.idToken, "accessToken": t.accessToken]) }
                catch let e as GoogleAuth.Failure { no(e.code, e.localizedDescription) }
                catch { no("failed", error.localizedDescription) }
            }
        case ("ERPNative", "biometry"):
            let b = FaceIDVault.biometry()
            ok(["available": b.available, "type": b.type] as [String: Any])
        case ("ERPNative", "secretSave"):
            guard let key = o["key"] as? String, let value = o["value"] as? String else { return no("invalid", "key and value are needed") }
            do { try FaceIDVault.save(value, for: key); ok(["saved": true]) }
            catch let e as FaceIDVault.Failure { no(e.code, e.message) }
            catch { no("failed", error.localizedDescription) }
        case ("ERPNative", "secretHas"):
            ok(["has": FaceIDVault.has(o["key"] as? String ?? "")])
        case ("ERPNative", "secretRead"):
            guard let key = o["key"] as? String else { return no("invalid", "key is needed") }
            Task { @MainActor in
                do {
                    // null: nothing kept on this phone (the page then asks for the code typed).
                    var out: [String: Any] = ["value": NSNull()]
                    if let v = try await FaceIDVault.read(key, reason: o["reason"] as? String ?? "Unlock") { out["value"] = v }
                    ok(out)
                }
                catch let e as FaceIDVault.Failure { no(e.code, e.message) }
                catch { no("failed", error.localizedDescription) }
            }
        case ("ERPNative", "secretDelete"):
            FaceIDVault.delete(o["key"] as? String ?? "")
            ok(nil)
        case ("ERPNative", "scanDocument"):
            Task { @MainActor in
                do {
                    let pages = try await DocumentScanner.scan()
                    ok(["pages": pages.map { ["data": $0.jpeg.base64EncodedString(), "name": $0.name] }])
                } catch let e as DocumentScanner.Failure { no(e.code, e.message) }
                catch { no("failed", error.localizedDescription) }
            }
        case ("ERPNative", "chrome"):
            ok(nil) // the app draws its own bars
        case ("ERPNative", "speechStart"):
            speech.start(lang: o["lang"] as? String ?? "en-IN") { error in error.map { no($0.0, $0.1) } ?? ok(nil) }
        case ("ERPNative", "speechStop"):
            speech.stop(notify: true); ok(nil)
        case ("Filesystem", "writeFile"):
            do { ok(["uri": try Self.write(o).absoluteString]) } catch { no("failed", error.localizedDescription) }
        case ("Filesystem", "rmdir"):
            try? FileManager.default.removeItem(at: Self.base.appendingPathComponent(o["path"] as? String ?? "shared"))
            ok(nil)
        case ("Share", "share"):
            share(o, ok: { ok(nil) }, no: no)
        default:
            no("unimplemented", "\(plugin).\(method) is not in this app")
        }
    }

    /// What this phone can do for a page, so the page can choose before a tap (a file input opened
    /// after an asynchronous call has lost the tap, and iOS refuses it).
    private static var features: [String] {
        var f = ["share", "files"]
        if DocumentScanner.isSupported { f.append("scan") }
        if FaceIDVault.biometry().available { f.append("faceID") }
        return f
    }

    // MARK: Files out

    private static var base: URL { FileManager.default.temporaryDirectory.appendingPathComponent("erp-web", isDirectory: true) }

    private static func write(_ o: [String: Any]) throws -> URL {
        let rel = (o["path"] as? String ?? "file").replacingOccurrences(of: "..", with: "")
        let url = base.appendingPathComponent(rel)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = Data(base64Encoded: o["data"] as? String ?? "") else { throw CocoaError(.fileWriteUnknown) }
        try data.write(to: url, options: .atomic)
        return url
    }

    @MainActor
    private func share(_ o: [String: Any], ok: @escaping () -> Void, no: @escaping (String, String) -> Void) {
        var items: [Any] = (o["files"] as? [String] ?? []).compactMap { URL(string: $0) }
        if let t = o["text"] as? String { items.append(t) }
        if let u = (o["url"] as? String).flatMap(URL.init(string:)) { items.append(u) }
        guard !items.isEmpty, let top = Presenter.top else { return no("failed", "Nothing to share") }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, done, _, error in
            if let error { no("failed", error.localizedDescription) } else if done { ok() } else { no("cancelled", "Share canceled") }
        }
        if let pop = sheet.popoverPresentationController { pop.sourceView = top.view; pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 60, width: 1, height: 1) }
        top.present(sheet, animated: true)
    }
}
