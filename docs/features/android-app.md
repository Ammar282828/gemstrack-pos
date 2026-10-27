# Android app

## Android app

Started 2026-10-12 (owner: port the native iPhone/iPad ERP to Android, both houses, built and handed out without a Mac).

**What it is.** `apps/android`: Kotlin, Jetpack Compose, Material 3 (expressive), one codebase with two product
flavors, **taheri** (`shop.taheri.erp`, "ERP": the one app that holds Taheri, House of Mina and any business added by its
address, [below](#one-app-many-businesses-2026-10-24)) and **mina** (`store.houseofmina.erp`, "Mina ERP", deprecated like Mina's own
iPhone app: it starts on Mina and holds only Mina), the same IDs as the iPhone apps. The reference is `apps/iphone` (its 2026-10-12 redesign): the same places, words,
money rules and payloads; the look is Android's own, [Material You](#material-you-2026-10-26) (not the iPhone's, not Liquid Glass). `apps/android/CONVENTIONS.md`
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
  drawer, and Orders, Invoices, Customers, Stock and Repairs show their list beside the picked item (`nav/HubSplit.kt`, the iPad's `HubSplit`: the item side stays open with "Choose an order" etc. until something is picked; a window under 700 dp is the phone's one stack).
- **The look** (Material You since 2026-10-26, [below](#material-you-2026-10-26)). Material 3 Expressive on the open business's colour: tonal
  surfaces, segmented groups of rows, large collapsing top bars; light and dark follow the device, or the shop's/phone's theme as on the
  iPhone. The kit keeps the iPhone's names: `Tone` (late, problem, owed, settled, working, credit), `Radius`, `ledgerCard`, `SectionCard`,
  `heroSheen`, `MoneyRow`, `HeroAmount`, `PaidRing`, `Pill`, `FilterChip`, `Monogram`, the `Note` toast, haptics on money events. Font
  scaling, TalkBack labels, Reduce Motion (`ANIMATOR_DURATION_SCALE` = 0) are first-class.
- **Device.** Voice, Siri-grade since 2026-10-26 (see [Voice](ai.md#android-2026-10-26): warm on-device recogniser, end of speech by itself, follow-ups, yes/no; "Talk to ERP" shortcut, Quick Settings tile, assist intents). The older recording path (`screens/voice`: Android's recogniser for live words plus a recording of up to a minute, AAC in
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

### One app, many businesses (2026-10-24)

The iPhone's model ([iphone-app.md](iphone-app.md#one-app-many-businesses-2026-10-16)) on Android: the taheri flavor is the one app, and
the house is a thing it holds at run time. Owner, 2026-10-16: one app for all his businesses, to switch between them and to add more.

- **A business** (`config/Business.kt`) is exactly the ERP's `GET /api/app/business`, with an `android` block beside `ios`
  (`src/lib/store-config.ts` `storeAppAndroid()`): `{ googleWebClientId, firebase: { appId, apiKey, projectId, senderId, storageBucket } }`
  from `APP_ANDROID_FIREBASE_APP_ID` / `APP_ANDROID_GOOGLE_WEB_CLIENT_ID` (Taheri's are the code's defaults) and the web's `NEXT_PUBLIC_FIREBASE_*`.
  Either variable `none`, `0`, `off` or empty means "not registered": `android: null`. An override cannot remove a variable, so
  `apphosting.mina.yaml` sets both to `"none"` or Mina would wear Taheri's Firebase app. Taheri and Mina ship in the app
  (`app/src/main/assets/businesses.json`, written by `apps/iphone/scripts/businesses.mjs` with the iPhone's list from `houses.json` and the `android`
  block from `apps/android/houses.json`; a JVM test keeps them equal), so a first launch needs no network and each keeps its bundled art
  (`brand_logo_<id>`, `badge_mark_<id>` copied from the iPhone's asset catalog by Gradle, with each house's menu and design bundle).
- **The list** (`config/BusinessStore.kt`, `Businesses.kt`): kept in `files/erp-businesses.json` with the built-ins the person hid. Add by
  address (`BusinessRules.origin`: https, the host only; `judge`: the descriptor must come from that host, name that host or its erp./pos. twin as its
  own and pass `Business.problem`; the typed address is the one kept, so the sign-in token goes where the person pointed it); a refresh
  (`Businesses.refresh`, after the launch) keeps names, colours and switches current and never moves an address or a Firebase identity. A
  descriptor with no `android` can still be added: it shows its sign-in page saying it **isn't set up for this Android app yet** (the owner
  registers `shop.taheri.erp` in that Firebase project with the signing fingerprints) and offers the other businesses instead of failing. The
  last business cannot go; a built-in is hidden, not deleted (it comes back by typing its address); removing signs the business out (alerts
  unregistered, widget key revoked, Firebase user, books on disk, drafts, unsent saves).
- **One of everything per business, none shared.** Its own named `FirebaseApp` (`b-<id>`; the build's own business keeps the default app,
  so an install stays signed in) with its own Auth and Firestore (and Firestore's copy on disk); its `Session` (`auth/Sessions.kt`), `Book`
  (`Book.of(business)`), `ErpApi.forBusiness(b)` (its address and its token; a call begun for one business is finished for it whatever is open),
  `WriteIntents.forBusiness`, and `Outbox.of(b)` over `files/erp-outbox/{outbox,write-intents}-<id>.json`: what one business has on its way
  when the person switches is sent to its own server with its own token, and `Outbox.resume` also resumes the other businesses' files. `Prefs`
  scopes every key to the open business (`erp.orderDraft` becomes `erp.orderDraft.taheri`) except the phone's own (theme, lock, the picker's
  switch, widget option); the first run moves what the one-business build kept to the build's business (`Prefs.moveLegacy`). `House` is a
  thin facade over the open business (every property computed), and the palette, logo, margin, metal, flags and menus follow it
  (`EntryHouse` gets its metal and margin from the descriptor).
- **A switch** (`Businesses.switchTo`) lets go of the business left (its books' listeners stop, its session and the stores that hold one
  business's data are emptied) and bumps `generation`: every Activity (`rebuildOnBusinessSwitch`) starts the task again at the tabs, so no
  screen or saved page of the old one survives. The demo (`erp.demo`) is one business of the build's look with no Firebase, as before.
- **The chip and the sheet.** The open business's badge heads every tab root (`screens/businesses/BusinessChip.kt`, in the top bar; on
  tablets in the rail's header with the ERP's whole name): tap opens the Businesses sheet, touch and hold lists the businesses to switch
  between at once. The sheet (`BusinessesPanel.kt`, also `/app/businesses` from Settings → Businesses and Search → Businesses) lists each
  business with its address and who is signed in, switches on a tap, reorders and removes in Edit, adds by address with a "Found" card (name,
  logo, colours) before "Add", and holds "Ask which business at launch".
- **The cold-start picker** (`BusinessPicker.kt`, `LaunchPicker`) is on by default with two or more businesses: it paints first and the
  open business is built under it (its books load while the person decides), lives above the Activities so a switch never brings it back, and
  sits under the lock cover (a window of its own). `LaunchClock` stamps `picker:shown` and `picked`, and a launch whose books were still on
  their way when the person chose ends as `ready:picker`. A widget's tap or a notification that names a business skips it.
- **Notifications.** The server already sends `business` in the data; a tap opens the app on that business, then its `url`
  (`AppRouter.prepare`: the business is switched to before the shell is built; a link while the app runs rebuilds it, then opens the page).
  Each business's Firebase project has its own sender, so each signed-in business gets its own FCM token from its own app
  (`FirebaseApp.get(FirebaseMessaging::class.java)`, the component `FirebaseMessaging.getInstance()` itself asks the default app for) and files it at
  its own `/api/push/devices`; the token is kept per business. **Limitation:** only the default app is told when FCM changes a token
  (`onNewToken`), so the others are looked at again whenever the app comes to the front (`Push.refreshAll`). `FirebaseApp.get` is public but annotated for
  SDK use; delivery for a secondary sender is the part not run on a phone. FCM tokens are bound to their sender, so the default app's token cannot
  stand in for another business's.
- **Widgets** (`widget/`, Glance), redone as the iPhone's: today's takings (hero) with the week's line (a sparkline on the small face, bars on the
  medium and large) and its change on last week, Owed to you / due / on the bench, and on the large face Needs you (4) and Recent sales (3) and
  the pinned note, all from `/api/widget/summary`'s `extras` (`WidgetExtras`, decoded leniently). **Both businesses are shown on every size by
  default** when two are linked (small stacks two rows, medium sets two columns, large stacks two medium faces, each on its own palette), and
  Settings → Widgets' "Show both businesses" turns it off (Android's Glance widget has no Edit-widget sheet, so the option is the app's, for every widget;
  off shows the open business). The widget keys are a sealed list, one per business (`WidgetStore`, the Keystore AES key), made when that business is
  signed in to and **revoked on the ERP (`DELETE /api/widget/key`) and forgotten on that business's sign-out or removal**; the figures last read are kept per
  business under the key's hash. A tap opens the app on that business and screen (`shoperp://open?b=<business>&p=<path>`, an intent of the app's own,
  never the browser); a line of Needs you or Recent sales opens its screen. `WidgetLayout.plan` is the one layout the Glance widget and the
  Settings → Widgets preview (`WidgetFacePreview`, the same chart bitmaps) draw, with JVM tests.
