#if os(macOS)
import SwiftUI
import ERPCore

// The few plain parts the reports (Today's cash, Analytics) share: a section's header, a block of label and value rows, and
// the sort-ready numeric cell. Nothing here reads or writes the books.

/// A report's row of figures. Reports build the kit's `MacFigures` here and nowhere else, so its initializer is named once.
func macReportsFigures(_ figures: [MacFigure]) -> some View {
    MacFigures(figures: figures)
}

/// A table's or block's header: plain bold words, a count or note beside them at the right.
struct MacReportsHeader: View {
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.headline)
            Spacer(minLength: 8)
            if let detail, !detail.isEmpty {
                Text(detail).font(.callout).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }
}

/// A money or count cell, right-aligned in steady digits.
struct MacReportsNumber: View {
    let text: String
    var tone: Tone?

    init(_ text: String, tone: Tone? = nil) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .monospacedDigit()
            .foregroundStyle(tone?.color ?? Color.primary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// A few label and value rows (a small breakdown that is not a list): the label at the left, the value at the right.
struct MacReportsFacts: View {
    let title: String
    var detail: String?
    let rows: [MacReportsFact]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: title, detail: detail)
            ForEach(rows) { (r: MacReportsFact) in
                HStack(alignment: .firstTextBaseline) {
                    Text(r.label).foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(r.value).monospacedDigit().foregroundStyle(r.tone?.color ?? Color.primary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
            }
        }
    }
}

struct MacReportsFact: Identifiable {
    let label: String
    let value: String
    var tone: Tone?
    var id: String { label }

    init(_ label: String, _ value: String, tone: Tone? = nil) {
        self.label = label
        self.value = value
        self.tone = tone
    }
}
#endif
