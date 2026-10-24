#if os(macOS)
import AppKit
import SwiftUI

// The Mac app (docs/features/mac-app.md) compiles the iPhone's screens as they are. What UIKit names on the phone is
// AppKit's here under the phone's names, and what only a phone has (a keyboard type, a title's size, a haptic) is a
// quiet no-op, so a screen never forks for the Mac. Where the Mac does something truly different, the screen says
// `#if os(macOS)` itself; nothing in this file changes what a screen does on the iPhone, which never compiles it.

typealias UIImage = NSImage
typealias UIColor = NSColor
typealias UIFont = NSFont

extension NSImage {
    /// UIKit's `UIImage(cgImage:)`: the picture at its pixel size.
    convenience init(cgImage: CGImage) {
        self.init(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
    }

    /// UIKit's `UIImage(systemName:)`.
    convenience init?(systemName: String) {
        self.init(systemSymbolName: systemName, accessibilityDescription: nil)
    }

    /// UIKit's `cgImage`: the best bitmap of the picture.
    var cgImage: CGImage? {
        var rect = CGRect(origin: .zero, size: size)
        return cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }

    /// Always 1: an NSImage's size is already in pixels for pictures made here.
    var scale: CGFloat { 1 }

    func jpegData(compressionQuality: CGFloat) -> Data? {
        guard let cg = cgImage else { return nil }
        return NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: compressionQuality])
    }

    func pngData() -> Data? {
        guard let cg = cgImage else { return nil }
        return NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
    }
}

extension Image {
    init(uiImage: NSImage) { self.init(nsImage: uiImage) }
}

extension Color {
    init(uiColor: NSColor) { self.init(nsColor: uiColor) }
}

// MARK: - The application

/// UIKit's `UIBackgroundTaskIdentifier`: a Mac app is not suspended mid-write, so there is nothing to ask for.
struct UIBackgroundTaskIdentifier: Hashable {
    let raw: Int
    static let invalid = UIBackgroundTaskIdentifier(raw: 0)
}

/// The few `UIApplication.shared` calls the screens make, answered by AppKit.
@MainActor
final class UIApplication {
    static let shared = UIApplication()
    enum State { case active, inactive, background }
    var applicationState: State { NSApp?.isActive == true ? .active : .inactive }

    @discardableResult
    func open(_ url: URL, options: [AnyHashable: Any] = [:], completionHandler: ((Bool) -> Void)? = nil) -> Bool {
        let ok = NSWorkspace.shared.open(url)
        completionHandler?(ok)
        return ok
    }

    func canOpenURL(_ url: URL) -> Bool { NSWorkspace.shared.urlForApplication(toOpen: url) != nil }

    /// The phone's "resign first responder" (the keyboard's Done): the key window gives up its field.
    @discardableResult
    func sendAction(_ action: Selector, to target: Any?, from sender: Any?, for event: Any?) -> Bool {
        NSApp?.keyWindow?.makeFirstResponder(nil)
        return true
    }

    func beginBackgroundTask(withName name: String?, expirationHandler: (() -> Void)? = nil) -> UIBackgroundTaskIdentifier { .invalid }
    func endBackgroundTask(_ id: UIBackgroundTaskIdentifier) {}

    // Alternate icons are an iPhone's; the Mac's Dock icon is the app's own.
    var supportsAlternateIcons: Bool { false }
    var alternateIconName: String? { nil }
    func setAlternateIconName(_ name: String?) async throws {}

    func registerForRemoteNotifications() { NSApp?.registerForRemoteNotifications() }
}

/// UIKit's `UIResponder`, only so `#selector(UIResponder.resignFirstResponder)` reads the same.
typealias UIResponder = NSResponder

enum UIUserInterfaceIdiom { case unspecified, phone, pad, mac }

/// `UIDevice.current`: what the ERP is told about the device it is on.
@MainActor
final class UIDevice {
    static let current = UIDevice()
    var model: String { "Mac" }
    var name: String { Host.current().localizedName ?? "Mac" }
    var systemName: String { "macOS" }
    var systemVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }
    var userInterfaceIdiom: UIUserInterfaceIdiom { .mac }
    var identifierForVendor: UUID? { nil }
}

/// The pasteboard, as the phone's `UIPasteboard.general` is used: text in and out.
@MainActor
final class UIPasteboard {
    static let general = UIPasteboard()
    var string: String? {
        get { NSPasteboard.general.string(forType: .string) }
        set {
            NSPasteboard.general.clearContents()
            if let newValue { NSPasteboard.general.setString(newValue, forType: .string) }
        }
    }
    var hasStrings: Bool { NSPasteboard.general.string(forType: .string) != nil }
    var url: URL? {
        get { NSPasteboard.general.string(forType: .string).flatMap(URL.init(string:)) }
        set { string = newValue?.absoluteString }
    }
    var image: NSImage? {
        get { NSImage(pasteboard: NSPasteboard.general) }
        set {
            NSPasteboard.general.clearContents()
            if let newValue { NSPasteboard.general.writeObjects([newValue]) }
        }
    }
}