- **The launcher label** is the flavor's `homeName`: "ERP" for the taheri flavor, "Mina ERP" for the deprecated one. The launcher icon is still
  each house's own wordmark (the iPhone's gold-diamond `AppIcon-erp` is not drawn here).

**The Mina Firebase step (once, by the owner).** For House of Mina to sign in inside the one Android app, its Firebase project needs the app:
1. Firebase console → project `hom-pos-52710474-ceeea` → Add app → Android, package **`shop.taheri.erp`**; add the SHA fingerprints: the **upload key**'s
   SHA-256 is the one in `public/.well-known/assetlinks.json` (`1A:AC:EA:…:3D:24`, public) and its SHA-1 from
   `keytool -list -v -keystore release.jks` on the decrypted `apps/android/signing/release.jks.enc` (passphrase: the repository secret
   `ANDROID_KEYSTORE_PASSWORD`); once the app is on Google Play, also **Play's app signing key** (SHA-1 and SHA-256, Play Console → Test and release → App
   integrity), or sign-in fails on phones that installed from Play. Note the **App ID** (`1:288366939838:android:…`).
2. Google Cloud console (same project) → Credentials: the **Web client** Firebase made for it (its id ends `.apps.googleusercontent.com`) is the
   `serverClientId`; no Android OAuth client needs creating by hand (Firebase makes it from the SHA-1).
