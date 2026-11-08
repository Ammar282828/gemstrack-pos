# Performance

Audit of 2026-11-01 against a 31-point app-speed checklist (BreakingBreach's toolkit), on web, iPhone/Mac and Android.

## Where the time goes

- **Distance.** Cloud Run (us-central1) and both Firestores (`nam5`) sit together in the US; the shop is in Karachi,
  ~250-300 ms a round trip. A Firestore's location can't change, so the lever is fewer trips and the on-device caches
  (web IndexedDB, iPhone 512 MB + on-disk snapshots, Android persistent cache), never a move.
- **Whole collections.** Every surface listens to whole collections (invoices, orders, hisaab, expenses, products…)
  because Analytics, balances and search read all history. Fine at today's size; the first open of a new device and
  memory grow with history. Bounding it (a recent window + load older on demand, with an explicit all-history path for
  Analytics and hisaab) is the next structural step, and needs the owner's call. Photos inside product documents
  (`data:` URIs) ride in every products snapshot; moving them to URLs would shrink it.

## Done 2026-11-01

- Web: jspdf, recharts and html5-qrcode load on demand; the Zebra script is injected only when printing; timeouts on
  every server fetch (`lib/http/timeout.ts`); lazy/async images in the grids; deferred search on Invoices, Customers,
  Products and the palette; a day's cache on `/public` images and fonts; `gzipJson` (`lib/http/gzip-json.ts`) on the
  big JSON routes (site pieces, pieces, edits, staff collections, backup).
- iPhone/Mac: Home and Analytics figures worked out off the main thread (keys by Karachi day / 15 minutes, not every
  minute); debounced, memoised list search; invoice days stamped once per revision; cached image loads everywhere;
  API decoding off main and one retry of a timed-out GET; MetricKit's daily speed summary to `/api/app/diagnostics`
  (`kind: metrics` in `app_diagnostics`).
- Android: first answers sorted off the main thread; a Coil loader (15% memory, 200 MB disk); `erp.core.models`
  declared stable to Compose (`app/compose_stability.conf`); 10 s connect and one retry for GETs; debounced search;
  notification channels off the launch path.

## Open

- Android: a Baseline Profile (+ `androidx.profileinstaller`), and dropping `proguard-preview.pro` from release so R8
  optimises the app's own code — both need a run on a real phone first.
- Web: the remaining static jspdf imports (`hisaab-pdf.ts`, `repair-pdf.ts`, `order-slip-pdf.ts`,
  `expense-report-pdf.ts`); web-vitals reporting. (The bare `useAppStore()` calls were fixed in the 2026-11-03 pass.)
- All: the history window above.

## Phone web pass 2: what a tap feels like, 2026-11-08

Owner, after pass 1: "still not very intuitive, snappy or smooth as a whole". Measured as a hand would: the time from a tap to the
first change on screen, and the longest freeze, iPhone 13 emulation, CPU 4x, production build (scratchpad journey script).

- **Tabs answered nothing for ~1.8 s.** The Orders page drew its whole history at once (0.8 s React + 1.6 s style/layout,
  a 23,000px page) and the tab bar's lit tab followed the pathname, so nothing moved until the new page was ready. Now
  the tapped tab lights at once (`pending`, tab-bar.tsx), and Orders and Invoices draw 40 rows then more as you scroll
  (`useGrowing` / `takeRows`, hooks/use-growing.ts; the count is kept per page for the visit so Back returns to the same
  place). Both also drew the desktop table hidden behind the phone's cards; now one or the other (`useWide`).
  Tap Orders: first change 1,772 -> 164 ms, longest freeze 655 -> 132 ms. Back to Orders: 1,319 -> 273 ms frozen.
- **Invoice rows on a phone** opened by `router.push` with no prefetch and no pressed state: now `usePrefetchIntent` (loads on
  touch-down) and `press-row`. Their actions are one row: the quick-print icon beside Print (two identical printers) is gone
  from the phone card (kept on the desktop row and the invoice), Print is the printer alone (`PrintButton iconOnly`), the total
  one size down so it no longer runs to the card's edge.
- **Header on a phone**: pass 1 dropped its blur but kept the desktop's half-clear fade, so rows showed through behind the
  title. Solid behind the bar, a 0.75rem fade below.
- **Order page pieces**: photo above the details below `sm`; beside them the metal read "Gold (2…" and every price wrapped.
- **Section headings** (`LedgerHeading`): the title keeps its width, the count truncates (Customers read "Rec…").
- Icon + short label buttons (Customers/Expenses Add, Invoices Import, Shareholders) had no gap on a phone.

## Phone web pass, 2026-11-08

Owner: "the erp on web on phones is quite un optimized, glitchy, laggy, and buttons sizes are wrong in dock".
Measured on a production build, iPhone 13 emulation, CPU throttled 4x (rAF frame times while scrolling, tab-tap timing).

- **Dock (Liquid Glass).** The capsule took the generic `.glass-bar` padding: items sat top-aligned, the lit pill was oversized
  and ran to the rim, and the microphone and create button (placed for a 49px bar) sat on its top edge. The capsule is now
  3.625rem with its own item styling (`.tab-bar` / `.tab-item`, globals.css), `--tabbar-h` follows it, and every floating button
  and the page's bottom padding are placed from `--tabbar-h`.
- **Blur on a phone.** Below 768px only the tab bar keeps a backdrop-filter (18px, no saturate); the header, toolbars, tabs,
  rate chip and FABs use near-opaque fills. Several stacked full-width backdrop-filters re-sampled on every scrolled frame
  (proposal 2 below). The headless measure can't see GPU blur cost; this is fewer filters, not a measured number.
- **Shell script.** The command palette, microphone and map sheet load after the first paint (`next/dynamic`, app-layout.tsx);
  `openCommandPalette` moved to `search/open-palette.ts` so the shell no longer pulls the palette in. The layout chunk went
  59 KB -> 22 KB gzipped, parsed on every first load.
- **Components declared inside a render.** `const Section: React.FC = …` inside a page is a new component type each render, so
  React threw away and rebuilt its whole subtree on every keystroke and every snapshot. Customers, Karigars, Workshop, My work,
  Expenses, Calendar and the karigar picker now call these as functions. Don't declare components inside components.
- **Customers.** Drew every customer twice (phone cards and the hidden desktop table) and all at once (~1,100 rows, a
  112,000px page). It now draws one layout (`useWide`) and the cards 60 at a time as you near the end (`Growing`). Scroll:
  6 -> 2 janky frames; page height at load 112,037 -> 13,270px. A per-row `content-visibility` was tried first and was worse
  (31 janky frames: rows laid out on every frame of a flick).
- **Draft writer** compares a cheap key (`workKey`, draft-writer.ts: long strings such as photos reduced to length + tail) instead
  of stringifying photos on every change (half of proposal 1).
- Not done: the order form's top-level `form.watch()` (proposal 1's other half). The money panel reads every field, so it is a split
  of the form into `useWatch` parts, a larger change to the shop's main form.

