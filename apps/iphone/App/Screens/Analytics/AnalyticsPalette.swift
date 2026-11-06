import SwiftUI
import ERPCore

/// Analytics' six series colours, `--ana-1…6` of src/app/globals.css, light and dark. Colour follows the thing it stands
/// for, never its rank (22K is always the same colour), is checked for colour blindness there, and is never the tone:
/// good and bad are `Tone.settled` / `Tone.late` and nothing else (decision "Analytics redesign").
enum AbPalette {
    private static func dynamic(_ light: String, _ dark: String) -> Color {
        let l = UIColor(hex: light) ?? .gray, d = UIColor(hex: dark) ?? .gray
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? d : l })
    }

    /// 1 gold, 2 blue, 3 orange, 4 green, 5 violet, 6 pink.
    static let series: [Color] = [
        dynamic("#b07a00", "#c98500"), dynamic("#2a78d6", "#3987e5"), dynamic("#eb6834", "#d95926"),
        dynamic("#1baf7a", "#199e70"), dynamic("#6250d6", "#9085e9"), dynamic("#e87ba4", "#d55181"),
    ]

    /// The nth series colour, 1…6 (wraps).
    static func color(_ n: Int) -> Color { series[((n - 1) % 6 + 6) % 6] }

    /// A karat is always the same colour: 24k gold, 22k blue, 21k orange, 18k green, 12k violet, anything else pink.
    static func karat(_ karat: String) -> Color {
        switch karat.lowercased() {
        case "24k": return color(1)
        case "22k": return color(2)
        case "21k": return color(3)
        case "18k": return color(4)
        case "12k": return color(5)
        default: return color(6)
        }
    }

    /// A sale's source is always the same colour; Unclassified is the neutral.
    static func source(_ key: String) -> Color {
        switch key {
        case "taheri_spillover": return color(1)
        case "referral": return color(2)
        case "walkin": return color(3)
        case "social_media": return color(4)
        case "website": return color(5)
        case "other": return color(6)
        default: return Color.secondary
        }
    }

    /// Running costs, the goods, the partners' drawings.
    static func kind(_ kind: ExpenseKind) -> Color {
        switch kind {
        case .running: return color(1)
        case .goods: return color(2)
        case .drawings: return color(3)
        }
    }

    static func kindLabel(_ kind: ExpenseKind) -> String {
        switch kind {
        case .running: return "Running cost"
        case .goods: return "Goods"
        case .drawings: return "Drawings"
        }
    }

    static func kindPlural(_ kind: ExpenseKind) -> String {
        switch kind {
        case .running: return "Running costs"
        case .goods: return "Goods"
        case .drawings: return "Drawings"
        }
    }
}
