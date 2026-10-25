import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import ERPCore

/// Pictures on a tag. A photo or a file becomes the 1-bit bitmap a Zebra prints (ERPCore `LabelBitmap.fromRaster`:
/// threshold, Atkinson or Floyd–Steinberg), scaled to dots. The field keeps a small copy of the original (under
/// 64 KB, as the web does) so its dithering can be changed later.
enum LabelPicture {
    /// A picture's file or photo as a bitmap-ready image, never larger than `maxSide` on its long side.
    static func cgImage(from data: Data, maxSide: Int = 1600) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
        let pw = (props?[kCGImagePropertyPixelWidth] as? Int) ?? 0, ph = (props?[kCGImagePropertyPixelHeight] as? Int) ?? 0
        if max(pw, ph) > maxSide {
            let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                         kCGImageSourceThumbnailMaxPixelSize: maxSide]
            return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
        }
        return CGImageSourceCreateImageAtIndex(src, 0, nil)
    }

    /// Straight (not premultiplied) RGBA, the form `LabelBitmap.fromRaster` reads.
    static func decoded(_ cg: CGImage) -> DecodedImage? {
        let w = cg.width, h = cg.height
        guard w > 0, h > 0, w * h <= 16_000_000, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        var drawn = false
        buf.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            drawn = true
        }
        guard drawn else { return nil }
        for i in 0..<(w * h) {
            let a = Int(buf[i * 4 + 3])
            if a > 0 && a < 255 {
                for c in 0..<3 { buf[i * 4 + c] = UInt8(min(255, Int(buf[i * 4 + c]) * 255 / a)) }
            }
        }
        return DecodedImage(width: w, height: h, rgba: buf)
    }

    /// The decoder a Label LIVE import uses for pictures that are not PNG (and the app's own for the rest).
    static let importDecoder: (Data) -> DecodedImage? = { data in cgImage(from: data, maxSide: 4000).flatMap(decoded) }

    /// The original, small, as the PNG data URL a layout keeps (nil when it would be over 64 KB).
    static func sourceURL(_ cg: CGImage) -> String? {
        var image = cg
        for side in [400, 280, 200] {
            if max(cg.width, cg.height) > side, let down = shrink(cg, to: side) { image = down }
            guard let png = pngData(image) else { return nil }
            let text = "data:image/png;base64," + png.base64EncodedString()
            if text.utf8.count <= 64 * 1024 { return text }
        }
        return nil
    }

    private static func shrink(_ cg: CGImage, to side: Int) -> CGImage? {
        let k = Double(side) / Double(max(cg.width, cg.height))
        let w = max(1, Int(Double(cg.width) * k)), h = max(1, Int(Double(cg.height) * k))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }

    private static func pngData(_ cg: CGImage) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, nil)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    /// The picture inside a `data:image/...;base64,` URL.
    static func decodeSource(_ url: String) -> DecodedImage? {
        guard let comma = url.firstIndex(of: ","), url.hasPrefix("data:"),
              let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else { return nil }
        return cgImage(from: data).flatMap(decoded)
    }

    /// The bitmap of a picture at a size in dots.
    static func bitmap(_ img: DecodedImage, width: Int, height: Int, dither: LabelBitmap.Dither, threshold: Double, brightness: Double = 0) -> String {
        LabelBitmap.fromRaster(img.rgba, sourceWidth: img.width, sourceHeight: img.height, width: width, height: height,
                               dither: dither, threshold: threshold, brightness: brightness)
    }

    /// A field's picture made again from its kept original at its own size (after the dither or threshold changed).
    static func redone(_ f: LabelLayoutField, dither: LabelBitmap.Dither, threshold: Double) -> LabelLayoutField? {
        guard let src = f.source, let img = decodeSource(src), let w = f.width, let h = f.height else { return nil }
        var r = f
        r.bitmap = bitmap(img, width: w, height: h, dither: dither, threshold: threshold)
        r.dither = dither.rawValue
        r.threshold = threshold
        return r
    }
}

