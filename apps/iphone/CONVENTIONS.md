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
   any path without a native screen opens `WebScreen(path:)`, the ERP page inside the app.
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
