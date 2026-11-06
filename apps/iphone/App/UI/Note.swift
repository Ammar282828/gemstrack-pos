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
                .foregroundStyle(note.failed ? Tone.problem.color : Tone.settled.color)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                if !note.detail.isEmpty {
                    Text(note.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if note.undo != nil, let onUndo {
                Button("Undo", action: onUndo)
                    .buttonStyle(HoldingButtonStyle(onHold: onHold))
                    .font(.subheadline.weight(.semibold))
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

    private struct Key: Equatable { var note: Note?; var holding: Bool }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let shown = note {
                    NoteBanner(note: shown, onUndo: {
                        let run = shown.undo
                        holding = false
                        Motion.run(Motion.exit, reduce: reduce) { note = nil }
                        run?()
                    }, onHold: { holding = $0 })
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
            }
            .task(id: Key(note: note, holding: holding)) {
                guard let shown = note, !holding else { return }
                try? await Task.sleep(for: .seconds(shown.undo == nil ? 4 : 6))
                if !Task.isCancelled { Motion.run(Motion.exit, reduce: reduce) { note = nil } }
            }
    }
}
