import SwiftUI
import UIKit
import ERPCore

// What New ad, the ad set designer, Audiences, Rules and Setup share on the phone: the routes they call (the
// web's own, src/app/api/ads/**, gated to owners and marketing accounts by adsGate), the one photo upload,
// and the panels shown instead of a page that can't work yet. Meta is never called from the phone.

/// A query value of an ERP path ("/ads/new?piece=Rings%2FDSC0912.webp" → "Rings/DSC0912.webp").
enum AdsQuery {
    static func value(_ name: String, in path: String) -> String? {
        let v = URLComponents(string: path)?.queryItems?.first { (q: URLQueryItem) in q.name == name }?.value
        return (v ?? "").isEmpty ? nil : v
    }

    static func escape(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
}

extension AdsAPI {
    // MARK: The account

    static func status() async throws -> AdsStatusAnswer {
        try await ERPAPI.shared.get("/api/ads/status", as: AdsStatusAnswer.self)
    }

    // MARK: New ad and the ad set designer

    /// What New ad offers in this house: goals and buttons in the web's words, the links, the quiet days ahead.
    static func newAdLists() async throws -> AdsNewAdLists {
        try await ERPAPI.shared.get("/api/ads/plan", as: AdsNewAdLists.self)
    }

    /// What stops the ad and what it will do and cost (planSummary), before anything is made.
    static func check(plan: [String: Any]) async throws -> AdsPlanCheck {
        try await ERPAPI.shared.post("/api/ads/plan", ["plan": plan], as: AdsPlanCheck.self)
    }

    static func check(design: [String: Any]) async throws -> AdsDesignCheck {
        try await ERPAPI.shared.post("/api/ads/plan", ["design": design], as: AdsDesignCheck.self)
    }

    /// Campaign → ad set → ad, paused or live as the plan says (/api/ads/create, which checks the plan again,
    /// deletes a half-made campaign on any failure and records it in `ads_log`). Meta can take a while.
    static func create(plan: [String: Any]) async throws -> AdsMade {
        let d = try await ERPAPI.shared.data("/api/ads/create", method: "POST", json: ["plan": plan], timeout: 130)
        return try JSONDecoder().decode(AdsMade.self, from: d)
    }

    static func adsetsInfo(campaign: String?, from: String?) async throws -> AdsAdsetsInfo {
        var path = "/api/ads/adsets"
        if let from { path += "?from=\(AdsQuery.escape(from))" } else if let campaign { path += "?campaign=\(AdsQuery.escape(campaign))" }
        return try await ERPAPI.shared.get(path, as: AdsAdsetsInfo.self)
    }

    static func makeAdsets(design: [String: Any]) async throws -> AdsDesignMade {
        let d = try await ERPAPI.shared.data("/api/ads/adsets", method: "POST", json: ["design": design], timeout: 130)
        return try JSONDecoder().decode(AdsDesignMade.self, from: d)
    }

    static func media(after: String?) async throws -> AdsMediaAnswer {
        try await ERPAPI.shared.get("/api/ads/media" + (after.map { (a: String) in "?after=\(AdsQuery.escape(a))" } ?? ""), as: AdsMediaAnswer.self)
    }

    static func library(after: String?) async throws -> AdsLibraryAnswer {
        try await ERPAPI.shared.get("/api/ads/library" + (after.map { (a: String) in "?after=\(AdsQuery.escape(a))" } ?? ""), as: AdsLibraryAnswer.self)
    }

    /// A website piece's photo into the ad account's library: the server fetches it from the house's own site.
    static func image(pieceId: String) async throws -> AdsImageAnswer {
        try await ERPAPI.shared.post("/api/ads/images", ["pieceId": pieceId], as: AdsImageAnswer.self)
    }

    static func preview(plan: [String: Any]) async throws -> [AdsPreview] {
        try await ERPAPI.shared.post("/api/ads/preview", ["plan": plan], as: AdsPreviewAnswer.self).previews
    }

    static func template(ad: String) async throws -> AdsTemplate {
        try await ERPAPI.shared.get("/api/ads/template?ad=\(AdsQuery.escape(ad))", as: AdsTemplate.self)
    }

    // MARK: Who sees it

    static func places(_ q: String) async throws -> [AdsPlace] {
        try await ERPAPI.shared.get("/api/ads/search?type=place&q=\(AdsQuery.escape(q))", as: AdsSearchResults<AdsPlace>.self).results
            .filter { (p: AdsPlace) in !p.key.isEmpty }
    }

