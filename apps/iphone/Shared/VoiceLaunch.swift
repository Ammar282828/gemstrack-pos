#if os(iOS)
import AppIntents
import Foundation

/// "Talk to ERP" from outside the app: Siri ("Hey Siri, talk to ERP"), the Action button, Spotlight, Shortcuts and a
/// Control Center control all run this one intent. It opens the app and leaves a request that RootView answers by
/// opening the voice sheet straight into listening (behind Face ID if the app is locked, and only for an owner).
/// It lives in Shared because the control is built in the widget extension; there it is only a button, and the
/// intent runs in the app. Foundation and AppIntents only.
enum VoiceLaunch {
    static let notification = Notification.Name("erp.voice.launch")
    /// Set by the intent, cleared by RootView when it has opened the sheet (or found it may not).
    @MainActor static var requested = false
}

struct TalkToERPIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk to the ERP"
    static let description = IntentDescription("Opens the ERP listening, ready for what you want to do.")
    /// iOS 26's replacement for the deprecated `openAppWhenRun`: the app comes to the front before `perform` runs.
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        VoiceLaunch.requested = true
        NotificationCenter.default.post(name: VoiceLaunch.notification, object: nil)
        return .result()
    }
}

/// The only thing the open intent can be told to open.
enum VoiceLaunchTarget: String, AppEnum {
    case voice

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "ERP")
    static let caseDisplayRepresentations: [VoiceLaunchTarget: DisplayRepresentation] = [
        .voice: DisplayRepresentation(title: "Talk to ERP"),
    ]
}

/// What the Control Center / Lock Screen control runs. Apple's rule for a control that opens the app
/// ("Creating controls to perform actions across the system" > Open your app with a control): the button's
/// action is an intent conforming to `OpenIntent`, and the intent is a member of both the app and the widget
/// extension targets (Shared/ is in both). The system brings the app to the front, then runs `perform` in it.
struct OpenERPVoiceIntent: OpenIntent {
    static let title: LocalizedStringResource = "Talk to the ERP"

    @Parameter(title: "Target", default: .voice)
    var target: VoiceLaunchTarget

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        VoiceLaunch.requested = true
        NotificationCenter.default.post(name: VoiceLaunch.notification, object: nil)
        return .result()
    }
}
#endif
