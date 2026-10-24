import SwiftUI
import ERPCore

/// Stock › Labels (src/app/settings/printer/page.tsx; its address is still /settings/printer): the tag designer
/// (App/Screens/Settings/LabelDesigner), with Label LIVE, the printer's settings and a piece's tag as the CSV a label
/// app like WEPrint imports alongside it. The layout is the shop's (settings `labelLayout`, the same on every device);
/// owners design it, staff see it.
struct LabelSettings: View {
    var body: some View {
        LabelDesigner()
    }
}

/// Settings → WEPrint (src/app/settings/weprint-api): switched off on the web (its live feed's endpoint never
/// existed), kept so an old bookmark lands somewhere, and saying the same here.
struct WeprintSettings: View {
    var body: some View {
        Form { Group {
            Section {
                Label("WEPrint", systemImage: "printer").font(.headline)
                Text("The live feed to WEPrint isn’t set up, so this page is switched off.")
                Text("Export the pieces as CSV from Labels and import that file into WEPrint instead.")
                    .foregroundStyle(.secondary)
                NavigationLink(value: Route(path: "/settings/printer")) { Label("Open Labels", systemImage: "tag") }
            }
            }
            .houseRows()
        }
        .navigationTitle("WEPrint")
        .navigationBarTitleDisplayMode(.inline)
    }
}
