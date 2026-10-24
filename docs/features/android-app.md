# Android app

## Android app

Started 2026-10-12 (owner: port the native iPhone/iPad ERP to Android, both houses, built and handed out without a Mac).

**What it is.** `apps/android`: Kotlin, Jetpack Compose, Material 3 (expressive), one codebase with two product
flavors, **taheri** (`shop.taheri.erp`, "Taheri ERP") and **mina** (`store.houseofmina.erp`, "Mina ERP"), the same
IDs as the iPhone apps. The design reference is `apps/iphone` (its 2026-10-12 redesign): the same places, words,
money rules, payloads and look, in Android's own idiom (Material, not Liquid Glass). `apps/android/CONVENTIONS.md`
is its rulebook, mirroring `apps/iphone/CONVENTIONS.md`.

### Shape

| Module | What | Mirrors |
|---|---|---|
| `core/` | Pure Kotlin (JVM, no Android): the ERP's models, decoded leniently, and its rules (`erp.core`), **with ERPCore's tests ported case for case**; the New order / New sale logic (`erp.core.entry`) and the contract generator. Runs with `gradle :core:test` anywhere. | `Packages/ERPCore`, `App/Screens/NewOrder/*Math/Draft/…`, `App/Screens/Sale/SaleModel/Figures/…`, `Packages/Contract` |
| `app/` | The Compose app (`erp.app`): kit, navigation, data, auth, device, every screen group, the Glance widget, FCM. | `App/`, `Widget/`, `Shared/` |

**One source for what both phones share** — nothing is copied by hand:
- `apps/iphone/houses.json` (names, server URL, palette seeds, Firebase project, API key, sender) plus
  `apps/android/houses.json` (Android-only: Firebase Android app ID, web OAuth client for Credential Manager, testers);
  Gradle reads both into each flavor's `BuildConfig` and resources.
- Colours: generated per flavor from the iOS asset catalog's `Accent-/Ground-/Card-/OnAccent-/Launch-<house>.colorset`
  (light and dark), so a palette change on one phone is a change on both.
- `apps/iphone/App/Resources/Design/design-<house>.js` (the web's `src/lib/social`, bundled), `nav-<house>.json`
  (`npm run nav:export`), `demo.json`, the fonts: Gradle source sets point at the iPhone's folders, and an
  icon/logo step renders Android's adaptive icons from the asset catalog's art.

### Architecture (the iPhone's, in Android's terms)

- **One brain.** Money rules live in TypeScript first; `core` ports them line for line with their tests. Every write
  goes through `/api/app/write` (`ErpApi.write(op, fields)`) with the iPhone's payloads, the same request-id
  de-duplication (30 s, "when" fields ignored) and the follow-ups sent without waiting.
- **The contract.** `core`'s contract generator builds the very orders and sales `Packages/Contract` builds, through
  the Kotlin New order / New sale code, and writes `apps/android/contract/cases.json`. A `core` test fails unless it
  equals `apps/iphone/contract/cases.json` value for value, and `src/app/api/app/write/contract.test.ts` runs the
  ERP's own money over both files: the Android phone, the iPhone and the ERP cannot drift apart silently.
- **Reading the books** (`data/Book.kt`): one `Shelf<T>` per collection, filled only when a screen asks (`need()`),
  as `StateFlow`s. Owners read Firestore live (Android Firebase SDK, persistent cache so it opens offline); staff and
  marketing poll `/api/staff/collections` every 25 s (woken at once after their own write); the demo reads
  `demo.json`. Signing out clears Firestore's disk cache.
- **Sign-in.** Credential Manager's Google sign-in (the house's **web** OAuth client as `serverClientId`, which needs
  the house's Android app registered in Firebase with the signing key's SHA fingerprints) → Google ID token →
  `signInWithCredential`: the same Firebase user as the website and the iPhone. `/api/app/me` decides the role, as
  on the iPhone (owner, staff, marketing, karigar → My work; none → signed out with the reason). The last answer is
  kept for opening offline.
- **Every ERP place stays reachable.** Menus from `nav-<house>.json`; a registry maps ERP paths to native screens;
  any other path (or `?web=1`) opens the ERP page in a WebView (`WebScreen`): user agent `ERPApp/1 (<house>)
  ERPNative/1`, the same `window.Capacitor` bridge the iPhone injects (`src/lib/native-app.ts` is unchanged), signed in
  with the app's Google token, downloads and `navigator.share` to Android's share sheet. So the app is complete from
  its first build, and native screens replace pages one by one.
- **Navigation.** Navigation 3: each top-level place keeps its own back stack of ERP paths. Phones get a bottom bar
  (Home, Orders, Invoices, Customers, Search — Search is the whole map, Settings and the account) and a floating
  New sale · Order · Scan · Voice menu; tablets and unfolded foldables (window size classes) get a navigation rail or
  drawer and list-detail panes, the iPad's layout.
