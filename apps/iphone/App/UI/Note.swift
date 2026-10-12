import SwiftUI
import UIKit

// The toast said after a save or a refusal. It was the owners' pages' (OwnerNote); every screen uses it now.
// `@State private var note: Note?`, `.noteToast($note)` on the screen, `Note.show(...)` to say something.

/// What was said after a save, for a few seconds (the web's toast).
struct Note: Equatable {
    let title: String
    var detail = ""
    /// Something that did not happen: an amber warning and a warning tap, never the green tick.
    var failed = false

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

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: note.failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(note.failed ? Tone.owed.color : Tone.settled.color)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                if !note.detail.isEmpty {
                    Text(note.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .combine)
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

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let shown = note {
                    NoteBanner(note: shown)
                        .frame(maxWidth: 560)
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                        .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
            .sensoryFeedback(trigger: note) { _, now in
                guard let now else { return nil }
                return now.failed ? .warning : .success
            }
            .onChange(of: note) { _, now in
                if let now { AccessibilityNotification.Announcement(now.spoken).post() }
            }
            .task(id: note) {
                guard note != nil else { return }
                try? await Task.sleep(for: .seconds(4))
                if !Task.isCancelled { Motion.run(Motion.exit, reduce: reduce) { note = nil } }
            }
    }
}
