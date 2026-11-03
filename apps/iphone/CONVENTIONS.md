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
   A card's surface is `.houseCard()` (`Theme.card` in the flat 22 pt shape, with the mode's lift: a soft shadow in light, a 0.5 pt
   hairline in dark; never glass, never on something that fades or slides); `Theme.elevated` is the step above it (sheets, popovers,
   rows inside a card). Owner, 2026-10-25.
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

16. **Every screen behaves the same** (UI scan, 2026-10-17: twelve audits of every screen found each one solving
   the same things its own way). Rule 15 still holds: keep each screen's layout; these are the defaults *inside* it.
   - **Glass is the control layer only.** Floating bars, toolbars, the tab bar, sheets, the Create button. A button
     inside a List row, a card or a Form is `.bordered` / `.borderless` (or a plain row), never `.glass` /
     `.glassProminent` / `.houseProminent`; no `.ultraThinMaterial` / `.regularMaterial` on content. Two or more glass
     controls side by side sit in one `GlassEffectContainer` (`ActionBar` does this). Never glass on something that
     fades or slides in and out (the `Note` toast is a frosted card): glass forming mid-transition draws a stray
     "bubble" (owner, 2026-10-15 and 2026-10-17).
   - **One primary action per screen, and it never scrolls away.** On a page or a sheet whose job is one action
     (Save, Send, Take payment, Mark done, Publish), that action is the `.actionBar(...)` at the bottom (prominent,
     full width, busy state, a one-line summary such as the balance). A short sheet (≤ one screen of fields) may use
     the toolbar's confirm instead. Never both, never a second Save at the foot of the form.
   - **Sheets.** Their own `NavigationStack`; Cancel is `.cancellationAction`, the confirm is `.confirmationAction`
     (a read-only sheet has one `Button(role: .close)` leading). `.presentationDetents` fits the content
     (`[.medium, .large]` for a short form; nothing for a long one; never `[.large]` alone);
     `.interactiveDismissDisabled(busy || dirty)` on anything that saves or moves money; `.houseForm()` on a Form.
   - **Titles.** A tab's root and a hub (a list you pick from) use the large title (`hubTitleDisplay()`); a detail
     page, an editor and every sheet use `.inline`.
   - **Errors.** A refused action is `.failureAlert($failure)`; a page that could not load is `ErrorState(message,
     retry:)`; nothing is said in red text at the foot of a form. Empty is `EmptyState`, a search with no hits
     `ContentUnavailableView.search(text:)`, both as an `.overlay` of the list, never a row inside it.
   - **Destructive.** Every delete, remove, sign out, clear or empty asks first (`.confirmDestructive(...)`), sits in
     its own last section (or the bottom of a Menu after a `Divider`), and gives `destructiveFeedback`.
   - **Feel.** Every money write has `.moneyFeedback`; every other save, tick, toggle or send gives
     `.savedFeedback(trigger:)` (success) and a refusal `.refusedFeedback(trigger:)`; a filter or segment change gives
     selection feedback (`FilterChip` has it). A `Note` toast and `failureAlert` already tap, so an event
     that shows one adds no second feedback. Haptics fire on the event, never on each keystroke, and a scan that
     found nothing is a warning, not a success.
   - **Motion.** Every state change that moves layout runs through `Motion.run` / `.motion(value)`: rows inserting or
     leaving, a section appearing (`.transition(.opacity.combined(with: .move(edge: .top)))`), show more / fewer,
     filters, steps. Every figure that changes uses `.contentTransition(.numericText(value:))` inside that animation;
     symbol swaps use `.contentTransition(.symbolEffect(.replace))`. No `.animation(_:)` on a whole tree (only on the
     one view that changes, keyed by its value). Never `.id(x)` on a container to force a refresh: it kills scroll,
     focus and the transition.
   - **Lists.** Rows are the List's own (swipe actions, context menu, virtualised); a grid of cards inside one row is for the
     iPad's width only, and its cards still carry a context menu with the row's swipe actions;
     `ForEach` is keyed by a stable id, never `\.offset`. Every list or form that has a text field takes
     `.scrollDismissesKeyboard(.interactively)`; a number keypad gets the keyboard Done (`.keyboardDone()`).
   - **Dynamic Type.** No `.font(.system(size:))` for text (a glyph inside a fixed shape may); no
     `minimumScaleFactor` below 0.8 on a figure; any label-plus-value row stacks at accessibility sizes (`FigureRow`,
     `MoneyRow`, `AdaptiveStack`). Icon-only buttons carry an `accessibilityLabel` and a 44 pt target.
   - **Words.** Sentence case for every button and title ("Settle and carry over", not "Settle & Carry Over"); a
     count agrees with its noun ("1 piece"); no developer words a shop reads (Vertex, PITR, scopes, err, ids).

