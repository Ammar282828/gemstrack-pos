// swift-tools-version: 5.9
// The ERP's models and pure rules in Swift, shared by the app and the widget (apps/iphone).
// Foundation only, so `swift test` runs on Linux too (no Mac needed to check the arithmetic).
import PackageDescription

let package = Package(
    name: "ERPCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ERPCore", targets: ["ERPCore"])],
    targets: [
        .target(name: "ERPCore"),
        .testTarget(name: "ERPCoreTests", dependencies: ["ERPCore"]),
    ]
)
