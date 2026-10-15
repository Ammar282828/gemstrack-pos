# The native Android app: how it is written

Read before adding anything here. The why is in `docs/features/android-app.md`; the design reference is the iPhone
app, `apps/iphone` (read `apps/iphone/CONVENTIONS.md` too: its rules hold here, in Android's terms).

## Shape

- `core/` — pure Kotlin (JVM, no Android). `erp.core.models` and `erp.core.logic` are ERPCore ported with its tests;
  `erp.core.entry` is the New order / New sale logic; the contract generator is in its tests
  (`./gradlew :core:contractCases`, `ContractTests` holds `contract/cases.json` equal to the iPhone's). `PORTING.md`
  maps Swift names to Kotlin. Run `./gradlew :core:test`.
- `app/` — the Compose app, `erp.app` under `app/src/main/kotlin`:
  `config` (House, Prefs), `auth` (Session, GoogleAuth), `data` (Book, ErpApi, FirestoreSource, ServerShelf, Demo,
  WorkDraftSync, OnlineInbox), `nav` (Route, ScreenRegistry, NavMap, RootGate, RootScaffold, PlaceScreen),
  `web` (WebScreen and the bridge), `device`, `ui` (the kit), `screens/<group>`.
- Build: `source /opt/android-sdk/env.sh` (or `scripts/setup-sdk.sh` in a fresh container), then from `apps/android`
  `./gradlew :app:assembleTaheriDebug :app:assembleMinaDebug :app:testTaheriDebugUnitTest :core:test`.
  Maven Central sometimes answers 429 here: retry after ~20 s; `--max-workers=2`.

## Rules

1. **One brain.** A rule that decides money exists in TypeScript first and in `core` second, ported line for line
   with its tests. Screens never re-implement a figure: they call `core`. Writes go only through
   `ErpApi.shared.write(op, fields)` (`/api/app/write`) with **exactly the iPhone's payloads** (same op names, field
   names, types, rounding) — read the Swift call site and match it key for key. Other ERP routes go through
   `ErpApi.shared.send/get/post/data`, the same paths and bodies as the iPhone.
2. **Parity with the iPhone.** Each Swift screen, sheet, action, menu item, empty state, error and word has its
   Compose counterpart. Port pure screen logic (`*Logic.swift`, `*Model.swift`, `*Figures.swift`) as plain Kotlin in
   the group's folder with JVM unit tests (port the Swift tests where they exist). Where the iPhone opens the ERP's
   page (`?web=1`, a path with no native screen), do the same: `LocalNavigator.current.open(path)`.
3. **Lenient models, ERP field names.** Models come from `core` (decoded leniently). Dates stay ISO strings; parse with
   `ERPDate` / show with `ShopDate.say`.
4. **No real data in the repo.** Fixtures, previews and tests use made-up names, phones and amounts only.
5. **Material 3 expressive, the house's palette.** Content sits on the house ground (`ErpColors.ground`), cards on
   `ErpColors.card` via `Modifier.ledgerCard()` / `SectionCard`; filled buttons in the accent with `ErpColors.onAccent`
   words. Use the kit before writing your own: `Tone` for every meaning-colour, `Radius` for every corner, `Pill`,
   `MoneyRow`, `HeroAmount`, `RowAmount`, `PaidRing`/`PaidBar`, `FigureTile/Row/Grid`, `LedgerHeading`,
   `LedgerSection`, `FilterChip`/`ChipRow`, `Monogram`, `TwoLine`, `ShelfState`/`SkeletonLoading`, `NotAvailableState`,
   `FailureAlert`, the `Note` banner (`LocalNoteState`), `PaymentSheet`, `EntrySteps`/`TransactionWorkspace`,
   `CustomerField`, `PdfDocumentScreen`, `Haptics`/`MoneyFeedback`/`DestructiveFeedback`, `zoomSource`/
   `zoomDestination`, `readableColumn`. `.heroSheen()` on the one hero card of a screen.
6. **Screens and their places.** A group lives in `screens/<group>/` with `<Group>Routes.kt` exposing
   `val <Group>Routes: List<ScreenRoute>` (`ScreenRoute.exact("/orders") { … }`, `ScreenRoute.item("/orders/") { id -> … }`)
   and adds one term to `NativeScreens.all` (first match wins: `/orders/add` before `/orders/`). A screen never makes
   its own navigation stack: it calls `ScreenTitle("…")`, `ScreenActions { … }` and `LocalNavigator.current.open(path)`.
   Sheets are `ModalBottomSheet`s (full screen on phones where the iPhone uses `.page`/large forms).
7. **Reading the books.** `val book = LocalBook.current`; `val orders by rememberShelf(book.orders)` (it calls `need()`),
   `rememberShelfStatus`, `rememberShelfItem(shelf, id)`, `rememberSingle(book.settings)`. Work out figures in
   `remember(revision)`/`derivedStateOf`, off the main thread when heavy. Owners' shelves are Firestore, live; staff's
   the stripped server copy: never show the hisaab, expenses or costs to anyone but an owner (`LocalSession.current.isOwner`).
   The shop's margin is for owners and staff, never a customer, blurred until tapped.
8. **The house's settings** come from `LocalSession.current.shop` (counter names, expense categories, partnership,
   website selling, the shop's name), never guessed. What a customer or karigar reads says `shop.name`.
9. **Large screens.** Phones are the baseline; at expanded width (tablets, unfolded foldables) follow the iPad:
   list-detail (`ListDetailPaneScaffold` from material3-adaptive) where the iPad shows a list beside its item,
   `TransactionWorkspace` for forms beside their summary, readable columns elsewhere (ScreenRegistry.readableWidth on
   the iPhone gives the widths).
10. **Accessibility.** Font scaling never clips (let text wrap; `FigureRow` stacks); every icon-only control has a
    `contentDescription`; touch targets ≥ 48 dp; Reduce Motion (`LocalReduceMotion`) honoured; haptics on money events.
11. **Words.** The ERP's own (docs/decisions.md "The name ERP", "Customer copy"): "Owed to you", "In the drawer",
    "Taken by", "hisaab", "karigar". Never "Najmi Market" or "Saddar".
12. **Comments say why**, briefly, in the ERP's voice (as the Swift and `src/lib` do).
13. **Demo and screenshots.** Every native screen must render from the demo books (`assets/demo.json`, launch extra
    `erp.demo=true`), and has a screenshot test (Roborazzi + Robolectric, `app/src/test/kotlin/erp/app/shots`): add a
    `@Test` to `ScreenShots` (or a class of your own on `ShotBase`) that calls `showPlace("/your/path")` and
    `shoot("name")`. Each runs at phone (411x891 dp) and tablet (1280x800 dp), light and dark, in the demo as the
    owner, with the clock pinned (`AppClock`) so a baseline does not age. Images are the committed review baseline in
    `app/src/test/screenshots/<house>/`: `./gradlew :app:recordRoborazziTaheriDebug` (and `…MinaDebug`) records,
    `:app:verifyRoborazziTaheriDebug` checks. A screen whose look depends on the house (palette, menus, name) records
    for both flavors; the rest call `onlyTaheri()`. Look at the images after recording.
14. **Shared helpers, not copies.** Before writing one, look in `erp/app/ui` (rows and pages: `Forms.kt`; paper and
    photos: `Paper.kt`; `SwipeActions`; `OwnerDeleteCodeSheet` for any delete that asks for the code; `PdfDocumentScreen`),
    `erp/app/device` (`ShareFiles.kt`: `shareFile`, `shareBytes`, `shareText`, `openAddress`, `viewFile`), `ErpApi.shared.bytes`
    for a file from the ERP, `House.margin`, `LocalNoteState` (the shell hosts the toast: never make your own host),
    `LocalNavigator.current.replace(path)` for a form that hands over to what it made, and `ScreenRegistry.readableWidth`
    (PlaceScreen already puts a native page in its column: do not add another unless the page needs a narrower one).

## Motion

The ERP's three curves and 150-400 ms live in `ui/Motion.kt` (docs/decisions.md "Motion"); everything is instant under
`LocalReduceMotion` (the system's "Remove animations"). Nothing loops, nothing animates on scroll, and per-frame work
is read in the layer (`graphicsLayer {}`), never in composition.

- **A list row that opens a page morphs into it and back.** Put `Modifier.zoomSource(path)` on the row or card
  (`corner =` its radius if it is not a card), and `Modifier.zoomDestination(path)` on the page's root, where **`path` is
  the page's route path, the same string `navigator.open(path)` is given** (`OrderPaths.order(id)`, `InvoiceFacts.path(id)`).
  `StackHost` provides the shared-transition scopes; the bounds travel in a `SharedTransitionLayout`, clipped to a
  corner that falls from the row's to square. Back, the button and the predictive gesture, folds the page into the row.
  Only the first source of an id on screen morphs (an invoice in Home's Needs you and Recent sales is one id).
  A page no row opens gets Material's shared axis (30 dp + fade); the back gesture scales it to 0.9 with rounded corners.
  Wrap the whole page (`ShelfState(modifier = Modifier.fillMaxSize().zoomDestination(path))`), not a part of it.
- **Tabs** fade through (`RootScaffold`); the create sheet rises from the corner of the create button.
- **Small things use the kit:** `Modifier.pressScale()` on a tappable card (0.98 and a spring back), `Modifier.appearOnce(index)`
  on a list's rows (first six, once, saved with the row), `NumericText`/`HeroAmount` for figures that change, `Pill` (colour
  cross-fades), `LedgerSection(collapsible)` / `motionContentSize()` for sections, `ErpPullToRefreshBox` for refresh
  (the expressive indicator), `NoteHost` for toasts. Tests: `shots/MotionTests` runs open -> back with a paused clock.