## Frame-rate pass, web, 2026-11-03

Goal (owner): locked 60 fps, 120 on ProMotion. An audit of `src/app`, `src/components`, `src/lib` client code. What is
already fine and was left: dialogs, sheets and the accordion animate transform/opacity/keyframes; scroll listeners are
passive (`use-scrolled.ts`); Orders, Invoices and Customers already skip off-screen rows (`.cv-list`); recharts and
html5-qrcode are dynamic; the order photos live in `order_photos`, not in the order.

Changed:
- **Store subscriptions.** 52 `useAppStore()` calls with no selector, and 10 selectors that returned a new object, re-rendered
  their page on *every* snapshot of *any* collection (Home, Orders, Invoices, Customers, Sale, Scan, Products, Hisaab, the order
  and invoice viewers…). All now `useShallow` (`zustand/react/shallow`) over the keys they read. Write new ones the same way;
  never `useAppStore()` bare and never a bare `state => ({…})`.
- **Selectors that built a new array per call** (`selectCartDetails`, `selectProductWithCosts`) are memoised on the cart / product
  and settings identity; before, Sale, Scan, New and the piece page re-rendered on every store change.
- **Snapshots keep unchanged rows** (`createDataLoader`, `lib/store.ts`). Firestore's `docChanges()` says which documents moved;
  the rest keep the object from the previous snapshot, and a snapshot with no change (the cache -> server hand-over) sets nothing.
  Every `useMemo` / `React.memo` over a collection now sees a stable row. (Optimistic edits are still overwritten by the next
  changed snapshot, as before.)
