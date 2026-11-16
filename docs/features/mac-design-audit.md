# Design review: ERP for Mac (2026-11-15)

Owner, 2026-11-15: "use this design skill and perform a comprehensive audit" (github.com/dickwu/apple-design-skill), after "add
cards for every available view … the list view looks very dated … ffs use glassmorphism/liquid glass". Method: the skill's
review process (context, references, five lenses, report), its `code-audit.md` for Liquid Glass in code, and its pages read
before citing: `liquid-glass.md`, `materials.md`, `designing-for-macos.md`, `lists-and-tables.md`, `collections.md`,
`sidebars.md`, `toolbars.md`, `windows.md`, `accessibility.md`, `typography.md`, `undo-and-redo.md`.

The same day another session audited all four surfaces with the same skill ([Design audit](../design-audit.md), shipped
in ERP 2.7.9: status ink colours, Increase Contrast, no repurposed or Control-key shortcuts, menus, no app appearance
switch). This is the Mac's own deeper pass (glass, layout, lists, interaction); where the two meet it says so.

**Context.** Desktop, SwiftUI on macOS 26 (Tahoe), the `ERPMac` target. A jeweller's ERP for two shops (owners and counter
staff) used for hours at a desk: orders, invoices, repairs, customers, stock, reports. The artifact is the source code; nothing
was run (no Mac in the cloud, and GitHub refused every Actions job on 2026-11-15, "account is locked due to a billing issue",
so nothing here is compiled or seen yet). Contrast is computed from the colour assets' values. **Thesis:** one counter's books
on a Mac, each record one click from what to do next. What it should be remembered by: the gold (Taheri) or rose (Mina) house
colour carried through a calm, dense, keyboard-first workspace.

### Summary

