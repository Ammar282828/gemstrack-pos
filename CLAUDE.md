# taheri-shop — the ERP for both houses

Next.js **ERP** (it started as a point-of-sale; renamed 2026-09-27) serving **two shops from one codebase**:

| House | Live at | Firebase project | Backend / environment | Deploys from |
|---|---|---|---|---|
| Taheri (gold and diamond) | erp.taheri.shop (and pos.taheri.shop) | `gemstrack-pos` | `studio` / `taheri` | branch **`taheri-next`** of this repo |
| House of Mina (silver) | erp.houseofmina.store (and pos.houseofmina.store) | `hom-pos-52710474-ceeea` | `studio` / `mina` | branch **`main`** of repo **gemstrack-pos** (remote `hom`) |

Two forks, reconverged 2026-09-22: both deploy from this history (`.firebaserc` is for the unused CLI).

The public website is a separate repo: **taheri-site** (github.com/Ammar282828/taheri-site,
`~/Projects/taheri-site`), a Vite app on Hostinger. Read its CLAUDE.md for the site.
Brand facts (name, hours, claims, links, voice) live in `taheri-site/docs/taheri-knowledge.md`.

## Branches and deploys

- Remotes: **`taheri`** (this repo, github.com/Ammar282828/taheri-pos) and **`hom`** (github.com/Ammar282828/gemstrack-pos).
  Neither is called origin.
- **`main` is the working branch.** Taheri deploys from `taheri-next`, Mina from `hom`'s `main`; both are
  pushed *from* `main` (see below). Every push to a deploy branch rolls out automatically
  (~5 min; `gcloud builds list --region us-central1`).
- Never trigger builds by hand (REST/console): they jam the queue.

## Running locally

- **Node 20**, not the Mac's default: launch config "POS (node 20)" (`PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev`, port 3000), or per house
  "Taheri (node 20)" (port 3000) / "Mina (node 20)" (port 3001). On Node 26 Google auth fails ("Premature close"). The per-house
  configs drop the second laptop's `GOOGLE_APPLICATION_CREDENTIALS` (a missing file that breaks every Google call).
