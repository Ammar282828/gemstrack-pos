import SwiftUI

// The business switcher's small parts: the badge (a business's logo or its first letter, in its own accent), and the
// chip that heads every tab root and the iPad sidebar. The sheet and the list are Screens/Settings/BusinessesScreen.swift.

/// A business's mark: its icon from its ERP when it arrives, else its first letter on its accent. Drawn from the
/// business's own palette, not `Theme`, so a business that is not open looks like itself in the list.
struct BusinessBadge: View {
    let business: Business
    var size: CGFloat = 28
    @Environment(\.colorScheme) private var scheme

    /// The ground each bundled BadgeMark-<art> is drawn on (its corner colour), so the circle and the art are one.
    private static let markGround = ["taheri": "0A1111", "mina": "FAF7F2"]

    var body: some View {
        let side = scheme == .dark ? business.palette.dark : business.palette.light
        let accent = Color(hex: side.accent) ?? .gray
        ZStack {
            if let art = business.art, let ground = Self.markGround[art] {
                // A built-in: the bundled mark (the "t", the MINA wordmark) centred with whitespace, on its own ground so
                // the whitespace is seamless. Not scaledToFill: nothing touches the edge.
                Circle().fill(Color(hex: ground) ?? .gray)
                // Clipped to the circle, and drawn as itself: in a toolbar Menu's label an image is otherwise
                // turned into a template and painted solid, which showed as a square block (owner, 2026-10-23).
                Image("BadgeMark-\(art)").renderingMode(.original).resizable().scaledToFit().clipShape(Circle())
            } else {
                Circle().fill(accent)
                Text(business.initial)
                    .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hex: side.onAccent) ?? .white)
                if let icon = business.icon.flatMap(URL.init(string:)), icon.scheme == "https" {
                    // The ERP's icon, fitted with ~14% padding on the business's card colour.
                    let card = Color(hex: side.card) ?? accent
                    AsyncImage(url: icon) { phase in
                        if let image = phase.image {
                            image.renderingMode(.original).resizable().scaledToFit().padding(size * 0.14)
                                .frame(width: size, height: size).background(card).transition(.opacity)
                        }
                    }
                    .clipShape(Circle())
                }
            }
        }
        .frame(width: size, height: size)
        .overlay { Circle().strokeBorder(.primary.opacity(0.12), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }
}

/// A business's whole logo at the width it is given: the bundled one for a built-in, else the one its ERP serves (kept
/// on disk), else its name.
struct BusinessLogo: View {
    let business: Business
    @Environment(\.colorScheme) private var scheme
    @State private var fetched: UIImage?

    var body: some View {
        Group {
            if let art = business.art {
                Image("BrandLogo-\(art)").resizable().scaledToFit()
            } else if let fetched {
                Image(uiImage: fetched).resizable().scaledToFit()
            } else {
                Text(business.name).font(.title2.weight(.semibold)).foregroundStyle(.primary).lineLimit(1).minimumScaleFactor(0.5)
            }
        }
        .padding(.vertical, pt(4))
        .frame(maxWidth: 200, maxHeight: 56, alignment: .leading)
        .task(id: "\(business.id)|\(scheme == .dark)") {
            guard business.art == nil else { return }
            fetched = await BusinessLogos.load(business, dark: scheme == .dark)
        }
        .accessibilityLabel(business.displayName)
    }
}

/// The open business at the top of the app: its mark and name. Tap opens the Businesses sheet; touch and hold lists
/// the businesses to switch between at once. With only one business it stays, quietly (no arrows, the secondary
/// colour): it is still the way to add another.
struct BusinessChip: View {
    /// The iPad sidebar's row is wider and says the ERP's whole name.
    var wide = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let store = Businesses.shared
        let current = store.current
        let many = store.list.count > 1
        Menu {
            if many {
                ForEach(store.list) { b in
                    Button {
                        switchTo(b)
                    } label: {
                        if b.id == current.id { Label(b.displayName, systemImage: "checkmark") } else { Text(b.displayName) }
                    }
                }
                Divider()
            }
            Button("Businesses…", systemImage: "building.2") { store.switcherOpen = true }
        } label: {
            HStack(spacing: pt(6)) {
                BusinessBadge(business: current, size: wide ? 28 : 22)
                if wide {
                    Text(current.displayName).font(.headline).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(current.name).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                }
                if many {
                    Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(many ? Color.primary : Color.secondary)
            .contentShape(Rectangle())
        } primaryAction: {
            store.switcherOpen = true
        }
        .accessibilityLabel("Business: \(current.displayName)")
        .accessibilityHint(many ? "Opens the list of businesses. Touch and hold to switch." : "Opens the list of businesses, where you can add one.")
        .accessibilityIdentifier("business.chip")
    }

    private func switchTo(_ b: Business) {
        guard b.id != Businesses.shared.current.id else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        Motion.run(Motion.travel, reduce: reduceMotion) { Businesses.shared.switch(to: b.id) }
    }
}