- **Sorting by date parsed twice per comparison** (~n log n `parseISO` calls; ~100k for 5,000 invoices): Home's recent sales,
  Orders, Invoices, Activity log use `newestFirst` (`lib/sort-by-time.ts`), one parse per row.
- **Search**: Orders and Hisaab now filter on `useDeferredValue`, as Invoices, Customers and Products already did.
- **Lists**: Products grid, Hisaab accounts and Activity log skip off-screen rows (`.cv-list`); Products' cards/rows are
  `React.memo` with stable callbacks (ticking a box re-renders one card, not the grid) and their thumbnails have `sizes`.
- **jsPDF off the hot pages**: Hisaab, Hisaab ledger and Expenses import their PDF drawers when you press Print; Orders, Invoices,
  the order page and Repairs go through `lib/pdf-lazy.ts`, which opens the iOS window first (it must happen in the tap) and
  hands it to the drawer (`preOpened`). Before, every visit parsed jsPDF + the drawers.
- **Auth context** value is memoised (it was a new object on every gate render, re-rendering every `useAuth()` consumer).
- `transition-all` removed (toast, QR frame, queue thumbnail: now the properties that change); the create-menu's full-screen
  `backdrop-blur-[2px]` is gone (a full-viewport backdrop-filter during its fade-in); `decoding="async"` on every `<img>`.

Proposed, not done (needs the owner or a larger change):
1. **Order form re-renders whole on every keystroke** (`order-form.tsx:498` `form.watch()`), and the draft writer then
   `JSON.stringify`s the whole form, photos included, every time it fires (`use-work-drafts.ts:168`). Split the money panel and
   the draft into `useWatch` on the fields they read; compare a cheap key (lengths + non-photo fields) before stringifying.
2. **`backdrop-filter` over scrolling content** on the fixed bottom bars and the sticky Hisaab toolbar (`glass-bar`, `glass-toolbar`,
   `backdrop-blur`). Liquid Glass is the owner's choice (`docs/features/liquid-glass.md`); on a phone, offer "Reduce transparency"
   automatically when `devicePixelRatio >= 3` and frame time is poor, or drop the blur from bars that are already 95% opaque.
3. **Products with `data:` photos** ride in every products snapshot and are cloned per snapshot (now only for changed rows).
   Moving them to Storage URLs is the structural fix (above).
4. **Index keys** on lists with controlled inputs (`repairs/page.tsx:164`, `voice-command-editor.tsx:122`, `order-scanner.tsx:227`)
   are correct but re-mount rows on removal; use a row id.
5. A true windowed list (`@tanstack/react-virtual`) only if a list passes ~3,000 rows on a phone; `.cv-list` is enough today.

### How to verify (Chrome DevTools > Performance, and the React Profiler)
Use a production build (`npm run build && npm start`), CPU 4x slowdown, Network "Fast 4G", Slow mode off, Screenshots on.
1. **Orders / Invoices typing**: record while typing 6 letters in the search. Expect the input task < 16 ms and the list render
   as a separate low-priority task; no "Long task" bar over 50 ms. Before: one 100+ ms task per key.
