import SwiftUI

/// The actual widget faces, shown with explicitly labelled examples before adding one to the home screen.
struct WidgetPreviewScreen: View {
    private var summary: ERPSummary { .sample(house: House.storeName) }

    var body: some View {
      GeometryReader { geometry in
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Example figures and message").font(.subheadline).foregroundStyle(.secondary)
                if geometry.size.width >= 594 {
                    HStack(alignment: .top, spacing: 24) {
                        preview("Small", size: .small, width: 170, height: 170)
                        preview("Medium", size: .medium, width: 360, height: 170)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 24) {
                        preview("Small", size: .small, width: 170, height: 170)
                        preview("Medium", size: .medium, width: min(340, max(0, geometry.size.width - 40)), height: 170)
                    }
                }
                preview("Large", size: .large, width: min(340, max(0, geometry.size.width - 40)), height: 360)
                if geometry.size.width >= 740 {
                    preview("Extra large · iPad", size: .extraLarge, width: 700, height: 360)
                }
                Text("Your home-screen widget shows the shop’s actual revenue and pinned message after it is linked.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }
      }
        .navigationTitle("Widgets")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func preview(_ title: String, size: ERPWidgetSize, width: CGFloat, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium))
            ERPWidgetFace(summary: summary, size: size, appName: House.storeName)
                .padding(16).frame(width: width, height: height)
                .background { ERPWidgetPaper(house: summary.house) }
                .clipShape(.rect(cornerRadius: 24))
        }
    }
}
