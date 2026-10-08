import SwiftUI
import UIKit
import VisionKit
import Vision

/// The camera that reads a piece's tag, shared by Scan a tag and New sale's Scan. A tag's QR holds
/// the SKU (the web's scanner reads the same), possibly inside a link: the receiver takes the last
/// path part (`TagCode.sku(from:)`). The camera is Apple's DataScannerViewController, which finds a
/// QR or Code 128 by itself; text (a SKU printed on the tag) is read when it is tapped, so a stray
/// word on the counter never counts. Where the camera is not available (the simulator, or camera
/// access off) the SKU is typed instead, and typing is always offered beside the camera.
struct TagScanner: View {
    /// False pauses the camera, for a screen that is showing what it found.
    var active = true
    var height: CGFloat = 300
    /// The code as read or typed, untouched.
    let onCode: (String) -> Void

    @State private var typed = ""

    private var cameraSupported: Bool { DataScannerViewController.isSupported }
    private var cameraAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        VStack(spacing: 12) {
            if cameraAvailable {
                TagScannerCamera(active: active, onCode: onCode)
                    .frame(height: height)
                    .clipShape(.rect(cornerRadius: 22))
                    .overlay(alignment: .bottom) {
                        Text("Hold the tag's code in view, or tap a SKU printed on it")
                            .font(.footnote.weight(.medium))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .glassEffect(.regular, in: .capsule)
                            .padding(.bottom, 10)
                    }
            } else {
                unavailable
            }
            typeRow
        }
    }

    private var unavailable: some View {
        VStack(spacing: 8) {
            Image(systemName: "camera.slash").font(.largeTitle).foregroundStyle(.secondary)
            Text(cameraSupported ? "The camera is off for this app." : "This phone can't scan tags here.")
                .font(.headline)
            Text(cameraSupported ? "Allow it in Settings, or type the SKU below." : "Type the SKU below.")
                .font(.subheadline).foregroundStyle(.secondary)
            if cameraSupported {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .buttonStyle(.glass)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(.background.secondary, in: .rect(cornerRadius: 22))
    }

    private var typeRow: some View {
        HStack(spacing: 10) {
            TextField("Type the SKU", text: $typed)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { find() }
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(.background.secondary, in: .rect(cornerRadius: 14))
            Button("Find") { find() }
                .buttonStyle(.glass)
                .controlSize(.large)
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func find() {
        let t = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        typed = ""
        onCode(t)
    }
}

/// The camera itself. A QR or Code 128 reports as soon as it is seen; the same code is not reported
/// again for two seconds (the web scanner's debounce), so holding the tag still does not add it twice.
private struct TagScannerCamera: UIViewControllerRepresentable {
    var active: Bool
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr, .code128]), .text()],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.onCode = onCode
        if active {
            if !scanner.isScanning { try? scanner.startScanning() }
        } else if scanner.isScanning {
            scanner.stopScanning()
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onCode: (String) -> Void
        private var last: (code: String, at: Date)?

        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        /// On the main thread: the same code twice within two seconds is one read.
        @MainActor
        private func accept(_ code: String) {
            let now = Date()
            if let previous = last, previous.code == code, now.timeIntervalSince(previous.at) < 2 { return }
            last = (code, now)
            onCode(code)
        }

        nonisolated func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            // Codes report by themselves; text waits for a tap (didTapOn).
            for item in addedItems {
                if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue, !payload.isEmpty {
                    Task { @MainActor in self.accept(payload) }
                    return
                }
            }
        }

        nonisolated func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            switch item {
            case .barcode(let barcode):
                if let payload = barcode.payloadStringValue, !payload.isEmpty {
                    Task { @MainActor in self.accept(payload) }
                }
            case .text(let text):
                let transcript = text.transcript
                if !transcript.isEmpty {
                    Task { @MainActor in self.accept(transcript) }
                }
            @unknown default:
                break
            }
        }
    }
}
