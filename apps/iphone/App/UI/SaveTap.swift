import UIKit

/// The success tap for a save that leaves its sheet at once (a sheet that is closing cannot play `.savedFeedback`).
enum SaveTap {
    @MainActor static func play() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}