- **The look.** Material 3 expressive with the house's palette (Accent, Ground, Card, OnAccent; light and dark follow
  the device, or the shop's/phone's theme as on the iPhone). The iPhone's kit, by the same names: `Tone` (late,
  problem, owed, settled, working, credit), `Radius` (card 22, chip 14, tile 12, thumb 10), `ledgerCard`,
  `SectionCard`, `heroSheen`, `MoneyRow`, `HeroAmount`, `PaidRing`, `Pill`, `FilterChip`, `Monogram`, the `Note`
  toast, haptics on money events, shared-element list→detail. Font scaling, TalkBack labels, Reduce Motion
  (`ANIMATOR_DURATION_SCALE` = 0) are first-class.
- **Device.** Voice (`screens/voice`: Android's recogniser for live words plus a recording of up to a minute, AAC in
  `.m4a`, sent to `/api/voice/native` as `{audio: base64}`; if the recorder came out empty or silent, the live words go as
  `{text}` instead, because the recogniser and the recorder share the microphone and nothing here could try a phone). It
  is a sheet from the create menu, owners only, and the page its answer chooses opens after the sheet has closed; a card
  that needs a form drafts the New order / New sale on the phone, as the iPhone's. Documents scanned with ML Kit's
  document scanner, biometric unlock for the delete code (BiometricPrompt + Keystore), PDFs from `/api/app/pdf/*` shown
  natively and shared, deep links (`https://<erp host>/…` App Links and `erp://`). **Widgets** (`widget/`, Glance): the
  small, medium and large faces of the iPhone's widget (no lock screen on Android) drawn from `/api/widget/summary` with
  the phone's own key (`/api/widget/key`, minted once while signed in, sealed with a Keystore AES key in the app's
  preferences; it opens nothing else). WorkManager refreshes every 30 minutes and when the app comes to the front; the
  widget draws what was last kept and a tap opens the app. Its picker label is the flavor's name ("Taheri ERP" /
  "Mina ERP"). Settings → Widgets previews the same faces in plain Compose, from the same layout plan.
- **Notifications.** FCM. `src/lib/push` sends to Android phones beside Apple's, from the same events, with the same
  words and the same per-kind switches (`push_devices` entries carry `platform: 'android'`); sent with
  `firebase-admin` messaging under the backend's own service account (no FCM key to upload). A phone registers at `/api/push/devices` with `{ token: <FCM registration token>, platform: "android", bundleId: <applicationId>, label: <Build.MODEL> }`, owners only, after an owner's sign-in (that is when Android 13+ is asked for `POST_NOTIFICATIONS`, as the iPhone asks then, never at launch), again whenever FCM refreshes the token, and is forgotten on sign-out (`DELETE {token}`, capped at 3 s, while the sign-in token is good). It only happens when the house's Android app is registered in Firebase (`House.firebaseOptions`), never in the demo. Four channels, made at app start and named as the server's `kind`: `sales` "Sales", `payments` "Payments", `orders` "Orders", `karigar` "Karigar work". A notification shown while the app is open is built by `ErpMessagingService`; a tap, in either case, opens the `url` in its data over the tabs (`AppRouter`, from the intent's extras when the app was in the background). The App Hosting runtime service account (`firebase-app-hosting-compute@<project>.iam.gserviceaccount.com`) may need `roles/firebasecloudmessaging.admin` in each project to send: an owner step, unverified.

### Build and hand-out (Linux only)

- `.github/workflows/android.yml` on `ubuntu-latest`, path-filtered to `apps/android/**`, `apps/iphone/houses.json`,
  the shared resources and the workflow itself (macOS minutes once exhausted the Actions budget; this never uses them):
  `core` tests and the contract, `assemble` both flavors, then, on `main`/`claude/**` pushes, a signed release bundle
  (AAB) per house to **Google Play's internal testing track** through the Play Developer API (owner, 2026-10-12:
  "deploy it to the app store yourself").
- **Internal testing, not a public listing**, the Play equivalent of the iPhone's TestFlight-internal: up to 100
  testers install from the Play Store app itself and get every update automatically, with no review. A public
  (production) listing would put a staff-only ERP in the store for anyone to find. It would also need Google's review,
  with a way for reviewers to get past Google sign-in, and on a personal developer account a 14-day closed test with
  12 testers first. Promoting a build to production later is one API call if the owner ever wants it.
- **What only the owner can do, once** (no Google API does these): a Play Console developer account; create the two
  apps (Taheri ERP `shop.taheri.erp`, Mina ERP `store.houseofmina.erp`); upload each house's first bundle by hand
  (Play fixes the package name on the first upload; the session hands over the two `.aab` files); add the release
  service account under Users and permissions; add testers' emails to the internal track. After that every push
  ships by itself.