2. **Idle re-renders**: React Profiler, record 30 s on Home with another tab editing an expense. Expect Home to commit only when
   expenses/orders it reads change, and zero commits on `settings`/`products` snapshots. Check "Why did this render?".
3. **First paint of a snapshot**: Performance, reload Orders; in the Main track find `onSnapshot` handlers. A second snapshot
   (cache -> server) should produce no commit now.
4. **Scroll**: Products grid with 500+ pieces, scroll fast, Rendering > Frame rendering stats: steady 60/120 fps, no red
   frames; Layers panel shows no full-screen repaints.
5. **Bundle**: Network, disable cache, open Orders: `jspdf` / `jspdf-autotable` chunks must not load until Print is pressed.
   Lighthouse "Reduce unused JavaScript" for /orders drops by the jsPDF chunk.

## Native-feel pass, web, 2026-11-03

Owner's 7-point checklist ("feel like the best native apps"). Built on top of the frame-rate pass above; nothing there was redone.

- **Freeze what you aren't looking at.** `lib/visible-interval.ts` (+ `hooks/use-visible-interval.ts`) is the one interval: it drops its timer
  while the page is hidden and catches up once on return. Every poll and clock uses it: the staff collections and settings polls
  (`store.ts`), the Design board's list, the Posts / Investments / queue refreshes, the Analytics day-turn check, the rate chip, Today,
  the website order hold line, the waiting-orders count, My work, and the already-guarded Live / Shopify / library polls (those used to
  keep a timer that did nothing). Owner-side data is Firestore listeners, global in the store by design (Analytics, balances and search
  read whole history), so there is no per-page listener to detach; the page-level ones (`use-work-drafts`) unsubscribe on unmount.
  `lib/idle.ts` (`whenIdle`) runs the PDF logo warm-up and the service worker registration after first paint; Invoices' tab chips and month
  filter use `useDeferredValue` (the chip lights at once, the list follows). No `forceMount`; Radix tabs and dialogs mount only what shows.
- **Fewer crashes.** `components/shared/section-boundary.tsx`: `SectionBoundary` (an inline card with Retry; Retry re-mounts so a lazy chunk
  downloads again), `withBoundary` (the 7 dynamic charts: Analytics' five, the website sessions chart, Shopify's), `LoadError` (a failed
  fetch: message + Retry). Home's four sections and the Taken-by-day dialog, and Analytics' three breakdowns, are boundaries. A per-section
  `error.tsx` (Website, Analytics, Ads, Insights, Posts, Design, Settings; `components/shared/segment-error.tsx`) keeps the person in the
  section. `lib/global-errors.ts`: `unhandledrejection` is logged and toasted once (not for aborts, offline, or the same message within 15 s;
  never on a customer's page). `lib/safe-date.ts` `formatDate` replaces 54 `format(parseISO(x), …)` calls, which threw on a record with a
  missing or mangled date and took the page down; money was already guarded (`rupees`, `lacCrore` coerce NaN to 0) and every `JSON.parse` on
  the client was already in a try. My work no longer says "No work account found" when the server is down (Retry instead); Website
  Visitors and Shopify show `LoadError`.
- **Micro-interactions.** `future.hoverOnlyWhenSupported` in `tailwind.config.ts` wraps every `hover:` in `@media (hover: hover)` (the glass
  CSS hovers too); the toast close and a hover-only caption stay visible on touch. `.press` (scale 98%) and `.press-row` (tint) in
  `globals.css`, both off under Reduce Motion, on Home's tiles and rows, Orders / Hisaab cards and Customers rows (the Button already
  pressed). A brand-coloured `:focus-visible` ring for anything interactive a component did not style (`:where()`, so every component's own
  ring or `outline-none` wins). `touch-action: manipulation` on controls; buttons are not text-selectable. Toasts: 4 s, 7 s for an error
  (was 5 s for both), 15 s for a failed background save. Haptics: `lib/haptics.ts`, a 10 ms tick on a success toast and a double tick on an
  error toast through `navigator.vibrate` (Android; iOS and desktop ignore it), off under Reduce Motion or `localStorage['gemstrack:haptics']='off'`.
  Empty states: Products, Analytics (2) and Ads campaigns moved to `EmptyState`.
