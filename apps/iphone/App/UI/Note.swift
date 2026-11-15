import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// The toast said after a save or a refusal. It was the owners' pages' (OwnerNote); every screen uses it now.
// `@State private var note: Note?`, `.noteToast($note)` on the screen, `Note.show(...)` to say something.

/// What was said after a save, for a few seconds (the web's toast).
struct Note: Equatable {
    let title: String
    var detail = ""
    /// Something that did not happen: a red problem and a warning tap, never the green tick.
    var failed = false
    /// "Undo": the reverse of what was just done. The toast shows a button for it and stays longer. Only for a
    /// reversible, non-money change whose reverse write exists.
    var undo: (@MainActor () -> Void)?
    /// The Mac's Edit menu names the undo after this ("Undo Remove Line"); empty, the title names it.
    var undoName = ""

    static func == (a: Note, b: Note) -> Bool {
        a.title == b.title && a.detail == b.detail && a.failed == b.failed && (a.undo == nil) == (b.undo == nil)
    }

    /// Say it: the toast rises on the enter curve (it only appears under Reduce Motion). Pass the screen's
    /// `@Environment(\.accessibilityReduceMotion)`; use this rather than a bare `withAnimation`.
    @MainActor static func show(_ note: Note, in binding: Binding<Note?>, reduce: Bool) {
        Motion.run(Motion.enter, reduce: reduce) { binding.wrappedValue = note }
    }

    /// What VoiceOver says when it appears.
    var spoken: String { detail.isEmpty ? title : title + ". " + detail }
}

typealias OwnerNote = Note

struct NoteBanner: View {
    let note: Note
    /// The toast's own: the Undo tap (the toast leaves after it) and whether a finger is on it (the toast waits).
    var onUndo: (@MainActor () -> Void)?
    var onHold: ((Bool) -> Void)?

    var body: some View {
        HStack(spacing: pt(10)) {
            Image(systemName: note.failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(note.failed ? Tone.problem.ink : Tone.settled.ink)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.house(.subheadline).weight(.semibold))
                if !note.detail.isEmpty {
                    Text(note.detail).font(.house(.caption)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if note.undo != nil, let onUndo {
                Button("Undo", action: onUndo)
                    .buttonStyle(HoldingButtonStyle(onHold: onHold))
                    .font(.house(.subheadline).weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, pt(16))
        .padding(.vertical, pt(10))
        // A frosted card, not Liquid Glass: glass can't fade or slide, so a note rising after a save drew a stray
        // "bubble" as it formed and as it went (owner, 2026-10-15 and again 2026-10-17).
        .background(.regularMaterial, in: .rect(cornerRadius: Radius.card, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Undo") { if note.undo != nil { onUndo?() } }
    }
}

/// A plain text button that tells the toast while it is held, so the toast does not leave under a finger.
private struct HoldingButtonStyle: ButtonStyle {
    var onHold: ((Bool) -> Void)?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .onChange(of: configuration.isPressed) { _, now in onHold?(now) }
    }
}

typealias OwnerNoteBanner = NoteBanner

extension View {
    /// The note floating over the bottom of the screen, gone after four seconds.
    func noteToast(_ note: Binding<Note?>) -> some View {
        modifier(NotePresenter(note: note))
    }

    /// The old name of `note(_:)`.
    func ownerNote(_ note: Binding<Note?>) -> some View {
        modifier(NotePresenter(note: note))
    }
}

/// The note rises in on the enter curve with a success tick (felt as well as seen), and leaves on the exit
/// curve; under Reduce Motion it only fades. VoiceOver is told in words, as the banner takes no focus.
private struct NotePresenter: ViewModifier {
    @Binding var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var holding = false
    #if os(macOS)
    /// The window's: a note's Undo is Edit › Undo as well (⌘Z), until it is taken either way or the screen goes.
    @Environment(\.undoManager) private var undoManager
    /// The reverses this screen's notes put on the Edit menu, newest last.
    @State private var offered: [NoteMenuUndo] = []
    #endif

    private struct Key: Equatable { var note: Note?; var holding: Bool }

    /// The toast's Undo: the note's reverse, run once. On the Mac it leaves the Edit menu too (the newest there is this
    /// note's), so ⌘Z after it does not run it a second time.
    private func undoTapped(_ shown: Note) {
        let run = shown.undo
        #if os(macOS)
        if let menu = offered.popLast() {
            _ = menu.take()
            undoManager?.removeAllActions(withTarget: menu)
        }
        #endif
        holding = false
        Motion.run(Motion.exit, reduce: reduce) { note = nil }
        run?()
    }

    #if os(macOS)
    /// A note with an Undo puts the same reverse on the window's undo list, named after it. Whichever runs first takes it;
    /// Edit › Undo also takes the toast away if it is still up. Not money: a note's undo is only ever a non-money reverse.
    private func offerInEditMenu(_ now: Note?) {
        guard let now, let run = now.undo else { return }
        guard let um = undoManager else { return }
        let menu = NoteMenuUndo(run: run)
        let binding = $note
        let title = now.title
        um.registerUndo(withTarget: menu) { m in
            MainActor.assumeIsolated {
                guard let reverse = m.take() else { return }
                if binding.wrappedValue?.title == title, binding.wrappedValue?.undo != nil { binding.wrappedValue = nil }
                reverse()
            }
        }
        um.setActionName(now.undoName.isEmpty ? now.title : now.undoName)
        offered.removeAll { !$0.waiting }
        offered.append(menu)
    }
    #endif

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let shown = note {
                    NoteBanner(note: shown, onUndo: { undoTapped(shown) }, onHold: { holding = $0 })
                        .frame(maxWidth: 560)
                        .padding(.horizontal)
                        .padding(.bottom, pt(8))
                        .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
            .sensoryFeedback(trigger: note) { _, now in
                guard let now else { return nil }
                return now.failed ? .warning : .success
            }
            .onChange(of: note) { _, now in
                holding = false
                if let now { AccessibilityNotification.Announcement(now.spoken).post() }
                #if os(macOS)
                offerInEditMenu(now)
                #endif
            }
            #if os(macOS)
            // The screen gone, its reverse goes from the Edit menu too (it reads the screen's state).
            .onDisappear {
                for menu in offered { undoManager?.removeAllActions(withTarget: menu) }
                offered = []
            }
            #endif
            .task(id: Key(note: note, holding: holding)) {
                guard let shown = note, !holding else { return }
                // A VoiceOver user needs time to find Undo: its note stays until acted on or replaced.
                #if os(iOS)
                if shown.undo != nil && UIAccessibility.isVoiceOverRunning { return }
                #endif
                try? await Task.sleep(for: .seconds(shown.undo == nil ? 4 : 6))
                if !Task.isCancelled { Motion.run(Motion.exit, reduce: reduce) { note = nil } }
            }
    }
}

#if os(macOS)
/// One note's reverse on the Edit menu: taken once, by the toast's Undo or Edit › Undo, whichever comes first.
@MainActor
private final class NoteMenuUndo {
    private var run: (@MainActor () -> Void)?

    init(run: @escaping @MainActor () -> Void) { self.run = run }

    /// Not yet taken.
    var waiting: Bool { run != nil }

    func take() -> (@MainActor () -> Void)? {
        let r = run
        run = nil
        return r
    }
}
#endif
