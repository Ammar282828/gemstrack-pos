import SwiftUI

/// The actual widget faces, shown with explicitly labelled examples before adding one to the home screen.
struct WidgetPreviewScreen: View {
    private enum Look: String, CaseIterable, Identifiable {
        case light = "Light", dark = "Dark", tinted = "Tinted"
        var id: Self { self }
    }

    @State private var look: Look = .light
    private var summary: ERPSummary { .sample(house: House.storeName) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                content(width: geometry.size.width)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
            }
        }
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle("Widgets")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(width: CGFloat) -> some View {
        let column = min(340, max(0, width - 40))
        return VStack(alignment: .leading, spacing: 24) {
            intro
            Picker("Appearance", selection: $look) {
                ForEach(Look.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 340)
            if width >= 584 {
                HStack(alignment: .top, spacing: 24) {
                    preview("Small", size: .small, width: 160, height: 160)
                    preview("Medium", size: .medium, width: 340, height: 160)
                }
            } else {
                preview("Small", size: .small, width: 160, height: 160)
                preview("Medium", size: .medium, width: column, height: 160)
            }
            preview("Large", size: .large, width: column, height: 354)
            if width >= 740 {
                preview("Extra large · iPad", size: .extraLarge, width: 700, height: 354)
            }
            footer
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Sample figures and message", systemImage: "eye")
                .font(.subheadline.weight(.semibold))
            Text("These are examples, not your shop’s numbers.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var footer: some View {
        Text(look == .tinted
             ? "Tinted is an approximation; the home screen applies your chosen tint. Your widget shows the shop’s actual revenue and pinned message after it is linked."
             : "Your home-screen widget shows the shop’s actual revenue and pinned message after it is linked.")
            .font(.footnote).foregroundStyle(.secondary)
    }

    private func preview(_ title: String, size: ERPWidgetSize, width: CGFloat, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium))
            card(size: size, width: width, height: height)
        }
    }

    private func card(size: ERPWidgetSize, width: CGFloat, height: CGFloat) -> some View {
        ERPWidgetFace(summary: summary, size: size, look: ERPWidgetLook(House.business), accented: look == .tinted)
            .padding(16)
            .frame(width: width, height: height)
            .background { backdrop }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, look == .light ? .light : .dark)
            // A real widget's text stops growing about here; past it the fixed-size preview would clip.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Sample widget")
    }

    @ViewBuilder private var backdrop: some View {
        if look == .tinted {
            Color(white: 0.15)
        } else {
            ERPWidgetPaper(look: ERPWidgetLook(House.business))
        }
    }
}