- **Signing:** Play App Signing. Our upload key (both houses) is kept encrypted in the repo
  (`apps/android/signing/release.jks.enc`, AES-256); its passphrase is the repository secret
  `ANDROID_KEYSTORE_PASSWORD`. Google re-signs with its own app signing key, so **both** fingerprints (the upload key
  and Play's app signing key, Play Console → Test and release → App integrity) must be on the house's Android app in
  Firebase, or Google sign-in fails on phones that installed from Play.

### Phases

1. Foundation: Gradle project, flavors, palette/fonts/icons from the shared sources, `core` with ERPCore's tests,
   kit, navigation, auth, data, web fallback, demo mode.
2. Selling: Orders hub/detail/finalize/online, Invoices list/detail/sheets, New order and New sale step flows,
   the contract.
3. The rest: Home, Customers, Stock, Repairs, Workshop, Money/Hisaab/Expenses, Owner, Analytics, Rates, Settings, My work.
4. Marketing: Posts, Website, Ads, Studio and the designer (the same `design-<house>.js` in a WebView).
5. Device: widgets, FCM (and the server side), voice, scanner, PDFs and share, deep links, biometrics.
6. CI and distribution, owner steps.

### Design is native (2026-10-19)

Owner: "The post section in the Taheri app takes me to the web version of the ERP. I want it to be native." Posts › Design
(`/design`) was the one tab still opening the ERP's page. It is the iPhone's Design, ported file for file
(`apps/iphone/App/Screens/Design` → `app/screens/design`), registered after the Marketing group as the Swift's `NativeScreens` has it.
`/website/post` (Post a piece) and `/ads/studio` keep their own native screens, as on the iPhone; no address redirects inside the app.

- **Screens.** Make (the start screen, then the workspace: page strip, the page, Words, the photograph with its AI tools, Resize, Publish,
  Save), Photos (the website's pieces; owner and marketing also Best for ads and Every photo), Saved (folders, drafts on this phone, In the
  ad account, one design's sheet). Rule 16: Publish (with Save beside it) is pinned in the bar, deletes ask, the page is pinned beside the
  words on a tablet. `?v=`, `?s=`, `?kind=`, `?play=`, `?draft=`, `?site=`, `?new=1` are answered as the web answers them.
- **Roles** (`designGate`): owner, staff and marketing may design; the Board, the library with scores, the Ad kind, Flat image → layers and
  Make the ad with AI are owner and marketing's.
- **Endpoints, as the Swift sends them:** `/api/design/designs` (list, one file by `?key=`, multipart save, PATCH, DELETE, `folders`),
  `/api/design/destinations`, `/api/design/{resize,parse,fetch,analyze,layers,remove-background}`, `/api/website/post/ai`,
  `/api/ads/studio/{auto,uploads,library,saved,creatives}`, `/api/website/{site-pieces,photos,post,post/queue,post/health,featured,edits}`,
  `/api/instagram/{story,post,connect}`, `/api/ads/{images,campaigns}`, `/api/app/website`.
- **The designer's v2** (`screens/marketing/Artwork*`): blend and opacity, shadow / glow / outline, the nine text effects, rich text runs (per
  word: face, bold, italic, underline, capitals, size, colour, foil), gradients (any angle, radial, up to eight stops) on text, shapes and the
  background base, QR layers, the full photo adjust (filters, quick fixes, thirteen sliders) and cut-out, twenty faces, snapping to guides,
  grid, margins and other layers with a haptic tick, "match the first one picked", Cancel that asks.
- **The engine protocol** (`DesignProtocol`) gained `brand` (as `NativeArtwork.swift` sends it; the shipped bundles ignore it) and `message()`,
  the one function `run` and the Chromium check share. The new actions (`resize`, `resizeMerge`, `words`, `siteLayouts`, the website's `names`)
  and options (`swap`, `subject`, `photoMarked`, `targets`, `items`) pass through the generic options. `apps/android/scripts/check-design-engine.mjs`
  runs both houses' real bundles in headless Chromium with the exact page and messages the app builds
  (`DesignEngineFixturesTest` writes them; it reads the answers back through `DesignProtocol.parse`).
- **Tests.** JVM: `DesignModelTests`, `DesignPublishTests`, `ArtworkV2Tests`, `DesignProtocolTests`, `DesignEngineFixturesTest`. Screenshots
  (`DesignShots`, phone and tablet, light and dark, the demo's made-up designs; a stand-in engine draws the pages, as a JVM test cannot run
  the bundle): start, workspace, Publish, Resize, Saved, Photos, the designer.
- **Engine finding.** `carry` (Paste copied layers) throws a non-finite `createLinearGradient` in the bundle when the carried text has a gradient run; the iPhone sends the same message, so it is the engine's, not the port's. `check-design-engine.mjs` carries the v2 layers without the runs.
- **Not at parity.** The Board section opens the ERP's own page (`/design?v=board&web=1`): the Studio's board (canvas, notes, Let it cook,
  the agent) is a port of its own and Android has no Studio yet. The Posts hub's cards and Edit a piece do not yet offer "Open in Design" (the iPhone's
  tray, `PostTray*`, is not ported here); Design is reached from Posts › Design. The share sheet cannot say whether a story was posted, so after Share it asks when the person returns.
  Nothing here has run on a phone (no emulator here): the WebView engine on a device, the camera and the pickers are unverified.

### The interim app (apps/android-twa)

Owner, 2026-10-12: "just give me an apk". Until the native app ships, `apps/android-twa` is a Trusted Web Activity: the
live ERP full-screen in Chrome under the native app's IDs and upload key (versionCode 1; the native app starts at 2,
so it installs over it as an update). Google sign-in works as it does in Chrome, with nothing registered in Firebase.
Full-screen needs `public/.well-known/assetlinks.json` (both packages, the upload key's SHA-256) on each ERP host;
Play App Signing's key must be added to it when the app goes to Play. Signed APKs are built in a session with the
key and handed over directly.

### Status

- 2026-10-12 — Phase 1 done: Gradle project (AGP 9.4, Kotlin 2.4, Compose BOM 2026.09, Material 3 1.5.0-beta01 for the
  expressive API, minSdk 26, target 37), flavors, palette/fonts/icons from the iPhone's sources; `core` (ERPCore, 368
  tests = the Swift's 368); the New order / New sale logic and the contract (`contract/cases.json` byte-identical
  to the iPhone's; the ERP's contract test runs both phones' files, 270/270); the kit; the shell (sign-in, session, the
  books, ErpApi, Navigation 3 with per-tab stacks and adaptive bars, the ERP page with the full bridge, biometric vault,
  document scanner, speech, deep links, demo mode). No emulator here (no KVM): screens are checked by JVM screenshot tests.