/// Add a picture to the tag (or, with `replacing`, give a picture field a new one): choose a photo or a file, see it as
/// the printer will print it, pick the dithering and the threshold, and its width on the tag.
struct LabelPictureSheet: View {
    let labelWidthDots: Int
    let dpi: Int?
    /// bitmap, width, height, dither, threshold, source
    let onDone: (_ bitmap: String, _ width: Int, _ height: Int, _ dither: String, _ threshold: Double, _ source: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var item: PhotosPickerItem?
    @State private var choosing = false
    @State private var cg: CGImage?
    @State private var image: DecodedImage?
    @State private var widthDots = 120
    @State private var dither: LabelBitmap.Dither = .atkinson
    @State private var threshold = 0.5
    @State private var brightness = 0.0
    @State private var problem: String?

    private var height: Int {
        guard let image else { return 1 }
        return max(1, Int((Double(widthDots) * Double(image.height) / Double(max(1, image.width))).rounded()))
    }

    private var bitmap: String? {
        guard let image, widthDots > 0, widthDots * height <= 2_000_000 else { return nil }
        return LabelPicture.bitmap(image, width: widthDots, height: height, dither: dither, threshold: threshold, brightness: brightness)
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    PhotosPicker(selection: $item, matching: .images) { Label("Choose a photo", systemImage: "photo") }
                    Button { choosing = true } label: { Label("Choose a file", systemImage: "folder") }
                    if let problem { Text(problem).foregroundStyle(.secondary) }
                } header: { LedgerHeading(title: "Picture") }

                if image != nil {
                    Section {
                        preview
                            .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                    } header: { LedgerHeading(title: "As it prints") }
                    Section {
                        Picker("Dithering", selection: $dither) {
                            Text("Threshold").tag(LabelBitmap.Dither.threshold)
                            Text("Atkinson").tag(LabelBitmap.Dither.atkinson)
                            Text("Floyd–Steinberg").tag(LabelBitmap.Dither.floyd)
                        }
                        VStack(alignment: .leading) {
                            Text("Threshold \(Int(threshold * 100))%")
                            Slider(value: $threshold, in: 0.05...0.95)
                        }
                        VStack(alignment: .leading) {
                            Text("Brightness")
                            Slider(value: $brightness, in: -0.5...0.5)
                        }
                        Stepper(value: $widthDots, in: 8...max(8, labelWidthDots * 2), step: 4) {
                            LabeledContent("Width", value: "\(widthDots) dots · \(LabelUnits.mmText(dots: Double(widthDots), dpi: dpi)) mm")
                        }
                        LabeledContent("Height", value: "\(height) dots · \(LabelUnits.mmText(dots: Double(height), dpi: dpi)) mm")
                    } header: { LedgerHeading(title: "Dots") }
                }
            }
            .houseRows()
            }
            .houseForm()
            .navigationTitle("Picture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let b = bitmap, let cg else { return }
                        onDone(b, widthDots, height, dither.rawValue, threshold, LabelPicture.sourceURL(cg))
                        dismiss()
                    }
                    .disabled(image == nil)
                }
            }
            .onChange(of: item) { _, next in
                guard let next else { return }
                Task {
                    if let data = try? await next.loadTransferable(type: Data.self) { load(data) } else { problem = "That photo could not be read." }
                }
            }
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.image]) { result in
                guard case .success(let url) = result else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let data = try? Data(contentsOf: url) { load(data) } else { problem = "That file could not be read." }
            }
        }
        #if os(macOS)
        .macSheetSize(minWidth: 520, minHeight: 520)
        #else
        .macSheetSize(minWidth: 520, minHeight: 560)
        #endif
    }

    private func load(_ data: Data) {
        guard let c = LabelPicture.cgImage(from: data, maxSide: 1200), let d = LabelPicture.decoded(c) else {
            problem = "That picture could not be read."
            return
        }
        problem = nil
        cg = c
        image = d
        widthDots = max(8, min(labelWidthDots / 3, 160))
    }

    @ViewBuilder
    private var preview: some View {
        if let b = bitmap, let out = LabelBitmapImage.make(b, width: widthDots, height: height) {
            Image(decorative: out, scale: 1).resizable().interpolation(.none)
                .aspectRatio(CGFloat(widthDots) / CGFloat(height), contentMode: .fit)
                .background(Color.white)
                .frame(maxWidth: .infinity, maxHeight: 220)
                .accessibilityLabel("The picture as dots")
        }
    }
}