**Needs work** before this change, **Good** after it, pending a look on a Mac (it compiles: the owner's Release build at 70de6348, 2026-11-16 check). The app is native, Universal, keyboard-rich and
broadly HIG-shaped, but it fought Liquid Glass instead of using it: it painted opaque grounds under the window's own glass
(the inspector, a hand-built bottom bar) and kept the brand colour out of the content layer, so Tahoe's material had nothing
to show and the Mac looked flat. Its lists were an inset List with hairlines; there was no card view. One accessibility
failure class (tiny unlabelled icon buttons) and one contrast miss (Taheri's light accent on the page ground).

### Critical

- **What:** Icon-only buttons with a glyph-sized hit region (about 15 by 15 pt) and no spoken name: the piece tick in the order
  inspector and the order window's pieces, the team note's pencil, the exchange row's minus, the Workshop column's chevron.
  VoiceOver read "circle" or "pencil".
  **Why:** `accessibility.md › Offer sufficiently sized controls`: macOS "28x28 pt" default, "20x20 pt" minimum.
  **Fix (done):** a 22 pt hit region and an `accessibilityLabel` on each:
  `Mac/Places/Orders/MacOrderInspector.swift` (tick), `Mac/Places/Orders/MacOrdersRecordParts.swift` (doneCell),
  `Mac/Places/Reports/MacReportsToday.swift` (two pencils), `Mac/Places/NewOrder/MacNewOrderOrderForm.swift` (remove
  exchange), `Mac/Places/Workshop/MacWorkshopBoardView.swift` (open karigar).

### Improvements

- **High: glass painted over.** The inspector is the system's (`.inspector`, which Tahoe floats on Liquid Glass), but every
  panel was given `.background(Theme.ground)` (`Mac/Kit/MacParts.swift`, MacInspectorModifier; and in the panels themselves,
  e.g. `MacOrderInspector.swift`, `MacInvoiceInspector.swift`, `MacCustomersPlace.swift`), so it drew opaque.
  `liquid-glass.md › Where the material belongs`: "Differentiate controls from content… use a scroll edge effect instead of a
  solid or semi-opaque background color beneath them". **Fixed:** the inspector paints nothing (`macGrounded`), every panel's
  flat ground became `.macGround()`, which paints once, where nothing under it already draws, and never in the inspector.
- **High: a hand-built opaque bottom bar.** The list summary (`MacSummaryBar`) was a full-width strip on `Theme.ground` with a
  divider. `code-audit.md › Liquid Glass in code`: "A hand-built tab bar or toolbar… where `.toolbar` would do" misses the
  material; `windows.md`: "Avoid putting critical information or actions in a bottom bar… use it only to display a small amount
  of information directly related to a window's contents". **Fixed:** a floating capsule of regular Liquid Glass at the list's
  foot (counts and sums only, as Finder's status bar). To check on a Mac: the owner rejected a plain translucent bar on
  2026-10-27 because rows showed through the words; regular glass blurs them, and the list's last row rests above it.
- **High: no brand colour under the glass.** Every Mac page painted a flat `Theme.ground` (27 places), so the sidebar, toolbar
  and inspector glass had nothing of the house to take up. `liquid-glass.md › Color on glass`: "To express the brand through
  color, consider moving it into the content layer, where it scrolls beneath the glass and the material picks it up";
  `sidebars.md › Best practices`: "Extend visually rich content beneath the sidebar". **Fixed:** `MacGround` (the house ground
  with the accent's soft wash, the iPhone's Liquid Glass ground) on every page, extended under the sidebar with
  `backgroundExtensionEffect()` (`Mac/MacShell.swift`, MacPageGround); Increase Contrast gets the plain ground.
- **High: no Undo.** Nothing used an UndoManager, so ⌘Z did nothing. `undo-and-redo.md`: "Help people predict the results… you
  can modify the menu item labels to identify the result". **Fixed earlier today** (`MacUndo`, PR #182): status changes, piece
  ticks and repair steps, named ("Undo Mark Ready"), never money. Still open: `undo-and-redo.md › Show the results of an undo`
  (scroll to the record undone when it is off screen), Low.
- **Medium: every click waited.** Rows and board cards had a double-click gesture beside the single one, so SwiftUI held
  each click for the double-click interval (about a third of a second) before it picked anything: the "not snappy" a
  Mac user feels without naming it. **Fixed:** the click picks at once and the second click of a double-click opens
  (`onTapGesture` plus a simultaneous `TapGesture(count: 2)`, as Stock's gallery already did), in the record collection
  and on the Orders board.
- **Medium: the list was the dated part, and there were no cards.** An inset `List` with hairline separators on a flat ground.
  `lists-and-tables.md › Style`: "Choose a table or list style that coordinates with your data and platform". **Fixed:**
  `MacRecordCollection` (`Mac/Kit/MacRecordCollection.swift`) draws every place's records as tiles (List) or cards (Cards), one
  source, the same behaviour (click, ⌘-click, ⇧-click, double-click and Return, ↑ ↓ ← →, Esc, ⌘A, right-click, ⌘C, drag out,
  folding groups); Orders (List, Cards, Board), Invoices, Repairs, Customers (List, Cards); Stock's list as tiles beside its
  Gallery. The tiles and cards are content, so opaque (`liquid-glass.md › Review checklist` 1: "Glass on app backgrounds,
  cards, list rows, or content containers is a defect").
- **Medium: cards where there is only text.** `collections.md › Best practices`: "Consider using a table instead of a collection
  for text"; "collections are ideal for showing image-based content". List stays the default everywhere; Cards earn their place
  where a record has a picture. **Fixed** where there is one: an order card leads with its first piece's reference photo
  (else the catalogue pick's), an invoice card with its order's photo or the sold piece's stock photo (`MacCardPhoto`,
  read only for the cards on screen), as Stock's Gallery does. Customers and Repairs keep word cards: they have no
  pictures, so their List is the better view, and it stays the default.
- **Medium: toolbar items not all in the menu bar.** The layout control was in the toolbar only for most places, and the Filter
  menu's Taken by, Payment and Sort still are. `designing-for-macos.md › Best practices`: "Use the menu bar to give people easy
  access to all the commands they need". **Fixed:** View › as List / as Cards / as Board for every place
  (`Mac/MacCommands.swift`; no key, as 2.7.9 dropped Control-key shortcuts), and each place's Filter menu as View
  submenus: Taken By, Payment, Source, Sort By (`MacViewFilter`, `Mac/Kit/MacActions.swift`).
- **Medium: Taheri's light accent on the page ground is 4.03:1** (`#8A6B42` on `#ECE8E1`), under `accessibility.md`'s "Up to 17
  pts … 4.5:1" for text. It passes on cards (4.93:1, white) and in dark mode (10.27:1); Mina passes everywhere (15.02:1 light).
  Most accent text sits inside cards, so few places fail, but any accent link or caption drawn straight on the ground does.
  ERP 2.7.9 answers Increase Contrast with a darker gold (`#765832`); the everyday light gold is unchanged. Open (the house's
  palette is the owner's call, decision "Web matches the app"): `#80633D` reaches 4.56:1 on the ground with almost no
  visible change; or keep accent text on cards only.
- **Low: brand type in controls.** The ERP reads in Inter everywhere, the sidebar and controls included (decision "Fonts",
  2026-11-06). `typography.md`: system fonts are "designed for optimized legibility"; the skill's craft lens keeps system type
  for navigation and controls and brand type in content. Recorded, not reopened.
- **Low: an app-level interface style.** An app switch for what the system already governs (Reduce Transparency, Increase
  Contrast, the system's Liquid Glass look). Resolved: ERP 2.7.9 took the app appearance switch off the Mac, and the window's
  glass here is the system's whatever the iPhone's setting; content stays opaque.

### Craft notes

- **Point of view (Medium).** The house colour is the signature, and until now the Mac spent it on small type (links,
  captions) rather than on the surface. The wash under the glass moves it where Apple says brand belongs, and where it reads as
  the house rather than as a link colour. Keep the accent off controls other than the one primary action per view
  (`liquid-glass.md › Color on glass`).
- **Remove one accessory.** The summary capsule repeats the window subtitle's count; if it carries nothing but the count on a
  place, drop it there.

### What works

- Native SwiftUI with AppKit where it must (key monitors, CUPS), Universal Release builds, lazy lists and board columns, one
  web page left (Stories, as on the iPhone).
- The menu bar: New (⇧⌘N, ⌥⌘N…), Open, Print, Find, Quick Open (⌘K), Go (⌘1–9, ⌘[ ⌘]), a record menu on 47 screens,
  Settings in its own window; windows that reopen where they were; records in resizable windows of their own.
- System components that carry the glass for free: the sidebar (`.listStyle(.sidebar)`), the toolbar, the inspector, menus,
  sheets; a segmented layout control in the toolbar's centre.
- Tones that mean one thing each (owed amber, late red, settled green, credit teal), status capsules, monograms: one visual
  language from the iPhone to the Mac.
- Keyboard: Return and double-click open, Space previews an invoice's PDF, ⌘⌫ deletes with the code, ⌘C copies, ⌘Z undoes.

### Platform notes

- Everything here is macOS 26 API (`glassEffect`, `backgroundExtensionEffect`, `onKeyPress`, `onCommand`); the deployment
  target is macOS 26.0, so none needs a fallback.
- The iPhone's code is untouched by this change (`mac-check.py`); the one shared hook from earlier today, `RepairsDesk.stepped`, is
  nil there. Its content-layer glass (owner, 2026-11-03) is a separate decision this audit did not reopen; by the same checklist it
  would be a finding.
- Compiled (both schemes in Release on the owner's Mac at 70de6348, 2026-11-15, after an unrelated ERPCore one-line fix); not yet seen
  on a screen: the tiles' and cards' selection and keyboard focus, the inspector's glass, the summary
  capsule's legibility over a scrolling list, and the wash's strength under the sidebar.
