# The native Android app: how it is written

Read before adding anything here. The why is in `docs/features/android-app.md`; the reference for what a screen does and says is the
iPhone app, `apps/iphone` (read `apps/iphone/CONVENTIONS.md` too: its rules hold here, in Android's terms). How it looks is Material You, not the iPhone's look (rule 5).

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
5. **Material You (2026-10-26): Material 3 Expressive on the business's own colour.** The look is Android's own (Pixel's Settings,
   Clock, Wallet), not the iPhone's: no serif, no shadows, no hairline borders on cards. A screen says roles, not hexes.
   - **Colour is tonal and from a seed.** `ErpTheme` grows every Material 3 role (primary/secondary/tertiary and their
     containers, surface, `surfaceContainerLowest`..`Highest`, outline, error) from the open business's accent with Google's
     Material Color Utilities (`ui/theme/Scheme.kt`, TonalSpot, light and dark). Say `MaterialTheme.colorScheme.*`; the old names
     are aliases and still compile (`ErpColors.accent` = primary, `onAccent` = onPrimary, `ground` = surface, `card` =
     surfaceContainer, `elevated` = surfaceContainerHigh). Settings > This phone > "Wallpaper colours" swaps in Android 12+'s
     `dynamic*ColorScheme`; it is off by default because the business's colour is how staff tell Taheri from House of Mina.
   - **Surfaces are tone, never shadow.** The page is `surface`; a card or a group of rows is `surfaceContainer`; sheets and menus
     one step higher; the one hero card of a screen (`.heroSheen()`) is `primaryContainer`. Cards are `Modifier.ledgerCard()` /
     `SectionCard` (extraLarge, 28 dp); "yours" is `ledgerCard(lit = true)`, a wash of the primary container, never an outline.
   - **A list of rows is a segmented group** (Android 16 Settings): each row its own tile, 2 dp apart, the group's outer corners
     extraLarge and the joints extraSmall. `LedgerSection`, `FormSection`, `SettingsSection`, Search and `SegmentedColumn` draw it;
     a row is a child with `ledgerRow()`; a `LedgerDivider()` inside is only a marker (in a plain card it is a hairline). Lazy
     lists of rows use the same corners by place (`cardEdges`). Never wrap a group's rows in a card of your own.
   - **Shapes** are `Radius` (the Expressive scale: card 28, chip 16, tile 12, thumb 8, joint 4); **type** is the Material 3
     scale in the system sans (`ErpType.heroNumber` displaySmall, `tileValue` titleLarge, `heading` titleMedium, all emphasized,
     digits tabular); a section's heading (`LedgerHeading`) is sentence case in the primary.
   - **Components:** import `erp.app.ui.Button/FilledTonalButton/OutlinedButton/TextButton/IconButton` (their shape morphs while
     pressed), `Switch` (with its icon), `SegmentedButton` + `SingleChoiceSegmentedButtonRow` (a connected button group),
     `FilterChip` (Material's, with the check), `SearchBarField` (the search bar), `Loading`/`ContainedLoading` (the expressive
     loading indicator), `morphCard` for a card that is itself the button. Pushed pages get the large flexible app bar that
     collapses on scroll (PlaceScreen), tab roots the small one. Meaning-colours are `Tone` (tonal palettes harmonised toward the
     seed; a pill is a container with its on-container words). The kit's other parts: `Pill`, `MoneyRow`, `HeroAmount`,
     `RowAmount`, `PaidRing`/`PaidBar`, `FigureTile/Row/Grid`, `LedgerHeading`, `Monogram`, `TwoLine`, `ShelfState`/`SkeletonLoading`,
     `NotAvailableState`, `FailureAlert`, the `Note` banner (`LocalNoteState`), `PaymentSheet`, `EntrySteps`/`TransactionWorkspace`,
     `CustomerField`, `PdfDocumentScreen`, `Haptics`/`MoneyFeedback`/`DestructiveFeedback`, `readableColumn`.
   - Filled primary buttons carry `onPrimary` words; do not hand-roll a card (`background(...).clip(RoundedCornerShape(..))`), a
     border, a shadow, a serif or a hex ground: add to the kit instead.
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

## Motion (the platform's own page transitions since 2026-10-15)

The ERP's three curves and 150-400 ms live in `ui/Motion.kt` (docs/decisions.md "Motion"); everything is instant under
`LocalReduceMotion`. Nothing loops, nothing animates on scroll, per-frame work is read in the layer (`graphicsLayer {}`).

- **Every pushed page is its own Activity** (`PageActivity`, the path in an extra): `LocalNavigator.current.open(path)` starts
  one, `back()` finishes it, `replace(path)` starts the new one and finishes this. Android draws the open/close animation and
  the predictive back gesture; never add `overridePendingTransition`, `overrideActivityTransition` or a window animation style,
  and do not intercept Back except for an unsaved form. `AppShell` is what both activities wear.
- `zoomSource` / `zoomDestination` are inert now (no shared scopes between Activities); leaving them in is harmless.
- **Tabs** fade through (`RootScaffold`); the create sheet rises from the corner of the create button.
- **Small things use the kit:** `Modifier.morphCard(onClick)` on a card that is itself the button (its corners morph from extraLarge to large
  while pressed, then spring back), buttons and icon buttons morph by the kit's own wrappers, `Modifier.appearOnce(index)`
  on a list's rows (first six, once, saved with the row), `NumericText`/`HeroAmount` for figures that change, `Pill` (colour
  cross-fades), `LedgerSection(collapsible)` / `motionContentSize()` for sections, `ErpPullToRefreshBox` for refresh
  (the expressive indicator), `NoteHost` for toasts. Tests: `shots/MotionTests` runs open -> back with a paused clock.
