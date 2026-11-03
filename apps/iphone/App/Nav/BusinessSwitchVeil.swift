import SwiftUI

// The business switch as one smooth change (owner, 2026-11-03: "switching business through double tap is jittery").
// A switch tears down the books and rebuilds the whole tree on the new id; that is synchronous main-thread work, and
// animating it (the old `withAnimation` around it) drew the half-built screens. So: a picture of the window is laid over
// the window, the switch happens beneath it with animations off, and once the new root has drawn its first frames
// (from the shelves' snapshot, ShelfSnapshots) the picture fades out on the app's travel curve. The picture is a
// layer the render server fades, so the fade stays smooth even if the main thread is still busy.

#if os(iOS)
import UIKit

@MainActor
final class SwitchVeil {
    private let snapshot: UIView
    private var finished = false

    private init(snapshot: UIView) { self.snapshot = snapshot }

    /// Lays a picture of the app's window over it. Nil when there is no window to picture (the switch then goes without one).
    static func cover() -> SwitchVeil? {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            // The lock's window sits above at its own level and is not part of the picture.
            .filter { $0.windowLevel == .normal }
        guard let window = windows.first(where: \.isKeyWindow) ?? windows.first,
              let picture = window.snapshotView(afterScreenUpdates: false) else { return nil }
        picture.frame = window.bounds
        picture.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Nothing underneath can be touched while it is changing.
        picture.isUserInteractionEnabled = true
        window.addSubview(picture)
        return SwitchVeil(snapshot: picture)
    }

    /// Takes the picture away once the new business has drawn: a few frames after the switch (the first commit of the
    /// rebuilt tree, then the shelves' cached paint), and no later than a second, whatever the main thread is doing.
    func reveal(reduce: Bool) {
        FrameWait.frames(3) { [self] in fade(reduce: reduce) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [self] in fade(reduce: reduce) }
    }

    private func fade(reduce: Bool) {
        guard !finished else { return }
        finished = true
        let picture = snapshot
        if reduce {
            picture.removeFromSuperview()
            return
        }
        // The app's travel curve (Motion.travel: 0.32, 0.72, 0, 1), over a little longer than its 0.3 s: two whole screens.
        let duration: CFTimeInterval = 0.35
        CATransaction.begin()
        CATransaction.setCompletionBlock { picture.removeFromSuperview() }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        fade.duration = duration
        fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.32, 0.72, 0, 1)
        // The model value is the end state, so the picture does not flash back when the animation is removed.
        CATransaction.setDisableActions(true)
        picture.layer.opacity = 0
        picture.layer.add(fade, forKey: "veil")
        CATransaction.commit()
        picture.isUserInteractionEnabled = false
    }
}

/// Calls back after the screen has drawn this many more frames.
private final class FrameWait: NSObject {
    private var link: CADisplayLink?
    private var left: Int
    private var done: (() -> Void)?

    private init(frames: Int, done: @escaping () -> Void) {
        left = frames
        self.done = done
        super.init()
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    static func frames(_ count: Int, _ done: @escaping () -> Void) {
        _ = FrameWait(frames: count, done: done)
    }

    @objc private func tick() {
        left -= 1
        guard left <= 0 else { return }
        link?.invalidate()
        link = nil
        let call = done
        done = nil
        call?()
    }
}
#else
/// A Mac window is rebuilt in place (MacShell); there is no picture to lay over it.
@MainActor
struct SwitchVeil {
    static func cover() -> SwitchVeil? { nil }
    func reveal(reduce: Bool) {}
}
#endif