3. Put both in `apphosting.mina.yaml` (`APP_ANDROID_FIREBASE_APP_ID`, `APP_ANDROID_GOOGLE_WEB_CLIENT_ID`, replacing `"none"`) and in
   `apps/android/houses.json` under `mina` (`firebaseAndroidAppId`, `googleWebClientId`), then run `node apps/iphone/scripts/businesses.mjs`
   so the bundled copy matches. Deploy both houses as always. Until step 3 reaches the ERP the app lists Mina with "Android sign-in not set up" and
   never fails; after it, the app picks Mina's registration up on its next launch (the refresh gives a built-in the sign-in it lacked).
4. Taheri's App Links already cover both ERP addresses (`assetlinks.json` is served by each house and names `shop.taheri.erp`).

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
  the agent) is a port of its own and Android has no Studio yet. The Posts tray's "Design" and Edit a piece's "Open in Design" hand the piece to the native Design (`/design?v=make&site=<id>`, `DesignRoutes` `startFromSite`), as the iPhone's do. The share sheet cannot say whether a story was posted, so after Share it asks when the person returns.
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
- 2026-10-24 — One app, many businesses on Android, with the iPhone's new widgets ([above](#one-app-many-businesses-2026-10-24)): the server's `android` block (`storeAppAndroid`, vitest), the Business model and store (descriptor checks, list merge, per-business file keys, widget layout and the picker's rules are JVM-tested: `BusinessTests`, `WidgetPlanTests`), a Firebase app, session, books, Outbox and settings per business, the chip, the Businesses sheet and screen, the cold-start picker, per-business FCM and widget keys. Not run on a phone: a second business's sign-in and FCM token (Mina's Android app is not registered yet), the widget on a launcher, the Activities' rebuild on a switch. Screenshots: `BusinessShots`, `settings-widgets`.
- 2026-10-24 — The iPhone's blind-spot and snappy rounds, in the data layer. A write names itself: `ErpApi.write` takes the name from `WriteIntents` (`data/WriteIntents.kt`), kept on disk per house against what the change is (the body without its date and its own name, hashed) until the ERP answers, so a retry after a timeout or a relaunch is the same change and the ERP replays its first answer (`idempotency.ts`; money ops require a name); a 409 clears it, a day forgets it. The request is not cut off when its screen goes. A save that does not move money leaves at once through `ErpApi.enqueue(op, fields, label)` (`data/Outbox.kt`): applied on screen first (`ui/Optimistic.kt` `LocalChanges`, cleared when the shelf agrees or the Outbox gives up), kept in `files/erp-outbox/outbox-<house>.json`, retried at 2, 8, 25 and 80 s, then "Not saved: <label>" with Retry over every screen (`ui/OutboxHost.kt`, hosted by `AppShell`); resumed and the server warmed (`/api/app/me`) whenever an Activity comes forward. Money ops (`OutboxEngine.moneyOps`) stay awaited. Page loads time out at 15 s. One number reader (`core/logic/ShopNumber.kt`, `ShopNumberTests`): Urdu and Arabic-Indic digits, lakh commas, a lone comma with 1-2 digits is a decimal point, unreadable is null and holds Save in the sale, order and repair forms. The launch is timed (`device/LaunchClock.kt`) and sent once to `/api/app/launch` with `platform: "android"`. The lock cover is a window of its own, so it sits over sheets and dialogs. Not run on a phone: the cover over an open sheet and the Outbox's background retries are checked by unit tests only.
- 2026-10-24 — Website → Interest (the site's report: periods with comparison and a custom range, tiles, chart, WhatsApp funnel, sources with Sources|Kinds, places with Cities|Countries, devices, pages, collections, searches, then the piece rankings) and Live, native (`WebsiteInterest.kt`, `WebsiteLive.kt`, `WebsiteAnalytics*.kt`). Posts: a card starts with the hero photo alone, the piece's other photos offered beneath (tap adds one, Add all), more from the website or the phone, one caption; WhatsApp gets one message per photo (caption on the first), Instagram a carousel of the first 10 (`Album` in `core`, `ig-post` queue step, `instagramPost`); Ads Check again asks `?fresh=1`; the checks panel is folded. Sends (tray, queue sheet, Send all, composer) run in `ErpApp.scope` with their result as a toast; the tray reads each card's photos first (the engine belongs to the screen) and returns any card that did not go. Not run on a phone; no drag to reorder photos (arrows only).
- 2026-10-24 — iPhone parity round (Search, Home, Analytics, tablet): Search is one calm list on the house ground (the map by group, Home's own group shown as Overview with Analytics and its later sections, then the account) and a typed search over customers (name, phone digits), invoices, orders, stock, repairs and places, five rows a kind then "Show all N"; no quick buttons or recents, each row one `clickable`. Home is titled Today with four figures always showing (Owed to you, On the bench, This month, Orders due); Needs you only when something needs you. The nav JSON's `section`/`marketing`/`moved` are read (`NavMap`): Analytics shows a section picker (Sales · Website · Social · Ads) and the title menu lists the open section's pages, the marketing account sees only tabs marked `marketing`, Settings is headed Shop · Connections · Records. Categories read a line's own category, else its order's, else its name's (`core` `lineCategory`/`guessCategory`, tests) and draw ranked share bars. Android has no house badge to change (one app per house; its rail shows the logo/wordmark), so the badge item needed no code.

### Level with the iPhone (2026-10-25)

- **Piece details** (`WorkshopPieceDetailsSheet.kt`): the Workshop's menu Details on an order's piece or a sold piece, saved through the Outbox
  (`updateOrderPieceDetails`, `updateInvoicePieceDetails`; payload in `WorkshopWrites.pieceDetails`, tested against the Swift's keys).
- **Selling on the website** (`/app/settings/website`, `WebsiteSellingSettings.kt`, logic in `WebsiteSellingLogic.kt`): the whole `app_settings/website`
  document through the Outbox (`saveWebsiteConfig`, `seq` per save), the server checking every figure.
- **Taheri book import** (`/settings/import-taheri`, `TaheriBookImportSettings.kt`): `importTaheriBook` preview, then Import with its fingerprint; awaited, as money.
- **Update gate** (`config/UpdateGate.kt`, `ui/UpdateBanner.kt`): `/api/app/business` carries `minAndroidBuild` (`APP_MIN_ANDROID_BUILD`, default 0), compared
  with `BuildConfig.VERSION_CODE`; below it `ErpApi.write` answers 426 "This app is out of date: install the latest version." and the money Saves shut under a
  quiet line. It is its own number: the iPhone's `APP_MIN_BUILD` is a CFBundleVersion.

### Material You (2026-10-26)

Owner: "Update the design language to Material YOU. Do your research on how Material You looks and feels, the UI, and everything, and implement it on the app."
The Android app had worn the iPhone's look on Material (cream/grey ground, flat white 22 dp cards with a shadow or hairline, the serif for figures
and headings, iOS grouped rows). It now looks like Pixel's own apps on Android 16 (Settings, Clock, Phone, Files, Wallet). A look-and-feel change only:
money, words, payloads, navigation and the iPhone's features are as they were (so `docs/parity.md` is untouched: a platform look, n/a elsewhere).
Rules: `apps/android/CONVENTIONS.md` rule 5; the decision: `docs/decisions.md#material-you`.

- **Colour is tonal and from a seed.** `ui/theme/Scheme.kt` grows the whole Material 3 scheme (primary, secondary, tertiary and their containers, surface,
  dim/bright, `surfaceContainerLowest`..`Highest`, outline, inverse, error), light and dark, from the open business's accent with Google's Material Color
  Utilities (`com.materialkolor:material-color-utilities`, the pure-Kotlin port: no Compose in it, so it cannot clash with androidx material3; R8 passes), variant
  TonalSpot (the Pixel's). The seed is the business's light accent, unless that is too dark to carry a hue (Mina's maroon, tone 10): then its dark accent, the
  pink. `ErpColors.*` are aliases onto the scheme (accent = primary, onAccent = onPrimary, ground = surface, card = surfaceContainer, elevated =
  surfaceContainerHigh), so existing screens compile and follow. The descriptor's palette is still the seed, the demo/bare-preview fallback is Taheri's gold.
- **Wallpaper colours** (Settings → This phone, Android 12+, `ThemeChoice.wallpaper`, the phone's own key `erp.phone.wallpaperColors`): the phone's
  `dynamicLightColorScheme`/`dynamicDarkColorScheme` instead. Off by default, because one app holds Taheri (gold) and House of Mina (pink) and the business's
  colour is how staff tell them apart; the switch's footer says so.
- **Tones** (`Tone`) are tonal palettes, as Material builds a role: red is the scheme's error (never shifted), amber, green, teal and blue are harmonised toward
  the seed (Material's `Blend.harmonize`, at most 15 degrees) with a capped chroma, read at tone 40 in light and 80 in dark for words and icons, 50/70 for bars; a
  `Pill` is a container (tone 90 / 30) with its on-container words (10 / 90), so every one reads on the scheme's surfaces in both modes.
- **Surfaces, no shadow.** The page is `surface`; a card or group `surfaceContainer`; sheets, menus and dialogs one step up (Material's defaults); the one hero card
  of a screen `primaryContainer`; "yours" (an order or sale of the signed-in person) is `ledgerCard(lit = true)`, a wash of the primary container, not an outline.
  Edge to edge over the surface, the bars' icons follow the theme.
- **Shape and type.** `Radius` is the Expressive scale (card 28, chip 16, tile 12, thumb 8, joint 4; the theme's `Shapes` carry extraSmall 4 ... extraLargeIncreased 32).
  The serif is gone: the Material 3 type scale in the system sans (Google Sans on a Pixel, Roboto elsewhere); `ErpType.heroNumber` is displaySmall emphasized,
  `tileValue` titleLarge emphasized, `heading` titleMedium emphasized, digits tabular; `LedgerHeading` is sentence case in the primary, as Settings' group headers.
- **Segmented groups.** `ui/Segmented.kt`: `SegmentedColumn` lays out its children as tiles 2 dp apart, the first with extraLarge corners above, the last below, small
  joints between, each clipped to its tile (a ripple keeps the corners). `LedgerSection`, `FormSection`, `SettingsSection`, Search and the Home lists draw it, so the
  ~75 screens that build rows with `ledgerRow()` follow; `LedgerDivider` inside one is a marker (the gap is the line), in a plain card still a hairline. The lazy lists of
  rows (Customers, Invoices, Stock, Repairs, money, the activity log) take the same corners by place. Settings' row icons are a glyph in the primary on a tonal circle
  (the iPhone's coloured squares are gone).
- **Components.** Pushed pages and form first screens have `LargeFlexibleTopAppBar` collapsing as the page scrolls (tab roots and wide windows the small bar, which takes
  the container tone under scrolled content); the short bottom navigation bar with the pill indicator and the FAB menu as before; connected button groups
  (`SingleChoiceSegmentedButtonRow`/`SegmentedButton` keep their names and are Material's `ToggleButton`s) for every one-of-few choice (Day | Stage | Due, the sections,
  Sources | Kinds, a method); `FilterChip` is Material's with its check; search boxes are the search bar field (`SearchBarField`); switches carry their icon
  (`ui/Controls.kt`); `Button`, `FilledTonalButton`, `OutlinedButton`, `TextButton` and `IconButton` (`ui/Buttons.kt`) take the stock arguments and the Expressive
  shapes, which morph while pressed; a card that is itself a button is `morphCard` (corners 28 to 16 while pressed); waits are `Loading`/`ContainedLoading` (the
  morphing loading indicator); pull to refresh was already the expressive one. Icons are Material Symbols Rounded (see "The rest" below).
- **Motion.** `MotionScheme.expressive()` springs as before; the press scale is gone for the morphs above (the buttons' come from Material's own `shapes`, `morphCard`'s
  corners spring with the theme's fast spatial spec and stay still under Reduce Motion). The platform's own page transitions (PageActivity) are untouched.
- **Kept from the house:** the business's wordmark and badge, the colour seed, money wording, whole rupees, lac and crore, the owner's words.
- **Screenshots.** Every baseline under `app/src/test/screenshots/<house>/` was re-recorded for both flavors (phone and tablet, light and dark): they are the review.
- **Left as it was, on purpose.** `SwipeActions` keep their tone fills; the paper of a PDF keeps its shadow; a chart's axis and the invoice paper's sum rule stay lines. (The icon set, the widget, bespoke cards' hairlines, outlined text fields and the launch window's colour were left on 2026-10-26 and converted the next day: below.)
- **Checks.** `SchemeTests` (the seed is the business's colour that carries a hue; gold and pink keep their hues; every role and every tone reads at 4.5:1 or better on the surfaces it
  sits on, both houses, light and dark; late stays red) and `SegmentedTests` (tiles two dp apart, with or without a divider, an empty row leaves no gap); `:app:testTaheriDebugUnitTest`
  and `:app:assembleTaheriRelease` (R8 with the colour library) pass; `verifyRoborazziTaheriDebug` against the new baselines.

#### Material You, the rest (2026-10-27)

Owner: "Convert the remaining." The five things the first pass left in the old look:

- **Icons are Material Symbols Rounded** (weight 400, grade 0, optical size 24; outline by default, the filled axis for a selected or active state). Compose has no
  Symbols library (`material-icons-extended` is the old Material Icons), so `scripts/symbols.py` turns the official SVGs (a pinned commit of google/material-design-icons)
  into `ui/icons/Symbols.kt`, an object of lazily built `ImageVector`s: `Symbols.Add`, and `Symbols.Fill.Home` where a state is shown (the navigation bar's chosen tab via
  `NavIcon.filled`; status marks such as the check circle and warning are drawn filled by default, as Material draws them). The list is `scripts/symbols.txt` (Kotlin name,
  Symbols name, flags). About 250 names replaced every `Icons.Filled/Rounded/Outlined/AutoMirrored.*` (~360 uses of 247 names); `material-icons-extended` is dropped from the app
  (APK size in the checks below). `NavIcon` keeps its contract (`NavMapTests.everyIconBothMapsUseIsDrawn`).
- **The widget** (`widget/`) is Material You: `WidgetColors` grows the business's scheme (the same `ErpScheme` seed, light and dark; the phone's wallpaper colours on Android 12+ when
  Settings > This phone > "Wallpaper colours" is on, and switching it refreshes the widget) into a `GlanceTheme` per business tile, so two businesses on one widget each wear their own colours.
  Tiles are `surfaceContainerHigh` with the system's own corner (`system_app_widget_background_radius`; `system_app_widget_inner_radius` for the insets, 24/16 dp before Android 12);
  the large face's "Needs you" and "Recent sales" are tonal insets with a Symbols glyph (`ic_symbol_*` drawables generated with the rest) in place of the rule; names, labels and
  figures use the Material 3 label/title sizes in sentence case; up, late and owed are the app's tones. Every face's content, the layout plan (`WidgetLayout`, `WidgetPlanTests`)
  and the both-businesses arrangements are as they were. `WidgetFacePreview` draws the same plan from the same `WidgetColors` and shapes.
- **The create button no longer covers the last row**: `LocalFabClearance` (88 dp: the button, its margin and a gap) is provided by `PlaceScreen` on a phone's tab root, and Home,
  the Orders hub, Invoices, Customers and Search pad their scrolling content's end with it.
- **No hairlines in cards.** An order's pieces and the invoice's pieces, totals and payments are `SegmentedColumn` tiles (the totals the group's last tile); the order's note and
  delivery, the New sale/order review panes and the piece summary are tiles; an order or invoice card's action row, the sheets' header rules and the Design, Marketing and Label bars
  are spacing or their own tone (`surfaceContainer`); a pane divider is a gap; `formRow` lost its drawn line; `LedgerDivider` outside a group is a 2 dp slit of the page tone. The
  invoice's perforation before the totals is gone from the screen (the PDF's paper keeps its own). Menus keep Material's divider between their groups. The New menu's order and
  repair icons and Settings' icons no longer carry the iPhone's system colours (scheme roles; `SettingsColors` is gone), the sending pill is the inverse surface (no shadow).
- **Text fields are Material's filled field** (`ui/TextFields.kt`, `erp.app.ui.TextField`: `surfaceContainerHighest`, the chip's corners, a primary indicator only while focused),
  for all 57 files that used `OutlinedTextField`. The label-and-value rows (`ValueInput`, `QuietField`, `FieldRow` of New order) are the Settings list's inline entry and are unchanged.
- **The launch window** is the business's surface: `generate<House>HouseRes` (app/build.gradle.kts) works out the scheme's `surface` for the flavor's palette with the same
  Material Color Utilities (on the build's classpath) and writes `house_launch` and `house_ground` for `values` and `values-night`; `Theme.Erp.Splash` (the Android 12+
  SplashScreen API) draws the mark on it and `Theme.Erp` is its window, so no cream shows before Compose draws.
