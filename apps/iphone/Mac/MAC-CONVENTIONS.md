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

## Fluid (2026-10-25)

- Anything worked out from a shelf for drawing (a table's rows, search results, a page's figures) is a `Memo` in the
  view's `@State`, keyed on the shelves' `revision` (and the search, the sort, the period): never recomputed per drawing.
  A click on a row, a hover, an arrow key or the app coming forward redraws a view; none of them may walk the books.
- A Mac never shows a spinner for a list it can have read already: the shell reads the day-to-day shelves at launch.
- No gate the person did not ask for between opening the app and the books: Touch ID, nothing else.

## The redesign (2026-10-25): docs/features/mac-design.md is the design

Read its ten rules and your place's section before touching a screen. The parts (apps/iphone/Mac/Kit/):
- `MacAction(title, symbol:, shortcut: KeyboardShortcut(...), role:, enabled:, isDefault:) { … }` — every action of a
  record, declared once. `.macRecordMenu(MacRecordMenu(title: "Invoice", groups: [[…], […]]))` on the place's root
  publishes them to the menu bar (only the root publishes; disable the actions while nothing is picked, never drop the
  menu). `MacActionItems(groups:)` draws them in a right-click menu; `MacToolbarAction(action:)` as a toolbar button
  (no key: the menu owns it); `MacActionButtons(actions:)` as the inspector's push buttons. A key lives only on its
  `MacAction` — delete the hidden zero-size shortcut buttons a Mac body used to carry.
- `MacStatus("Owed", tone: .owed)`; `.macSummaryBar(["214 invoices", "PKR 32.4 lac billed"])` at a list's foot;
  `MacFigures([MacFigure("Revenue", "PKR 32.4 lac", detail: "+12% on September", detailTone: .settled, open: {…})])` for a
  report's head; `MacInspectorHeader(title:subtitle:status:headline:actions:)`; `MacDocumentHeader` for a record window;
  `MacInspectorEmpty`; `.macInspector { … }` (the right-hand inspector with its toolbar toggle; it remembers itself);
  `.macSearchable(text:prompt:)` (the toolbar field ⌘F reaches); `.macRefresh { … }` (⌘R, for places that fetch);
  `MacComboBox(placeholder:text:items:pick:)` (a name with suggestions: never suggestion rows in a form).
- `MacLists` — the saved lists (`MacLists.list(in: path)` and the rules `MacLists.orders/invoices/repairs/customers`).
- Not yours to change: anything in `Mac/` outside `Mac/Places/`, `App/Nav/`, `App/UI/` (except where your brief says),
  `App/Config/Theme.swift`, the ERPCore package, any write or model. The shell (sidebar, menus, the rate, Settings) is
  being built beside you.
- No new sheet over a sheet; no confirmation after a sheet whose button already states what it does; no chips, no
  segmented control inside content (a toolbar segmented control for a place's views is fine); no hero figures, no
  `FigureTile`/`ledgerCard` cards on a Mac body, no serif (`LedgerHeading` → a plain `Text` section header); no
  `controlSize(.large)`; no "Tap" in words.

## The polish rules (2026-10-25, after the first real build: "ui is quite fucked")

What the owner's screenshot (13-inch MacBook Air, 1470 points) showed, and the rules that came of it:
- **A window grows to fit its content's minimum widths.** A Menu's label drew the shop's logo 500 points wide at the
  sidebar's head; the window went off the screen and took the table's last columns and the inspector with it. A list
  must work at 600 points: the sum of a table's column minimums ≤ 620, seven columns at most (the inspector has the
  rest), the name column the only wide one; nothing in an inspector wider than 240; a sheet's minimum ≤ 560 × 520.
