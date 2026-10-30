import SwiftUI
import PDFKit
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

/// A PDF the ERP draws on its server with the browser's own builder — the invoice Print saves
/// (lib/invoice-pdf.ts), the workshop slip (lib/order-slip-pdf.ts) — fetched as the signed-in person
/// (ERPAPI), shown here, and handed to the share sheet: Print, Save to Files, AirDrop, WhatsApp. Staff are
/// sent what their browser prints (lib/app-pdf.ts). The file is kept only while the screen is open, in this
/// phone's temporary folder, under the name the browser saves it by.
struct PDFDocumentScreen: View {
    /// The ERP route that draws it: "/api/app/pdf/invoice/INV-000123".
    let path: String
    /// "Invoice - Test Buyer.pdf", "OrderSlip-ORD-000123.pdf": what Print, Files and WhatsApp call it.
    let fileName: String
    let title: String
    /// How long the ERP may take to draw it. The monthly report reads every invoice, order and expense of the
    /// shop before it draws, so it asks for longer than a slip does.
    var timeout: TimeInterval = 90
    /// A line under the spinner, for a document that takes a while ("Drawing the report…").
    var wait: String?

    @State private var shown: Shown?
    @State private var failed: String?
    @State private var attempt = 0

    private struct Shown {
        let document: PDFDocument
        let file: URL
        let data: Data
    }

    var body: some View {
        Group {
            if let shown {
                PDFKitView(document: shown.document)
                    .ignoresSafeArea(edges: .bottom)
            } else if let failed {
                ContentUnavailableView {
                    Label("Couldn't draw the PDF", systemImage: "exclamationmark.triangle")
                } description: { Text(failed) } actions: {
                    Button("Try again") { self.failed = nil; attempt += 1 }.buttonStyle(.houseGlass)
                }
            } else {
                VStack(spacing: 12) {
                    SkeletonLoading().controlSize(.large)
                    if let wait {
                        Text(wait).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 32)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .modifier(HouseGround())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .trailingAction) { shareButton }
        }
        .task(id: attempt) { await load() }
        .onDisappear { forget() }
    }

    /// Print is in the share sheet, beside Save to Files and WhatsApp.
    @ViewBuilder
    private var shareButton: some View {
        if let shown {
            #if os(macOS)
            // The Mac's print panel, straight from the PDF (also what Print, ⌘P, opens from the menu).
            Button { Self.printDocument(shown.document) } label: {
                Label("Print", systemImage: "printer")
            }
            #endif
            #if os(macOS)
            Button { Self.save(shown.data, as: shown.file.lastPathComponent) } label: {
                Label("Save as PDF", systemImage: "square.and.arrow.down")
            }
            #endif
            ShareLink(item: shown.file) {
                Label("Share or print", systemImage: "square.and.arrow.up")
            }
        }
    }

    #if os(macOS)
    /// The Mac's save panel, so the report lands where the person chooses, under its own name.
    private static func save(_ data: Data, as name: String) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? data.write(to: url, options: .atomic)
    }

    private static func printDocument(_ document: PDFDocument) {
        let info = NSPrintInfo.shared.copy() as? NSPrintInfo ?? NSPrintInfo.shared
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleDownToFit, autoRotate: true) else { return }
        if let window = NSApp.keyWindow {
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            operation.run()
        }
    }
    #endif

    // MARK: The file

    private func load() async {
        guard shown == nil else { return }
        do {
            // A slip of many pieces is drawn in a second or two; the monthly report reads the whole book first.
            let data = try await ERPAPI.shared.data(path, timeout: timeout)
            guard let document = PDFDocument(data: data), document.pageCount > 0 else {
                failed = "The ERP's answer was not a PDF."
                return
            }
            shown = Shown(document: document, file: try Self.keep(data, as: fileName), data: data)
        } catch {
            if Task.isCancelled { return }
            failed = Self.said(error)
        }
    }

    /// What went wrong, in words the person can act on.
    private static func said(_ error: Error) -> String {
        if let failure = error as? ERPAPI.Failure, failure.status == 401 || failure.status == 403 {
            return "This one is for the owners. Sign in as an owner to open it."
        }
        if (error as? URLError)?.code == .timedOut {
            return "The ERP took too long to draw it. Check the connection and try again."
        }
        return error.localizedDescription
    }

    /// A folder of its own for each PDF, so the file keeps its exact name and two never meet.
    private static func keep(_ data: Data, as name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("erp-pdf", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(safeName(name))
        try data.write(to: url, options: .atomic)
        return url
    }

    /// A file's name, never a path (the ERP's names are already clean: lib/invoice-share.ts).
    private static func safeName(_ name: String) -> String {
        var n = name.replacingOccurrences(of: "/", with: " ").replacingOccurrences(of: ":", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { n = "Document" }
        return n.lowercased().hasSuffix(".pdf") ? n : n + ".pdf"
    }

    /// The customer's bill is not left on the phone once its screen is gone.
    private func forget() {
        guard let shown else { return }
        try? FileManager.default.removeItem(at: shown.file.deletingLastPathComponent())
        self.shown = nil
    }
}

#if os(macOS)
/// PDFKit's own viewer on the Mac: the pages one under the other, scaled to the window, on the house's ground.
private struct PDFKitView: NSViewRepresentable {
    let document: PDFDocument

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.displaysPageBreaks = true
        view.backgroundColor = .clear
        view.document = document
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
#else
/// PDFKit's own viewer: pinch to zoom, the pages one under the other, on the house's ground.
private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.displaysPageBreaks = true
        view.backgroundColor = .clear
        view.document = document
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
#endif
