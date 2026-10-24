#if os(macOS)
import AppKit
import ImageIO
import UniformTypeIdentifiers

/// Paper for the ERP's readers (a bill, a parchi, an order slip) on the Mac: there is no document camera, so "scan" is the
/// Mac's open panel for the photos (or pictures of paper) the person already has, here from the Mac, from AirDrop, or from
/// File > Import from iPhone. They come back as the phone's scanner returns its pages: JPEG, no side longer than 2200 px.
@MainActor
final class DocumentScanner {
    struct Page { let jpeg: Data; let name: String }
    struct Failure: Error { let code: String; let message: String }

    static var isSupported: Bool { true }

    static func scan() async throws -> [Page] {
        let urls: [URL] = await withCheckedContinuation { cont in
            let panel = NSOpenPanel()
            panel.title = "Choose the photos of the paper"
            panel.prompt = "Choose"
            panel.allowedContentTypes = [.image]
            panel.allowsMultipleSelection = true
            panel.canChooseDirectories = false
            panel.begin { response in cont.resume(returning: response == .OK ? panel.urls : []) }
        }
        guard !urls.isEmpty else { throw Failure(code: "cancelled", message: "Cancelled") }
        let pages = await Task.detached(priority: .userInitiated) {
            urls.enumerated().compactMap { i, url in
                Self.read(url, longest: 2200).flatMap { $0.jpegData(compressionQuality: 0.82) }
                    .map { Page(jpeg: $0, name: "Scan \(i + 1).jpg") }
            }
        }.value
        guard !pages.isEmpty else { throw Failure(code: "failed", message: "Nothing was read from those files.") }
        return pages
    }

    /// The picture with the camera's turn applied and no side over `longest` pixels (ImageIO does both in one pass).
    nonisolated private static func read(_ url: URL, longest: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longest,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
    }

    /// The picture at most `longest` pixels on its longer side (the NSImage's pixels, drawn once into a bitmap).
    nonisolated static func fitted(_ image: UIImage, longest: CGFloat) -> UIImage {
        guard let cg = image.cgImage else { return image }
        let side = CGFloat(max(cg.width, cg.height))
        guard side > longest else { return image }
        let scale = longest / side
        let w = Int((CGFloat(cg.width) * scale).rounded()), h = Int((CGFloat(cg.height) * scale).rounded())
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return image }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage().map { UIImage(cgImage: $0) } ?? image
    }
}
#else
#if canImport(UIKit)
import UIKit
#endif
import VisionKit

/// Paper for the ERP's readers (a bill, a parchi, an order slip): Apple's scanner finds the page's
/// edges, squares it up and evens the light, which a photo of paper on a counter never is. The
/// ERP's "From Photos" stays beside it for a bill that arrived on WhatsApp.
@MainActor
final class DocumentScanner: NSObject, VNDocumentCameraViewControllerDelegate {
    struct Page { let jpeg: Data; let name: String }
    struct Failure: Error { let code: String; let message: String }

    static var isSupported: Bool { VNDocumentCameraViewController.isSupported }

    private var done: ((Result<[Page], Failure>) -> Void)?
    private static var current: DocumentScanner?

    /// The pages scanned, JPEG, no side longer than 2200 px: enough to read a bill, small enough to send.
    static func scan() async throws -> [Page] {
        guard isSupported, let top = Presenter.top else { throw Failure(code: "unsupported", message: "This phone can't scan documents.") }
        let scanner = DocumentScanner()
        current = scanner
        return try await withCheckedThrowingContinuation { cont in
            scanner.done = { result in
                current = nil
                cont.resume(with: result)
            }
            let camera = VNDocumentCameraViewController()
            camera.delegate = scanner
            top.present(camera, animated: true)
        }
    }

    private func finish(_ r: Result<[Page], Failure>) {
        let d = done
        done = nil
        d?(r)
    }

    nonisolated func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
        Task { @MainActor in
            controller.dismiss(animated: true)
            let pages = await Task.detached(priority: .userInitiated) {
                images.enumerated().compactMap { i, image in
                    Self.fitted(image, longest: 2200).jpegData(compressionQuality: 0.82).map { Page(jpeg: $0, name: "Scan \(i + 1).jpg") }
                }
            }.value
            self.finish(pages.isEmpty ? .failure(Failure(code: "failed", message: "Nothing was scanned.")) : .success(pages))
        }
    }

    nonisolated func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        Task { @MainActor in
            controller.dismiss(animated: true)
            self.finish(.failure(Failure(code: "cancelled", message: "Cancelled")))
        }
    }

    nonisolated func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            controller.dismiss(animated: true)
            self.finish(.failure(Failure(code: "failed", message: message)))
        }
    }

    nonisolated static func fitted(_ image: UIImage, longest: CGFloat) -> UIImage {
        let side = max(image.size.width, image.size.height)
        guard side > longest else { return image }
        let scale = longest / side
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
#endif
