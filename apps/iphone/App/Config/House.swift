import Foundation
import FirebaseCore

/// Which house this build is, from Info.plist (written from apps/iphone/houses.json).
enum House {
    private static func value(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "").trimmingCharacters(in: .whitespaces)
    }

    static let id = value("ERPHouse").isEmpty ? "taheri" : value("ERPHouse")
    static let storeName = value("ERPStoreName")
    static let serverURL = URL(string: value("ERPServerURL")) ?? URL(string: "https://erp.taheri.shop")!
    static let metal = value("ERPMetal") == "silver" ? "silver" : "gold"
    static let googleClientID = value("ERPGoogleClientID")
    static let sharedKeychainGroup: String? = {
        let g = value("ERPSharedKeychainGroup")
        return g.isEmpty || g.hasPrefix(".") || g.contains("$(") ? nil : g
    }()

    /// Launched with `-ERPDemo YES` (the simulator check): made-up data, no sign-in, no Firebase.
    static let isDemo = UserDefaults.standard.bool(forKey: "ERPDemo")

    /// Firebase for this house's project. Nil until the house's iOS app is registered in Firebase
    /// (houses.json firebase.iosAppId): the app then says so on its sign-in screen.
    static let firebaseOptions: FirebaseOptions? = {
        let appID = value("ERPFirebaseAppID")
        guard appID.contains(":ios:") else { return nil }
        let o = FirebaseOptions(googleAppID: appID, gcmSenderID: value("ERPFirebaseSenderID"))
        o.apiKey = value("ERPFirebaseAPIKey")
        o.projectID = value("ERPFirebaseProjectID")
        o.storageBucket = value("ERPFirebaseStorageBucket")
        o.bundleID = Bundle.main.bundleIdentifier ?? ""
        return o
    }()
}
