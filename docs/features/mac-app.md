# Mac app

<a id="mac-app"></a>
**Mac app** (2026-10-24; owner: "build a native mac app. dont skip any screens. add label live functionality native").

**What it is.** A native macOS SwiftUI app (not Catalyst, not "Designed for iPad"), the `ERPMac` target in
`apps/iphone/project.yml`. It is the **same app record and bundle ID as the iPhone's** (`shop.taheri.erp`, a universal
purchase): one app in App Store Connect, macOS added as a platform, one TestFlight group ("Shop").

**Why one project, not `apps/mac`.** The Mac compiles the iPhone's `App/` and `Shared/` as they are, so every screen the
iPhone has (about 95 routes, every one of nav.ts's places) is on the Mac the day it is on the iPhone, with the same money
rules (ERPCore), the same writes (`/api/app/write`), the same Outbox. A fork would drift within a week. What differs is:
- `App/Platform/MacPlatform.swift` (compiled only on macOS): UIKit's names answered by AppKit (`UIImage` is `NSImage`,
  `UIApplication.shared.open` is NSWorkspace, haptics are silent, the phone's keyboard types and title sizes do nothing),
  so a screen never forks for the Mac. A screen says `#if os(macOS)` itself only where the Mac truly differs.
- `EnvironmentValues.layoutWidthClass` (Kit.swift) replaces `horizontalSizeClass` (AppKit's SwiftUI has none): always
  regular on a Mac, so every screen takes the iPad's wide layout.
- `apps/iphone/Mac/`: the Mac's own shell.

**The Mac's shell** (`apps/iphone/Mac/`):
- `MacApp.swift`: the app, its windows, the lock (Touch ID or the Mac's password, `AppLock` with a five-minute grace and
  no cover while another app is in front), push through `NSApplicationDelegate`.
- `MacShell.swift`: `NavigationSplitView`, the sidebar drawn from nav.ts's map (the same JSON the iPhone bundles) with the
  business chip at its head and the online-orders count beside Orders; the detail is a `NavigationStack` of `PlaceScreen`s,
  so every path opens its native screen or, where none exists, the ERP's page (`WebScreen`).
- Multiple windows: `WindowGroup(for: Route.self)`. File › Open in New Window (⌘O), the sidebar's context menu.
- `MacCommands.swift`: File › New Sale ⌘N, New Order ⇧⌘N, New Repair ⌥⌘N, Scan a Tag ⇧⌘T, Print ⌘P; Go › ⌘1–⌘9, Back ⌘[,
  Search ⌘F; View › Businesses ⇧⌘B; File › Import from iPhone (Continuity Camera: Take Photo, Scan Documents).
- `MacPrint.swift`: ⌘P prints the page in front: a piece's tag through Label LIVE, an invoice, an order's slip or a repair's
  receipt as the ERP's own PDF in the Mac's print panel.
- `MacSettingsWindow.swift`: ERP › Settings… (⌘,): Shop (owners), Labels, This Mac, Businesses.
- `MacTodayMenu.swift`: a menu-bar extra with today's figures for **every** business signed in on the Mac, from the widget's
  summary and the widget's key per business (`ERPWidgetLink`), so it shows what the iPhone's widget shows.

**Mac sizes (2026-10-25).** Owner: "doesn't seem very optimized for mac in terms of ui and ux". The shared kit answers
a Mac's sizes on macOS (`Metrics`, `Radius`, 28 pt rows, push buttons for glass, regular controls, group-box cards, the
arrow pointer), and a new sale, order, repair or scan opens in its own window. Then every spacing a shared screen writes
goes through `pt()` (77% on a Mac, Catalyst's "Match iPad" ratio, so room shrinks with the Mac's smaller text), and the Mac
takes the system's window and list backgrounds with the house in the accent (owner: "a classic native mac os application"). The rules: `apps/iphone/Mac/MAC-CONVENTIONS.md`.

**Fluid, as the Claude app is (2026-10-25 audit).** Owner: "you see how the claude app is a native mac app, i want it to
operate this fluidly". The data was already fast (every shelf painted from its file on disk, decoded off the main thread,
small changes slotted in without a re-sort, figures in `Memo`). What caught was the drawing and the gates:
- The five tables re-read, re-lowercased and re-sorted every record on every redraw, and a click on a row redraws them
  (Stock re-priced every piece at today's rates too). Their rows are now a `Memo` keyed on the shelf's revision, the
  search and the sort (`Single.revision` for the rates).
- Search worked its results out again on every ↑/↓; Analytics reckoned every figure again whenever the app came forward.
  Both are `Memo`s now.
- Each list loaded on its first click (a spinner over the table): the Mac reads them all in the background once the window
  is up.
- The business picker came before every launch (and in every new window), then Touch ID: on a Mac the app opens on the
  business last open (`LaunchPicker.askByDefault`, Settings → Businesses can ask again), and a window reopens on its place.
- ⌘K, Quick Open (`Mac/MacQuickOpen.swift`): any place, customer, invoice, order, piece or repair as you type, over the page.

**Designed as a Mac app (2026-10-25).** Owner: "audit the ui and ux, design from scratch for mac". The design is
`docs/features/mac-design.md`; the parts are `Mac/Kit/`, each place's Mac views are `Mac/Places/<area>/` beside the screens'
own `#if os(macOS)` bodies, the sidebar is `Mac/MacSidebar.swift`, the menus `Mac/MacCommands.swift`, Settings
`Mac/MacSettingsWindow.swift`.

## Label LIVE on the Mac and the iPhone

The tag logic is ERPCore's (`LabelLive.swift`, `LabelCSV.swift`: `src/lib/label-live.ts`, `label-live-values.ts`,
`label-csv.ts` ported case for case, 36 tests mirroring theirs, its link and JSON escaping compared byte for byte with the
TypeScript's output). Settings → Labels → Label LIVE (`/app/label-live`, `LabelLiveSettingsScreen`) is native on both:
paste the Integrate link, pair the variables, printer (on a Mac, a picker of its printers in Label LIVE's `System-<name>`
form), copies, test print, this device's print history. It saves through `updateSettings`, which now takes `labelLive`
(`src/lib/writes/settings.ts`, checked by `cleanLabelLive`, the web card's shape; `settings-label-live.test.ts`).

How a tag reaches Label LIVE (`App/Device/LabelLivePrinter.swift`):
- **On the counter Mac:** Label LIVE's HTTP API on `localhost:11180` first (a native app may call it; an https page may not),
  which answers whether it printed; else the `labellive://` link through NSWorkspace, as the web does. Label LIVE documents
  its HTTP API only in part (its integration guide shows `/api/v1/batch`); the app POSTs the print link's own query to
  `/api/v1/print` and, if this Label LIVE answers 404, uses the link for the rest of the session. **Unverified until it runs
  at the counter.**
- **From an iPhone (or another Mac):** Label LIVE has no iPhone app and no cloud. Its MQTT broker (port 1883, MQTT 3.1.1, no
  password; switched on in Label LIVE's settings) takes the same link on `$LL/url` and reports on `$LL/status`. The app
  speaks the least of MQTT itself (`MQTTOnce`, Network framework). Name the counter Mac in Settings → Labels → Label LIVE
  ("counter-mac.local"); the phone must be on the shop's Wi-Fi. The broker has no password: keep port 1883 off the internet.

## Building it

- **Xcode Cloud's "Mac release" workflow** (made by `asc.mjs mac-setup`, copied from the iPhone's release workflow): archives
  the "ERP Mac" scheme for TestFlight (internal) and builds the iPhone's "ERP" scheme beside it, so a Mac change that breaks
  the iPhone shows on the same run. Started by a line in `apps/iphone/MAC-RELEASES.md` on a `claude/` branch.
- **`.github/workflows/mac-status.yml`** runs on the same push: makes sure macOS is on the app record and the workflow exists,
  prints the newest finished run's results and every compile error with its file and line (`asc.mjs ci-runs`), and puts a
  valid Mac build in "Shop" (`builds --fix`, per platform: a Mac upload never displaces the iPhone's). It never waits for a
  run (2026-10-24, the Actions allowance ran out and the owner can't pay for more): while one is going, Xcode Cloud's own
  checks on the commit ("App | Mac release | …") say how it went, free. The "Shop" group has access to all builds, so a
  Mac build that passes reaches TestFlight even when this job cannot run.
- `keep-fresh` leaves the Mac workflow alone (it picks the iPhone's release line only).

### How a Mac change is checked (2026-11-01)

- **Xcode Cloud's 25 hours renew about the 17th of each month, not the 1st.** They ran out on 10-31 at 04:00 UTC; summing
  the builds back from then reaches 25 hours at 10-17 08:56, October's calendar total (about 32.6 h) is more than the plan
  holds, and a build made on 11-01 at 04:03 was still cancelled before it started (Taheri Release #159, `cancelReason`
  null). Apple pegs the period to the subscription ("a new billing period" when a plan is upgraded). Until it renews,
  every release line is cancelled before it starts, with no check on the commit.
- **`.github/workflows/swift-compile.yml`, "Swift compile", compiles both apps on every deploy, free.** GitHub bills macOS
  minutes ten to one only on a private repository; gemstrack-pos is public and every deploy pushes this history to its
  `main`, so the workflow runs there (on taheri-pos it is skipped). Two jobs, Mac ("ERP Mac") and iPhone ("ERP", for a
  device as Xcode Cloud's iOS actions are), unsigned, Debug (only `WebScreen.swift` differs under DEBUG), packages only
  from the committed `Package.resolved`, on the newest released Xcode on the runner (a notice names it). Its first run
  (63bcfac, on the image's default Xcode) failed only on "unable to type-check this expression in reasonable time", in
  code Xcode Cloud had built (`ArtworkEditor.swift:142` iPhone, `BusinessesScreen.swift:366` Mac): such an expression is a
  compiler-version cliff and slows every build, so split it (the Mac one was). Read it at `https://github.com/Ammar282828/gemstrack-pos/actions/workflows/swift-compile.yml`
  (WebFetch; the session's GitHub API does not reach gemstrack-pos): runs are by commit, the same SHAs as taheri-pos's
  `main`, and each run's summary lists every error with its file and line.
- **What each proves.** A green Swift compile says the code compiles; ✓ in `docs/parity.md` still waits for a Mac release
  on Xcode Cloud (the build in TestFlight is what "in the app" means). So compile first, free, and spend a release line
  only on code that compiles. If gemstrack-pos is made private (docs/security.md), switch the workflow off.

## Labels and Zebra (2026-10-24)

Owner: "use something to be able to directly print from mac app, for any zebra printer like i do through label live",
"make the label designer full interactive, use the label i will give you for reference", "copy label live one to one for
every feature i might need for these labels, and printing functionality and modes and numbers".
- **One tag model** (`src/lib/label-layout.ts` = ERPCore `LabelLayout`): text blocks, QR, six barcodes, lines, boxes,
  ellipses, pictures (threshold/Atkinson/Floyd), two tags a label (`{SKU_1}`/`{SKU_2}`), `{date:…}`, `{counter:…}`,
  transforms (`|upper`, `|fixed:2`, `|group`, prefix/suffix), hidden and locked fields, and the printer's settings
  (`printer`: transfer/direct, tear/peel/cut/rewind, gap/mark/continuous, darkness, speed, label top/shift, tear-off,
  orientation, mirror, home). ZPL by `src/lib/zebra-zpl.ts` = ERPCore `Zpl.swift`, byte for byte, text through `^FH_`.
- **Label LIVE import** (`label-lsc.ts` = `LabelLSC.swift`): a `.lsc` becomes the shop's tag (geometry and variable names
  only; never its data).
- **The designer** (Settings → Labels, `Screens/Settings/LabelDesigner/`, iPhone and Mac): the canvas drawn as it
  prints, drag, handles, rotate, nudge, align, distribute, layers, inspector, undo, preview with real pieces, import,
  copy ZPL, test print. Saves the whole layout through `saveLabelLayout`.
- **Printing** (`TagPrinter`, `ZebraTransport`): per device, Label LIVE or the shop's tag to a Zebra: Zebra Browser Print
  or a Mac printer sent raw (CUPS, `Mac/CUPS`), or a network address (both apps). Settings → Labels → Printer; the
  print-job sheet (copies, skip, counter start); ⌘P opens it, ⌥⌘P prints at once. Printer status by `~HS`.
- Not tried on a printer from here: the first prints at the counter are the test (Browser Print's JSON, raw CUPS in the
  sandbox, `~HS` parsing, picture darkness).

## Status

Kept current in [parity.md](../parity.md)'s Mac column. Every screen Mac-shaped (round 4, cb87c32) and the labels
(round 5, a82280c) built on Xcode Cloud, Mac and iPhone. Verified before: ERPCore's tests on Linux (487), the web's typecheck and
tests, and **the Mac target archived on Xcode Cloud with no errors** ("Mac release", commit c5080d8, 2026-10-24; the iPhone's
scheme built beside it). Round 1 (034ddeb) found 19 errors, all iOS-only SwiftUI that a same-named stand-in cannot cover (the
compiler prefers SwiftUI's own, marked unavailable): `contentShape(.hoverEffect)`, `listSectionSpacing`, the zoom transition,
`appLaunchDiagnostics`, a nested `NavigationBarDrawerDisplayMode`. They are platform modifiers now (`pointerHover`,
`sectionSpacing24`, `alwaysShownSearch`, `fieldKind`). Not yet verified: the build in TestFlight (the API-made workflow has no
TestFlight post-action; reading App Store Connect needs the Actions job), and the app run on a Mac.
