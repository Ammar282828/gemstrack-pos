import SwiftUI

/// The ERP asks for a newer build than this one (`APP_MIN_BUILD`, Business.needsUpdate): money screens stay shut
/// and say why, quietly. Read where it is drawn, so a business switch to one with another floor shows at once.
enum UpdateGate {
    static var blocked: Bool { Businesses.shared.current.needsUpdate }
    static let words = "This app is out of date: update it from TestFlight."

    /// For a money write that has no Save button of its own to switch off.
    static func refuse() throws {
        if blocked { throw ERPAPI.Failure(status: 426, message: words) }
    }
}

/// One quiet line, nothing when the app is current.
struct UpdateBanner: View {
    var body: some View {
        if UpdateGate.blocked {
            Label(UpdateGate.words, systemImage: "arrow.down.circle")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Tone.owed.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)
                .accessibilityElement(children: .combine)
        }
    }
}
