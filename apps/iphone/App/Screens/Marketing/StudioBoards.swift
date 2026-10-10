import SwiftUI

/// Keep the complete shared board available while its canvas is being ported.
struct StudioBoards: View {
    let model: StudioModel
    var body: some View { WebScreen(path: "/ads/studio?v=board&web=1") }
}
