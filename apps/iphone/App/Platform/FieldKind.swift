import SwiftUI

/// What a text field holds, for the phone's keyboard and AutoFill (`textContentType`). The Mac's text fields take another
/// type with other names, and a Mac fills nothing from it: there it says nothing.
enum FieldKind {
    case name, telephoneNumber, emailAddress, fullStreetAddress, oneTimeCode, URL

    #if os(iOS)
    var content: UITextContentType {
        switch self {
        case .name: return .name
        case .telephoneNumber: return .telephoneNumber
        case .emailAddress: return .emailAddress
        case .fullStreetAddress: return .fullStreetAddress
        case .oneTimeCode: return .oneTimeCode
        case .URL: return .URL
        }
    }
    #endif
}

extension View {
    @ViewBuilder
    func fieldKind(_ kind: FieldKind) -> some View {
        #if os(iOS)
        textContentType(kind.content)
        #else
        self
        #endif
    }
}
