# iPhone app

## iPhone app

Started 2026-10-08 (owner: "make the pos into an iphone app"; enrolled in the Apple Developer Program).

**What it is.** `apps/ios`, a Capacitor 8 shell (Swift Package Manager, no CocoaPods) that opens the live ERP:
erp.taheri.shop for **Taheri ERP** (`shop.taheri.erp`) and erp.houseofmina.store for **House of Mina ERP**
(`store.houseofmina.erp`, "Mina ERP" on the home screen). Every ERP deploy reaches the phones with the next page
load; only a change to the shell needs a build. `apps/ios/houses.json` holds what differs between the two apps;
`scripts/house.mjs <house>` dresses the project as one house (Capacitor config, offline page, the App target's
bundle ID, name, icon, launch screen and Google client). The project's committed defaults are Taheri's.

**Given out by TestFlight, never the App Store.** Apple refuses a website in a wrapper on the App Store and
reviews every external build; internal TestFlight testing needs no review: up to 100 people who are users of the
App Store Connect team, each build alive for 90 days. `scripts/asc.mjs testers` puts the account holder in each
app's internal group "Shop" (every build) and invites anyone else as a **Marketing** user who sees that house's
app only (the least role TestFlight takes); they accept Apple's email and the next build reaches them.

**Built by GitHub, not a Mac.** `.github/workflows/ios.yml`, on `macos-26`:
- a push that changes the app (`apps/ios/ios`, `www`, `houses.json`, its packages; not only its scripts) → both
  houses to TestFlight, each once it is ready (its app made in App Store
  Connect — Apple's API cannot make one — and its Google iOS client in houses.json), else a simulator check;
- every other month → a fresh build before the last one's 90 days end;
- "Run workflow" → `check` (simulator) or `testflight`, and emails to make testers. A cloud session cannot press
  it (403): it adds a line to `apps/ios/RELEASES.md` and pushes.
The simulator check builds Taheri, runs `apps/ios/ci/probe.html` in the app (what the web view offers, the app's
own plugin answering, Google's sheet, the share sheet) and photographs the ERP light and dark; the pictures are in
the run's artifact and, small, in its log. macOS minutes count ten to one against the account's Actions minutes,
which the deploys share, so nothing builds for an ERP-only change. When they run out (first on 2026-10-09,
after a day of `[ui]` rounds), every job fails within seconds with no steps and no log, cloud-deploy's included:
no cloud session can ship to either house until the owner raises the Actions budget (github.com/settings/billing)
or the month turns. Then a run page's "Re-run all jobs" picks up; a cloud session cannot re-run (403).

**Signing.** The repository secrets `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` (the .p8) are an App Store
Connect team key with **Admin** access. A secret box takes text, not a file: the .p8's text is pasted, whole or
only its middle, lines joined or not (`asc.mjs privateKeyPem` puts it back together; a key it cannot read fails the
plan job by name). Each build makes its own distribution certificate and App Store profile
through the API, signs in a keychain of its own and revokes both at the end (`asc.mjs sign` / `revoke`). No
private key is kept anywhere; revoking touches nothing already uploaded, as Apple re-signs what TestFlight hands
out. The owner gets Apple's "certificate revoked" email per build.

**What the page asks of the phone** (`src/lib/native-app.ts`, installed in the root layout; nothing changes in a
browser):
- **Google sign-in.** Google refuses sign-in inside an app's web view ("disallowed_useragent"). `ERP.swift` signs
  in with Apple's sheet (ASWebAuthenticationSession: Safari's engine and cookies) with the house's **iOS OAuth
  client** (Google Cloud → Credentials, one per Firebase project: gemstrack-pos for Taheri, hom-pos for Mina) and
  PKCE, and hands Google's ID token to the gate, which signs Firebase in with `signInWithCredential`: the same
  Firebase user as on the website. `embeddedBrowser()` no longer tells the app to "open in Safari" (its user agent
  ends `ERPApp/1 (<house>)`); the sign-in log calls it "ERP app".
- **Files out.** A web view drops downloads (`<a download>`, jsPDF's save) and cannot put files on the page's
  share sheet. In the app `navigator.share`/`canShare` and every download go to the iPhone's share sheet
  (Capacitor Filesystem + Share): Print, Save to Files, WhatsApp, AirDrop. `savePDF` already took that path on iOS.
  A blob freed right after its click lives a minute longer in the app so it can still be read.
- **Live words.** No SpeechRecognition in a web view: `ERP.swift` runs Apple's recogniser and the page's
  `SpeechRecognition` is a stand-in for it, so `lib/voice/live.ts` is unchanged. It shares the microphone with
  the recording Gemini reads and never ends the audio session under it.
- **Status bar.** Follows the ERP's palette (the shop's or this phone's choice, not the phone's own light or
  dark): the root layout tells the app the colour it gives the browser bar.

**Notifications** (2026-10-08). `lib/push`: the ERP speaks to Apple's push service itself (HTTP/2, token auth),
no Firebase Messaging. Sent beside the WhatsApp alerts, from the same events and with the same words (an AlertDoc's
title and headline): a sale, a payment (and a website transfer slip, and a payment Shopify took), a new order (the
counter, the website, a new Shopify order as it arrives), an order finished or cancelled, online orders waiting or let
go, and a karigar marking a piece done (`/api/karigar/complete`, which never alerted). To every phone an owner signed in
on (`push_devices`), unless that phone switched the kind off; WhatsApp's switches do not decide it. Once per event
(`push_sent`); a development server only logs. The Apple key (one APNs key serves both houses) is uploaded in Settings →
Alerts and kept in `app_private/apns`, sealed under a key drawn from CRON_SECRET: Taheri's Firestore rules are still
open and Secret Manager is not writable from the ERP. The one owner step: create an APNs key (developer.apple.com →
Keys, APNs ticked) and upload the .p8 with its key ID and team TND272ULB5 in **both** ERPs, Settings → Alerts, since each
house has its own Firestore. `asc.mjs builds <house> --fix` (the TestFlight status workflow) turns on the App ID's Push
Notifications capability, so the next Xcode Cloud build's profile carries `aps-environment`. Failures now show: a phone
that cannot register reports it to `push_devices_failed` (`/api/push/register-failed`, last error, no token) and in
Settings → This phone; the server logs `[push] no-key: <kind>` (once per 10 minutes) and `[push] no devices: <kind>`. `push_devices` entries carry `platform` (absent = `ios`); Android phones are sent through FCM (`lib/push/fcm.ts`, firebase-admin under the backend's own service account, no key needed; see [Android](android-app.md)), so the Apple key is required only when an iPhone is registered. The App Hosting runtime service account may need `roles/firebasecloudmessaging.admin` (an owner step, unverified).

**The widget's figures** (`/api/widget/summary`, `lib/widget`): the house's rate, the drawer (Today's cash), Owed to
you (with hisaab) and orders and repairs due, from the ERP's own functions, worked out at most every 15 minutes. Read
with a key of the phone's own (`/api/widget/key`, kept by hash in `widget_keys`) that opens nothing else. The native
widget (2026-10-12) has small, medium, large and extra-large sizes and lock-screen forms, its text follows Dynamic Type,
and Settings shows a preview. It learns its house from `ERP_HOUSE` in its own Info.plist, never from a name containing
"mina".

**Going fully native** (owner, 2026-10-08: "rewrite the app and make the app fully native … follow latest apple liquid
glass design … keep ALL my erp features"). `apps/iphone` (SwiftUI, iOS 26) replaces this shell under the same bundle IDs
as version 2.0; `apps/iphone/CONVENTIONS.md` is its rulebook.
- **One brain.** Reads come from Firestore through Apple's Firebase SDK (`Data/Book.swift`): owners live, with a 512 MB
  copy on the phone for opening offline; staff and marketing poll `/api/staff/collections` (they have no Firestore
  access), as the web store does. Every write goes through `/api/app/write`, which runs the same `lib/writes/*` the
  browser runs (payment, advance, order status, piece done, rates, new customer) and names its follow-ups (the WhatsApp
  alert, a Shopify cancel) for the app to send without waiting.
- **The rules in Swift.** `Packages/ERPCore` (Foundation only, tested on Linux): the store's models, decoded leniently
  (a number stored as text, a list stored as a map, an unknown status kept), and `src/lib`'s display rules ported case
  for case (owed, today's cash, cash in, sale value, order stage and timing, exchange, credit, walk-in, rates, margin).
- **Every ERP place.** The menus are `lib/nav.ts` exported per house (`npm run nav:export`; a test fails when stale).
  A path with a native screen opens it; any other path, or `?web=1`, opens the ERP page inside the app, without its
  sidebar and top bar ("ERPNative/" in the user agent), signed in by itself with the app's Google token.
- **What is still the ERP's page** (2026-10-09, after every operational page went native; the designers followed on
  2026-10-12, below): PDFs still drawn only in the browser (the
  hisaab ledger and its reminder, the expense report, the repair receipt; the invoice and the workshop slip are drawn
  on the server, `/api/app/pdf/*`, and shown natively); an order's Give out and a sold piece's workshop details (sample
  photo, admin note); a stock piece's photo; the voice order; Backups' Restore (a mass merge with no undo, kept to the
  browser's rules) and the one-off Taheri book import; the customers' spam finder; Ads' Facebook Connect (opens Safari:
  the callback checks a cookie the app's session cannot hold).
- **Liquid Glass** on the control layer only: four tabs (Home, Orders, Invoices, Customers) and Search, which is also the
  whole map, Settings and the account (an iPhone shows five tabs; a sixth folded two away); New sale · Order · Scan as the
  tab bar's accessory; the rate chip on each tab's first screen for owners. Motion runs on the ERP's three curves and
  stops under Reduce Motion; saves and payments tap.
- **iPad.** An iPad layout needs the idiom to be pad **and** the width regular: a Plus or Max iPhone held sideways is
  regular width too and keeps the phone's layout. On an iPad the pages sit in readable columns (wider for money and
  analytics, full width for boards and lists that lay out their own columns), Home has two columns, the create menu
  is in the toolbar rather than floating, and a sale, an order or a piece is edited beside its summary
  (`TransactionWorkspace`).
- **New order and New sale are steps** (customer, pieces, payment and exchange, review), each with Continue, and the
  review page links back to any step. A picture already filed on an order is not sent again.
- **The phone.** Face ID keeps the delete code (offered once a typed code is accepted; the server still checks it),
  Apple's document scanner reads paper for the bill and order-slip readers, notifications per kind (Search → This
  phone), the home-screen widget. Settings → This phone says whether the phone is registered for alerts and sends
  a test notification.
- **Voice** is native (`Device/NativeVoice.swift`, `Device/VoiceEngine.swift`): on-device words (SpeechTranscriber, else
  SFSpeechRecognizer) go as text to `/api/voice/native` (below), owners only; it listens continuously and answers "Talk to
  ERP" from Siri, the Action button and Control Center ([Voice, Siri-grade](ai.md#voice-siri-grade-iphone-and-mac-2026-10-25)).
  Its sheet closes before the page it chose opens (two sheets in one update can drop the second).
- **The team note** ([decision](../decisions.md#team-note)): owners edit it from the banner (600 characters; Save stays
  off past that and says why); everyone reads it. It heads each tab's first screen and Search, not pushed pages or
  forms, where it would repeat at every level and take room from the fields.
- **Offline.** Cached books show at once and are not treated as a lost connection. Only a confirmed network loss
  (`Connection`, NWPathMonitor) puts up the offline wording; a cold start opens on the last answer with a
  ledger-shaped skeleton, re-checking sign-in at the same time.
- **Studio is native.** Post a piece, the Ad studio's Make and its **Board** (the canvas, notes, Let it cook, shapes,
  Saved ads, the post queue, over the same transactional board ops as the web and the MCP agent; read-only in the
  demo) and **Shopify** (Settings → Integrations: the connection, its permissions, a selective one-way import of
  orders; owners only) have no web page behind them. Re-making a site photo on Edit a piece still opens the ERP's page.
- **The designer engine is the web's own.** `App/Resources/Design/design-<house>.js` is `src/lib/social` bundled with
  the house's fonts and wordmark and run in a web view on the phone, with no network. **Whenever `src/lib/social` (or `lib/ads/studio` templates, `lib/website/maisons`)
  changes, run `node apps/iphone/scripts/design-bundle.mjs` and commit both files**; a phone otherwise draws the
  old design. A design is held as raw JSON (`MarketingValue`), never decoded into Swift fields, so a field the web adds
  survives a save from the phone and the reverse. Board designs are editable in full on the web and the phone
  (owner, 2026-10-12: "let me edit any present text and picture from any of the ads"); a picture added in the designer
  goes to the library through `POST /api/ads/studio/uploads` and the design keeps `lib:up:<id>`.
- **Agent keys** (Studio settings): the MCP connection is named from `/api/app/website` `siteName` and "-studio"
  ("taheri-studio"), as `board.tsx` does, so web and phone show the same command. The server keeps only the key's hash;
  a new key is shown once.
- **Icons and launch.** Mina has dark and tinted app icons from its wordmark. The launch screen is `UILaunchScreen`:
  the colour `Launch-<house>` and the mark `LaunchLogo-<house>` (light and dark variants), both set per house by
  `house.mjs`, so it follows the phone's appearance.
- **Signing out** unregisters the phone for alerts first, while the sign-in token is good, capped at 3 seconds:
  offline, it still signs out at once. A revoked account skips the unregister.
- **Checks and builds** (`.github/workflows/iphone-native.yml`): ERPCore's tests on Linux on every push; the
  simulator build, a screenshot of each tab in the demo (`-ERPDemo YES`, made-up data in `Resources/demo.json`) and
  TestFlight only by hand since 2026-10-09, when Xcode Cloud took them over (below). A house reaches TestFlight once
  its Firebase iOS app ID is in `apps/iphone/houses.json` (`firebase.iosAppId`, Firebase console → Project settings →
  Add app → iOS).
- **Verifying in a cloud session.** A Linux Swift toolchain (swift.org 6.0.3 for Ubuntu 24.04, extracted to `/opt/swift`;
  not kept across containers) builds and tests `Packages/ERPCore` and `Packages/Contract` and regenerates
  `contract/cases.json`. The App and Widget targets (SwiftUI, UIKit) compile only on Xcode Cloud.

### Server routes the app uses

The native app reads the ERP's own data from Firestore and writes only through the server; these are the routes that
are not obvious from its screens.
- **`/api/app/write`** takes every write the app makes as an op, checked and applied on the server against the live data.
  `updateSettings` is owners'; **the Team note** (`settings.teamNote`, at most 600 characters) is written through it, and staff
  and Marketing get 403 ([decision](../decisions.md#team-note)).
- **`/api/voice/native`** is the native app's voice: owners only, read only. The phone sends a sentence (or up to a minute of
  audio); the server loads the book itself (never names, balances or candidates from the phone; kept 45 s per instance), runs
  the same listener as the web's voice (`/api/voice/listen`) and returns the **planned ops**, which the phone then sends to
  `/api/app/write`. It writes nothing.
- **`src/lib/analytics/revenue-period.ts`** (`revenueForPeriod`, tested) is the revenue of a period for the dashboard and the
  widget: sales at their source order's date, open booked orders and other income. A bare `YYYY-MM-DD` is read as midnight in
  Karachi (+05:00), so a day's edge matches the shop's day wherever the server runs.
- **Order photos** (`lib/order-photos.ts`): one document per picture in `order_photos`. `splitItemPhotos` fingerprints
  each picture (`samplePhotoHash` on the item, `hash` on the document), so the same bytes sent again are recognised
  and keep their document (documents filed before hashes are compared by reading the one document). A picture an
  edit replaces or removes has its document deleted in the same commit, in `updateOrder` and the web's order saves.
- **Audits.** What was checked and fixed in the native screens: [orders and invoices](iphone-order-invoice-audit.md) and
  [the workshop](iphone-workshop-audit.md).

### Xcode Cloud

**Xcode Cloud** builds the native app since 2026-10-09 (owner: "cant you switch to something free"): GitHub's Mac
minutes count ten to one and spent the month's Actions allowance in one day, which also stops the web deploys.
Apple's Developer Program includes 25 Xcode Cloud hours a month; a release of both houses takes about 20
minutes of them, a UI check about 15. `iphone-native.yml` keeps ERPCore's Linux tests, but since 2026-10-24 only
for a push that touches what they compile (Packages, `contract/`, App/Screens/NewOrder and Sale, the Contract
package's links); every other Swift change is compiled by Xcode Cloud's release. Its Mac jobs, and `ios.yml`'s (the
retired Capacitor shell), run only by hand. That day the month's 2,000 Actions minutes ran out (about 1,400 Linux
plus 340 Mac minutes at ten to one; the native app's test job alone about 5 billed minutes a push), and every
deploy stopped until the allowance resets.
- **How a build starts.** A new line in `apps/iphone/RELEASES.md` on a `claude/` branch: each house's "release"
  workflow archives and hands the build to TestFlight's internal "Shop" group. A new line in
  `apps/iphone/CHECKS.md`: the "UI check" workflow runs `ERPUITests` in the simulator. The result shows on the
  commit in GitHub (the "Xcode Cloud" check) and in App Store Connect → the app → Xcode Cloud.
- **How it builds.** `apps/iphone/ci_scripts/ci_post_clone.sh`: the house from the product's bundle ID
  (`houses.json`), `house.mjs --auto <team> <build number>` (automatic signing, Xcode Cloud's build number;
  which it stamps itself, counting from 1; 2.2 since 2026-10-12, as Mac uploads had reached 2.1 (1009) and TestFlight offers a phone only a higher version or build), XcodeGen, then the packages resolved (Xcode Cloud
  builds only from a Package.resolved, which a generated project lacks: the committed `apps/iphone/Package.resolved` is copied in; remake it when Firebase's version changes).
- **The one-time setup, on the Mac** (the owner, about ten minutes):
  1. `git pull`, then `sh apps/iphone/scripts/xcode-cloud-setup.sh taheri`: Xcode opens the Taheri app.
  2. Target ERP → Signing & Capabilities: tick *Automatically manage signing* and pick the team (also for
     ERPWidget).
  3. Integrate → Create Workflow… → the app → let Xcode Cloud reach GitHub (it installs Apple's app on
     `Ammar282828/taheri-pos`).
  4. Edit the workflow into **Taheri release**: Start Conditions → Branch Changes, branches beginning `claude/`,
     Files and Folders `apps/iphone/RELEASES.md`; Actions → Archive, iOS, TestFlight (Internal Testing Only);
     Post-Actions → TestFlight Internal Testing, group "Shop".
  5. Add **Taheri UI check**: Start Conditions the same with `apps/iphone/CHECKS.md`; Actions → Test, scheme ERP,
     an iPhone simulator on the latest iOS.
  6. `sh apps/iphone/scripts/xcode-cloud-setup.sh mina`, then steps 2 to 4 again: **Mina release**. Mina's project is
     `ERPMina.xcodeproj` (`project-mina.yml`, project.yml under another name): Xcode Cloud keeps one product per
     project file, so a Mina workflow made on `ERP.xcodeproj` joins Taheri's product and builds Taheri's app.
  - The Mac's clone needs a remote called `origin` on taheri-pos (Xcode Cloud reads it; `hom` sorts first
     otherwise and is gemstrack-pos, where no `claude/` branch lives).

### Parity with the web, 2026-10-15

Owner: "all the recent ERP fixes, make sure they got added [to the iOS app] also". Every web change since 2026-10-09 was
read; what the app lacked was brought over, the rest is listed so it is not asked twice.

**Ported (ERPCore first, with the TypeScript tests as XCTest cases):**
- **Analytics default is this month**, the 1st to today (`lib/analytics/range-param.ts` → `AnalyticsRange.swift`, tested). The
  app's period picker is now ERPCore's `AnalyticsPeriod`; "This month" leads the quick choices. A phone that stored
  "Last 30 days" keeps it; a fresh one, or an unreadable key, opens on this month.
- **Home's money card is "This month"** (the web's was "Last 30 days"): revenue, expenses (partner drawings out) and net since
  the 1st, with one chart point a day. The week of bars under "Taken today" still reads the trailing 30 days, so it never
  shrinks at a month's start.
- **Due grouping** (`lib/orders-due.ts`, the web extracted it from the app's `OrdersLogic`) now lives in ERPCore
  (`OrdersDue.swift`, `OrdersDueTests` mirror `orders-due.test.ts`); `OrdersLogic` calls it.
- **Calendar money in lac and crore** (`dayLac` over `axisLac`: 85k · 2.9L · 56L · 1.2Cr; the month's figures as "PKR 29.6 lac"):
  `Money.axisLac`, `ShopCalendar.dayMoney`, tested.
- **Studio board:** a replaced picture starts centred and unzoomed (`board-pictures.ts` `freshCrops`); a new design can start
  from Photos, Files or Drive, or a link (an image address or an Instagram post's, `/api/ads/studio/fetch-image`); Tidy up in
  the board's tools menu; a put that updates a design's other sizes says how many (`linked`, `board-links.ts`).
- **Designer:** the engine bundles were rebuilt (button pills, linked sizes' words, the bg shade, server-draw parity, and the six
  jewellery faces already bundled); the font and blend pickers list the v2 names.
- **Where the web moved:** Posts › Design and Ads › Plan are ERP pages in the app, offered as rows on the Posts hub and Ads
  overview (and by the map, Search and the sidebar). The native Post a piece composer and Studio stay at `/website/post` and
  `/ads/studio`: the web keeps those addresses in its map as `moved` pages for exactly this, and no API route moved. Settings →
  Shop details is `/settings/shop` on the web now; the native Shop screen answers it too.

**Already the same:** customer detail's one owed figure (the list's `lib/owed.ts`), Given by (`8707e3f` shipped its app half),
Posts' website weight (server, and the web card the hub opens), Studio uploads' transparency, order photos, push, Shopify
notices, the "Web matches the app" series (the web copied the app's look), tones, Settings index, Calendar layout.

**Not native, on purpose:** Design's own workspace (the v2 designer's panels, AI resize, smart input, publish sheet, the page
strip) is the ERP's page in the app; the phone's designer renders every v2 field (blend, effects, rich text, gradients, QR,
adjust) through the bundled engine and keeps what it cannot edit. Saved designs of the new store (`designs`) are on the Design
page's Saved shelf; the phone's Saved ads are the legacy `ad_saved` rows, which the web shows too until it re-saves them.

### Ads parity, 2026-10-17

The web's Ads Manager additions of 2026-10-16 (docs/features/ads.md) on the phone, owner: "Ship the new erp ad manager
changes to the ios app". As before, the phone gathers choices and the server keeps the rules and talks to Meta.
- **Overview:** Sales from ads and ROAS tiles (with cost per order) when anything sold; purchases lead the main result;
  ROAS on the top ads. `AdMetrics.values` carries Meta's action_values; `AdsResults.sales` is shape.ts `salesOf`.
- **Campaigns:** sales and ROAS on every row, "Best ROAS" in the gallery sort, and More → Download (CSV): the server's
  CSV (`/api/ads/campaigns?format=csv`, export.ts, the same file as the web's button) to the share sheet.
- **Audiences:** Website visitors from the pixel (`websiteEvents`, `pixel` on `/api/ads/audiences`).
- **New ad** (`AdsNewAdSources.swift`): What to promote is a menu now (six choices): a new video (Photos → Meta's resumable
  upload through `/api/ads/videos`, piece by piece, the ID token asked per piece; then Meta's cover frame), a creator's post
  (the partnership ad code, checked on `/api/ads/partner`), the catalogue (`/api/ads/catalog`, biggest set first; lookers or
  new buyers). Advanced: bidding (cost cap, bid cap, minimum ROAS for online orders) and set days and hours (which move the
  budget to a total one, Meta's rule). `bidding` and `hours` go in the plan; `/api/ads/plan` says what stops it.
- **A/B tests** (`AdsTests.swift`, `/ads/tests`, linked from Setup): make a split test of 2–5 ad sets and read each side.
- The "UI check" workflow (CHECKS.md) has never reported on a commit (no Xcode Cloud check on 9cebeeb or 4075675): it
  was likely never made in Xcode Cloud (setup step 5). A release is the compile check meanwhile: one that fails stops at
  the archive and sends nothing to TestFlight.

### Posts parity, 2026-10-17

Owner: "Why isnt the posts region ported yet". What the web's Posts → Design board gained after the app's 10-15 port:
- **The designer saves as you go** (board.tsx 2ef9bd7): each change a moment after the last touch, one save at a time, outside
  the edit that asked for it; no Save button or discard question; a cloud mark says Saved / Saving / Not saved (tap to retry).
  ‹ › open the previous or next design in reading order in place, Sizes the design's other sizes; Done waits for the
  last save and the board makes the design last edited glow.
- **Tidy** is board-tidy.ts's layout (each ad's sizes side by side, blocks a row by the screen's shape) and is sent 60
  moves a request, the server's limit: before, Tidy failed on any board over 60 designs (Mina's shoot boards have ~180).
- **The design engines** (`design-<house>.js`) rebuilt: they predated brand.ts's 10-15/16 changes (Mina's tarnish-resistant
  plating line, Bodoni italic and Tenor capitals, the owner's type edits), so the phone drew the old style.
- Not ported: the board's trackpad and ⌘-zoom fix (582822c) is the browser's; the phone's board pinches natively.

### No web pages left, 2026-10-17

Owner: "Check for others also and natively port them to ios", then "port all of them / Also make the app smoother
faster / And look for that bubble bug on form completion". Of the map's 61 places only Ads → Plan opened the web (now
AdsPlanScreen on the Studio's own Plan) and the one-off Taheri book import (kept). The hand-offs inside native screens:
- **Stock photo:** `POST /api/app/product-photo` (multipart; HEIC → JPEG, ≤ 2000 px; owners) uploads to the web's
  `product_images/` with a download token (`adminBucket()`) and saves it with the shared write `setProductPhoto`;
  `StockPiecePhotoField` (Photos or camera, remove).
- **Repairs receipt, Expense report, Hisaab summary and ledger PDFs:** drawn on the server by the web's own drawers
  (`/api/app/pdf/repair/[id]`, `/expenses`, `/hisaab`, `/hisaab/[id]`; lib/expense-report*, hisaab-report, hisaab-pdf,
  wall-clock for Karachi's days on a UTC server); the web's buttons use the same drawers. The ledger's WhatsApp
  reminder is `/api/app/hisaab/[id]/reminder` (reminderMessage, the web's words) and opens WhatsApp from the phone.
- **Customers → Clean up spam:** lib/customer-spam.ts, ported to ERPCore (CustomerSpam, same cases); a review sheet,
  one delete code, `removeCustomer` per pick.
- **Settings:** website selling (`saveWebsiteConfig`, the web form now saves through it too), alerts' connection, test
  and Send now (the notifications routes), Restore from backup (`/api/app/backup/restore`: delete code, 400 a request,
  dates revived from `{seconds, nanoseconds}` — the web's restore now revives them too), Restore shop defaults
  (`restoreShopDefaults`, previewed first), Change numbering (`setCounters`, delete code; `cleanSettingsPatch` still
  refuses counters).
- **Website → Re-make the photo:** the site layouts in the bundled engine; shape, layouts, the designer, AI, saved to
  `/api/website/edits` as the web saves it.
- Kept on the web on purpose: Meta's one-time dashboard steps (instructions), and a draft begun in the web's form.
- **The bubble on finishing a form** (owner, 10-15 and 10-17): New sale, New order and Make invoice swapped their form
  for the result on an animation, and the glass Save button (glassProminent) shrank into a blob over the result. The
  swap is now immediate; the Note toast is a material card, not glass.
- **Smoother:** piece photos load through `RemoteImageStore` (downsampled to the frame off the main thread, a memory
  cache, a 200 MB disk cache, one download per address) instead of AsyncImage; a customer's and a piece's figures are
  memoised on the shelves' revisions; pages find their record by id rather than walking the shelf.


### No buttons to the web, and quiet screens, 2026-10-17

Owner: "A lot of the buttons still lead to old non native screens", then "Also invoices tab is very noisy / Fix that
noisy issue everywhere / Scan ALL screens". Every `?web=1`, "Open in the ERP" and `WebScreen(` inside a native screen
is gone (CONVENTIONS rule 5); and a link on an ERP page to a place with a native screen opens that screen (WebBridge
`open`: a link's click asks first; a `router.push` after a save opens the screen and the page steps back).
- **Orders:** karigar per piece, remove a piece and delete an advance (delete code; ops-orders2, lib/writes/order-pieces,
  the browser's too: removing a piece now keeps the discount and advances in the balance), the piece's sample photo,
  Leopards always native. **Invoices:** the PDF to another number, a first link's key (`giveInvoiceShareKey`), payment
  links, Shopify CSV import (ops-invoices2, lib/writes/shopify-csv-import: numbers reserved first, never overwriting).
- **Stock:** the tag sheet (QR, CSV for WEPrint), delete with the delete code (`deleteProduct`, ops-stock3, the
  browser's too), voice add into the native form (`StockVoiceSeed`).
- **Workshop and work:** a job's details (`updateOrderPieceDetails`, `updateInvoicePieceDetails`), Revert in the activity
  log, sign-ins and the emergency lock (`lockDatabase`; ops-work2), a draft from another device in the native form
  (`WorkDraftContinue`, `WorkDraftSync.adopt`), Design's "Make the ad with AI".
- **Posts:** the tray (pick, weight, caption, AI caption, story, crop and design, send or queue), Send all and Spread
  over the day (QueuePlan, SiteWeight in ERPCore); Meta's one-time steps on Setup.
- **Settings:** the Taheri book import (`importTaheriBook`, ops-settings4), `/settings?tab=`.
- **Quiet screens** (CONVENTIONS rule 15). A first pass restructured the screens (two-line rows, no monograms or
  tiles); the owner: "I liked the old card ui for invoices and orders, just wanted it to be less noisy, revert that
  anywhere else". So every screen keeps its 10-16 layout, cards, monograms, tiles and stage tracks, and only the noise
  inside goes: no badge for the expected state (Paid, done, running, connected), no number twice, no obvious footers.
### One app, many businesses (2026-10-16)

Owner: one app for all his businesses, to switch between them and to add more. Until now each house was its own app
(Taheri `shop.taheri.erp`, House of Mina `store.houseofmina.erp`, one build per house by `house.mjs`). Now the default build is
**one app, `shop.taheri.erp`, "ERP" on the home screen**, and the house is a thing the app holds at run time.

**What a business is.** A `Business` (`App/Config/Business.swift`) is exactly the ERP's `GET /api/app/business`
(`src/app/api/app/business/route.ts`, public, cached five minutes): id, the shop's name, ERP address, metal, margin rule, light and dark
palette, logo, icon, the iOS sign-in identifiers (Google client and the Firebase iOS app) and the shop's switches (`flags`). Taheri and
House of Mina ship in the app (`Resources/businesses.json`, written by `scripts/businesses.mjs` from `houses.json`), so a first launch needs
no network and they keep their bundled art. `House` is a facade over the open business; nothing keeps a business's value in a static
(CONVENTIONS rule 13). `House.id == "mina"` branches are gone: Mina's foil order follows `metal`, the shop's defaults follow `flags`, and the two
that have no server flag (the Taheri Software import, the Mina catalogue's photo note) check `House.bundledArt`, the bundled art, so an added
business never borrows them.

**Adding one.** Settings → Businesses (owners), Search → Businesses (everyone), or the chip → Businesses…: type the ERP's address
(`erp.houseofmina.store`). `Businesses.describe(address:)` reads `/api/app/business` over https from that host only (the descriptor may not
name another host, or it could point the sign-in token at a stranger), judges it (`Business.problem`: an id, a name, readable colours, an iOS
sign-in), and the sheet shows the name, logo and colours as a card **before** "Add". Adding keeps it and opens it, at its sign-in. The five-minute
refresh (`Businesses.refresh`) keeps names, colours and switches current without an app update; it never moves a business's address or its
Firebase identity.

**The chip and the sheet.** Each tab root's leading toolbar (and the iPad sidebar's header) holds the open business's mark and name; tap opens the
Businesses sheet, touch and hold lists the businesses for a one-touch switch. With one business the chip stays, quiet, as the way to add. The sheet
lists each business with its address and who is signed in; tap to switch (a selection tick, the root rebuilt on the new business); swipe or Edit to
remove. A built-in is **hidden**, not deleted (it comes back by typing its address); the last business cannot go. Removing signs that business out
(its alerts unregistered, its Firebase user, Google token, books on disk, drafts, widget link and logo). The sign-in page says which business you are
signing in to, with a "Switch business" button.

**Per business.** Sign-in (one Firebase app each; Taheri keeps the default app, so existing installs stay signed in), data (Firestore cache per app,
`BizKey` defaults), session and role, push, widget.
- **Push.** The phone has one token; every business signed in on it is told of it (`Push.link`), and a payload names its business, so a tap opens that
  business first. Settings → This phone lists each business and whether it is linked (the kinds are chosen for the open business).
- **Widget.** One widget, many businesses. The keychain item the app and widget share is a list of `{id, name, url, key, palette, brand}` (`Shared/
  ERPWidgetLink.swift`); sign-in adds the open business's entry, sign-out or removal takes only its own, and a one-house build's single link is moved
  into the list. The widget (kind `ERPToday`, so widgets already placed keep their place) is configurable (`SelectBusinessIntent`, an App Intents
  `WidgetConfigurationIntent` whose "Business" is any linked one; the first until chosen). Colours and the wordmark come from the entry: Taheri's and
  Mina's from the asset catalogue, any other from its hex palette with its name for a wordmark. Nothing reads the build's Info.plist. With nothing linked
  it says "Open the app and sign in".
- **Icon.** The primary icon is the app's own, `AppIcon-erp` (a champagne-gold diamond outline on ink; `apps/iphone/scripts/erp-icon.mjs` draws it, `houses.json` `appIcon`); Taheri's and Mina's are alternates (`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = AppIcon-taheri AppIcon-mina`, from `houses.json`
  `alternateIcons`). Settings → This phone → App icon: ERP (default) / follow the business / Taheri / House of Mina. It changes only on that tap (iOS shows an alert on
  every change, so a business switch never does it); "follow" sets the open business's icon when chosen and offers an update button after a switch.

**The build.** `house.mjs taheri` is the merged app's bundle and asset base ("ERP"); `ERP_HOUSE` no longer drives behaviour at run time, only the launch
screen, the primary icon and the global accent colour. The `ERPHouse` Info.plist keys are gone.

**The Mina Firebase step (once, by the owner).** For House of Mina to sign in inside the one app, its Firebase project needs the merged app's bundle id:
1. Firebase console → project `hom-pos-52710474-ceeea` → Add app → iOS, bundle id **`shop.taheri.erp`**; download nothing, note the **App ID**
   (`1:288366939838:ios:…`) and the iOS OAuth client Google makes for it (its client id ends `.apps.googleusercontent.com`; its reversed id is the URL scheme
   the app registers).
2. Set the new values in `apphosting.mina.yaml`: `APP_IOS_FIREBASE_APP_ID` (the new App ID) and `APP_IOS_GOOGLE_CLIENT_ID` (the new iOS client id), keeping
   `APP_IOS_FIREBASE_API_KEY` if the project's key is unchanged; those are what `storeAppIos()` reads and `/api/app/business` sends. Put the same two in
   `houses.json` for `mina` (`firebase.iosAppId`, `googleClientId`) and rerun `node scripts/businesses.mjs`, so the bundled copy matches. Until then
   Mina's descriptor carries the old Mina app's ids (a temporary note in the YAML says so), which belong to another bundle id: Mina lists fine in the one app but
   Google sign-in to it fails there, and the old Mina app keeps working.
3. Deploy (both houses, as always). The app refreshes Mina's descriptor on its next launch.

**The old Mina app is deprecated.** `store.houseofmina.erp` (`project-mina.yml`, Mina's Xcode Cloud product, `houses.json` `mina`) keeps building and shipping
until its testers have moved to the one app; then delete the project file, Mina's workflows and the `mina` entry. Its sign-in and data are its own, so
moving means signing in again in the one app.

**Checks.** `swiftc -parse` only for `App/` here; the Mac build is the compiler. UI test `testTheBusinessesSheetOpensFromTheChip` (demo) opens the sheet from the
chip; launch arguments (`-ERPDemo`, `-ERPDemoTab`, `-ERPDemoOpen`) work as before, and `/app/businesses` is in the every-place list.

### The UI scan (2026-10-17)

Twelve read-only audits, one per screen group, found every screen solving the same things its own way: a bottom
bar built by hand 23 times, 86 hand-made empty states, red error text at the foot of forms, glass buttons inside
rows, deletes and sign-out with no question, a success tap fired twice (the toast already taps), sums shrunk to half
size at large text, and almost no motion in Orders or Marketing. The answer is `apps/iphone/CONVENTIONS.md` rule 16
and its kit (`App/UI/Surface.swift`: `.actionBar`, `ErrorState`, `EmptyState`, `confirmDestructive`, the feedback
modifiers, `keyboardDone`, `AdaptiveStack`), applied to every folder with each screen's layout kept (rule 15).

Left for later, because each is a redesign rather than a rule: one designer instead of two (`ArtworkEditor` beside
the Board's canvas, whose model is the better one), pinch/rotate and multi-select on the canvas, New sale and New
order sharing one piece editor and one step order, the Workshop's cards as real list rows (swipe actions), the
Studio's own tab strip, a shared money/weight field, and Search holding the map and the account rows.

### House of Mina's own app retired (2026-10-20)

Owner: "stop developing the house of mina app from now on." House of Mina lives on as a business inside the one
ERP app (`shop.taheri.erp`). Its own app (`store.houseofmina.erp`) gets no more builds: its Xcode Cloud workflows
are switched off by `asc.mjs ci-off mina` (run on every TestFlight status run, so they stay off), and the TestFlight
status and tester jobs handle the ERP app only. Its testers move to the ERP app (`testers taheri`).

### Release hygiene (2026-10-20)

From the blind-spot audit (App Store, platform, security):
- **Privacy manifests:** `App/Resources/PrivacyInfo.xcprivacy` and `Widget/PrivacyInfo.xcprivacy` (manifests are per bundle;
  XcodeGen takes them with their folders). No tracking. UserDefaults, reason CA92.1, in both (the widget's cache is its own
  defaults, no App Group). Not declared: file timestamps, disk space, keyboards (no use), and system boot time: `LaunchClock`
  reads the process's own start through `sysctl(KERN_PROC_PID)` (`p_starttime`), not `kern.boottime` or `systemUptime`, so it
  is not a required-reason API. Collected, linked, never for tracking: name, email, phone number, other user content,
  photos (scans), device ID (push token), crash and performance data (MetricKit, below). Run Xcode's Privacy Report on the
  Mac to confirm the Firebase and gRPC SDKs carry their own manifests.
- **TestFlight never lapses:** `asc.mjs keep-fresh taheri --days 60` starts an Xcode Cloud build of the release workflow on
  `main` when the newest valid build is 60 days old (nothing while a build is queued or running; `--dry` only says).
  `testflight-status.yml` runs it daily with the `builds --fix` pass.
- **Crash and hang reports:** `App/Support/Diagnostics.swift` (MetricKit) sends code signatures only (exception, signal,
  termination reason, the heaviest stack as `Binary+offset`, build, OS, model) to `/api/app/diagnostics`, kept in Firestore
  `app_diagnostics`. What cannot be sent waits on the phone for the next launch. Needs `Diagnostics.start()` at launch.
- **Widget:** the figures and the pinned note are `.privacySensitive()` (hidden on the locked Lock Screen); the widget key list
  is `AfterFirstUnlockThisDeviceOnly` (an old item is moved in place). `DELETE /api/widget/key` (`{ key }`, the same account)
  takes a key back; `WidgetKeys.revoke(business:)` calls it, capped at 3 s.
- **Pasteboard:** `SecretPasteboard.copy` (this device only, gone in 5 minutes) is for links that carry a key and for tokens.
- **Minimum build:** `/api/app/business` carries `minBuild` (`APP_MIN_BUILD`, default 0); `Business.needsUpdate` is true below it. The Android app has its own floor in the same answer, `minAndroidBuild` (`APP_MIN_ANDROID_BUILD`, a versionCode), because the two stores number builds apart.

### Business picker, redesigned (2026-10-30)

Owner: "Redo the initial business selection page of the app." `Nav/BusinessPicker.swift` (one body for iPhone, iPad and Mac;
`LaunchPicker` and the fast start are untouched: the picker paints first, `launch.ready` builds the open business's books
underneath, Settings › Businesses › "Ask which business on opening" still turns it off, the lock cover still sits above it).
- **Before:** a grouped-grey page, a bare "Open" title and plain rows (badge, name, email, chevron); the Mac had a second copy of the layout; nothing
  of a business's own look but a small badge; the current business only said "Last opened" in grey text; no sign-in warning.
- **Now:** one large card per business drawn from *its* palette for the current appearance (card colour, an accent wash from the corner,
  its badge, its whole wordmark via `BusinessLogo`, name, one quiet line, an accent arrow), on the open business's ground. The business used last
  comes first with a "Last opened" capsule. The quiet line is local only: the signed-in email, else "Sign-in needed" (only when its Firebase app
  already exists; the picker never makes one), else "Opened 3 hr. ago" from a per-business stamp (`erp.business.lastOpened.<id>`, written
  on choose), else its address. No figure ("today PKR x") is shown: none is cached locally per business.
- **Layout:** an adaptive grid (300-440 pt columns, 900 pt max, centred; one column on a phone, side by side on iPad/Mac, scrolls with many); "Add a
  business" and "Manage" (both open the Businesses sheet) sit at the foot. Mac and iPad keep Return for the last-used business and ⌘1... for the rest.
- **Motion:** cards rise in on `Motion.enter`, staggered; the tapped card grows and the others fade on `Motion.travel` while the host's existing
  transition takes the app in (a crossfade under Reduce Motion). Not a matched-geometry zoom: the app is built in another view tree. One selection haptic.
- VoiceOver reads "Open <name>", with last opened and the status line as its value.
