// swift-tools-version: 5.9
//
// The phone's money against the ERP's: `swift run ContractCases > ../../contract/cases.json` (Linux or a Mac).
//
// ContractCases compiles the app's own New order and New sale logic (symbolic links into App/Screens, so it
// is always the code that ships) with a stand-in for App/Config/House.swift, builds orders and sales the way
// the screens do, and writes what each screen shows and what it sends. The ERP's tests then run those very
// payloads through /api/app/write and the web's own money (src/app/api/app/write/contract.test.ts):
// a figure the phone shows that the ERP would save differently fails there.
import PackageDescription

let package = Package(
    name: "Contract",
    platforms: [.macOS(.v14), .iOS(.v17)],
    dependencies: [.package(path: "../ERPCore")],
    targets: [
        .executableTarget(name: "ContractCases", dependencies: [.product(name: "ERPCore", package: "ERPCore")]),
    ]
)
