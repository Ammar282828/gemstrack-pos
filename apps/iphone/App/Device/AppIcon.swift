import UIKit

/// The app's icon: the one app's own (AppIcon-erp, a diamond) is the primary; Taheri's and House of Mina's are alternates
/// (project.yml ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES, from houses.json). It changes only when the person asks for it in
/// Settings → This phone: iOS puts an alert up every time the icon changes, so a business switch never does it.
@MainActor
enum AppIcon {
    /// What the person chose: the app's own icon (the default), follow the open business (when they choose it), or one business's always.
    enum Mode: String { case erp, follow, taheri, mina }

    nonisolated static let modeKey = "erp.appIcon"
    private static let taheriIcon = "AppIcon-taheri"
    private static let minaIcon = "AppIcon-mina"

    /// False where the build declares no alternate: House of Mina's own (deprecated) build, whose primary icon is Mina's.
    static var supported: Bool { UIApplication.shared.supportsAlternateIcons }

    /// "erp", "taheri" or "mina": the icon showing now (the primary, AppIcon-erp, is no alternate name at all).
    static var currentArt: String {
        switch UIApplication.shared.alternateIconName {
        case minaIcon: return "mina"
        case taheriIcon: return "taheri"
        default: return "erp"
        }
    }

    /// The alternate icon name for an art: nil is the primary.
    private static func iconName(_ art: String) -> String? {
        switch art {
        case "mina": return minaIcon
        case "taheri": return taheriIcon
        default: return nil
        }
    }

    /// The icon a business wears: Mina's for the silver house's art, else Taheri's (an added business has none of its own).
    static func art(for b: Business) -> String { b.art == "mina" ? "mina" : "taheri" }

    /// Sets the icon for `mode` now (for `.follow`, the open business's), if it is not showing already.
    static func apply(_ mode: Mode) async throws {
        let art: String
        switch mode {
        case .erp: art = "erp"
        case .follow: art = Self.art(for: House.business)
        case .taheri: art = "taheri"
        case .mina: art = "mina"
        }
        if art != currentArt {
            try await UIApplication.shared.setAlternateIconName(iconName(art))
        }
        UserDefaults.standard.set(mode.rawValue, forKey: modeKey)
    }
}
