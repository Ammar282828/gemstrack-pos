import SwiftUI

/// An employee's Home has no figures (decision "Staff see no money", src/components/home/staff-actions.tsx): the things she
/// does, one tap each, then the work lists below it (Dashboard). The Marketing row only for a staff member who also runs the
/// marketing (`Session.alsoMarketing`), and only the places this house has (the map's); Help always.
struct StaffActions: View {
    @Environment(Session.self) private var session

    init() {}

    fileprivate struct StaffTile: Identifiable {
        let path: String
        let title: String
        let symbol: String
        var prominent = false
        var id: String { title }
    }

    private let work: [StaffTile] = [
        StaffTile(path: "/invoices/new", title: "New sale", symbol: "plus.circle.fill", prominent: true),
        StaffTile(path: "/orders/add", title: "New order", symbol: "list.clipboard"),
        StaffTile(path: "/repairs?new=1", title: "New repair", symbol: "wrench.and.screwdriver"),
        StaffTile(path: "/scan", title: "Scan a tag", symbol: "qrcode.viewfinder"),
        StaffTile(path: "/customers/add", title: "New customer", symbol: "person.badge.plus"),
        StaffTile(path: "/workshop", title: "Workshop", symbol: "hammer"),
    ]

    private let help = StaffTile(path: "/help", title: "Help", symbol: "questionmark.circle")

    /// Add photos, Design, Stories and New ad, each only where the house's map has it for her.
    private var marketing: [StaffTile] {
        guard session.alsoMarketing else { return [] }
        let all: [StaffTile] = [
            StaffTile(path: "/website/photos", title: "Add photos", symbol: "photo.badge.plus"),
            StaffTile(path: "/design", title: "Design", symbol: "paintpalette"),
            StaffTile(path: "/posts/stories", title: "Stories", symbol: "camera"),
            StaffTile(path: "/ads/new", title: "New ad", symbol: "megaphone"),
        ]
        return all.filter { MarketingKit.has($0.path, role: session.navRole) }
    }

    private let columns = [GridItem(.adaptive(minimum: 92), spacing: 8, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: pt(14)) {
            grid(work)
            if session.alsoMarketing {
                VStack(alignment: .leading, spacing: pt(6)) {
                    DashLabel("Marketing")
                    grid(marketing + [help])
                }
            } else {
                grid([help])
            }
        }
        .ledgerCard(padding: 12)
    }

    private func grid(_ items: [StaffTile]) -> some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: 10) {
            ForEach(items) { (a: StaffTile) in tile(a) }
        }
    }

    private func tile(_ a: StaffTile) -> some View {
        NavigationLink(value: Route(path: a.path)) {
            VStack(spacing: pt(6)) {
                Image(systemName: a.symbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(a.prominent ? Theme.onAccent : Theme.accent)
                    .frame(width: 46, height: 46)
                    .background(a.prominent ? Theme.accent : Theme.accent.opacity(0.13),
                                in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                Text(a.title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.tap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .pointerHover()
    }
}