- **Motion.** Audited: no `ease-in-out`, `ease-linear`, `transition-all` or one-off cubic-bezier in components; the only ones were four in
  `globals.css`, now `--ease-enter / --ease-exit / --ease-sheet` and `--dur-press / --dur-fade`. A bare `transition-*` used Tailwind's stock
  curve; `transitionTimingFunction.DEFAULT` is now `ease-enter`. Left: `duration-500` on a progress bar and `duration-700` on the board's
  "new" ring (both fills, not UI motion), `ease-in-out` on the link page's waiting pulse (a public page with its own look).
- **Perception of speed.** `lib/background-save.tsx` + the customer and karigar forms: a non-money save (edit; or a new one that goes back to
  the list) starts, the screen is left at once and the result is toasted when known, with Retry on failure that keeps what was typed. A second
  tap cannot make a second record. Money writes (sales, orders, payments, hisaab) stay awaited, as the rules say; a new customer from
  another form (`onSubmitSuccess`, or "to hisaab") still waits because the caller needs the id. `hooks/use-prefetch-intent.ts`: the
  Invoices table row (an onClick, no `<Link>`) prefetches on hover / touch-down. Every other list row is a `<Link>`, which Next prefetches
  in view; every route has a `loading.tsx`. Dialogs: no handler awaits a fetch before opening one (checked by search). The shell re-renders
  on navigation only to move the active highlight; its heavy parts are not props that change.
- **Refresh rate.** No `setInterval` moves anything on screen (the intervals above are data and clocks); drags use pointer events and
  `requestAnimationFrame` in the editors only; there is no `will-change` anywhere.
