import SwiftUI

// One face for the ERP (owner, 2026-11-06: "change the font to a nice professional one"; the web went to Inter that day,
// docs/decisions.md#fonts). Inter is bundled as four faces of one family (Resources/Fonts/Inter-Regular, -Medium, -SemiBold, -Bold.ttf,
// cut from the web's variable file so `.weight()` picks a real face; tabular digits kept for `.monospacedDigit()`), listed in Info.plist's UIAppFonts and found on the Mac through
// ATSApplicationFontsPath. It replaces the New York serif the headings and money figures wore, and the system face of the
// text styles. `relativeTo:` keeps Dynamic Type: a reader's larger text scales Inter as it scaled San Francisco.
extension Font {
    /// Inter at a text style's size, scaled with Dynamic Type. A headline is semibold, as the system's is.
    static func house(_ style: Font.TextStyle) -> Font {
        let face = Font.custom("Inter", size: HouseFont.size(style), relativeTo: style)
        return style == .headline ? face.weight(.semibold) : face
    }

    /// Inter at a fixed size (a monogram, a figure drawn to a frame).
    static func house(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom("Inter", fixedSize: size).weight(weight)
    }
}

/// The point sizes the system gives each text style at the default reading size (iOS, and the Mac's smaller ones).
enum HouseFont {
    static func size(_ style: Font.TextStyle) -> CGFloat {
        #if os(macOS)
        switch style {
        case .largeTitle: return 26
        case .title: return 22
        case .title2: return 17
        case .title3: return 15
        case .headline: return 13
        case .body: return 13
        case .callout: return 12
        case .subheadline: return 11
        case .footnote: return 10
        case .caption: return 10
        case .caption2: return 10
        default: return 13
        }
        #else
        switch style {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline: return 17
        case .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 13
        case .caption: return 12
        case .caption2: return 11
        default: return 17
        }
        #endif
    }
}

#if os(iOS)
extension HouseFont {
    /// UIKit draws the navigation bar's titles itself: Inter there too, scaled with the reader's text size.
    @MainActor static func dressBars() {
        guard let semi = UIFont(name: "Inter-SemiBold", size: 17), let bold = UIFont(name: "Inter-Bold", size: 34) else { return }
        let bar = UINavigationBar.appearance()
        bar.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: semi)]
        bar.largeTitleTextAttributes = [.font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: bold)]
    }
}
#endif
