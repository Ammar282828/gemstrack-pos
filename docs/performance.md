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
  `expense-report-pdf.ts`); 42 `useAppStore()` calls without a selector re-render on any collection's snapshot;
  web-vitals reporting.
- All: the history window above.