- The app is behind Google sign-in, locally and in **both** houses since 2026-09-30 (owner: "taheri being open to all
  is a bit dangerous"). Don't reintroduce `NEXT_PUBLIC_OPEN_ACCESS`.
- Typecheck: `npx tsc --noEmit -p .`. ESLint (v9) is broken; the build is the lint gate.

## Configuration and access

- `apphosting.yaml` holds every env var. A `secret:` it declares **must exist in Secret Manager and
  be readable by the three App Hosting service accounts** (mirror `CRON_SECRET`'s IAM) *before* it is
  declared, or the rollout fails. Names are case-sensitive (`website-upload-secret`).
  A variable with `value: ""` also fails the rollout: write a word the code reads as off (`"none"`, `"0"`).
- **Taheri's backend also has console `overrideEnv`** (19 variables; docs/features/two-houses.md) and **they beat the YAML**. Read them with the App Hosting REST API
  (`GET …/projects/gemstrack-pos/locations/us-central1/backends/studio`, field `overrideEnv`); what a build actually used
  is `builds/<id>` → `config.env`. Mina's backend has none.
- Firebase CLI login is broken on the owner's Mac. Use **`gcloud`** (authenticated as the owner):
  `gcloud secrets …`, `gcloud builds list`, `gcloud run revisions list` — all `--project gemstrack-pos --region us-central1`.
  Never print a secret value; compare `sha256` of trimmed values instead.
- Hostinger: SSH with `~/.ssh/taheri_deploy` (port 65002, user in `taheri-site/.github/workflows/deploy.yml`). **Only on the owner's Mac.**
- **A bare 503 is the server dying**, not a route (routes answer JSON): out of memory kills every request on it.
  `gcloud logging read 'textPayload:"Memory limit of"'`; 1 GiB ([why](docs/features/ad-studio.md#out-of-memory)).
- The owner is a Firebase/GCP Owner but lacks `iam.serviceAccounts.signBlob`, so `createCustomToken` fails from a laptop;
  test storage layers directly (`npx tsx`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=gemstrack-pos`).

## Two houses, one codebase — the rules

- **Every difference between the shops is a variable, never a fork of the code.** The code's
  defaults are Taheri's. `apphosting.yaml` holds only what both houses share; `apphosting.taheri.yaml`
  and `apphosting.mina.yaml` hold everything that differs and are applied by App Hosting on top of the base
  for the backend whose environment name matches (an override can add or replace a variable, never remove one —
  so nothing goes in the base that only one house wants). Mina's file states every value its old fork had
  baked into code; leave one out and Mina wears Taheri's name.
- A `secret:` in the base must exist in **both** projects; one in a house file only in that project.
- What the variables drive (name, palette, menus, flags, expense categories, alert labels) and each ERP's icons: `docs/features/two-houses.md`.

**Shipping a change to both houses:**
```
git pull --no-rebase taheri main              # what cloud sessions shipped (see "Cloud sessions")
git push taheri main main:taheri-next         # GitHub's main + Taheri rolls out (~5 min)
git push hom main:main                        # House of Mina rolls out
```
**Push both together, always** (owner, 2026-09-26) — no waiting on Taheri's rollout before
Mina's. Keep `taheri`'s `main` level too: every cloud session starts there. `main` here is the shared working branch.

**Running a house locally:** `npm run env:taheri` or `npm run env:mina` writes `.env.<house>.local`
from the YAML files (secrets left blank to fill from Secret Manager), then `npm run dev:taheri`
(port 3000) or `npm run dev:mina` (port 3001). `.env.local` is a hand-kept Taheri file that plain `npm run dev` uses.
The generator writes every other house's variable as **empty** (Next reads `.env.local` even under `dev:mina` and fills
gaps). Re-run it after changing either YAML.

## Cloud sessions (claude.ai/code, since 2026-09-27)

The rest (the account's reach, the setup script, network) is in `docs/cloud-sessions.md`. In short:
- `scripts/cloud/session-start.sh` runs first (the SessionStart hook, single-repo sessions only; by hand in a multi-repo one): Google
  credentials from `GCP_SA_KEY_B64` (`claude-cloud@gemstrack-pos`), Node 20, `.env.taheri.local` / `.env.mina.local` with secrets filled.
  **To cut the cloud off, delete that service account's key.**
- **gcloud:** `env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud …` (the placeholder token otherwise answers UNAUTHENTICATED).
- **Going live:** push only your `claude/…` branch; **Google Cloud Build** (`scripts/cloud/deploy.sh`, since 2026-10-24: GitHub's free
  Actions minutes ran out) merges `main`, `taheri-next` and gemstrack-pos `main` into it, typechecks, tests, and pushes both houses at
  once, **with no review** (owner, 2026-09-27). Its result is the commit's `deploy (Cloud Build)` status. On a conflict, rebase on
  `origin/main` and push again.
- **Mac only:** SSH to Hostinger, Google sign-in to a local ERP (`?dev=1` works here), the Mac's memory files, GoDaddy / Hostinger tokens.

## Security: Mina's repo is public (found 2026-09-27)

gemstrack-pos is public and its `main` is this history. hom-pos's Firebase admin key (commit 3aea1ff) **must still be deleted in
IAM**; Taheri's Firestore is open until the owner publishes `firestore.rules`. Details: `docs/security.md`.

## Keeping the three apps aligned

Owner, 2026-10-24: web, Android and iPhone stay aligned at all times. The ledger is `docs/parity.md` ([Parity](docs/decisions.md#parity)).
- Every user-facing change updates its row there **in the same commit**: ✓ where built, `owed` where not (`parity.yml` warns when a push touches one or two surfaces and not the ledger).
- A session finishing a feature on one surface relays it to the other surfaces' chats; the daily parity check (scheduled per surface) works the owed rows.
- `src/lib/nav.ts` is the only menu; its export (`npm run nav:export`, read by iPhone and Android) is checked in CI and a stale one fails.

## Where the rest is written down

- taheri.shop, the Mina catalogue and the ERP (`/api/public/*`, website routes), WhatsApp via WAHA: `docs/features/site-and-erp.md` (runbook `ops/waha/README.md`).
- House of Mina's catalogue (catalogue.houseofmina.store): `docs/features/mina-catalogue.md`.
- In progress (website edits, Meta app settings, Meta's Ads connector) and open items: `docs/in-progress.md`.
- The AI copies and a proposed merge: `docs/ai-merge-proposal.md`.

## Decisions already made (don't reopen unless asked)

One line each; the text is in `docs/decisions.md` and `docs/features/`. Add a new decision there and a line here.

**Navigation and the look**
- [The map](docs/decisions.md#the-map) — the sidebar rows, the one tab row per screen, and `lib/nav.ts` as the only registry; grouped tabs: Analytics (Sales · Website · Social · Ads) and Settings in sections
- [Parity](docs/decisions.md#parity) — `docs/parity.md` is the ledger of what web, iPhone and Android each have; ✓ / owed in the same commit; CI checks the exported nav
- [Web matches the app](docs/decisions.md#web-matches-the-app) — the app's palette, flat 22px cards, capsules, tones in `lib/tones.ts`; spec `docs/features/web-matches-app.md`
- [The name ERP](docs/decisions.md#the-name-erp) — ERP in every word people read; Shopify codes and code names stay POS
- [Number fields](docs/decisions.md#number-fields) — and sale-flow fields show 0 as blank
- [Hooks](docs/decisions.md#hooks) — the `/orders/add` crash of 2026-09-22
- [Fonts](docs/decisions.md#fonts) — every face in `src/fonts/`, `next/font/local`
- [Light and dark](docs/decisions.md#light-and-dark) — the device's choice wins; `theme-default` set outside React
- [Motion](docs/decisions.md#motion) — three curves; dialogs linger; Reduce Motion
- [Recent picks](docs/decisions.md#recent-picks) — last five per device

**Home and the day**
- [Dashboard](docs/decisions.md#dashboard) — four figures, Needs you, Due to customers, Recent sales; no buttons; revenue is the jewellery side (gold coins noted beside it, as Analytics splits them)
- [Rate chip](docs/decisions.md#rate-chip) — the cart writes back only a new invoice's typed rates
- [Team note](docs/decisions.md#team-note) — `settings.teamNote`, ≤ 600 characters; owners write via `/api/app/write`, staff read
- [One screen per question](docs/decisions.md#one-screen-per-question) — `lib/owed.ts`, Today's cash, the karigar's Now

**Selling: invoices, orders, repairs**
- [Drafts](docs/decisions.md#drafts) — only a new order or sale is drafted, in Firestore `drafts`; `finish()` on save; saved at every keystroke (within 300 ms, one write at a time), never auto-opened: a New sale/order is blank, the unfinished one waits in Drafts under its own id (Scan/Stock continue the sale with `?continue=1` / `?resume=1`)
- [Order actions gate](docs/decisions.md#order-actions-gate) — it moves money
- [Wastage in grams](docs/decisions.md#wastage-in-grams) — the bill and the workshop slip both (slip since 2026-10-28)
- [Repairs](docs/decisions.md#repairs) — a ticket of many pieces; In the shop → Ready → Collected; money to Extra revenue
- [Invoice pages](docs/decisions.md#invoice-pages) — the viewer never touches the cart; `/cart` redirects; `/view-invoice/<id>` is the customer's
- [Invoice PDF](docs/decisions.md#invoice-pdf) — `saveInvoicePdf`, per-piece; Taheri: "Invoice - <customer>", PDF on WhatsApp
- [Exchange rows](docs/decisions.md#exchange-rows) — `exchanges`, with the old totals kept
- [Order to invoice](docs/decisions.md#order-to-invoice) — advances as payments, exchange, discount, notes; wastage/making
- [Orders hub](docs/decisions.md#orders-hub) — by stage, a next step per card; pieces set status
- [Online orders](docs/decisions.md#online-orders) — a person confirms; no sale until the transfer
- [Shopify notices](docs/decisions.md#shopify-notices) — read back; kept current, never rewritten
- [Order WhatsApp](docs/decisions.md#order-whatsapp) — Mina's web orders messaged from its line: COD 1/2 → Confirm tag, bank → IBAN + screenshot, paid → thanks
- [Name a sale](docs/decisions.md#name-a-sale) — on the invoice
- [Advance method](docs/decisions.md#advance-method) — `.nullish()`, `onInvalid` toasts
- [Exchange line](docs/decisions.md#exchange-line) — what + amount
- [Sizes to the profile](docs/decisions.md#sizes-to-the-profile) — order sizes, offered once
- [Walk-ins](docs/decisions.md#walk-ins) — `lib/walk-in.ts`; one walk-in row everywhere
- [Saves are one trip](docs/decisions.md#saves-are-one-trip) — one commit per save; photos in `order_photos`; several reference photos per piece (`extraPhotos`, one doc each, the first stays in the old field), opened full screen

**Money and analytics**
- [Whole rupees](docs/decisions.md#whole-rupees) — no decimals; each line rounded, `lib/money-round.ts`; under 1 rupee is settled
- [Round-off](docs/decisions.md#round-off) — up to 3 round-down chips by the discount; "Settle" a remainder under 5,000 as discount
- [Lac and crore](docs/decisions.md#lac-and-crore) — `lib/money.ts`
- [Invoice credit](docs/decisions.md#invoice-credit) — overpaid is a named customer's credit, on their hisaab; the owner gives it back with "Give back" (`payBackCredit`, not a refund)
- [Margin](docs/decisions.md#margin) — typed 24k less 6 ratti, else 10%; never the customer's
- [Net profit](docs/decisions.md#net-profit) — estimated profit less expenses, never revenue less expenses; margin = net ÷ revenue
- [Exchange as cash](docs/decisions.md#exchange-as-cash) — in Cash In and in revenue (`invoiceSaleValue`)
- [Analytics default: this month](docs/decisions.md#analytics-default-this-month) — the 1st to today, not a rolling 30 days; Home's ledger too

**People and sign-in**
- [Add photos sign-in](docs/decisions.md#add-photos-sign-in) — superseded 2026-09-30: every house signs in
- [Taheri sign-in](docs/decisions.md#taheri-sign-in) — `NEXT_PUBLIC_STORE_OWNER_EMAILS`; locked rules for the owner to publish; share keys
- [Signed-in defaults](docs/decisions.md#signed-in-defaults) — `NEXT_PUBLIC_STORE_PEOPLE`; Taken by, Workshop; Orders/Invoices: all, yours lit
- [Karigar sign-in](docs/decisions.md#karigar-sign-in) — in-app browsers; `[sign-in]` in the log
- [Marketing role](docs/decisions.md#marketing-role) — `NEXT_PUBLIC_STORE_MARKETING_EMAILS`; Marketing group only, via the server; audiences owners'
- [Not your own action](docs/decisions.md#not-your-own-action) — an event push skips every phone of the person who caused it; reports, reminders and the test still reach them
- [Delete code](docs/decisions.md#delete-code) — every delete asks; the server checks it

**The website and copy**
- [Customer copy](docs/decisions.md#customer-copy) — never "Najmi Market" or "Saddar"; the hours
- [Weight preview](docs/decisions.md#weight-preview) — the overlay tool's Futura geometry
- [Shop outage](docs/decisions.md#shop-outage) — the hosted.app address still works
- [Community twin](docs/decisions.md#community-twin) — sends to "Taheri Collections" groups also reach their namesakes in "- II"; `/links` shows the community
- [Piece interest](docs/decisions.md#piece-interest) — both sites count opens, time looked, saves and WhatsApp enquiries per piece; Website → Interest ranks them
- [Website analytics](docs/decisions.md#website-analytics) — Analytics › Website (Visitors, Live) is each site's Shopify-style report (sources, places, devices, funnel to WhatsApp, pages, searches, 404s) and Live; day counters, no person or address kept

**Liquid Glass** (`docs/features/liquid-glass.md`)
- [Liquid Glass](docs/features/liquid-glass.md#liquid-glass) — Settings → Appearance; Apple HIG glass on the control layer only (`ui-glass`)

**AI: the key and the scanners** (`docs/features/ai.md`)
- [Vertex AI key](docs/features/ai.md#vertex-ai-key) — `vertex-ai-key` in gemstrack-pos Secret Manager, read at run time; tiny per-minute quota
- [Scanners](docs/features/ai.md#scanners) — wastage in grams, weight before stones, the bill's rate and discount; never 3.8-flash
- [Voice](docs/features/ai.md#voice) — live words; every part editable; anything, several steps
- [Voice, Siri-grade](docs/decisions.md#voice-siri-grade) — iPhone/Mac: warm at launch, on-device words, end of speech by itself, keeps listening for changes and "yes"; Siri / Action button / Control Center open it listening

**Design** (`docs/features/design.md`) — replaced Post a piece and the Ads Studio tab (2026-10-12)
- [Design](docs/decisions.md#design) — Posts › Design: one editor, one Publish sheet, one shelf; Ads → Plan; old URLs redirect, every `/api` route kept
- [Subject-aware stories](docs/decisions.md#design) — text kept off the piece (`lib/social/subject.ts`, the shared engine)

**Post a piece's engine** (`docs/features/post-a-piece.md`; the screen is Design)
- [Drafts](docs/features/post-a-piece.md#post-a-piece-drafts) — on this device (IndexedDB), photos included; resumes
- [Post a piece](docs/features/post-a-piece.md#post-a-piece) — story, square, caption → site, WhatsApp, Instagram; [Paint](docs/features/post-a-piece.md#paint)
- [Checks](docs/features/post-a-piece.md#checks) — each dependency tested live, with its fix
- [Story editor](docs/features/post-a-piece.md#story-editor), [Square only](docs/features/post-a-piece.md#square-only), [Designer](docs/features/post-a-piece.md#designer) — the layer document and its editors
- [Story and post](docs/features/post-a-piece.md#story-and-post), [Website photos](docs/features/post-a-piece.md#website-photos)
- [Queue and Mina](docs/features/post-a-piece.md#queue-and-mina) — per-destination ticks, the queue and its tick, Mina's community; several photos, one caption (WhatsApp in a row, Instagram carousel of 10)
- [Maisons](docs/features/post-a-piece.md#maisons) — house + official name; never priced by the gram
- [Retouch](docs/features/post-a-piece.md#retouch) — Magnific (GPT Image) + Precision, then the same-piece check

**AI keys** (`docs/features/ai-keys.md`)
- [AI keys](docs/decisions.md#ai-keys) — Settings → Connect an AI: scoped, hashed, revocable keys; MCP + REST + OpenAPI from one registry; an AI's posts wait for the owner's OK

**WhatsApp reports and the monthly PDF** (`docs/features/notifications.md`)
- [WhatsApp reports](docs/features/notifications.md#whatsapp-reports) — `app_settings/global` by name; daily; [PDFs only](docs/features/notifications.md#pdfs-only)
- [Monthly PDF](docs/features/notifications.md#monthly-pdf) — Analytics' rules; Analytics → Monthly PDF, and the 1st by WhatsApp

**Posts** (`docs/features/from-the-website.md`)
- [Hub](docs/features/from-the-website.md#posts-hub) — `/posts`: Today, queue, site pieces in batches
- [Stories](docs/decisions.md#story-drafts) — Posts › Stories: a story a day from the site's pieces, 2160 × 3840, weight in gold; to Instagram and the WhatsApp community; order in `lib/social/story-drafts.ts`, drawn by `week-story.ts`, only posted/skipped stored
- [From the website](docs/features/from-the-website.md#from-the-website), [its story](docs/features/from-the-website.md#site-story) — the card; moved to Design

**Investments by Taheri** (`docs/features/investments.md`)
- [Investments](docs/features/investments.md#investments) — the routine files it; the page and the schedule send it

**Edit a piece** (`docs/features/edit-a-piece.md`)
- [Edit a piece](docs/features/edit-a-piece.md#edit-a-piece) — edit any site piece from its original; the sites keep the change

**The link page** (`docs/features/links-page.md`)
- [Link page](docs/features/links-page.md#link-page) — `/links`, server-rendered, Just in, share previews

**Ads** (`docs/features/ads.md`)
- [Ads](docs/features/ads.md#ads) — Meta ad account per house; Overview, Campaigns, Plan, New ad, Setup

**Label LIVE** (`docs/features/label-live.md`)
- [Label LIVE](docs/features/label-live.md#label-live) — tags print by `labellive://` link; set up on Settings → Labels; variables paired to fields

**Insights** (`docs/features/insights.md`)
- [Insights](docs/features/insights.md#insights) — Instagram + Facebook, organic beside paid, via the Ads login; an hourly snapshot

**Ad studio** (`docs/features/ad-studio.md`) — its Plan is Ads → Plan, the rest are Design sections
- [Ad studio](docs/features/ad-studio.md#ad-studio) — both houses; [any shape](docs/features/ad-studio.md#any-shape)
- [Board](docs/features/ad-studio.md#board) — endless canvas, Let it cook, MCP agent (`/api/studio/mcp`), Use it; a weekly board Mondays 9:00
- [Editing on the board](docs/features/ad-studio.md#board-designer-flow) — saved as you go; ‹ › and the strip move between designs; Tidy keeps sizes together; a pinch never zooms the page (`useNoPageZoom`)
- [Server draws the board](docs/features/ad-studio.md#server-draw) — `server-draw.ts` on @napi-rs/canvas: agents and the weekly board lay out and draw without the page; `/draw` settles a board
- [The background, by hand](docs/features/ad-studio.md#free-background) — drag/scroll/pinch/double-click the photo; a new picture starts centred; one shade with on-page dots
- [Sizes, linked](docs/features/ad-studio.md#sizes) — `group` per ad; linked texts carry a change to every size; unlink keeps the key
- [Buttons](docs/features/ad-studio.md#buttons) — one text with a sized background (`box.w/h`); Words in it on a rectangle; Add → Button
- [Mina's ad style](docs/features/ad-studio.md#house-of-mina-ad-style) — named designs: italic name + pink caps; benefit ads: red SHOP NOW pill + wordmark; a deep shade; in `brand.ts`

**iPhone app** (`docs/features/iphone-app.md`)
- [iPhone app](docs/features/iphone-app.md#iphone-app) — `apps/ios`, Capacitor over the live ERP; TestFlight by `ios.yml`
- [One app, many businesses](docs/features/iphone-app.md#one-app-many-businesses-2026-10-16) — `shop.taheri.erp` "ERP": Taheri, Mina and any business by its address (`/api/app/business`), each its own sign-in, data, push, widget; Mina's own app retired 2026-10-20; Mina needs `shop.taheri.erp` in its Firebase

**Mac app** (`docs/features/mac-app.md`)
- [Mac app](docs/features/mac-app.md#mac-app) — the `ERPMac` target in `apps/iphone/project.yml`, native SwiftUI, the iPhone's screens through `App/Platform/MacPlatform.swift`; same bundle `shop.taheri.erp`; Label LIVE native (localhost API, else the link; iPhone via MQTT); Xcode Cloud "Mac release" by `apps/iphone/MAC-RELEASES.md`, its errors in the "Mac build" workflow's log

**Android app** (`docs/features/android-app.md`)
- [Android app](docs/features/android-app.md#android-app) — `apps/android`, Kotlin/Compose port of `apps/iphone`, two flavors; money in `core` to the iPhone's contract; Play internal testing
- [One app, many businesses (Android)](docs/features/android-app.md#one-app-many-businesses-2026-10-24) — the taheri flavor (`shop.taheri.erp`, "ERP") holds Taheri, Mina and added businesses; `/api/app/business` carries an `android` block (`storeAppAndroid`; `none` = not registered, Mina's until the owner registers the app)
- [Material You (Android)](docs/decisions.md#material-you) — Android wears Material 3 Expressive, not the iPhone's look; the seed is the business's colour (gold / pink), tonal surfaces, segmented groups, large collapsing bars; "Wallpaper colours" in This phone is optional and off

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — they walk the graph's edges
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` via pipx (`pipx install graphifyy`); `graphify-out/cache/` and dated backups are gitignored.
