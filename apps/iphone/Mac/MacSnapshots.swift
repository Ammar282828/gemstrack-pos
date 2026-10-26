#if os(macOS)
import SwiftUI
import AppKit
import ScreenCaptureKit

/// Help › Send Page Snapshots… (owners): the main window visits every place in its sidebar in turn, takes a picture of
/// itself at each, and sends the pictures to this business's ERP (/api/app/snapshots, Firestore `app_snapshots`). Whoever
/// is building the Mac app then sees what the owner's Mac draws, every page, without screenshots taken and sent one by
/// one (owner, 2026-10-25: "every page is broken"; the builders have no Mac to look at).
@MainActor
enum MacSnapshots {
    private(set) static var running = false

    /// One place to visit: its path and its sidebar title.
    struct Stop {
        let path: String
        let title: String
    }

    /// Every row of the sidebar, in its order: each place, then its rows.
    static func stops(_ sections: [MacSidebarSection]) -> [Stop] {
        var out: [Stop] = []
        for s in sections {
            for r in s.rows {
                out.append(Stop(path: r.id, title: r.title))
                for c in r.children { out.append(Stop(path: c.id, title: "\(r.title) \u{203A} \(c.title)")) }
            }
        }
        return out
    }

    /// Asks once (the window is busy for the length of the walk), then walks.
    static func ask(shell: MacShellModel, stops: [Stop], business: String) {
        // The demo's books are made up: nothing of it goes to a real ERP.
        guard !running, !stops.isEmpty, !House.isDemo else { return }
        // The window that asked (the menu acts on the key window); taken before the alert takes the key.
        let window = NSApp.keyWindow ?? mainWindow()
        let alert = NSAlert()
        alert.messageText = "Send a snapshot of every page?"
        let sees = CGPreflightScreenCaptureAccess()
        alert.informativeText = "This window opens each of its \(stops.count) pages in turn, about \(stops.count * 3) seconds, and sends a picture of each to \(House.storeName)'s own ERP for whoever is building the Mac app. Leave the window alone until it says it is done."
            + (sees ? "" : "\n\nFor true pictures (the sidebar and its glass included), allow ERP under System Settings \u{203A} Privacy & Security \u{203A} Screen & System Audio Recording, then reopen ERP. Without it the pictures leave the sidebar blank.")
        alert.addButton(withTitle: "Send Snapshots")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        // Asked once; the Mac remembers the answer. The pictures fall back to drawing the window themselves until it is given.
        if !sees { CGRequestScreenCaptureAccess() }
        walk(shell: shell, stops: stops, window: window, business: business)
    }

    private static func walk(shell: MacShellModel, stops: [Stop], window: NSWindow?, business: String) {
        running = true
        // Where the window was and how it got there: put back after the walk, Back and Forward as they were.
        let back = shell.memento
        let run = runID()
        Task { @MainActor in
            var sent = 0
            for (i, stop) in stops.enumerated() {
                // Another business opened, the window closed or the Mac locked mid-walk: stop, never photograph
                // another business's books (or the lock) under this one's run.
                guard Businesses.shared.current.id == business, window?.isVisible == true, !AppLock.shared.locked else { break }
                shell.go(stop.path)
                // The page draws from the shelves already in memory; the wait is for its first layout and any fetch.
                // 3 seconds: at 1.8 the marketing pages were still showing their loading shapes.
                try? await Task.sleep(for: .milliseconds(3000))
                guard Businesses.shared.current.id == business, !AppLock.shared.locked, let window else { continue }
                guard let shot = await screenPicture(of: window) ?? picture(of: window) else { continue }
                let body: [String: Any] = [
                    "run": run, "n": i, "path": stop.path, "title": stop.title, "build": build,
                    "width": shot.width, "height": shot.height, "image": shot.base64,
                ]
                if (try? await ERPAPI.shared.send("/api/app/snapshots", body, timeout: 30)) != nil { sent += 1 }
            }
            if Businesses.shared.current.id == business { shell.restore(back) }
            running = false
            let done = NSAlert()
            done.messageText = sent == stops.count ? "Sent all \(sent) pages" : "Sent \(sent) of \(stops.count) pages"
            done.informativeText = "Snapshot run \(run)."
            done.addButton(withTitle: "Done")
            done.runModal()
        }
    }

    /// The window as the screen shows it (ScreenCaptureKit, with the person's leave to record the screen): the sidebar's
    /// glass, the toolbar and every vibrant label as they are. `cacheDisplay` draws the views again by itself and leaves
    /// the sidebar white and vibrant text dark, which read as bugs that were not there.
    private static func screenPicture(of window: NSWindow) async -> (base64: String, width: Int, height: Int)? {
        guard CGPreflightScreenCaptureAccess() else { return nil }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let w = content.windows.first(where: { $0.windowID == CGWindowID(window.windowNumber) }) else { return nil }
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width)
            config.height = Int(window.frame.height)
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: w),
                                                                  configuration: config)
            return jpeg(NSBitmapImageRep(cgImage: image), width: config.width, height: config.height)
        } catch {
            return nil
        }
    }

    /// The window's picture as a JPEG at its size in points (not the Retina pixels), small enough for one document.
    private static func picture(of window: NSWindow) -> (base64: String, width: Int, height: Int)? {
        guard let view = window.contentView?.superview ?? window.contentView else { return nil }
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0, let full = view.bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        view.cacheDisplay(in: bounds, to: full)
        let w = Int(bounds.width), h = Int(bounds.height)
        guard let small = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                           bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        small.size = bounds.size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: small)
        full.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
        NSGraphicsContext.restoreGraphicsState()
        return jpeg(small, width: w, height: h)
    }

    private static func jpeg(_ small: NSBitmapImageRep, width w: Int, height h: Int) -> (base64: String, width: Int, height: Int)? {
        var quality = 0.75
        var data = small.representation(using: .jpeg, properties: [.compressionFactor: quality])
        while let d = data, d.count > 680_000, quality > 0.3 {
            quality -= 0.15
            data = small.representation(using: .jpeg, properties: [.compressionFactor: quality])
        }
        guard let jpeg = data, jpeg.count <= 700_000 else { return nil }
        return (jpeg.base64EncodedString(), w, h)
    }

    private static func mainWindow() -> NSWindow? {
        NSApp.windows.first { $0.identifier?.rawValue.hasPrefix(MacWindows.main) == true && $0.isVisible } ?? NSApp.keyWindow
    }

    private static func runID() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH-mm-ss"
        return f.string(from: Date())
    }

    private static var build: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
    }
}
#endif