    static func interests(_ q: String) async throws -> [AdsInterestHit] {
        try await ERPAPI.shared.get("/api/ads/search?type=interest&q=\(AdsQuery.escape(q))", as: AdsSearchResults<AdsInterestHit>.self).results
            .filter { (i: AdsInterestHit) in !i.id.isEmpty }
    }

    static func suggestions(_ names: [String]) async throws -> [AdsInterestHit] {
        let list = AdsQuery.escape(names.joined(separator: ","))
        return try await ERPAPI.shared.get("/api/ads/search?type=suggest&names=\(list)", as: AdsSearchResults<AdsInterestHit>.self).results
            .filter { (i: AdsInterestHit) in !i.id.isEmpty }
    }

    static func estimate(_ draft: AdsAudience, goal: String) async throws -> AdsEstimate {
        try await ERPAPI.shared.post("/api/ads/estimate", ["draft": draft.json, "goal": goal], as: AdsEstimate.self)
    }

    // MARK: Audiences, rules, setup, the pixel

    static func audiences() async throws -> AdsAudiencesAnswer {
        try await ERPAPI.shared.get("/api/ads/audiences", as: AdsAudiencesAnswer.self)
    }

    static func makeAudience(_ body: [String: Any]) async throws -> AdsAudienceMade {
        let d = try await ERPAPI.shared.data("/api/ads/audiences", method: "POST", json: body, timeout: 130)
        return try JSONDecoder().decode(AdsAudienceMade.self, from: d)
    }

    static func deleteAudience(_ id: String) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/audiences?id=\(AdsQuery.escape(id))", method: "DELETE")
    }

    static func rules() async throws -> AdsRulesAnswer {
        try await ERPAPI.shared.get("/api/ads/rules", as: AdsRulesAnswer.self)
    }

    static func makeRule(kind: String, amount: Double) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/rules", ["kind": kind, "amount": amount])
    }

    static func setRule(_ id: String, enabled: Bool) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/rules", ["id": id, "enabled": enabled])
    }

    static func deleteRule(_ id: String) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/rules?id=\(AdsQuery.escape(id))", method: "DELETE")
    }

    static func setupAssets() async throws -> AdsSetupAssets {
        try await ERPAPI.shared.get("/api/ads/setup", as: AdsSetupAssets.self)
    }

    /// Saves part of this house's settings (the ad account, Page, Instagram, greeting, login configuration).
    static func saveSetup(_ patch: [String: Any]) async throws -> AdsSettingsRow? {
        try await ERPAPI.shared.post("/api/ads/setup", patch, as: AdsSettingsSaved.self).settings
    }

    static func disconnect() async throws {
        _ = try await ERPAPI.shared.send("/api/ads/setup", ["action": "disconnect"])
    }

    static func pixel() async throws -> AdsPixelAnswer {
        try await ERPAPI.shared.get("/api/ads/pixel", as: AdsPixelAnswer.self)
    }

    /// Choose a pixel (nil: stop using one) or make a new one ("create"), then read the pixel again.
    static func pixel(_ body: [String: Any]) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/pixel", body)
    }

    // MARK: A photo from this phone

    /// A photo from this phone into the ad account's picture library, through the web's own route
    /// (/api/ads/images, a form with `file`; the server makes it a JPEG of at most 2048 px and hands it to
    /// Meta, which answers with the hash the ad names). ERPAPI sends JSON only, so this one form post is made
    /// here under ERPAPI's own guards: the house's ERP over https and nowhere else, the sign-in token, no
    /// redirect off the host (StayOnHost), and no cookie or cache kept.
    static func upload(_ jpeg: Data, token: String?) async throws -> AdsImageAnswer {
        if House.isDemo { throw ERPAPI.Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        guard let url = URL(string: "/api/ads/images", relativeTo: House.serverURL)?.absoluteURL,
              url.scheme == "https", url.host == House.serverURL.host else {
            throw ERPAPI.Failure(status: 0, message: "Not an address of this ERP.")
        }
        let boundary = "ERP-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body
        let (data, response) = try await uploads.data(for: request, delegate: StayOnHost.shared)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw ERPAPI.Failure(status: status, message: said ?? "The ERP answered \(status).")
        }
        let answer = try JSONDecoder().decode(AdsImageAnswer.self, from: data)
        if answer.hash.isEmpty { throw ERPAPI.Failure(status: status, message: "Meta took the photo but gave no reference for it.") }
        return answer
    }

    private static let uploads: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()
}

/// A picked photo made ready to send: turned upright and to a JPEG no bigger than Meta is sent (2048 px, the
/// server's own limit), so a HEIC or a 48-megapixel shot never travels whole.
enum AdsPhotoCodec {
    static let longestEdge: CGFloat = 2048