- **A Menu's label is AppKit's.** macOS keeps one `Text` and one `Image` of it and drops every other view (a badge, an
  `HStack`'s layout, `.frame`, `.clipShape`); an asset or `NSImage` is drawn at its pixel size. Labels are
  `Label("…", systemImage:)`, `Text` or `Image(systemName:)`; a picture goes beside the Menu, not in it.
- **The toolbar is the place's, and short.** The shell's only items are Back and Forward (`.navigation`, ahead of the
  title: with nothing there, Tahoe drew the title over the sidebar). New Sale, New Order and Search (⌘K) are the
  sidebar's first rows; the day's rate and the business are below its list. A place's toolbar is its view switch
  (`.principal`, if it has two views), then ONE `.automatic` group of its New and one Filter menu (every filter inline
  inside it), the search field, and the inspector toggle `.macInspector` draws above the inspector.
- **`.primaryAction` is the LEADING edge on a Mac** (Apple's ToolbarItemPlacement docs; it is trailing on the iPhone).
  Trailing on a Mac is `.automatic`. Mac-only code writes `.automatic`; code both platforms compile writes
  `.trailingAction` (App/Platform/ToolbarPlacements.swift: `.primaryAction` on the iPhone, `.automatic` on the Mac), and
  the phone's `.topBarTrailing` is `.automatic` on the Mac. The polish's first build put every place's buttons at the
  left and pushed the title over the sidebar (owner's screenshots, 2026-10-25).
- **Nothing is laid over a list.** A `safeAreaInset` view over a sidebar or a list lets the rows scroll through it
  (transparent) and, at the top of a sidebar, sits under the traffic lights: put rows in the list, or a footer below it
  in a `VStack`. An empty table shows its empty state alone; tables have no zebra stripes (`.alternatingRowBackgrounds
  (.disabled)` at the windows' roots).
- **See it before guessing.** Help › Send Page Snapshots… (owners) walks every sidebar place and sends a picture of each
  to the ERP's Firestore `app_snapshots` (one JPEG per document, `run` groups a walk); a cloud session reads them with
  the Firestore REST API (`datastore.user`; `python3 apps/iphone/scripts/mac-snapshots.py <dir>` writes the newest run
  as JPEGs) and looks before it changes a page.
  A picked record's actions are the inspector's head, the menu bar's record menu and the right-click menu — never also
  the toolbar's. A record window may carry four actions and a More menu.
- **Money in a table is digits.** `MacAmount(value)` (grouped, right-aligned, blank for nil); the header names the
  figure, the summary bar and the inspector say "PKR".
- **Snappy:** a shelf walked, sorted or filtered in `body` is behind a `Memo` keyed on the shelves' `revision`; no
  `.animation` on a table or list; never `.id()` a table by its selection; `need()` on appear, never a reload.

## The iPhone's look, built for the Mac (2026-10-27)

Owner, after the page snapshots: "i want a clean layout, matching the ui features of ios app as much as possible, but
built for mac." This replaces the classic-Mac look of 2026-10-25 (system greys, group boxes, no cards):
- Every page on `Theme.ground`; `Theme.card`/`.houseCard()` are the house's, as on the iPhone (Radius.card 16 on the Mac).
- Records are the iPhone's rows in a `List(selection:)` (Monogram, name over a line, amount, Pill), not `Table`s;
  sorting is a "Sort by" picker in the Filter menu. Numeric reports may stay `Table`s, inside a card.
- Inspectors and record windows are the iPhone's record page: hero figure, pills, StageTrack/PaidBar, quick actions,
  sections as cards. Report heads are figure cards. Cards, LedgerHeading, FigureTile, HeroAmount are wanted.
- The Mac's structure stays: sidebar, toolbar (`.automatic`, never `.primaryAction`), inspector, windows, menus, keys.

## Windows, menus and the lock (2026-10-27, from the end-to-end review)

- **Menus answer from any window.** `MacCommands` reads the business in front (`Sessions.shared.current`), never only the
  main window's focused values: a New Sale window or Settings has no sidebar, and ⌘N, Lock Now and Sign Out still work there.
- **Behind the lock nothing of the books answers**: every book command is `.disabled(!ready)`; the shell closes ⌘K and voice.
- **Every New is its own window**: `MacWindows.fresh(route)` (a `w=` mark no screen reads). Plain routes reuse their window.
- **A window belongs to the business it opened on**: `MacPlaceWindow` closes when another business opens.
- **Back/Forward are a browser's**: a page opened by a link or ⌘K drops Forward; a role change forgets places it lost.
- Every one of these has a test in `MacTests` or `MacUITests`; a new rule here comes with its test.

## Done means

Each screen of the group: a Mac layout that uses the window (no stretched phone column), right-click on rows, the
actions in the toolbar or the footer, keyboard for the main action, and the iPhone's path untouched.
`python3 apps/iphone/scripts/mac-check.py` passes before every push (with `export PATH=/opt/swift/usr/bin:$PATH`): it
runs `swiftc -parse` on each changed file, compares each file's iPhone view (the `#if os(macOS)` branches stripped) with
`origin/main`, and finds a modifier left dangling after `#endif` (a branch that opens with a whole view leaves the
`.modifier` after it a statement of its own; parse passes it, the compiler does not: the polish's one failed build).
Push in one batch and wait for it: a push to a branch cancels the Mac build still running on it (the first fix's build was
cancelled so). The Mac column of docs/parity.md says ✓ only after a Mac build on Xcode Cloud has compiled it.
