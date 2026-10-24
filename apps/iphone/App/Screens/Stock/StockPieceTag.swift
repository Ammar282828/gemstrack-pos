import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import CoreImage.CIFilterBuiltins
import ERPCore

/// A piece's Print tag: the piece page's "Export & QR Code" (src/app/products/[sku]/page.tsx). The QR its tag
/// carries, the SKU at the high error correction the page draws it with (`level="H"`), and the piece as the CSV a
/// label app like WEPrint imports (/api/app/labels, lib/label-csv.ts: the same text as the page's
/// `generateProductCsv`). Nothing here talks to a printer, as on the web: the CSV and the QR go out through the
/// share sheet, to Files, the printing app or AirPrint. The tag's layout is Stock › Labels (LabelSettings).
struct StockPieceTagSheet: View {
    let product: Product
    /// Drawn once as the sheet opens, not on every redraw.
    private let image: UIImage?

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var making = false
    @State private var csv: URL?
    @State private var note: Note?
    @State private var printing = false
    @State private var problem: String?
    @State private var jobOpen = false

    init(product: Product) {
        self.product = product
        image = StockPieceTagSheet.qr(product.sku)
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                qrSection
                if TagPrinter.method == .zebra { zebraSection } else { labelLiveSection }
                csvSection
                }
                .houseRows()
            }
            .houseForm()
            .navigationTitle("Print tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
            .noteToast($note)
            .failureAlert($problem, title: "The tag wasn't printed")
            // The sheet has its own stack, so the link to Settings resolves here.
            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
            .task { book.settings.need() }
        }
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $jobOpen) {
            TagPrintJobSheet(pieces: [product]) { message in
                Note.show(Note(title: "Tag sent", detail: message), in: $note, reduce: reduceMotion)
            }
        }
    }

    // MARK: The shop's own tag, to a Zebra

    /// This device prints the shop's tag as ZPL straight to a Zebra (Settings → Labels → Printer); the job sheet asks
    /// for copies and blank labels. With Label LIVE chosen there, the Label LIVE button below stays as it was.
    private var zebraSection: some View {
        Section {
            Button { jobOpen = true } label: { Label("Print tag…", systemImage: "printer") }
            NavigationLink(value: Route(path: TagPrinterSettingsScreen.path)) { Label("Printer", systemImage: "printer.dotmatrix") }
        } footer: {
            Text("Sends the shop's tag for this piece to the Zebra, at today's rates.")
        }
    }

    // MARK: The QR

    private var qrSection: some View {
        Section {
            VStack(spacing: 8) {
                if let image {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 160, height: 160)
                        // A QR reads dark on light, whatever the phone's own look.
                        .padding(10)
                        .background(Color.white, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                        .accessibilityLabel("QR Code for \(product.sku)")
                } else {
                    StockInitial(name: product.name)
                }
                if !product.name.isEmpty { Text(product.name).font(.headline) }
                Text(product.sku).font(.subheadline.monospaced()).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            if let image {
                ShareLink(item: Image(uiImage: image), preview: SharePreview(product.sku, image: Image(uiImage: image))) {
                    Label("Save, send or print the QR", systemImage: "square.and.arrow.up")
                }
            }
        } header: {
            LedgerHeading(title: "QR code")
        } footer: {
            Text("The QR holds the SKU, as the tag's does: Scan finds the piece by it.")
        }
    }

    /// The SKU as a QR code, drawn crisp at twelve pixels to a module (CoreImage, correction level H).
    static func qr(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "H"
        guard let out = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    // MARK: Label LIVE

    /// Print this piece's tag through Label LIVE (docs/features/label-live.md), or the way to set it up. The design is the
    /// shop's, saved in Settings → Labels; the tag is worked out at today's rates.
    @ViewBuilder
    private var labelLiveSection: some View {
        if book.settings.value?.labelLiveConfig != nil {
            Section {
                Button { Task { await printTag() } } label: {
                    HStack(spacing: 8) {
                        if printing { ProgressView().controlSize(.small) }
                        Label("Print with Label LIVE", systemImage: "printer")
                    }
                }
                .disabled(printing)
            } footer: {
                Text("Sends this piece's tag to Label LIVE at the counter, at today's rates.")
            }
        } else {
            Section {
                NavigationLink(value: Route(path: LabelLiveSettingsScreen.path)) {
                    Label("Set up Label LIVE", systemImage: "printer")
                }
            } footer: {
                Text("Paste the design's link once in Settings, and tags print from here.")
            }
        }
    }

    private func printTag() async {
        guard !printing, let settings = book.settings.value, let config = settings.labelLiveConfig else { return }
        printing = true
        let outcome = await LabelLivePrinter.print(pieces: [product], settings: settings, config: config)
        printing = false
        if outcome.ok {
            Note.show(Note(title: "Tag sent", detail: outcome.message), in: $note, reduce: reduceMotion)
        } else {
            problem = outcome.message
        }
    }

    // MARK: The CSV

    private var csvSection: some View {
        Section {
            Button { Task { await makeCsv() } } label: {
                HStack(spacing: 8) {
                    if making { ProgressView().controlSize(.small) }
                    Label("Export CSV for this piece", systemImage: "arrow.down.doc")
                }
            }
            .disabled(making)
            if let csv {
                ShareLink(item: csv) {
                    Label("Save or send the CSV", systemImage: "square.and.arrow.up")
                }
            }
        } footer: {
            Text("Use CSV to import into a label printing app like WEPrint.")
        }
    }

    /// The ERP's CSV of this piece at today's rates, saved under the page's file name for the share sheet.
    private func makeCsv() async {
        guard !making else { return }
        making = true
        do {
            let data = try await ERPAPI.shared.data("/api/app/labels", method: "POST", json: ["sku": product.sku])
            // The page's file name: gemstrack_double_tag_export_<UTC time>.csv (lib/label-csv.ts labelCsvFileName).
            let stamp = String(ERPDate.iso(Date()).prefix(19)).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "T", with: "-")
            csv = try SettingsFiles.save(data, named: "gemstrack_double_tag_export_\(stamp).csv")
            Note.show(Note(title: "CSV ready", detail: "CSV file for \(product.name.isEmpty ? product.sku : product.name) is ready."), in: $note, reduce: reduceMotion)
        } catch {
            Note.show(Note(title: "The CSV wasn't made", detail: error.localizedDescription, failed: true), in: $note, reduce: reduceMotion)
        }
        making = false
    }
}
