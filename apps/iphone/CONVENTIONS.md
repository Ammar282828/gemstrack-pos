# The native iPhone app: how it is written

Read before adding anything here. The why is in `docs/features/iphone-app.md`.

## Shape

- `Packages/ERPCore/` — Swift package, **Foundation only** (no UIKit, SwiftUI, Firebase). The ERP's
  models (`Models/`) and its pure rules (`Logic/`), ported from `src/lib` **with the same tests**
  (`Tests/ERPCoreTests/`). Runs on Linux: `PATH=/opt/swift/usr/bin:$PATH swift test` in that folder.
- `App/` — the SwiftUI app (iOS 26). `Shared/` — code the app and the widget both compile.
  `Widget/` — the WidgetKit extension. The Xcode project is generated from `project.yml` (XcodeGen);
  never commit an `.xcodeproj`.

## Rules

1. **One brain.** A rule that decides money (balances, hisaab, advances, totals, owed, cash) exists in
   TypeScript first. Port it to ERPCore line for line with its vitest cases as XCTest cases, or call the
   server. Never invent a Swift-only variant. Writes that move money go through ERP server routes
   (`App/Data/ERPAPI.swift`), never straight to Firestore.
2. **Lenient models.** Every model decodes with `init(from:)` using `KeyedDecodingContainer.string /
   double / int / bool / list / object` (`Support/Lenient.swift`). A missing or odd field gives a
   default, never a thrown error. Keep the TypeScript field names exactly (`balanceDue`, `paymentHistory`).
   Dates stay `String` (ISO) in models; parse with `ERPDate.parse` where needed.
3. **No real data in the repo.** gemstrack-pos is public. Fixtures and tests use made-up names, phones
   and amounts only.
4. **Liquid Glass (iOS 26), the HIG way.** Glass belongs to the navigation and control layer: the tab
   bar, toolbars, floating buttons (`.buttonStyle(.glass)` / `.glassProminent`, `.glassEffect(...)`
   inside a `GlassEffectContainer`), sheets. Content (lists, forms, cards of figures) is never glass:
   use `List`/`Form` with the system grouped styles. The house's accent is `Theme.accent` via `.tint`.
   SF Symbols only; `NavIcon.symbol(for:)` maps the ERP's lucide names.
5. **Every ERP place stays reachable.** Menus come from `App/Resources/nav-<house>.json` (exported from
   `src/lib/nav.ts`, `npm run nav:export`). A screen is registered by its ERP path in `ScreenRegistry`;
   any path without a native screen opens `WebScreen(path:)`, the ERP page inside the app. A button never opens
   the ERP page on purpose (no `?web=1`, no "Open in the ERP"): what it does is built natively. A link inside an
   ERP page to a place with a native screen opens that screen (WebBridge `open`).
6. **Words.** The ERP's own words (docs/decisions.md "The name ERP", "Customer copy"): "Owed to you",
   "In the drawer", "Taken by", "hisaab", "karigar". Never "Najmi Market" or "Saddar".
7. **Comments say why**, in the ERP's voice, briefly, as in `src/lib`.
8. **Screens and their places.** A group lives in `App/Screens/<Group>/` with `<Group>Routes.swift`, and adds
   one term to `NativeScreens.all`. A screen never makes its own `NavigationStack` (each tab, and the create
   sheet, already has one that resolves `Route`s); it links with `NavigationLink(value: Route(path:))`. A
   native screen sets its own title. `?web=1` on any path opens the ERP's page even where a native screen
   exists (edit, refund, delete, print); a path the ERP serves at its own address (`/customers/<id>/edit`)
   falls through by itself.
9. **Reading the books.** `@Environment(Book.self)`, `.need()` on every shelf read, `shelf.items` /
   `shelf.item(id)` (both observed). Owners' shelves are Firestore, live; staff's are the stripped server
   copy: never show the hisaab, expenses or costs to anyone but an owner. The shop's margin ("We earn") is for
   owners and staff, never a customer, and blurred until tapped (decision "Margin", shop-margin.tsx).
10. **Writing.** Only `ERPAPI.shared.write(op, fields)` (`/api/app/write`), which runs the browser's own
   `src/lib/writes/*`. A new kind of change gets its shared write there first, used by the browser too.
   Each change is named (ERPAPI) and the ERP records a name once, so a double tap is never a double payment.
11. **The house's settings** (counter names, expense categories, partnership, website selling, the shop's
   name) come from `session.shop` (/api/app/me), never guessed from the books or from `House.id`. Anything a
   customer or a karigar reads says `session.shop.name`, never `House.storeName` ("… ERP").