/// Reduce Motion and the screen reader's announcements, AppKit's way.
enum UIAccessibility {
    struct Notification: Equatable {
        let name: String
        static let announcement = Notification(name: "announcement")
        static let screenChanged = Notification(name: "screenChanged")
        static let layoutChanged = Notification(name: "layoutChanged")
    }
    @MainActor static var isReduceMotionEnabled: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    @MainActor static var isVoiceOverRunning: Bool { NSWorkspace.shared.isVoiceOverEnabled }
    @MainActor static func post(notification: Notification, argument: Any?) {
        guard notification == .announcement, let text = argument as? String, let app = NSApp else { return }
        NSAccessibility.post(element: app, notification: .announcementRequested,
                             userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
    }
}

// MARK: - Haptics: a Mac has none to speak of (a Force Touch trackpad's are for dragging), so these are silent.

final class UIImpactFeedbackGenerator {
    enum FeedbackStyle { case light, medium, heavy, soft, rigid }
    init(style: FeedbackStyle = .medium) {}
    func prepare() {}
    func impactOccurred() {}
    func impactOccurred(intensity: CGFloat) {}
}

final class UINotificationFeedbackGenerator {
    enum FeedbackType { case success, warning, error }
    init() {}
    func prepare() {}
    func notificationOccurred(_ type: FeedbackType) {}
}

final class UISelectionFeedbackGenerator {
    init() {}
    func prepare() {}
    func selectionChanged() {}
}

// MARK: - The phone's layout words

/// Unavailable in AppKit's SwiftUI: the Mac is always the wide layout (`EnvironmentValues.layoutWidthClass`).
enum UserInterfaceSizeClass: Hashable { case compact, regular }

enum NavigationBarItem {
    enum TitleDisplayMode { case automatic, inline, large }
}

/// The phone's keyboards; a Mac has one keyboard.
enum UIKeyboardType {
    case `default`, asciiCapable, numbersAndPunctuation, URL, numberPad, phonePad, namePhonePad, emailAddress, decimalPad, twitter, webSearch, asciiCapableNumberPad
}

struct TextInputAutocapitalization {
    static let never = TextInputAutocapitalization()
    static let words = TextInputAutocapitalization()
    static let sentences = TextInputAutocapitalization()
    static let characters = TextInputAutocapitalization()
}

struct MacHoverEffect {
    static let automatic = MacHoverEffect()
    static let highlight = MacHoverEffect()
    static let lift = MacHoverEffect()
}

enum NavigationBarDrawerDisplayMode { case automatic, always }

struct TabBarMinimizeBehavior {
    static let automatic = TabBarMinimizeBehavior()
    static let onScrollDown = TabBarMinimizeBehavior()
    static let onScrollUp = TabBarMinimizeBehavior()
    static let never = TabBarMinimizeBehavior()
}

extension View {
    func navigationBarTitleDisplayMode(_ mode: NavigationBarItem.TitleDisplayMode) -> some View { self }
    func keyboardType(_ type: UIKeyboardType) -> some View { self }
    func textInputAutocapitalization(_ autocapitalization: TextInputAutocapitalization?) -> some View { self }
    func hoverEffect(_ effect: MacHoverEffect = .automatic, isEnabled: Bool = true) -> some View { self }
    func tabBarMinimizeBehavior(_ behavior: TabBarMinimizeBehavior) -> some View { self }
    func statusBarHidden(_ hidden: Bool = true) -> some View { self }

    /// A full-screen cover is a sheet on the Mac.
    func fullScreenCover<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
                                        @ViewBuilder content: @escaping () -> Content) -> some View {
        sheet(isPresented: isPresented, onDismiss: onDismiss, content: content)
    }

    func fullScreenCover<Item: Identifiable, Content: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
                                                            @ViewBuilder content: @escaping (Item) -> Content) -> some View {
        sheet(item: item, onDismiss: onDismiss, content: content)
    }
}

extension ToolbarItemPlacement {
    /// The phone's bar ends: the window's leading (navigation) area and its trailing actions.
    static var topBarLeading: ToolbarItemPlacement { .navigation }
    static var topBarTrailing: ToolbarItemPlacement { .primaryAction }
}

extension SearchFieldPlacement {
    static func navigationBarDrawer(displayMode: NavigationBarDrawerDisplayMode) -> SearchFieldPlacement { .toolbar }
    static var navigationBarDrawer: SearchFieldPlacement { .toolbar }
}

extension ListStyle where Self == InsetListStyle {
    /// The phone's grouped list is the Mac's inset one (Forms are already grouped by `.houseForm()`).
    static var insetGrouped: InsetListStyle { InsetListStyle() }
}
#endif

#if os(macOS)
// UIKit's dynamic colour (`UIColor { traits in … }`): AppKit asks again for each appearance, light or dark.
enum UIUserInterfaceStyle { case unspecified, light, dark }
struct UITraitCollection { let userInterfaceStyle: UIUserInterfaceStyle }

extension NSColor {
    convenience init(dynamicProvider: @escaping @Sendable (UITraitCollection) -> NSColor) {
        self.init(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return dynamicProvider(UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
        }
    }
}
#endif
