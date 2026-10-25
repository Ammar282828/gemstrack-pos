import AppIntents
import SwiftUI
import WidgetKit

/// A Control Center button (and a Lock Screen one) that opens the ERP listening: the same request as Siri's
/// (Shared/VoiceLaunch.swift), which opens the app and leaves the request RootView answers.
struct ERPVoiceControl: ControlWidget {
    static let kind = "shop.taheri.erp.voice"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenERPVoiceIntent()) {
                Label("Talk to ERP", systemImage: "mic.fill")
            }
        }
        .displayName("Talk to ERP")
        .description("Opens the ERP listening.")
    }
}
