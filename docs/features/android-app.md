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
- **Device.** Voice (Android's recogniser → `/api/voice/native`), documents scanned with ML Kit's document scanner,
  biometric unlock for the delete code (BiometricPrompt + Keystore), PDFs from `/api/app/pdf/*` shown natively and
  shared, deep links (`https://<erp host>/…` App Links and `erp://`), Glance widgets from `/api/widget/summary` with
  the phone's own key (`/api/widget/key`).
- **Notifications.** FCM. `src/lib/push` sends to Android phones beside Apple's, from the same events, with the same
  words and the same per-kind switches (`push_devices` entries carry `platform: 'android'`); sent with
  `firebase-admin` messaging under the backend's own service account (no FCM key to upload). A phone registers at `/api/push/devices` with `{ token: <FCM registration token>, platform: "android", bundleId: <applicationId>, label }`. The App Hosting runtime service account (`firebase-app-hosting-compute@<project>.iam.gserviceaccount.com`) may need `roles/firebasecloudmessaging.admin` in each project to send: an owner step, unverified.

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