17. **Offline is a state, not an error** (owner, 2026-11-03: "it should fully handle not being connected at all in any
   situation"). The books paint from Firestore's cache and `ShelfSnapshots`; a screen that asks a route (`ERPAPI.get`)
   paints the last answer (`ReadCache`) when there is no line, so it never blocks or errors on the network. A creation or
   a payment (`Outbox.queueableOps`) that cannot reach the ERP is kept on the phone by `ERPAPI.write` under the request
   name made at the first tap, answers `["queued": true]` (check `ERPAPI.wasQueued(out)` before reading the new record
   from the answer), and goes by itself when the line returns; New order / New sale then finish as saved, and the record
   is a "Waiting to send" row at the top of Orders / Invoices (`PendingRecords`). Deletes, refunds, settlements and
   everything else that needs the ERP fail at once with "Needs a connection" (`ERPAPI.Failure.needsConnection`), never a
   spinner. A refusal (4xx) of a kept change keeps its data, says so app-wide with Retry, and can be discarded from
   Waiting to send (`WaitingToSendSheet`, opened by the offline capsule or Settings → This phone). A new money op that
   may wait is added to `Outbox.queueableOps` only if its callers never read the answer's record.

18. **Loading: a skeleton for a known shape, a circle for an unknown one** (owner, 2026-11-03: "fix all loading states").
   - **Known shape** (a list of records, a record's page, cards, figure tiles, a form's fields, a chart frame, a photo of a
     known frame, a settings section): a skeleton at the real content's heights, so nothing jumps when it arrives
     (`App/UI/Skeletons.swift`: `SkeletonRows`, `SkeletonCards`, `SkeletonFigures`, `SkeletonRecord`, `SkeletonThumbGrid`,
     `SkeletonChart`, `SkeletonPhoto`, `SkeletonForm`; a whole page is `SkeletonPage(shape:)`, and `ShelfState(shape:)`
     takes the screen's own shape). The shimmer is one soft pulse on the group and stops under Reduce Motion.
   - **Unknown shape** (an action under way: sending, saving, preparing a PDF, an AI scan, signing in, connecting, a
     search on the server, "checking…"): the system's circular `ProgressView`, with a few words when it lasts
     (`BusySpinner("Preparing PDF…")`, `inline:` in a row). In a button the spinner takes the label's place and the button
     keeps its size: `label.busy(isBusy)` with `.disabled(isBusy)` on the button.
   - Never a spinner for a list or page whose shape is known; never a skeleton for an action. A page that could not load
     is still `ErrorState`, offline is still `ShelfState`'s copy.

## Kit components

Reach for these before writing a screen's own. Files: `App/UI/Ledger.swift`, `KitComponents.swift`, `Note.swift`.

- **Colour: `Tone` only.** `.late` is a missed promise, `.problem` a failed or refused write (both red, never
  swapped), `.owed` amber, `.settled` green, `.working` blue, `.credit` teal. An order status is `Tone(status:)`.
  `Pill(text, tone:)` is the capsule; `StatusBadge` is a thin wrapper over it, kept for old call sites.
- **Corners: `Radius` only** (`card` 22, `chip` 14, `tile` 12, `thumb` 10), always `style: .continuous`. No bare numbers.
- **Cards:** `.ledgerCard()` for any card; `SectionCard("Title", count:, trailing:) { … }` for a titled one. In a
  List, `LedgerSection`. **`.heroSheen()` on the ONE hero card of a screen**, in place of `ledgerCard`.
  `PerforationDivider()` between a bill's lines and its totals.
- **Pointer:** `.ledgerCard().cardHover()` on a card that opens something (the highlight under an iPad's pointer); never on a card that only shows.
- **Money:** `MoneyRow(label, amount, tone:, lac:, emphasis:, signed:)` for a label and its sum; `RowAmount` inside
  custom rows; `HeroAmount` for the screen's one big figure (`unit:` + `text:` for a weight: `Weight.grams(g)`).
  Every sum passes `value:` to `.numericText(value:)`. `Money.signed(n)` ("+ / − PKR x"), `Money.minus(n)`.
  `PaidRing(paid:total:)` for a payment's progress (`PaidBar` where a thin bar fits better).
- **Failures:** `.failureAlert($message)` for a refused action (not an ad-hoc `.alert`); `NotAvailableState(title,
  why:, symbol:)` for what the person cannot have.
- **Saying something:** the `Note` toast. `.noteToast($note)` on the screen, then `Note.show(Note(title:), in: $note,
  reduce: reduceMotion)`. Never a bare `withAnimation`: use `Motion.run(_, reduce:)` (or `.motion(value)`).
  `OwnerNote` / `.ownerNote` still compile; new code says `Note`.
- **Saves: `Outbox`** (`App/Data/Outbox.swift`). A non-money save is `Outbox.shared.send(op:fields:business:label:)`: it returns at once,
  runs in the background with the same `requestId` on every retry, is kept on disk, and a failure is said app-wide with Retry
  (`pending` / `status(of:)` for a "Saving…"); a long send is `Outbox.shared.post(label:) { … }`. Money writes (`Outbox.moneyOps`)
  stay awaited through `ERPAPI.write`.
- **Feel:** `.moneyFeedback(success:failure:)` on a screen that takes or refunds money (triggers change only on
  the event); `.destructiveFeedback(trigger:)` where a delete or refund is confirmed.
- **List to detail:** `.zoomSource(id: route.path)` on the row, `.zoomDestination(id: path)` on the page's root
  view. `zoomScope()` is set on each NavigationStack by RootView; screens never set it. No-op without it.
- **Sheets' forms:** `.houseForm()`. **Steps:** `EntrySteps(selection:, states:)` shows done / needs a look.
- **People and dates:** `Monogram(name:, size: Monogram.Size.row | .card | .hero)`; `ShopDate.say(iso)` or
  `ShopDate.stamp(date, withTime:)`.
- **Rule 16's pieces** (`App/UI/Surface.swift`): `.actionBar(primary:secondary:summary:)` (bottom glass bar, one
  prominent action, busy state, stacks at AX sizes, hides over the keyboard); `ErrorState(message, retry:)`;
  `EmptyState(title, symbol:, message:, action:)`; `LoadingRow(label)` (an action's spinner and words; a list or page that is loading is a skeleton, rule 18); `.confirmDestructive(isPresented:, title:,
  message:, action:, perform:)`; `.savedFeedback(trigger:)` / `.refusedFeedback(trigger:)` /
  `.selectionFeedback(trigger:)`; `.keyboardDone()`; `AdaptiveStack { }` (HStack, VStack at AX sizes).

## Feel of the app (2026-11-03)

The owner's checklist of why the best apps feel smooth, held against this one. Rules that came out of it:

- **Press.** A card, row, tile or chip that opens something and sits in a button is `.buttonStyle(.pressable)` (`UI/Kit.swift`: 0.97 and a
  little dimmer while held, `Motion.exit` in and `Motion.enter` out, nothing under Reduce Motion), never `.plain`, which has no pressed
  state. Not for a button inside a Form or a toolbar (the system draws those), nor for glass (`.glass` presses itself).
- **Haptics are the five of the platform and nothing else.** success (`.savedFeedback`, `.moneyFeedback`, `SaveTap.play()` for a sheet that
  closes in the same breath), warning (`.destructiveFeedback`), error (`.refusedFeedback`, `failureAlert`, the Outbox's failure banner),
  selection (`.selectionFeedback`, `FilterChip`, the picker's choice), light impact (the pull-down search's threshold). A system `Toggle`,
  `Picker`, `refreshable` and `Menu` already tap: add nothing. Never on a keystroke; never twice for one event (a `Note` taps itself).
- **Work rests when nobody looks.** A poll or a clock that repeats is `.whileActive { … }` (`UI/Kit.swift`): it runs while its screen is on
  display and the scene is `.active`, and comes back by itself. A loop is "sleep, then do", so the return's own refresh and the loop never
  ask twice. A loop in a model (not a view) checks `scenePhase`/`foreground` itself (`ServerShelf`) and is nudged on return.
- **A hub does not reckon for nobody.** An opened tab stays alive and its body runs for every change of the books it reads. A hub that
  holds `Memo`s keeps `@State covered`, sets it with `.trackCovered($covered)` (on the title), and passes `resting: covered` to each
  memo; a hub that reckons in a `.task(id:)` puts `covered` in the key and returns early while covered (`Dashboard`, `AnalyticsScreen`).
  Reckoning that gates the first paint is `.userInitiated`; every later refresh of it is `.utility`.
- **Glass in a sheet is the cheap look.** Under the Liquid Glass style a card is true glass (`.glassCard()`, `FigureTile`, `HeroSheen`,
  `RecordCard`) only on a page, a few per screen and grouped in a `GlassGroup`; scrolling rows and chips are `.glassRow()` (no blur).
  A sheet is glass already (HIG: no glass in glass): a sheet's Form gets `.onGlassSheet()` through `houseForm()`, and a sheet whose
  root is a ScrollView of cards calls `.onGlassSheet()` itself (`DashTakenSheet`). Code: `UI/GlassSurface.swift`.
- **Spacing is `pt(n)`**, in every padding and stack/grid spacing of a screen (a Mac scales it; a phone is unchanged). A literal is for a
  glyph inside a fixed shape and for the Mac's own `#if os(macOS)` code, which is already in Mac points.
- **The first frame is the launch screen's colour.** `UILaunchScreen`'s `Launch-<house>` equals the house's `Ground` in light and dark; the
  business picker reads that same colour (not `systemBackground`), so nothing flashes between the two. Change them together.
- **Crashes name their place.** `Breadcrumb.note(path)` (`Support/Diagnostics.swift`, called by `PlaceScreen`) keeps the screen and the
  business; the next launch adds "last screen: /orders/·, mina" to every MetricKit report's `terminationReason`. Ids are never kept
  (a path keeps its first word and a known verb). A number from the server that becomes an `Int` goes through `Int(clamped:)`.
- **Release is built for speed.** `project.yml` states the release settings (`-O`, whole module, dead-code stripping, no testability,
  stripped product, dSYM) so the iPhone, iPad and Mac archives do not depend on Xcode's defaults. `CADisableMinimumFrameDurationOnPhone`
  stays in `App/Info.plist`: without it an iPhone draws at 60 Hz.