- **Precompile / startup.** `public/sw.js`, registered by `lib/sw-register.ts` after load, production only, not in the iPhone app, not on the
  customer's pages. Cache-first for `/_next/static` (hashed), stale-while-revalidate for fonts / icons / brand / manifest and for exactly
  `/?source=pwa` (the new `start_url`, `id: '/'` keeps the install's identity), network-first (3 s) with the last copy of that URL, then
  `/~offline`, for other pages. It never answers non-GET, `/api/*`, `/__/*`, other origins, Next's RSC / prefetch requests, `/view-invoice`,
  `/links`, or an address with a token / key / code. Caches are `erp-sw-v1-*`, pruned (600 / 120 / 30 entries). **Off switch:**
  `NEXT_PUBLIC_DISABLE_SW=1` (unregisters and clears on the next visit); bump `VERSION` in `sw.js` to drop every cache. `/sw.js` is served
  `no-cache` with `Service-Worker-Allowed: /` (`next.config.ts`). The older `public/service-worker.js` kill-switch stays. Manifest now also has
  `scope`, `lang`, `display_override`, `categories` and two shortcuts (New sale, Orders); the page has the `apple-mobile-web-app-*` tags.
  `reactStrictMode: false` is deliberate and was left; compression is Next's default; fonts are `next/font/local` (preloaded); no third-party
  scripts; the boot script sets the page ground before paint.

### How to verify (needs a browser or a phone)
1. **Freeze:** DevTools > Network, open Home, switch to another tab for 2 minutes: no `/api/staff/collections` requests while hidden, one on
   return. Console: `performance.getEntriesByType('resource')` after returning.
2. **Service worker:** `npm run build && npm start`, Application > Service Workers shows `sw.js` activated; reload once, then Network shows
   `(ServiceWorker)` for chunks and fonts; tick Offline and reload `/orders` (the offline page or the last copy), and `/?source=pwa` paints.
   Check Cache Storage holds no `/api/` entry. Install to the home screen and cold-launch with the phone in airplane mode: the shell and the
   dashboard skeleton must paint (data then comes from Firestore's own cache). After a deploy, the first launch is the previous version.
3. **Boundaries:** in the React DevTools throw from one Home card (or block `analytics-charts` chunk in Network): only that card shows the
   inline error with Retry. Force `unhandledrejection` from the console (`Promise.reject(new Error('x'))`): one toast, one console line.
4. **Press / hover / focus:** on a phone, tap a Home tile and an Orders card (they sink 2% and return; nothing stays lit after the tap); with a
   keyboard Tab through Home (a gold ring on each row); on a laptop hover still lights buttons and rows.
5. **Background save:** Add customer on a throttled "Slow 3G": the list opens at once, a toast follows; "Offline": the toast says it is queued by
   Firestore only when the write resolves, so it appears on reconnect (the customer is on the list straight away from the local cache).
6. **Haptics:** an Android phone in Chrome: a short tick on "Success", a double tick on an error toast.

## Frame-rate pass, iPhone / iPad / Mac, 2026-11-03

Audit of `apps/iphone/App` (Screens, UI, Nav, Data) for hitches, written without a SwiftUI compiler: nothing here is measured
yet (see "How to verify"). What was already sound and was left alone: every `DateFormatter` / `NumberFormatter` but two is a
`static let`; Home, Analytics and Customers reckon once per `Shelf.revision` (Home and Analytics off the main thread); lists are
`List` / `LazyVGrid` with stable ids; photos are ImageIO thumbnails in `RemoteImageStore` (memory + 200 MB disk); `GeometryReader`
rows are gone (`onGeometryChange` on the container); no `.glassEffect` or material sits on scrolling content except the bottom
bars; shelf decoding runs on Firestore's own queue.

### Fixed
1. **Orders hub re-sorted and re-grouped on every body pass** (`OrdersHub.swift`, `hub`/`makeSections`). The comparator parsed two
   ISO strings per comparison (n log n parses, ~20 µs each) and the body ran for each toast, busy flag, tick and typed letter.
   Now the scoped / shown / grouped list is one `Memo` keyed by both revisions, the filters, the search, the status patches and the
   Karachi day; each date is read once. The Filter menu's months and per-status counts (a pass that parsed every date, six more
   passes for the counts) are a `Memo` on `orders.revision`.
2. **Workshop (phone / iPad) rebuilt every piece on every body pass** (`WorkshopBoard.swift`, `content`): `buildJobs` over all
   orders, stock jobs and invoices, plus a sort, per typed letter in the search. Same two memos the Mac already had (jobs keyed by
   the four revisions, the patches and the hour; the snapshot by those and the filters).
3. **Floating + button redrew its overlay on every frame of a scroll** (`RootView.swift`, `CreateAccessory`). The scroll callback
   wrote `offsetY` and `scrolled` into `@State` per frame; an assignment invalidates the owning view whether or not the value
   changed. `offsetY` / `openedAt` are now a plain object, and `scrolled` / `compact` are written only when they flip.
4. **Photo thumbnails showed a too-small picture in the full-screen viewer, and flashed blank on scroll-back**
   (`StockImageDecoder`, `PieceGallery.swift`). The decode cache key had no size, so a 192 px thumbnail was returned to the
   viewer's 2400 px request; it also had no cost limit. The key now carries `maxPixel`, the cache is capped at 96 MB, a thumbnail
   whose picture is already decoded paints without the background hop, and a photo new on the phone (`PhotoSource.data`) is
   shrunk by ImageIO off the main thread instead of `UIImage(data:)` decoding it whole at the first draw.
5. **`ERPDate.parse` cached** (`ERPCore/Support/ERPDate.swift`): an `ISO8601DateFormatter` read costs tens of microseconds and every
   list sort, filter, group and row asks for the same few thousand `createdAt`s. A locked dictionary (8,192 entries, cleared when
   full; failures kept too) turns repeats into a hit. Benefits every screen at once, Linux tests unchanged (583 run; the one failure,
   `ShopCalendarTests.testAnOrderCountsItsSubtotalOnlyWhileUninvoicedAndLive`, fails on the untouched tree too).
6. **Invoices Filter menu** read every invoice's date again per body pass for its months list; it now uses the stamps the list
   already holds (`InvoiceMenuFacts`, per `invoices.revision`).
7. **Today's cash** ran `todaysCash` (every payment of every invoice, dates parsed) on each redraw; now a `Memo` per revisions and minute.
8. **`NumberFormatter()` built per call** in `OrdersLogic.number` (order cards: weights, wastage) and `CustomerKit.grams`: now static.
9. **`UIImage(data:)` in sheet bodies** (the story preview in `PostTrayScreen`, the before / after in `StudioBoardEditor`): a whole
   2160 x 3840 picture decoded again at every redraw. New `DataImage` (ImageIO, once, off main).
10. `OrderItem.photoSources` no longer copies a multi-megabyte inline photo string through `trimmingCharacters` per body pass.

### Not done: needs a device, or is a larger change
1. **Customers list reckons on the main thread** (`CustomersList.figures`, `CustomerKit.owed` / `stats` over all invoices, orders
   and hisaab) when a revision changes. Memoised, but a first open on a big book is one long frame. Move it to a `.task(id:)` +
   `Task.detached` like `Dashboard.reckonFigures`, keeping the last result on screen. Needs the screen's skeleton path checked.
2. **`Theme.card` / `accent` are computed per read** (`Theme.swift`; for a business added by address that is a hex parse and a
   `UIColor` per read, several per row). Cache per `(business id, asset)` and drop the cache in `Businesses.resetPerBusinessState()`.
3. **`Money.lacCrore` uses `String(format:)` several times per row.** A hand-rolled digit formatter would be ~5x cheaper; money rules
   are shared with the web, so port it with `MoneyTests` first.
4. **`NewOrderDraft` equality in `onChange(of: draft)`** compares the photos' bytes on each keystroke (same buffer, so cheap, but
   it is a memcmp of up to 12 MB). Compare a revision counter bumped by the setters instead.
