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
open and Secret Manager is not writable from the ERP.

**The widget's figures** (`/api/widget/summary`, `lib/widget`): the house's rate, the drawer (Today's cash), Owed to
you (with hisaab) and orders and repairs due, from the ERP's own functions, worked out at most every 15 minutes. Read
with a key of the phone's own (`/api/widget/key`, kept by hash in `widget_keys`) that opens nothing else.

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
- **What is still the ERP's page** (2026-10-09, after every operational page went native): the designers (Post a piece's
  story and square, the Ad studio, re-making a site photo on Edit a piece); PDFs still drawn only in the browser (the
  hisaab ledger and its reminder, the expense report, the repair receipt; the invoice and the workshop slip are drawn
  on the server, `/api/app/pdf/*`, and shown natively); an order's Give out and a sold piece's workshop details (sample
  photo, admin note); a stock piece's photo; the voice order; Backups' Restore (a mass merge with no undo, kept to the
  browser's rules) and the one-off Taheri book import; the customers' spam finder; Ads' Facebook Connect (opens Safari:
  the callback checks a cookie the app's session cannot hold).
- **Liquid Glass** on the control layer only: four tabs (Home, Orders, Invoices, Customers) and Search, which is also the
  whole map, Settings and the account (an iPhone shows five tabs; a sixth folded two away); New sale · Order · Scan as the
  tab bar's accessory; the rate chip on each tab's first screen for owners.
- **The phone.** Face ID keeps the delete code (offered once a typed code is accepted; the server still checks it),
  Apple's document scanner reads paper for the bill and order-slip readers, notifications per kind (Search → This
  phone), the home-screen widget.
- **Checks and builds** (`.github/workflows/iphone-native.yml`): ERPCore's tests on Linux on every push; the
  simulator build, a screenshot of each tab in the demo (`-ERPDemo YES`, made-up data in `Resources/demo.json`) and
  TestFlight only by hand since 2026-10-09, when Xcode Cloud took them over (below). A house reaches TestFlight once
  its Firebase iOS app ID is in `apps/iphone/houses.json` (`firebase.iosAppId`, Firebase console → Project settings →
  Add app → iOS).

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
  2.1 from the first such build, as its numbers count from 1), XcodeGen, then the packages resolved (Xcode Cloud
  builds only from a Package.resolved, which a generated project lacks).
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
  6. `sh apps/iphone/scripts/xcode-cloud-setup.sh mina`, then steps 2 to 4 again: **Mina release**.