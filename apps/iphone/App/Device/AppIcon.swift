import UIKit

/// The app's icon: Taheri's is the primary, House of Mina's an alternate (project.yml
/// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES, from houses.json). It changes only when the person asks for it in
/// Settings → This phone: iOS puts an alert up every time the icon changes, so a business switch never does it.
@MainActor
enum AppIcon {
    /// What the person chose: follow the open business (when they choose it), or one of the two always.
    enum Mode: String { case follow, taheri, mina }

    nonisolated static let modeKey = "erp.appIcon"
    private static let minaIcon = "AppIcon-mina"

    /// False where the build declares no alternate: House of Mina's own (deprecated) build, whose primary icon is Mina's.
    static var supported: Bool { UIApplication.shared.supportsAlternateIcons }

    /// "mina" or "taheri": the icon showing now.
    static var currentArt: String { UIApplication.shared.alternateIconName == minaIcon ? "mina" : "taheri" }

    /// The icon a business wears: Mina's for the silver house's art, else Taheri's (an added business has none of its own).
    static func art(for b: Business) -> String { b.art == "mina" ? "mina" : "taheri" }

    /// Sets the icon for `mode` now (for `.follow`, the open business's), if it is not showing already.
    static func apply(_ mode: Mode) async throws {
        let art: String
        switch mode {
        case .follow: art = Self.art(for: House.business)
        case .taheri: art = "taheri"
        case .mina: art = "mina"
        }
        if art != currentArt {
            try await UIApplication.shared.setAlternateIconName(art == "mina" ? minaIcon : nil)
        }
        UserDefaults.standard.set(mode.rawValue, forKey: modeKey)
    }
}