- Phase 2 in progress: Orders, Invoices, New sale.
- 2026-10-13 — Phase 5 (device): notifications (FCM client), Glance widgets and voice, as above. Not run on a phone: no emulator here, so the recorder/recogniser sharing the microphone, FCM delivery and the launcher's widget sizes are unverified.
- 2026-10-19 — Marketing, native (`screens/marketing`): Posts (the hub with Send all and Spread over the day, the tray with its captions, stamps, designs, story and Later, the queue, the pieces), Investments and its schedule, Add photos, Edit a piece (the words and the photo re-made by the bundled engine: shape, layouts, designer, AI), Photo weights (Futura LT Light geometry), the Website menu and Insights (overview, posts, audience). No button in Posts or Website opens the ERP's page; `/design` is still the ERP's until Design lands. `core` gained `QueuePlan` and `SiteWeight` with their tests. Not run on a phone: the engine's web view, the camera and the story post are checked by unit tests and screenshots only.
- 2026-10-24 — The iPhone's blind-spot and snappy rounds, in the data layer. A write names itself: `ErpApi.write` takes the name from `WriteIntents` (`data/WriteIntents.kt`), kept on disk per house against what the change is (the body without its date and its own name, hashed) until the ERP answers, so a retry after a timeout or a relaunch is the same change and the ERP replays its first answer (`idempotency.ts`; money ops require a name); a 409 clears it, a day forgets it. The request is not cut off when its screen goes. A save that does not move money leaves at once through `ErpApi.enqueue(op, fields, label)` (`data/Outbox.kt`): applied on screen first (`ui/Optimistic.kt` `LocalChanges`, cleared when the shelf agrees or the Outbox gives up), kept in `files/erp-outbox/outbox-<house>.json`, retried at 2, 8, 25 and 80 s, then "Not saved: <label>" with Retry over every screen (`ui/OutboxHost.kt`, hosted by `AppShell`); resumed and the server warmed (`/api/app/me`) whenever an Activity comes forward. Money ops (`OutboxEngine.moneyOps`) stay awaited. Page loads time out at 15 s. One number reader (`core/logic/ShopNumber.kt`, `ShopNumberTests`): Urdu and Arabic-Indic digits, lakh commas, a lone comma with 1-2 digits is a decimal point, unreadable is null and holds Save in the sale, order and repair forms. The launch is timed (`device/LaunchClock.kt`) and sent once to `/api/app/launch` with `platform: "android"`. The lock cover is a window of its own, so it sits over sheets and dialogs. Not run on a phone: the cover over an open sheet and the Outbox's background retries are checked by unit tests only.
