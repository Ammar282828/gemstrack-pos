# The Mac app: how a screen is Mac-shaped

Owner, 2026-10-24: "make it fully mac shaped and native, EVERY SCREEN." The Mac compiles the iPhone's screens
(docs/features/mac-app.md); this is how each one gets a Mac's shape without the iPhone changing by a pixel.
Read apps/iphone/CONVENTIONS.md first: its rules (one brain, lenient models, no real data, the kit, quiet screens,
words) hold on the Mac too.

## The rule of the fork

- The iPhone's code path stays byte-identical. A Mac layout lives under `#if os(macOS)` in the **same file** as the
  screen (so it can use the screen's `private` state and functions), as an extension with a `macBody` (or Mac-only
  sub-views), and the screen's `body` picks it:
  `var body: some View { #if os(macOS) macBody #else <the existing body unchanged> #endif }`.
  Prefer moving nothing: wrap the old body as is.
- Logic is never forked: the Mac layout calls the same save/load functions, the same ERPAPI writes, the same ERPCore
  rules, the same `Book` shelves. Only arrangement, controls and chrome differ.
- No new UIKit. AppKit only where SwiftUI lacks it, under `#if os(macOS)`.

## What a Mac screen looks like

- **Windows, not phones.** The detail area is 700–1600 pt wide. Lay out in columns: a record's summary (who, totals,
  status) on the left or in an `.inspector`, its lines/pieces/payments in the main area; a hub's list as a `Table`
  with sortable columns (Mac/MacHub.swift has the five main ones already). No full-width phone rows stretched across
  a window; cap reading widths (`.frame(maxWidth: 760)`) for forms and text.
- **Forms** are `Form { … }.formStyle(.grouped)` (`.houseForm()` already does this on the Mac) with `LabeledContent`
  / labelled `TextField`s, `Picker` as a pop-up menu, `Toggle` as a switch, `DatePicker(.field or .stepperField)`.
  No steppers of pages: a flow the iPhone splits into steps (New sale, New order) is one window on the Mac — the steps
  as sections of one form, the bill/summary in a fixed column on the right, always visible.
- **The primary action** is `.actionBar(...)` (on the Mac a dialog footer: summary left, buttons right, Return is the
  default) or a toolbar `.confirmationAction` with `.keyboardShortcut(.defaultAction)`. Cancel is `.cancellationAction`
  (Esc). Destructive actions ask with `.confirmDestructive`.
- **Toolbars** carry the page's actions (`.primaryAction`), filters as a segmented `Picker` or `Menu` in `.principal`
  or `.automatic`, search as `.searchable(placement: .toolbar)`. A Mac page never puts its action buttons as big rows
  inside the content.
- **Right-click everything.** Every row or card that has swipe actions or a menu on the iPhone gets the same actions
  in `.contextMenu`, and a row that opens something also offers "Open in New Window" via
  `@Environment(\.openPlaceWindow)` (Mac/MacShell.swift) when it opens a Route.
- **Keyboard.** ⌘N/⇧⌘N/⌘P/⌘F/⌘O are the app's (MacCommands). A screen adds shortcuts for its own main actions
  (`.keyboardShortcut("s", modifiers: .command)` for Save on an editor, Delete key ⌫ for remove where safe with a
  confirm). Focus moves by Tab: give text fields `.focused` order where the iPhone relied on the keypad's Next.
- **Sheets** are Mac sheets: `.frame(minWidth:minHeight:)` sized to the content (forms 520–720 wide), title in the
  sheet's toolbar, Cancel/confirm in the toolbar or the footer. `presentationDetents` mean nothing on the Mac.
- **Hover**: cards that open something use `.ledgerCard().cardHover()` / `.pointerHover()` (a Mac pointer
  highlight). Help tags (`.help("…")`) on icon-only buttons.
- **Density**: Mac controls are `.controlSize(.regular)`; lists are `.listStyle(.inset)`; tiles and figures in a
  `Grid` that uses the width (4–6 across on a wide window), not the phone's two.
- **Photos and files**: drag and drop (`.dropDestination`), `fileImporter`, `PhotosPicker`; no camera (already handled).
- **Charts** (Swift Charts) get hover read-outs (`.chartOverlay` + `onContinuousHover`) where the iPhone uses a tap.
- **Words**: the ERP's (rule 6, 15). "Click", not "tap", in any text the Mac shows.

## Sizes are a pointer's, not a finger's (2026-10-25)

Owner: "doesn't seem very optimized for mac in terms of ui and ux". The Mac's screens were built from the iPhone's
parts at the iPhone's sizes. The kit now answers the Mac's own on macOS, so every screen takes them; a screen never
writes a phone's number:
- `Metrics.tap` (44 on a phone, 24 on a Mac) for any least height or width of a clickable thing; `Metrics.cardPadding`
  (16 / 12); `Radius` is 10/7/6/5 on a Mac (22/14/12/10 on a phone); `Monogram.Size` 26/28/44; list rows 28 (`houseGround`).
- Buttons in a page: `.buttonStyle(.houseGlass)` / `.houseGlassProminent` / `.houseProminent` (glass on a phone, push
  buttons on a Mac) and `.largeOnPhone()` instead of `.controlSize(.large)`. Glass on the Mac is the window's own (toolbar,
  sidebar), never a button in the content. `SkeletonLoading().controlSize(.large)` keeps its meaning (a whole page loading).
- `ledgerCard` is a Mac group box (the card colour, a hairline edge); `QuickAction` is a bordered button with its word.
- The pointer stays the arrow over cards and rows (the pointing hand is a link's); hover is a faint wash.
- **`pt(_:)`**: every literal spacing, padding, corner and fixed font size in a shared screen is written `pt(16)`: the
  number as written on a phone, 77% of it on a Mac (Apple's own ratio for an iPad app on a Mac, which the Mac's text
  styles already follow: body 13 pt against 17). A Mac-only body (`#if os(macOS)`) writes Mac numbers and no `pt`.
- **A classic Mac application** (owner: "operate as a classic native mac os application"): on the Mac `Theme.ground` is
  the window's background and `Theme.card` the system's content colour; lists and forms keep the system's backgrounds
  and draw their own rows and selection (`houseRows` does nothing there, `mineRow` is the accent's bar). The house shows
  in the accent only, as Mail and Finder carry the system's.
- New sale, New order, a repair and Scan open in a window of their own (`MacShell`'s `creating`), never a sheet over
  the main window.

## Done means

Each screen of the group: a Mac layout that uses the window (no stretched phone column), right-click on rows, the
actions in the toolbar or the footer, keyboard for the main action, and the iPhone's path untouched. `swiftc -parse`
on every file touched (`export PATH=/opt/swift/usr/bin:$PATH`). The Mac column of docs/parity.md says ✓ only after a
Mac build on Xcode Cloud has compiled it.
