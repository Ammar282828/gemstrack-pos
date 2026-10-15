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
Settings → This phone; the server logs `[push] no-key: <kind>` (once per 10 minutes) and `[push] no devices: <kind>`.

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
- **Voice** is native (`Device/NativeVoice.swift`): Apple's recogniser or up to a minute of audio goes to
  `/api/voice/native` (below), owners only. Its sheet closes before the page it chose opens (two sheets in one update
  can drop the second).
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
minutes of them, a UI check about 15. `iphone-native.yml` keeps ERPCore's Linux tests on every push; its Mac
jobs run only by hand.
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
