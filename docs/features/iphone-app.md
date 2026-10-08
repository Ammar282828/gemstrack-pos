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
which the deploys share, so nothing builds for an ERP-only change.

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

**Going fully native** (owner, 2026-10-08: "rewrite the app and make the app fully native"). `apps/iphone`, SwiftUI,
replaces this shell under the same bundle IDs. Reads straight from Firestore with Apple's Firebase SDK (live, and on the
phone when offline); every write that moves money goes through the ERP's server routes (`/api/staff/write` and its
like), so the rules for balances, hisaab and advances stay in one place. Screens arrive in phases; until a screen's
native version lands it opens as the web page inside the app.

**Left for the native app.** Push registration on the phone, the widget, Face ID for the delete code, the document
scanner, offline opening.
