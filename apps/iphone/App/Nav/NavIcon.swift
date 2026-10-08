import Foundation

/// The ERP's icons (lucide) as SF Symbols. A name not here falls back to a plain square, and the
/// map is short enough to keep whole: nav-export lists every icon the ERP's map uses.
enum NavIcon {
    static let symbols: [String: String] = [
        "ArchiveRestore": "archivebox", "Banknote": "banknote", "Bell": "bell", "BookUser": "book.closed",
        "Boxes": "shippingbox", "Briefcase": "briefcase", "Calendar": "calendar", "Camera": "camera",
        "ChartColumn": "chart.bar", "ChartPie": "chart.pie", "CirclePlus": "plus.circle", "ClipboardList": "list.clipboard",
        "Coins": "dollarsign.circle", "Contact": "person.crop.rectangle", "Database": "cylinder.split.1x2", "FileClock": "doc.badge.clock",
        "Gem": "diamond", "Globe": "globe", "Hammer": "hammer", "History": "clock.arrow.circlepath",
        "House": "house", "ImagePlus": "photo.badge.plus", "Import": "square.and.arrow.down", "Landmark": "building.columns",
        "Layers": "square.3.layers.3d", "LayoutGrid": "square.grid.2x2", "ListChecks": "checklist", "Megaphone": "megaphone",
        "Mic": "mic", "Package": "shippingbox.and.arrow.backward", "Palette": "paintpalette", "PenLine": "pencil.line",
        "Plug": "powerplug", "Receipt": "receipt", "Rocket": "paperplane", "RotateCcw": "arrow.uturn.backward",
        "Scale": "scalemass", "ScanLine": "qrcode.viewfinder", "Send": "paperplane.fill", "Settings": "gearshape",
        "SlidersHorizontal": "slider.horizontal.3", "Tag": "tag", "Target": "target", "TrendingUp": "chart.line.uptrend.xyaxis",
        "Users": "person.2", "UsersRound": "person.3", "Wallet": "wallet.bifold", "Wrench": "wrench.and.screwdriver",
    ]

    static func symbol(for lucide: String?) -> String { lucide.flatMap { symbols[$0] } ?? "square" }
}
