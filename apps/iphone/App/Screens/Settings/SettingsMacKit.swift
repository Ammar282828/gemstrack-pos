import SwiftUI

/// The Mac's settings pages (docs/features/mac-app.md): every settings page is a grouped form (System Settings' look),
/// at a width a form reads at, centred in the window. The iPhone's pages are not touched: off the Mac every call here
/// returns the view as it was.
extension View {
    /// A settings page on the Mac: `.formStyle(.grouped)` on the house's ground, at a reading width of 760 pt, centred.
    @ViewBuilder
    func macSettingsPage() -> some View {
        #if os(macOS)
        self.formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .background(Theme.ground)
        #else
        self
        #endif
    }
}

extension View {
    /// A sheet's size on the Mac (a phone sheet sizes itself).
    @ViewBuilder
    func macSheetSize(minWidth: CGFloat, minHeight: CGFloat) -> some View {
        #if os(macOS)
        self.frame(minWidth: minWidth, minHeight: minHeight)
        #else
        self
        #endif
    }

    /// A row's right-click menu with one destructive action (a Form on the Mac has no swipe).
    @ViewBuilder
    func macRemoveMenu(_ title: String, _ remove: @escaping () -> Void) -> some View {
        #if os(macOS)
        self.contextMenu { Button(title, systemImage: "trash", role: .destructive, action: remove) }
        #else
        self
        #endif
    }
}

#if os(macOS)
/// A sheet's footer on the Mac: Cancel (Esc) and the one action (Return), as every Mac dialog has them.
struct MacSheetFooter: View {
    let confirm: String
    var cancel = "Cancel"
    var busy = false
    var disabled = false
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Spacer()
                Button(cancel, role: .cancel, action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button(action: onConfirm) {
                    if busy { ProgressView().controlSize(.small) } else { Text(confirm) }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(disabled || busy)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }
}
#endif