5. `ShelfState` cross-fades a whole `List` (`.opacity` transition) the first time a shelf loads: an offscreen pass over the list for
   ~300 ms. Only on a cold first load; fade the skeleton out and show the list at once if Instruments shows it.
6. `ForEach(..., id: \.offset)` remains on short, fixed lists (payments, exchanges, tracking checkpoints); harmless, but breaks rule 16.

### How to verify on a device (Xcode > Product > Profile, an iPad Pro on the shop's books, Release build)
1. **Orders hub typing and filtering**: SwiftUI template (View Body + Update Groups) and Time Profiler. Open Orders, type six letters
   in the pulled-down search, change Group by. Before: `OrdersHub.makeSections` and `ISO8601DateFormatter.date(from:)` are the heaviest
   frames under each keystroke; after: they appear once per change of the text, never under a toast or a busy flag.
2. **Workshop typing**: same, on Workshop. `WorkshopLogic.buildJobs` must not appear under a keystroke, only under a snapshot.
3. **Scroll hitches with the + button**: Hitches instrument (Animation Hitches), scroll Orders / Invoices end to end. In SwiftUI
   > Update Groups, `CreateAccessory` must not update per frame (before: one update per scrolled point).
4. **Order photos**: Time Profiler on the main thread while opening an order with 3 reference photos, then the viewer, then scrolling
   Orders back and forth: no `UIImage` decode (`CGImageSourceCreateImageAtIndex`, `ImageIO` decode) on the main thread; Allocations
   stays below ~100 MB for the photo cache; the viewer's photo is sharp (it was the thumbnail before).
