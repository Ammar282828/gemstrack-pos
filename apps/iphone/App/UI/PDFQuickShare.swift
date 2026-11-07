import SwiftUI
import PDFKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Share or print a PDF without opening it first (owner, 2026-11-02: "cant print pdf without opening the pdf first,
// like directly opening the share options on ios"). Set the binding to a target and the ERP draws the PDF; a small
// glass capsule says "Preparing…" over the screen while it does, then the system's share sheet opens straight away
// (Print, WhatsApp, Save to Files, AirDrop). On a Mac the print panel opens instead. "View PDF" (PDFDocumentScreen)
// is still there for looking at it first.

extension View {
    /// Share or print `target`'s PDF the moment it is set; the binding is put back to nil once the work has started.
    func pdfQuickShare(_ target: Binding<InvoicePDFTarget?>) -> some View {
        modifier(PDFQuickShare(target: target))
    }
}

private struct PDFQuickShare: ViewModifier {
    @Binding var target: InvoicePDFTarget?
    @State private var preparing: InvoicePDFTarget?
    @State private var problem: String?
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let preparing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Preparing \(preparing.title)…").font(.house(.subheadline)).lineLimit(1)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 72)
                    .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    .accessibilityElement(children: .combine)
                }
            }
            .animation(reduce ? nil : Motion.travel, value: preparing)
            .onChange(of: target) { _, wanted in
                guard let wanted else { return }
                target = nil
                guard preparing == nil else { return }
                preparing = wanted
                Task { await run(wanted) }
            }
            .alert("Couldn't prepare the PDF", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(problem ?? "") }
    }

    @MainActor
    private func run(_ t: InvoicePDFTarget) async {
        defer { preparing = nil }
        do {
            let data = try await ERPAPI.shared.data(t.path, timeout: 90)
            guard let document = PDFDocument(data: data), document.pageCount > 0 else {
                problem = "The ERP's answer was not a PDF."
                return
            }
            #if os(iOS)
            let url = try PDFQuickShareFiles.keep(data, as: t.fileName)
            PDFQuickShareFiles.present(url)
            #else
            PDFQuickShareFiles.print(document)
            #endif
        } catch {
            if Task.isCancelled { return }
            problem = PDFQuickShareFiles.said(error)
        }
    }
}

enum PDFQuickShareFiles {
    /// What went wrong, in words the person can act on (as PDFDocumentScreen says it).
    static func said(_ error: Error) -> String {
        if let failure = error as? ERPAPI.Failure, failure.status == 401 || failure.status == 403 {
            return "This one is for the owners. Sign in as an owner to share it."
        }
        if (error as? URLError)?.code == .timedOut {
            return "The ERP took too long to draw it. Check the connection and try again."
        }
        return error.localizedDescription
    }

    /// A folder of its own, so the file keeps its exact name ("Invoice - Ayesha.pdf") in WhatsApp and Files.
    static func keep(_ data: Data, as name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("erp-pdf-share", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var n = name.replacingOccurrences(of: "/", with: " ").replacingOccurrences(of: ":", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { n = "Document" }
        if !n.lowercased().hasSuffix(".pdf") { n += ".pdf" }
        let url = dir.appendingPathComponent(n)
        try data.write(to: url, options: .atomic)
        return url
    }

    #if os(iOS)
    /// The system share sheet from whatever is on top (a sheet included), anchored for an iPad's popover; the file
    /// is removed from the phone when the sheet closes.
    @MainActor
    static func present(_ url: URL) {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController else { return }
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        top.present(sheet, animated: true)
    }
    #else
    /// The Mac's print panel, straight from the PDF.
    @MainActor
    static func print(_ document: PDFDocument) {
        let info = NSPrintInfo.shared.copy() as? NSPrintInfo ?? NSPrintInfo.shared
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleDownToFit, autoRotate: true) else { return }
        if let window = NSApp.keyWindow {
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            operation.run()
        }
    }
    #endif
}

/// The printer on every invoice and order card (owner, 2026-11-03: "quick print buttons on every order and an invoice
/// card"): one tap and the share sheet opens with Print first in line, via `.pdfQuickShare`. Borderless, so a List
/// row's own tap (open the record) and this one stay apart.
struct QuickPrintButton: View {
    /// "Print INV-000123": what VoiceOver says.
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "printer")
                .font(.house(.subheadline).weight(.semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(.borderless)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel(label)
        .help(label)
    }
}
