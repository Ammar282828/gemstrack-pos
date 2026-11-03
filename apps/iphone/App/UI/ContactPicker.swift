import SwiftUI
import ERPCore
import Contacts
import ContactsUI
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

// Owner, 2026-11-03: "when adding numbers for any customers or karigars let me choose from contacts". A small button at the
// trailing edge of a phone field opens the system's contact picker. The picker runs out of process, so the app asks for no
// Contacts permission (the Info.plist line is only the system's courtesy). A contact with one number is picked in one tap;
// one with several shows its numbers to choose from.

/// What the picker hands back: a name and a number.
struct ContactPick {
    var name: String
    /// As the ERP keeps a number (+923001234567); the contact's own text when it is not dialable.
    var phone: String
}

extension ContactPick {
    fileprivate init(contact: CNContact, number: String) {
        let full = CNContactFormatter.string(from: contact, style: .fullName) ?? ""
        let e164 = CustomerContactLinks.e164(number)
        self.init(name: full.trimmingCharacters(in: .whitespacesAndNewlines),
                  phone: e164.isEmpty ? number.trimmingCharacters(in: .whitespacesAndNewlines) : e164)
    }
}

/// The picker's delegate. Kept alive by `ContactPickerPresenter` while the picker is up.
private final class ContactPickDelegate: NSObject, CNContactPickerDelegate {
    let done: (ContactPick?) -> Void
    init(done: @escaping (ContactPick?) -> Void) { self.done = done }

    #if os(iOS)
    func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) { choose(contact) }
    func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) { choose(contactProperty) }
    func contactPickerDidCancel(_ picker: CNContactPickerViewController) { done(nil) }
    #else
    func contactPicker(_ picker: CNContactPicker, didSelect contact: CNContact) { choose(contact) }
    func contactPicker(_ picker: CNContactPicker, didSelect contactProperty: CNContactProperty) { choose(contactProperty) }
    func contactPickerDidClose(_ picker: CNContactPicker) {}
    #endif

    func choose(_ contact: CNContact) {
        // Only chosen directly when it has exactly one number (the selection predicate); be safe anyway.
        guard let number = contact.phoneNumbers.first?.value.stringValue else { done(nil); return }
        done(ContactPick(contact: contact, number: number))
    }

    func choose(_ property: CNContactProperty) {
        guard let number = (property.value as? CNPhoneNumber)?.stringValue else { done(nil); return }
        done(ContactPick(contact: property.contact, number: number))
    }
}

#if os(iOS)
@MainActor
enum ContactPickerPresenter {
    private static var delegate: ContactPickDelegate?

    /// From whatever is on top (a sheet included), as `PDFQuickShareFiles.present` does: a representable inside a sheet breaks.
    static func present(onPick: @escaping (ContactPick) -> Void) {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController else { return }
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }

        let picker = CNContactPickerViewController()
        picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
        picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
        picker.predicateForSelectionOfContact = NSPredicate(format: "phoneNumbers.@count == 1")
        let d = ContactPickDelegate { pick in
            delegate = nil
            if let pick { onPick(pick) }
        }
        delegate = d
        picker.delegate = d
        top.present(picker, animated: true)
    }
}

/// A small borderless button for the trailing edge of a phone field.
struct ContactPickButton: View {
    let onPick: (ContactPick) -> Void

    var body: some View {
        Button {
            ContactPickerPresenter.present(onPick: onPick)
        } label: {
            Image(systemName: "person.crop.circle.badge.plus")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Choose from Contacts")
    }
}
#else
/// The Mac's picker pops over the button.
private struct ContactPickAnchor: NSViewRepresentable {
    final class Coordinator {
        var delegate: ContactPickDelegate?
        var picker: CNContactPicker?
    }
    @Binding var shown: Bool
    let onPick: (ContactPick) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        guard shown else { return }
        DispatchQueue.main.async {
            shown = false
            let coordinator = context.coordinator
            let picker = CNContactPicker()
            picker.displayedKeys = [CNContactPhoneNumbersKey]
            let d = ContactPickDelegate { pick in
                coordinator.delegate = nil
                coordinator.picker = nil
                if let pick { onPick(pick) }
            }
            coordinator.delegate = d
            coordinator.picker = picker
            picker.delegate = d
            picker.showRelative(to: view.bounds, of: view, preferredEdge: NSRectEdge.minY)
        }
    }
}

struct ContactPickButton: View {
    let onPick: (ContactPick) -> Void
    @State private var shown = false

    var body: some View {
        Button { shown = true } label: {
            Image(systemName: "person.crop.circle.badge.plus")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Choose from Contacts")
        .background(ContactPickAnchor(shown: $shown, onPick: onPick))
    }
}
#endif

extension ContactPick {
    /// Fills a phone field, and the name too when the form has an empty one: a name already typed is never overwritten.
    func fill(phone phoneField: inout String, name nameField: inout String) {
        if !phone.isEmpty { phoneField = phone }
        if let n = nameToFill(over: nameField) { nameField = n }
    }

    /// The name to write, or nil when the field already holds one (or the contact has none).
    func nameToFill(over current: String) -> String? {
        current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !name.isEmpty ? name : nil
    }
}

extension View {
    /// The phone field with the Contacts button at its trailing edge. `onPick` runs on the main actor.
    func contactPickable(_ onPick: @escaping (ContactPick) -> Void) -> some View {
        HStack(spacing: 8) {
            self
            ContactPickButton(onPick: onPick)
        }
    }
}
