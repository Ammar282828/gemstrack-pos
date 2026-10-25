#if os(macOS)
import SwiftUI
import ERPCore

// Ads › New Ad on the Mac (docs/features/mac-design.md, "Ads"): a document. The source of the ad at the left, the form in
// the centre with no step numbers, the preview (or the audience) in the panel at the right, and in the footer the
// one button, Create Ad, with Paused or Live beside it. The screen (AdsNewAd.swift) keeps the state and every call.

/// What the right-hand panel shows.
enum AdsMacNewAdPane: Hashable {
    case preview, audience
}

/// The document's footer: what it will spend, Paused or Live, and Create Ad as the default button. One question follows
/// it (the server's check, in words and money), not two.
struct AdsMacFooter: View {
    @Binding var launch: String
    var title = "Create Ad"
    let summary: String
    let busy: Bool
    let disabled: Bool
    let create: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(2)
                Spacer(minLength: 12)
                Picker("Start", selection: $launch) {
                    Text("Paused").tag("paused")
                    Text("Live").tag("live")
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .fixedSize()
                .help("Paused: nothing is spent until you switch it on in Campaigns. Live: it starts once Meta approves it.")
                Button(busy ? "Checking…" : title, action: create)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || disabled)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }
}

/// The ad as a sketch: the first picture, the words, the headline and the button, over the Instagram account's name.
struct AdsMacAdSketch: View {
    let account: String
    let picture: String?
    let preview: Data?
    let words: String
    let headline: String
    let button: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
                Text(account).font(.subheadline.weight(.semibold))
                Spacer()
                Text("Sponsored").font(.caption).foregroundStyle(.secondary)
            }
            image
            if !words.isEmpty { Text(words).font(.callout).lineLimit(6) }
            if !headline.isEmpty || !button.isEmpty {
                HStack {
                    Text(headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                    Spacer(minLength: 8)
                    if !button.isEmpty {
                        Text(button).font(.caption.weight(.semibold))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(.quaternary, in: .capsule)
                    }
                }
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private var image: some View {
        if picture == nil, let preview, let local = UIImage(data: preview) {
            Image(uiImage: local).resizable().scaledToFill()
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 6, style: .continuous))
        } else if let picture {
            StockImage(imageUrl: picture, name: headline, key: "preview-" + picture)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 6, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(.quaternary)
                .aspectRatio(1, contentMode: .fit)
                .overlay { Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary) }
        }
    }
}
#endif
