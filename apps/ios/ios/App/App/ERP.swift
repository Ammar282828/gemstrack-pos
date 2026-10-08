import UIKit
import WebKit
import Capacitor
import AuthenticationServices
import CryptoKit
import Speech
import AVFoundation

/// The ERP's iPhone shell: Capacitor's view controller, which opens the live ERP
/// (capacitor.config.json server.url), with the ERP's own native pieces registered.
/// apps/ios/README.md has the why of each.
class ERPViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ERPNativePlugin())
        // Swipe in from the left edge to go back, as in Safari.
        webView?.allowsBackForwardNavigationGestures = true
    }
}

/// What the page asks of the phone, as `Capacitor.nativePromise('ERPNative', …)`
/// (src/lib/native-app.ts in the ERP).
@objc(ERPNativePlugin)
public class ERPNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ERPNativePlugin"
    public let jsName = "ERPNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "googleSignIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speechStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speechStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chrome", returnType: CAPPluginReturnPromise),
    ]

    private var googleClientId: String {
        (Bundle.main.object(forInfoDictionaryKey: "ERPGoogleClientID") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @objc func info(_ call: CAPPluginCall) {
        let info = Bundle.main.infoDictionary ?? [:]
        call.resolve([
            "bundleId": Bundle.main.bundleIdentifier ?? "",
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
            "googleSignIn": googleClientId.hasSuffix(".apps.googleusercontent.com"),
            "speech": true,
        ])
    }

    /// The status bar follows the ERP's palette, which is the shop's or this phone's choice and
    /// can differ from the phone's own light or dark: light text on a dark page, and the page's
    /// colour behind it and under the bounce.
    @objc func chrome(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        let color = call.getString("background").flatMap(UIColor.init(erpHex:))
        DispatchQueue.main.async {
            (self.bridge?.viewController as? CAPBridgeViewController)?.setStatusBarStyle(dark ? .lightContent : .darkContent)
            if let color = color {
                self.bridge?.viewController?.view.backgroundColor = color
                self.bridge?.webView?.backgroundColor = color
                self.bridge?.webView?.scrollView.backgroundColor = color
                if #available(iOS 15.0, *) { self.bridge?.webView?.underPageBackgroundColor = color }
            }
            call.resolve()
        }
    }

    // MARK: - Google sign-in

    /// Google refuses to sign anyone in inside an app's web view ("disallowed_useragent"), so the
    /// sign-in happens in Apple's sign-in sheet (ASWebAuthenticationSession, Safari's own engine
    /// and cookies) with the house's iOS OAuth client and PKCE, and the page gets Google's ID token
    /// back for Firebase (signInWithCredential): the same Google account, the same Firebase user,
    /// as a sign-in on the website.
    private var authSession: ASWebAuthenticationSession?

    @objc func googleSignIn(_ call: CAPPluginCall) {
        let clientId = googleClientId
        guard clientId.hasSuffix(".apps.googleusercontent.com") else {
            call.reject("Google sign-in isn't set up in this build of the app.", "not-configured")
            return
        }
        let scheme = "com.googleusercontent.apps." + clientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        let redirect = scheme + ":/oauth2redirect"
        let verifier = Self.randomURLSafe(32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomURLSafe(16)

        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        var query = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        if let hint = call.getString("loginHint"), !hint.isEmpty {
            query.append(URLQueryItem(name: "login_hint", value: hint))
        }
        url.queryItems = query
        guard let authURL = url.url else {
            call.reject("Couldn't open Google sign-in.", "failed")
            return
        }

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.authSession = nil
                if let error = error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        call.reject("Sign-in cancelled.", "cancelled")
                    } else {
                        call.reject(error.localizedDescription, "failed")
                    }
                    return
                }
                guard let callback = callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems else {
                    call.reject("No answer from Google.", "failed")
                    return
                }
                let value = { (name: String) in items.first(where: { $0.name == name })?.value }
                if let googleError = value("error") {
                    call.reject("Google said: \(googleError)", googleError == "access_denied" ? "cancelled" : "failed")
                    return
                }
                guard value("state") == state, let code = value("code") else {
                    call.reject("Google's answer didn't match this sign-in.", "failed")
                    return
                }
                Self.exchange(code: code, verifier: verifier, clientId: clientId, redirect: redirect, call: call)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("Couldn't open Google sign-in.", "failed")
            }
        }
    }

    private static func exchange(code: String, verifier: String, clientId: String, redirect: String, call: CAPPluginCall) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let form = [
            ("code", code), ("client_id", clientId), ("redirect_uri", redirect),
            ("code_verifier", verifier), ("grant_type", "authorization_code"),
        ]
        request.httpBody = form.map { "\($0.0)=\(formEncode($0.1))" }.joined(separator: "&").data(using: .utf8)
        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error = error {
                call.reject(error.localizedDescription, "network")
                return
            }
            guard let data = data,
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                call.reject("Google's answer couldn't be read.", "failed")
                return
            }
            guard let idToken = json["id_token"] as? String else {
                let why = (json["error_description"] as? String) ?? (json["error"] as? String) ?? "no token"
                call.reject("Google didn't sign you in (\(why)).", "failed")
                return
            }
            call.resolve(["idToken": idToken, "accessToken": json["access_token"] as? String ?? ""])
        }.resume()
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        let ok = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        if ok != errSecSuccess { data = Data((0..<bytes).map { _ in UInt8.random(in: 0...255) }) }
        return base64URL(data)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func formEncode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Live words

    /// The words on screen while someone speaks to the ERP (src/lib/voice/live.ts). Safari has
    /// speech recognition in the page; an app's web view does not, so the page's
    /// SpeechRecognition is this (Apple's on-device recogniser), events "speech" and "speechEnd".
    private let audioEngine = AVAudioEngine()
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?

    @objc func speechStart(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "en-IN"
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("Speech recognition is off for this app in Settings.", "not-allowed")
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("The microphone is off for this app in Settings.", "not-allowed")
                        return
                    }
                    do {
                        try self.beginSpeech(lang: lang)
                        call.resolve()
                    } catch {
                        call.reject(error.localizedDescription, "audio-capture")
                    }
                }
            }
        }
    }

    @objc func speechStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endSpeech(notify: true, error: nil)
            call.resolve()
        }
    }

    private func beginSpeech(lang: String) throws {
        endSpeech(notify: false, error: nil)
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer(),
              recognizer.isAvailable else {
            throw NSError(domain: "ERP", code: 1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition isn't available right now."])
        }
        let session = AVAudioSession.sharedInstance()
        // The page may be recording at the same time (the voice note Gemini reads): share the
        // microphone, never take it, and never end the session under it.
        if session.category != .playAndRecord {
            try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
        }
        try session.setActive(true)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if #available(iOS 16.0, *) { request.addsPunctuation = true }
        let input = audioEngine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()
        speechRequest = request
        speechTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.speechRequest === request else { return }
                if let result = result {
                    self.notifyListeners("speech", data: [
                        "transcript": result.bestTranscription.formattedString,
                        "isFinal": result.isFinal,
                    ])
                }
                if error != nil || result?.isFinal == true {
                    self.endSpeech(notify: true, error: error)
                }
            }
        }
    }

    private func endSpeech(notify: Bool, error: Error?) {
        guard speechRequest != nil else { return }
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        speechRequest?.endAudio()
        speechTask?.cancel()
        speechRequest = nil
        speechTask = nil
        guard notify else { return }
        var data: [String: Any] = [:]
        if let error = error {
            data["error"] = error.localizedDescription
        }
        notifyListeners("speechEnd", data: data)
    }
}

extension ERPNativePlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window { return window }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow }) ?? scenes.first.map { UIWindow(windowScene: $0) } ?? ASPresentationAnchor()
    }
}

extension UIColor {
    /// "#0A1111" or "#0A1111FF"; nil for anything else.
    convenience init?(erpHex: String) {
        var hex = erpHex.trimmingCharacters(in: .whitespaces)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else { return nil }
        let rgba = hex.count == 6 ? (value << 8) | 0xFF : value
        self.init(
            red: CGFloat((rgba >> 24) & 0xFF) / 255,
            green: CGFloat((rgba >> 16) & 0xFF) / 255,
            blue: CGFloat((rgba >> 8) & 0xFF) / 255,
            alpha: CGFloat(rgba & 0xFF) / 255
        )
    }
}
