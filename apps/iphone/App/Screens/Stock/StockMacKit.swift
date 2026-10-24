#if os(macOS)
import SwiftUI
import UniformTypeIdentifiers
import ERPCore

// The Mac's share of the Stock, Rates and Repairs screens: what a piece's right-click menu offers, a place opened in a
// window of its own, and a photo dropped on a piece's picture (docs/features/mac-app.md). Nothing here is on the iPhone.

/// "Open in New Window" for a row that opens a Route (MacShell's `openPlaceWindow`).
struct MacOpenInWindowItem: View {
    let path: String
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        if let openPlace {
            Button { openPlace(Route(path: path)) } label: { Label("Open in New Window", systemImage: "macwindow.badge.plus") }
        }
    }
}

extension View {
    /// A row's right-click menu holding only "Open in New Window" (for rows with no menu of their own).
    func macOpenInWindowMenu(_ path: String) -> some View {
        contextMenu { MacOpenInWindowItem(path: path) }
    }
}

/// What the Mac adds to a piece's right-click menu: its own window, its tag through Label LIVE, its SKU copied.
struct StockMacMenuItems: View {
    let sku: String

    var body: some View {
        MacOpenInWindowItem(path: StockKit.piecePath(sku))
        Button { MacPrint.print(Route(path: StockKit.piecePath(sku))) } label: { Label("Print Tag", systemImage: "printer") }
        Button { UIPasteboard.general.string = sku } label: { Label("Copy SKU", systemImage: "doc.on.doc") }
        Divider()
    }
}

/// A picture file dropped on a piece's photo (or chosen from "Replace photo…") replaces the piece's photo: the same
/// upload the form's Photo field makes (/api/app/product-photo), saved at once. The owners' shelf is live, so the new
/// picture follows by itself.
struct StockPhotoDrop: ViewModifier {
    let sku: String
    @Binding var choosing: Bool
    @State private var targeted = false
    @State private var busy = false
    @State private var failure: String?

    func body(content: Content) -> some View {
        content
            .overlay {
                if targeted {
                    RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
                        .strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                        .background(Theme.accent.opacity(0.08), in: .rect(cornerRadius: Radius.chip, style: .continuous))
                        .overlay { Label("Drop to replace the photo", systemImage: "photo.badge.arrow.down").font(.headline) }
                        .allowsHitTesting(false)
                } else if busy {
                    ProgressView("Uploading the photo…").padding(14).background(.regularMaterial, in: .rect(cornerRadius: 12))
                }
            }
            .dropDestination(for: URL.self) { urls, _ in
                guard !busy, let url = urls.first else { return false }
                Task { await send(url) }
                return true
            } isTargeted: { targeted = $0 }
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.image]) { result in
                if case .success(let url) = result { Task { await send(url) } }
            }
            .failureAlert($failure, title: "The photo wasn't saved")
    }

    private func send(_ url: URL) async {
        busy = true
        defer { busy = false }
        guard let image = NewOrderPhotoCodec.macPicture(at: url) else {
            failure = "Couldn't read that file as a photo. Try another."
            return
        }
        let jpeg = await Task.detached(priority: .userInitiated) { StockPhotoCodec.jpeg(from: image) }.value
        guard let jpeg else {
            failure = "Couldn't use that photo."
            return
        }
        do {
            _ = try await WebsiteForm.send("/api/app/product-photo", fields: [("sku", sku)],
                                           files: [WebsiteForm.File(field: "file", name: "\(sku).jpg", type: "image/jpeg", data: jpeg)],
                                           timeout: 120)
        } catch {
            failure = error.localizedDescription
        }
    }
}
#endif