5. **Cold start / first frame**: App Launch template, then the app's own `LaunchClock` report; `ERPDate.parse` should drop out of the
   top ten in Time Profiler's inverted call tree.
Pass mark: Hitches "Potential hangs" 0, hitch time ratio < 5 ms/s while scrolling, on a 120 Hz device.

## Android pass, 2026-11-03

Audit of `apps/android` for frame time and first-run cost. Fixed (behaviour unchanged):
- **Network and JSON off the main thread.** `ErpApi.data/bytes/upload/uploadBytes` run on `Dispatchers.IO`; `get/post/send/getModel` parse on `Dispatchers.Default`. The write's `NonCancellable` section is untouched.
- **Whole-collection passes off main.** `rememberOffMain(keys, initial, calc)` (`data/BookCompose.kt`: `produceState` + `Dispatchers.Default`, keeps the last value while recomputing) now works out Customers (owed, stats, groups), Orders hub sections, Invoices scope and sections, the Workshop board (jobs, snapshot, choices) and Stock (filter and price); the skeleton shows until the first value. `rememberShelfItem` follows the shelf's revision and derives its own item. Stock search is debounced 200 ms like Invoices.
- **Per-row costs.** `NumericText`/`RowAmount` are plain `Text` until a value first changes (no `AnimatedContent` per row at rest); `QuickPrintButton` takes `busy`/`onPrint`, the screen owns the one `QuickPdf` and builds the PDF target inside the tap; `SwipeActions` has a lazy `menu: () -> List<RowAction>` overload (read when the menu opens and for TalkBack); `OrderCardActions` is remembered with `rememberUpdatedState`; every list item has a `contentType`.
- **Skeletons** share one clock (`LocalSkeletonPulse`, provided by `SkeletonLoading`, read in `drawBehind`); image placeholders are a static `ColorPainter`. Stock, catalogue and online-order thumbnails use `AsyncImage` with a fixed decode size instead of `SubcomposeAsyncImage`.
- **Layer-phase reads.** Chevron rotation, the press corner (`morphCard`), the business-switch veil and the picker's alpha are read in `graphicsLayer`.
- **Fast paths.** `Money.grouped` (integer path under 1e15), `ERPDate.parse` (fixed-offset hand parser, regex kept as `parseRegex` and as fallback, compared on 20,000 generated inputs), `ShopDate.stamp` (regex hoisted), New sale `SaleData`/`SaleFigures` remembered by their inputs.
- **New sale draft** is kept 300 ms after the last change, encoded on `Dispatchers.Default`, the previous job superseded, flushed on disappear, on stop and before any read (`SaleStore.saveSoon/flush`). New order already did this on its own thread.
- **Baseline Profile** (hand-written, wildcard rules for `erp/app`, `erp/core`, `androidx/compose`) in `app/src/main/baseline-prof.txt`, with `androidx.profileinstaller` named in the catalogue.
- **Background.** Staff poll (25 s) and the online-orders count wait for the app to be on screen (`data/Foreground.kt`); the minute timers (Home, Today's cash, My work, Investments) run only while their screen is started. `reportFullyDrawn()` after Home's books load. A crash report now names the business beside the last screen.
- **Order messages** lead with the full amount, then "Advance paid" and "Balance due" as separate lines (`OrderActions.moneyLines`, as `src/lib/order-message.ts`).

Still open:
- **R8 keeps everything in `erp.core.**`** (`-keep class erp.core.** { *; }`) and every `@Serializable` class: minification buys little. Recommendation: narrow to the companions/serializers core finds by reflection, then verify on a device (release build, every screen) before shipping; not changed here because it needs a device.
- **Generated Baseline Profile**: replace the wildcard file with a Macrobenchmark-recorded one (cold start, Home, Orders scroll).
- **JankStats**: add to measure hitches in the field; none is collected yet.
- The Outbox's retry loops keep running in the background by design (a queued sale should still go); the Insights/Live polls already stop with their screens.
