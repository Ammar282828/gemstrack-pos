import UIKit
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
