import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import UniformTypeIdentifiers
import ERPCore

// What the Invoices page does with Shopify (src/app/invoices/page.tsx), native: the payment link on an unpaid
// invoice, and Import Shopify CSV. Both are the ERP's: the link is its draft order (/api/shopify/push/draft-order),
// the import its shared write (lib/writes/shopify-csv-import.ts, through /api/app/write).

// MARK: The payment link

/// The page's Payment link / Copy link: the ERP makes or refreshes the invoice's Shopify draft order, and its
/// checkout goes on the clipboard, to send the customer on WhatsApp or SMS. Set `invoice` and it runs.
private struct InvoicePaymentLink: ViewModifier {
    @Binding var invoice: Invoice?
    let made: (InvoiceNote) -> Void

    @State private var making = false
    @State private var failure: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .onChange(of: invoice) { _, picked in
                guard let picked else { return }
                invoice = nil
                Task { await make(picked) }
            }
            .failureAlert($failure, title: "No payment link")
            .overlay(alignment: .top) {
                if making {
                    Label("Making the payment link…", systemImage: "link")
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
    }

    /// `handleSendPaymentLink`: re-posted every time, so the draft order matches the invoice as it is now.
    private func make(_ inv: Invoice) async {
        guard !making else { return }
        Motion.run(reduce: reduceMotion) { making = true }
        defer { Motion.run(Motion.exit, reduce: reduceMotion) { making = false } }
        let refreshed = !(inv.shopifyCheckoutUrl ?? "").isEmpty
        do {
            let url = try await InvoiceFacts.paymentLink(inv)
            SecretPasteboard.copy(url)
            made(InvoiceNote(title: refreshed ? "Link refreshed and copied" : "Payment link created",
                             detail: "Checkout link copied to clipboard. Share it with the customer via WhatsApp or SMS."))
        } catch {
            failure = error.localizedDescription
        }
    }
}

extension View {
    /// The payment link for whichever invoice `invoice` is set to (InvoicePaymentLink); `made` says it is copied.
    func invoicePaymentLink(_ invoice: Binding<Invoice?>, made: @escaping (InvoiceNote) -> Void) -> some View {
        modifier(InvoicePaymentLink(invoice: invoice, made: made))
    }
}

// MARK: Import Shopify CSV

/// The page's "Import Shopify orders (CSV)": a Shopify orders export picked from Files, what it holds (the rows and
/// the first names, as the dialog shows them, read by the ERP), then each order written as an invoice numbered on
/// from the last invoice number. An owner's: the page's own Firestore write, which the shop floor cannot make.
struct InvoiceCSVImportSheet: View {
    let imported: (InvoiceNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var fileName: String?
    @State private var csv: String?
    @State private var preview: Preview?
    @State private var reading = false
    @State private var importing = false
    @State private var progress: [String] = []
    @State private var done: Done?
    @State private var failure: String?

    /// What the ERP read in the file.
    struct Preview: Equatable {
        let rows: Int
        let orders: Int
        let firstNames: [String]
    }

    struct Done: Equatable {
        let imported: Int
        let first: String
        let last: String
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                if let done {
                    Section {
                        Label("Import complete", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .foregroundStyle(Tone.settled.color)
                            .symbolEffect(.bounce, value: done)
                        Text(done.imported == 0
                             ? "The file held no Shopify orders (names like #1001), so nothing was imported."
                             : "\(done.imported) invoice\(done.imported == 1 ? "" : "s") saved, \(done.first) to \(done.last).")
                            .font(.subheadline)
                    }
                } else {
                    Section {
                        Button { picking = true } label: {
                            Label(fileName ?? "Choose a CSV file", systemImage: "square.and.arrow.down")
                        }
                        .disabled(importing)
                    } footer: {
                        Text("A Shopify orders export. Each order becomes an invoice, numbered on from the last invoice number.")
                    }
                    if reading {
                        Section { ProgressView("Reading the file…") }
                    } else if let preview {
                        Section {
                            LabeledContent("Rows", value: "\(preview.rows)")
                            LabeledContent("Shopify orders", value: "\(preview.orders)")
                            if !preview.firstNames.isEmpty {
                                Text("First entries: " + preview.firstNames.joined(separator: ", ") + (preview.rows > 5 ? "…" : ""))
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        } header: {
                            LedgerHeading(title: "In the file")
                        }
                    }
                    if !progress.isEmpty {
                        Section {
                            ForEach(Array(progress.enumerated()), id: \.offset) { pair in
                                Text(pair.element).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .navigationTitle("Import Shopify CSV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if done == nil {
                        Button(role: .cancel) { dismiss() }
                            .disabled(importing)
                    }
                }
                if done != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                if done == nil {
                    ActionBar(primary: ActionBar.Action(
                        preview.map { "Import \($0.orders) order\($0.orders == 1 ? "" : "s")" } ?? "Import",
                        systemImage: "tray.and.arrow.down", isBusy: importing,
                        isDisabled: csv == nil || reading || (preview?.orders ?? 0) == 0
                    ) { Task { await runImport() } })
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
                if case let .success(url) = result { Task { await read(url) } }
                if case let .failure(error) = result { failure = error.localizedDescription }
            }
            .failureAlert($failure, title: "Not imported")
        }
        .interactiveDismissDisabled(importing)
    }

    /// The file's words, then what the ERP reads in them (nothing is written yet).
    private func read(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            failure = "That file could not be read."
            return
        }
        let text = String(decoding: data, as: UTF8.self)
        fileName = url.lastPathComponent
        csv = text
        preview = nil
        progress = []
        reading = true
        defer { reading = false }
        do {
            // A look, not a change: each look is its own, so picking the same file again is never "already sent".
            let out = try await ERPAPI.shared.write("importShopifyCsv", ["csv": text, "preview": true, "look": UUID().uuidString])
            preview = Preview(rows: out["rows"] as? Int ?? 0, orders: out["orders"] as? Int ?? 0,
                              firstNames: out["firstNames"] as? [String] ?? [])
        } catch {
            csv = nil
            failure = error.localizedDescription
        }
    }

    private func runImport() async {
        guard let csv, !importing else { return }
        importing = true
        defer { importing = false }
        do {
            let out = try await ERPAPI.shared.write("importShopifyCsv", ["csv": csv])
            progress = out["progress"] as? [String] ?? []
            let count = out["imported"] as? Int ?? 0
            done = Done(imported: count, first: out["first"] as? String ?? "", last: out["last"] as? String ?? "")
            if count > 0 {
                imported(InvoiceNote(title: "Imported \(count) invoice\(count == 1 ? "" : "s")", detail: "Shopify CSV import complete."))
            }
        } catch {
            failure = error.localizedDescription
        }
    }
}
