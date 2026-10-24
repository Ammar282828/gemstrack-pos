#if os(macOS)
import SwiftUI
import AppKit
import PDFKit
import ERPCore

/// File › Print (⌘P) for the page in front: a stock piece's tag through Label LIVE (LabelLivePrinter), an invoice as the
/// PDF the browser prints (/api/app/pdf/invoice, lib/invoice-pdf.ts), an order's workshop slip, a repair's receipt, all
/// drawn on the ERP's server and handed to the Mac's print panel.
@MainActor
enum MacPrint {
    private enum Kind { case tag(String), pdf(path: String, name: String) }

    private static func kind(_ route: Route?) -> Kind? {
        guard let route else { return nil }
        let bare = ScreenRoute.bare(route.path)
        func id(_ prefix: String) -> String? {
            guard bare.hasPrefix(prefix) else { return nil }
            let rest = String(bare.dropFirst(prefix.count))
            guard !rest.isEmpty, !rest.contains("/"), !["add", "new", "bulk-add"].contains(rest) else { return nil }
            return rest.removingPercentEncoding ?? rest
        }
        if let sku = id("/products/") { return .tag(sku) }
        if let inv = id("/invoices/") { return .pdf(path: InvoiceFacts.pdfPath(inv), name: "Invoice-\(inv).pdf") }
        if let ord = id("/orders/") { return .pdf(path: "/api/app/pdf/order-slip/" + InvoiceFacts.encode(ord), name: "OrderSlip-\(ord).pdf") }
        if bare == "/repairs", let rep = URLComponents(string: route.path)?.queryItems?.first(where: { $0.name == "id" })?.value {
            return .pdf(path: "/api/app/pdf/repair/" + InvoiceFacts.encode(rep), name: "Repair-\(rep).pdf")
        }
        return nil
    }

    static func canPrint(_ route: Route?) -> Bool { kind(route) != nil }

    static func title(for route: Route?) -> String {
        switch kind(route) {
        case .tag: return "Print Tag…"
        case .pdf(let path, _) where path.contains("/invoice/"): return "Print Invoice…"
        case .pdf(let path, _) where path.contains("/order-slip/"): return "Print Order Slip…"
        case .pdf: return "Print Receipt…"
        case nil: return "Print…"
        }
    }

    static func print(_ route: Route) {
        guard let k = kind(route) else { return }
        Task {
            switch k {
            case .tag(let sku): await printTags([sku])
            case .pdf(let path, let name): await printPDF(path: path, name: name)
            }
        }
    }

    /// Pieces' tags as one Label LIVE job (the Stock table's selection, or one piece), told in an alert if it failed.
    static func printTags(_ skus: [String]) async {
        let book = Book.shared
        book.settings.need()
        book.products.need()
        guard let settings = book.settings.value else { return say("The shop's settings haven't loaded yet. Try again in a moment.") }
        guard let config = settings.labelLiveConfig else {
            return say("Label LIVE isn't set up. Paste the design's Integrate link in Settings → Labels → Label LIVE.")
        }
        let pieces = skus.compactMap { book.products.item($0) }
        guard !pieces.isEmpty else { return say("Those pieces aren't in the stock list.") }
        let outcome = await LabelLivePrinter.print(pieces: pieces, settings: settings, config: config)
        if !outcome.ok { say(outcome.message) }
        else { NSSound(named: "Glass")?.play() }
    }

    /// The ERP's own PDF, shown in the Mac's print panel.
    static func printPDF(path: String, name: String) async {
        do {
            let data = try await ERPAPI.shared.data(path, timeout: 90)
            guard let document = PDFDocument(data: data) else { return say("The ERP's answer was not a PDF.") }
            let info = NSPrintInfo.shared.copy() as? NSPrintInfo ?? NSPrintInfo()
            info.jobDisposition = .spool
            guard let op = document.printOperation(for: info, scalingMode: .pageScaleToFit, autoRotate: true) else {
                return say("This PDF can't be printed.")
            }
            op.jobTitle = name
            op.showsPrintPanel = true
            op.showsProgressPanel = true
            if let window = NSApp.keyWindow { op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil) } else { op.run() }
        } catch {
            say(error.localizedDescription)
        }
    }

    private static func say(_ text: String) {
        let alert = NSAlert()
        alert.messageText = "Not printed"
        alert.informativeText = text
        alert.alertStyle = .warning
        if let window = NSApp.keyWindow { alert.beginSheetModal(for: window) } else { alert.runModal() }
    }
}
#endif