12. **The look.** Screens sit on `HouseGround`; cards and tiles on `Theme.card`; list sections take
   `.houseRows()`; a filled button is `.buttonStyle(.houseProminent)` (its words in `Theme.onAccent`, as the
   web's --primary-foreground), never the system's white on the house's light dark-mode accent.
   All native pages share the ledger hierarchy: `LedgerHeading` / `LedgerSection` for section titles,
   `HeroAmount` for the main balance, `FigureTile` for supporting figures, and `FilterChip` for filters.
   Use `FigureRow` / `FigureGrid` so supporting figures stack at accessibility text sizes. Let names,
   descriptions and figure details wrap; keep every field and action reachable by scrolling rather than
   shrinking text or clipping information to fit a fixed card height.

13. **One app, many businesses.** `House` is a facade over `Businesses.shared.current` (Config/Businesses.swift): every
   property is computed, so never keep a House/Theme value in a `static let` or a stored global. A setting that belongs
   to one business is read and written through `BizKey("name")`; Firebase through `Businesses.shared.auth` /
   `.firestore` / `.firebaseApp` (never `Auth.auth()` or `Firestore.firestore()`); a long-lived singleton that holds
   a business's data gets `static var shared` + `static func reset()` and is added to
   `Businesses.resetPerBusinessState()`. Built-ins ship in `Resources/businesses.json` (`node scripts/businesses.mjs`).
14. **The switcher and the widget.** `BusinessChip` heads every tab root (and the iPad sidebar); the list, adding and removing are
   `BusinessesScreen` (`/app/businesses`, also the chip's sheet, presented by `ERPApp`'s `BusinessHost` via
   `Businesses.shared.switcherOpen`). The widget links are one per business in `ERPWidgetLink` (Shared); the widget reads
   nothing of the build's Info.plist for its look. A branch on `House.id == "mina"` is a bug: use a descriptor field
   (`metal`, `flags`) or, if the server has none, `House.bundledArt` and say so in a comment. The app icon changes only
   from Settings (`AppIcon`), never on a switch.

15. **Quiet screens** (owner, 2026-10-17: "the invoices tab is very noisy", then "I liked the old card ui for invoices
   and orders, just wanted it to be less noisy"). Keep each screen's layout as it is: its cards, monograms, tiles,
   stage tracks and row shapes. Take away only the noise inside them:
   - **The expected state has no badge** (but an order keeps its status: its stage words in their colour and Paid,
     owner 2026-10-17 "i liked the status of the orders"). Elsewhere Paid, done, active, connected, running: nothing. Colour is for what needs
     someone (owed, late, a problem, in credit), one coloured thing per row or card.
   - **No number twice** on a screen, and no second coloured line under a header that repeats a row's figure.
   - **No tags for the obvious** ("You" is a small quiet glyph), no subtitle that repeats its title, no footer that
     explains the obvious; a footer is for a consequence (money moves, something is deleted, a customer is messaged).
   - A wrapping caption is held to one line where the detail page already says it.

## Kit components

Reach for these before writing a screen's own. Files: `App/UI/Ledger.swift`, `KitComponents.swift`, `Note.swift`.

- **Colour: `Tone` only.** `.late` is a missed promise, `.problem` a failed or refused write (both red, never
  swapped), `.owed` amber, `.settled` green, `.working` blue, `.credit` teal. An order status is `Tone(status:)`.
  `Pill(text, tone:)` is the capsule; `StatusBadge` is a thin wrapper over it, kept for old call sites.
- **Corners: `Radius` only** (`card` 22, `chip` 14, `tile` 12, `thumb` 10), always `style: .continuous`. No bare numbers.
- **Cards:** `.ledgerCard()` for any card; `SectionCard("Title", count:, trailing:) { … }` for a titled one. In a
  List, `LedgerSection`. **`.heroSheen()` on the ONE hero card of a screen**, in place of `ledgerCard`.
  `PerforationDivider()` between a bill's lines and its totals.
- **Money:** `MoneyRow(label, amount, tone:, lac:, emphasis:, signed:)` for a label and its sum; `RowAmount` inside
  custom rows; `HeroAmount` for the screen's one big figure (`unit:` + `text:` for a weight: `Weight.grams(g)`).
  Every sum passes `value:` to `.numericText(value:)`. `Money.signed(n)` ("+ / − PKR x"), `Money.minus(n)`.
  `PaidRing(paid:total:)` for a payment's progress (`PaidBar` where a thin bar fits better).
- **Failures:** `.failureAlert($message)` for a refused action (not an ad-hoc `.alert`); `NotAvailableState(title,
  why:, symbol:)` for what the person cannot have.
- **Saying something:** the `Note` toast. `.noteToast($note)` on the screen, then `Note.show(Note(title:), in: $note,
  reduce: reduceMotion)`. Never a bare `withAnimation`: use `Motion.run(_, reduce:)` (or `.motion(value)`).
  `OwnerNote` / `.ownerNote` still compile; new code says `Note`.
- **Feel:** `.moneyFeedback(success:failure:)` on a screen that takes or refunds money (triggers change only on
  the event); `.destructiveFeedback(trigger:)` where a delete or refund is confirmed.
- **List to detail:** `.zoomSource(id: route.path)` on the row, `.zoomDestination(id: path)` on the page's root
  view. `zoomScope()` is set on each NavigationStack by RootView; screens never set it. No-op without it.
- **Sheets' forms:** `.houseForm()`. **Steps:** `EntrySteps(selection:, states:)` shows done / needs a look.
- **People and dates:** `Monogram(name:, size: Monogram.Size.row | .card | .hero)`; `ShopDate.say(iso)` or
  `ShopDate.stamp(date, withTime:)`.