    static func jpeg(from image: UIImage) -> Data? {
        let side = max(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let scale = min(1, longestEdge / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return small.jpegData(compressionQuality: 0.92)
    }

    /// A small copy to show in the list while the photo goes to Meta.
    static func thumbnail(from image: UIImage) -> Data? {
        let side = max(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let scale = min(1, 240 / side)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return small.jpegData(compressionQuality: 0.7)
    }
}

/// Instead of a page that can't work yet (ads-kit.tsx NotReady): what's missing, and the way to Setup.
struct AdsNotReady: View {
    let status: AdsStatusAnswer?
    let problem: String?
    let retry: () async -> Void

    var body: some View {
        if let problem {
            ContentUnavailableView {
                Label("Ads aren't ready", systemImage: "megaphone")
            } description: {
                Text(problem)
            } actions: {
                Button("Try again") { Task { await retry() } }.buttonStyle(.glass)
            }
        } else if let status {
            ContentUnavailableView {
                Label(title(status), systemImage: "powerplug")
            } description: {
                Text(detail(status))
            } actions: {
                NavigationLink(value: Route(path: "/ads/setup")) { Text("Open Setup") }.buttonStyle(.glass)
            }
        } else {
            ProgressView("Checking the Meta connection…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func title(_ s: AdsStatusAnswer) -> String {
        guard let app = s.app, app.id != nil, app.secret else { return "Meta ads aren't set up for this shop yet" }
        guard let conn = s.connection else { return "Connect the shop's Meta ad account" }
        if !conn.connected { return "The Meta connection needs renewing" }
        return "Choose the ad account for this shop"
    }

    private func detail(_ s: AdsStatusAnswer) -> String {
        guard let app = s.app, app.id != nil, app.secret else { return "A couple of one-time steps on Setup, then one tap to connect." }
        guard let conn = s.connection else { return "On Setup: log in to Facebook as the person who runs the ads and approve." }
        if !conn.connected { return conn.error ?? "Connect again on Setup." }
        return "Pick the ad account, Page and Instagram account on Setup."
    }
}

/// The account's own trouble (payment due, disabled), its spending limit, and a login running out (ads-kit.tsx
/// AccountAlerts), as a section at the top of a page. Nothing when all is well.
struct AdsAlertsSection: View {
    let status: AdsStatusAnswer

    private struct Item: Identifiable {
        let bad: Bool
        let text: String
        var id: String { text }
    }

    private var items: [Item] {
        var out: [Item] = []
        if let a = status.account {
            let s = AdsStatusWords.ofAccount(a.status)
            if s.tone != .good {
                out.append(Item(bad: s.tone == .bad, text: "\(a.name): \(s.label). \(AdsStatusWords.accountFix(a.status) ?? "")"))
            }
            if let cap = a.spendCap, cap > 0, a.amountSpent >= cap * 0.9 {
                out.append(Item(bad: false, text: "The account has spent \(Int((a.amountSpent / cap * 100).rounded()))% of its spending limit. Ads stop when it reaches it: raise it in Ads Manager → Payment settings."))
            }
        }
        if let days = status.connection?.daysLeft, status.connection?.kind == "user", days <= 10 {
            let when = days <= 0 ? "less than a day" : "\(days) day\(days == 1 ? "" : "s")"
            out.append(Item(bad: days <= 3, text: "The Meta connection runs out in \(when). Connect again on Setup to keep the Ads pages working (running ads are not affected)."))
        }
        if let e = status.accountError { out.append(Item(bad: true, text: "Meta didn't answer for the ad account: \(e)")) }
        return out
    }

    var body: some View {
        let list = items
        if !list.isEmpty {
            Section {
                ForEach(list) { (i: Item) in
                    Label(i.text, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(i.bad ? Color.red : Color.orange)
                }
            }
        }
    }
}

/// What stops a plan, as the server said it.
struct AdsProblemsSection: View {
    let problems: [String]
    /// A problem that names Setup links there.
    var setup = true

    var body: some View {
        if !problems.isEmpty {
            Section {
                ForEach(problems, id: \.self) { (p: String) in
                    Label(p, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                }
                if setup, problems.contains(where: { (p: String) in p.contains("Setup") }) {
                    MarketingLink(title: "Open Setup", symbol: "slider.horizontal.3", path: "/ads/setup")
                }
            } header: {
                Text("Before it can be made")
            }
        }
    }
}

/// An amount typed in the account's money ("1,500" → 1500): nil unless above zero.
enum AdsAmount {
    static func parse(_ text: String) -> Double? {
        guard let v = PaymentText.amount(text), v > 0 else { return nil }
        return v
    }

    static func field(_ v: Double) -> String { v > 0 ? PaymentText.field(v) : "" }
}
