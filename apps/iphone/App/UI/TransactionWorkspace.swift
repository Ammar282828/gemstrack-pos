import SwiftUI
import UIKit

enum EntryStep: Int, CaseIterable, Identifiable {
    case customer, pieces, payment, review
    var id: Int { rawValue }
    var title: String { ["Customer", "Pieces", "Payment", "Review"][rawValue] }
    var next: EntryStep { EntryStep(rawValue: min(rawValue + 1, 3)) ?? .review }
    var previous: EntryStep { EntryStep(rawValue: max(rawValue - 1, 0)) ?? .customer }
}

struct EntrySteps: View {
    @Binding var selection: EntryStep
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: typeSize.isAccessibilitySize ? 2 : 4), spacing: 4) {
            ForEach(EntryStep.allCases) { step in
                Button {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    selection = step
                } label: {
                    Text(step.title)
                        .font(.subheadline.weight(selection == step ? .semibold : .regular))
                        .foregroundStyle(selection == step ? Theme.accent : Color.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(selection == step ? Theme.accent.opacity(0.1) : Color.clear, in: .rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Step \(step.rawValue + 1) of 4: \(step.title)")
                .accessibilityAddTraits(selection == step ? .isSelected : [])
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Theme.ground)
    }
}

struct EntryContinue: View {
    @Binding var selection: EntryStep

    var body: some View {
        HStack(spacing: 12) {
            if selection != .customer {
                Button("Back", systemImage: "chevron.left") { move(selection.previous) }
                    .buttonStyle(.glass).controlSize(.large)
            }
            Button("Continue", systemImage: "arrow.right") { move(selection.next) }
                .frame(maxWidth: .infinity)
                .buttonStyle(.houseProminent).controlSize(.large)
                .accessibilityHint("Continue to \(selection.next.title)")
        }
        .padding(16)
    }

    private func move(_ step: EntryStep) {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        selection = step
    }
}

/// The available window width decides the layout, including iPad Split View and resized windows.
struct TransactionWorkspace<Editor: View, Review: View, Footer: View>: View {
    @ViewBuilder let editor: () -> Editor
    @ViewBuilder let review: () -> Review
    @ViewBuilder let footer: () -> Footer
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width >= 820 && !typeSize.isAccessibilitySize {
                HStack(spacing: 0) {
                    editor().scrollContentBackground(.hidden).background(Theme.ground).frame(maxWidth: .infinity)
                    Divider()
                    VStack(spacing: 0) {
                        ScrollView { review().padding(20) }
                        footer()
                    }
                    .frame(width: min(380, geometry.size.width * 0.35))
                    .background(Theme.ground)
                }
            } else {
                editor().scrollContentBackground(.hidden).background(Theme.ground)
                    .safeAreaBar(edge: .bottom, spacing: 0) { footer() }
            }
        }
    }
}

struct TransactionReviewRow: Identifiable {
    let label: String
    let value: String
    var id: String { label }
}

/// The same contextual summary accompanies piece editing on a wide window.
struct PieceInspector: View {
    let title: String
    let rows: [TransactionReviewRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Piece summary", systemImage: "sparkles")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
            Text(title.isEmpty ? "New piece" : title).font(.headline)
            Divider()
            ForEach(rows) { row in
                LabeledContent(row.label, value: row.value.isEmpty ? "—" : row.value)
                    .font(.subheadline).monospacedDigit()
            }
        }
        .padding(20)
        .background(Theme.card, in: .rect(cornerRadius: 20))
    }
}

struct TransactionReview: View {
    let customer: String
    var contact: String = ""
    let pieces: [TransactionReviewRow]
    let figures: [TransactionReviewRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("At a glance", systemImage: "list.clipboard")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 4) {
                Text(customer.isEmpty ? "Walk-in" : customer).font(.headline)
                if !contact.isEmpty { Text(contact).font(.subheadline).foregroundStyle(.secondary) }
            }
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                Text("\(pieces.count) piece\(pieces.count == 1 ? "" : "s")").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if pieces.isEmpty {
                    Text("Add a piece to begin.").font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(pieces) { row in reviewRow(row) }
            }
            Divider()
            VStack(spacing: 12) {
                ForEach(figures) { row in reviewRow(row) }
            }
        }
        .padding(20)
        .background(Theme.card, in: .rect(cornerRadius: 20))
    }

    private func reviewRow(_ row: TransactionReviewRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(row.label).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Text(row.value).font(.subheadline.weight(.medium)).monospacedDigit()
                .multilineTextAlignment(.trailing).fixedSize(horizontal: false, vertical: true)
        }
    }
}
