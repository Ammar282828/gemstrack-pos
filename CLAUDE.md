# taheri-shop — the ERP for both houses

Next.js **ERP** (it started as a point-of-sale; renamed 2026-09-27) serving **two shops from one codebase**:

| House | Live at | Firebase project | Backend / environment | Deploys from |
|---|---|---|---|---|
| Taheri (gold and diamond) | erp.taheri.shop (and pos.taheri.shop) | `gemstrack-pos` | `studio` / `taheri` | branch **`taheri-next`** of this repo |
| House of Mina (silver) | erp.houseofmina.store (and pos.houseofmina.store) | `hom-pos-52710474-ceeea` | `studio` / `mina` | branch **`main`** of repo **gemstrack-pos** (remote `hom`) |

The two were forks that drifted; they were reconverged on 2026-09-22 and this history is now
the one both deploy from. `.firebaserc` names hom-pos and is only for the Firebase CLI, which is not used.

The public website is a separate repo: **taheri-site** (github.com/Ammar282828/taheri-site,
`~/Projects/taheri-site`), a Vite app on Hostinger. Read its CLAUDE.md for the site.
Brand facts (name, hours, claims, links, voice) live in `taheri-site/docs/taheri-knowledge.md`.

## Branches and deploys

- Remotes: **`taheri`** (this repo, github.com/Ammar282828/taheri-pos) and **`hom`** (github.com/Ammar282828/gemstrack-pos).
  Neither is called origin.
- **`main` is the working branch.** Taheri deploys from `taheri-next`, Mina from `hom`'s `main`; both are
  pushed *from* `main` (see below). Every push to a deploy branch rolls out automatically
  (~5 min; `gcloud builds list --region us-central1 --project <project>` shows it).
- Never trigger builds by hand (REST/console); they jam the queue and a stale site looks like a code bug.

## Running locally

- **Node 20**, not the Mac's default: launch config "POS (node 20)" (`PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev`, port 3000), or per house
  "Taheri (node 20)" (port 3000) / "Mina (node 20)" (port 3001). On Node 26 the Google auth library fails ("Premature close"). The per-house
  configs drop a `GOOGLE_APPLICATION_CREDENTIALS` that points at a missing file (the second laptop's `~/.zshrc` does), which otherwise breaks every Google call.
- The app is behind Google sign-in locally; production runs `NEXT_PUBLIC_OPEN_ACCESS=1` (the owner's
  choice since 2026-09-07, paired with open `firestore.rules`; `firestore.rules.locked` holds the real rules).
  Don't reintroduce the open-access flag for local checks — ask the user to sign in on the preview.
- Typecheck: `npx tsc --noEmit -p .`. ESLint's config is broken (v9); the build is the lint gate.

## Configuration and access

- `apphosting.yaml` holds every env var. A `secret:` it declares **must exist in Secret Manager and
  be readable by the three App Hosting service accounts** (mirror `CRON_SECRET`'s IAM) *before* it is
  declared, or the rollout fails. Names are case-sensitive: the upload secret is `website-upload-secret`.
  A variable with `value: ""` also fails the rollout ("either 'value' or 'secret' field is required") — write
  a word the code reads as off (`"none"`, `"0"`) instead.
- **Taheri's backend also has console `overrideEnv`** (19 variables — Firebase config, `NEXT_PUBLIC_STORE_NAME` "Taheri",
  contacts, bank line, Instagram) and **they beat the YAML**. Read them with the App Hosting REST API
  (`GET …/projects/gemstrack-pos/locations/us-central1/backends/studio`, field `overrideEnv`); what a build actually used
  is `builds/<id>` → `config.env`. On 2026-09-26 its `NEXT_PUBLIC_STORE_WHATSAPP_URL` (the Collections community invite)
  was removed so the YAML's `wa.me` chat applies. Mina's backend has none.
- Firebase CLI login is broken on the owner's Mac. Use **`gcloud`** (authenticated as the owner):
  `gcloud secrets …`, `gcloud builds list`, `gcloud run revisions list` — all `--project gemstrack-pos --region us-central1`.
  Never print a secret value; compare `sha256` of trimmed values instead.
- Hostinger (the site's server) is reachable over SSH with the deploy key `~/.ssh/taheri_deploy`
  (port 65002, user in `taheri-site/.github/workflows/deploy.yml`). **The key exists only on the owner's Mac** —
  on another device use hPanel or copy the key deliberately.
- The owner is a Firebase/GCP Owner but lacks `iam.serviceAccounts.signBlob`, so `createCustomToken` fails from a laptop;
  test storage layers directly (`npx tsx`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=gemstrack-pos`).

## Cloud sessions (claude.ai/code, since 2026-09-27)

Claude Code runs these repos in the cloud too, with no Mac (owner, 2026-09-27: "i want to run this on the cloud").
- **One Google credential:** the service account `claude-cloud@gemstrack-pos`. Its JSON key, base64, is the environment
  variable `GCP_SA_KEY_B64` of the claude.ai/code environment (the Mac keeps it in `~/.config/claude-cloud/`, owner-only;
  `environment.env` there is the line to paste). It may read exactly the secrets the backends use (Taheri 13, Mina 14 —
  never `apphosting-github-conn-*`, `waha-dashboard-password`, `DASHBOARD_SECRET`), read/write Firestore in both projects
  (`datastore.user`), call Vertex in gemstrack-pos and Murtaza's `jewelgen-mm-e3d43ecb`, and view App Hosting, Cloud Build,
  Cloud Run, logs and Scheduler in both. **To cut the cloud off, delete its key**
  (`gcloud iam service-accounts keys list --iam-account claude-cloud@gemstrack-pos.iam.gserviceaccount.com`, then `… keys delete`).
  A secret added later needs `roles/secretmanager.secretAccessor` for it on that secret too. It cannot create or list secrets.
  **gcloud in a cloud session:** the environment sets `CLOUDSDK_AUTH_ACCESS_TOKEN` to a placeholder ("proxy-injected") that
  beats the activated account, so every call answers UNAUTHENTICATED — run gcloud as `env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud …`
  (2026-09-29). Node's Google libraries read the ADC file and are unaffected.
- **Every session starts** with `scripts/cloud/session-start.sh` (the SessionStart hook in `.claude/settings.json`, only when
  `CLAUDE_CODE_REMOTE=true`; hooks run in single-repo sessions only, so run it by hand in a multi-repo one): the key becomes the
  machine's default Google credentials (and gcloud's), Node 20 goes first on PATH, and `.env.taheri.local` / `.env.mina.local`
  are written from the YAML with every secret filled (`scripts/cloud/fill-secrets.mjs`; prints counts, never values). The
  environment's setup script is `scripts/cloud/environment-setup.sh` (gcloud CLI), pasted into the environment. Network: Full —
  Meta, WAHA, Green API, Shopify, Magnific and both sites are not on the Trusted list.
- **Going live:** a cloud session can push only its own `claude/…` branch. `.github/workflows/cloud-deploy.yml` takes any push to
  `claude/**`, merges `main`, `taheri-next` and gemstrack-pos `main` into it, runs the typecheck and tests, and pushes the result
  to `main` + `taheri-next` here and to gemstrack-pos `main` (a write deploy key there; its private half is this repo's Actions
  secret `HOM_DEPLOY_KEY`): both houses at once, **with no review** (owner's choice, 2026-09-27). A conflict or a failed check stops
  it before any push, and nothing is ever force-pushed. taheri-site and mina-catalogue do the same with their own `cloud-deploy.yml`
  (branch → main → their deploy). In a cloud session: commit, push the branch, watch `gh run list`; on a conflict, rebase on
  `origin/main` and push again. "Run workflow" on cloud-deploy.yml defaults to a dry run (checks, no pushes).
- **Mac only:** SSH to Hostinger (port 65002; the sites deploy through Actions anyway), Google sign-in to a local ERP (no browser —
  typecheck, tests and the gate's `?dev=1` still work), the Mac's memory files (this file is the handoff), GoDaddy / Hostinger API
  tokens (not in Secret Manager).

## How the site and the POS talk

| Route | Who calls it | What it does |
|---|---|---|
| `/api/public/quote`, `checkout`, `order/:id` | taheri.shop | prices at today's rate; bank-transfer checkout; the customer's order page (token link) |
| `/api/public/featured` | taheri.shop | the set of the day (`app_settings/website_featured`), cached 60 s |
| `/api/public/me` | taheri.shop and (on Mina's POS) catalogue.houseofmina.store, Bearer Firebase ID token of that house's project | the customer's record: profile, favourites, orders (`website_customers/{uid}`). Favourites must be three-part keys (`isPieceKey`): taheri.shop's `Category/Collection/file`, the catalogue's `mina/piece/<handle>` |
| `/api/website/photos` | POS page Add Photos | relays a photo to `taheri.shop/api/upload.php` with `WEBSITE_UPLOAD_SECRET`; HEIC → JPEG on the way |
| `/api/website/pieces` | POS page Photo Weights | counter-entered weights (`website_pieces`) for photos with no burned-in label |
| `/api/website/featured` | Photo Weights / Add Photos | set or clear the set of the day |
| `/api/website/post` | POS page Post a Piece | GET the community's name/size; POST one image + caption to `WHATSAPP_COMMUNITY_CHAT_ID` and then the channel `WHATSAPP_CHANNEL_ID`, via WAHA, logged in `social_posts`. `/convert` turns HEIC into JPEG for the canvas |
| `/api/website/post/ai` | Post a Piece | Gemini on Vertex (`IMAGE_AI_PROJECT`): `enhance`, `reframe`, `restage`, `letter`, `caption`, `check`. Every image edit is compared with its source ("same piece?"); capped 300 calls/day shop-wide, 60/h per IP |
| `/api/instagram/status`, `connect`, `callback`, `story` | Post a Piece | Instagram Login OAuth → 60-day token in **Secret Manager** (`instagram-token`, renewed on use), locked to `INSTAGRAM_USERNAME`; `story` publishes a 9:16 JPEG |
| `/api/website/post/queue`, `queue/[id]`, `[id]/send`, `queue/tick` | Post a Piece (queue); Cloud Scheduler `social-queue-tick` | several finished pieces kept in `social_queue` (+ images in `social_queue_media`), sent now or at their times — see "Post a Piece queue" below |
| `/api/website/post/health` | Post a Piece | GET: every check + last day's `social_errors` + diagnosis context; POST: the page records a failure |
| `/api/investments` (+ `/[id]/publish`, `/[id]/plan`, `/schedule`, `/api/public/investments/[id]/[kind]`) | the Cowork routine; POS page Investments | file a day's gold post (Bearer ingest token or the POS); send each part; hold/approve a day; the owner's schedule; serve the cards |
| `/api/investments/tick` | Cloud Scheduler `investments-tick` (every 5 min, Bearer `CRON_SECRET`) | send whatever part of today's post the schedule says is due; `?dry=1` sends nothing |
| `/api/website/site-pieces` (+ `/image?id=`) | POS page Posts → From the website | the house website's pieces (taheri.shop: `catalog-attributes.json`, which carries each photo's page `path`; the Mina catalogue: `catalog-pieces.json`) and when each last went out; a piece's photo as a JPEG from this server (only listed pieces) |
| `/api/website/edits` | POS page Edit a piece | GET: every site piece with the counter's changes (hidden ones too) + recent changes; `?id=` one piece, its last design, its original photo's address. POST: a piece's words / re-made photo / put back → the site's `api/override.php` — see "Edit a piece" below |
| `/api/public/social/[id]` | Instagram's fetcher | serves a story image for the minutes a post takes (Firestore `social_media`, deleted after) — there is no public bucket |
| `/api/website/orders/[id]` | POS order page | mark paid / shipped — **always verifies a token, even under open access** |
| `/api/ads/*` (`status`, `connect`, `callback`, `setup`, `overview`, `campaigns`, `object/[id]`, `create`, `images`, `library`, `media`, `preview`, `estimate`, `search`, `audiences`, `rules`, `assistant`, `template`) | POS pages under **Ads** | this house's Meta ad account through the Marketing API (Graph v26.0) — see "Ads" below |

CORS for `/api/public/*` is in `src/lib/website/cors.ts` (taheri.shop, www, and localhost:5180 in dev).
Design and go-live checklist: `docs/website-checkout.md`. Go-live of online selling is still blocked by empty
bank env vars and the open Firestore rules.

## WhatsApp: WAHA (since 2026-09-25)

Both POS send WhatsApp — alerts, customer messages, Post a Piece, Investments — through **WAHA**, the shop's own
gateway on the `waha` VM in gemstrack-pos (https://35-184-20-165.sslip.io), with +92 326 2275554 linked to it.
`src/lib/whatsapp.ts` uses it when `WAHA_URL` + `WAHA_API_KEY` (secret `waha-api-key`, in both projects) are set and falls
back to Green API otherwise; Green API stays configured until the owner cancels it. WAHA also posts to the WhatsApp
**channel** (`WHATSAPP_CHANNEL_ID`, Taheri's), which Green API never could. Runbook — relinking, resets, updates:
**`ops/waha/README.md`**.

## Two houses, one codebase — the rules

- **Every difference between the shops is a variable, never a fork of the code.** The code's
  defaults are Taheri's. `apphosting.yaml` holds only what both houses share; `apphosting.taheri.yaml`
  and `apphosting.mina.yaml` hold everything that differs and are applied by App Hosting on top of the base
  for the backend whose environment name matches (an override can add or replace a variable, never remove one —
  so nothing goes in the base that only one house wants). Mina's file states every value its old fork had
  baked into code; leave one out and Mina comes up wearing Taheri's name.
- What the variables drive: `src/lib/store-config.ts` (name, contacts, bank, links, allowed emails,
  default metal, margin, **brand**, logo, its aspect and its height in the sidebar (`NEXT_PUBLIC_STORE_LOGO_SIDEBAR_HEIGHT`, Mina 18 — its
  spaced capitals fill their file, so Taheri's 26 px was a banner; 2026-09-28), **counter staff** for "Taken by"); `globals.css`
  (`.dark .brand-mina:not(.theme-default)` is Mina's dark palette — muted burgundy with the catalogue's dusty rose
  #E8A5AE as the accent, 2026-09-25 — and `.brand-mina.theme-default` gives its light theme Mina's maroon #380000; Taheri's
  dark is the plain `.dark`. A palette block on <body> must re-declare the `--sidebar-*` vars, which otherwise resolve on
  <html> to Taheri's colours. Each house's logo has a white cut for dark grounds, `NEXT_PUBLIC_STORE_LOGO_LIGHT_URL`:
  `taheri-logo-light.png` by default, Mina's `house-of-mina-logo-light.png`); `layout.tsx`
  (brand class, theme-colour, links host); `app-layout.tsx` (the Website menu exists only when
  `NEXT_PUBLIC_STORE_WEBSITE_URL` is set; **Shareholder Finances** and "paid by Mina/Ammar" on an expense only when
  `NEXT_PUBLIC_STORE_PARTNERSHIP=1` — Mina's partnership book, whose ledgers live in Mina's Firestore);
  `voice/gemini.ts` (`VERTEX_PROJECT` bills Mina's voice to Taheri's project); the Website menu's **Photo Weights**
  and Add Photos' **Feature today** follow `NEXT_PUBLIC_STORE_WEBSITE_WEIGHTS` / `_FEATURED` (default on; Mina's
  catalogue has neither, so its file sets both to "0" at go-live); **Post a Piece** and **Investments** follow
  `NEXT_PUBLIC_STORE_POST_PIECE` / `_INVESTMENTS` (Taheri's accounts and series; Mina sets both "0", which hides the menu
  entries and pages and makes their routes answer 404 — owner, 2026-09-25: "why are taheri features in mina pos").
  **Expense categories** are `NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES` (`lib/expense-categories.ts`; Taheri's list by default,
  Mina's own 15 since 2026-09-25, worked out from all its expenses); Partner Drawings, Partner Salary and Other are always
  added — `lib/partnership.ts` reads the first two by name. The expenses filter also offers any other name an expense carries.
  **WhatsApp alerts name their POS** (`lib/notify-label.ts`, owner 2026-09-26: "I get both"): every alert to the owner —
  live ones through `/api/notifications/send`, the scheduled reports, a website order to the shop — starts `*Taheri POS* · …`,
  or Mina's `NEXT_PUBLIC_STORE_NOTIFY_LABEL` ("House of Mina POS"). Messages to customers and the gold updates are not labelled.
- A `secret:` in the base must exist in **both** projects; one in a house file only in that project.

**Shipping a change to both houses:**
```
git pull --no-rebase taheri main              # what cloud sessions shipped (see "Cloud sessions")
git push taheri main main:taheri-next         # GitHub's main + Taheri rolls out (~5 min)
git push hom main:main                        # House of Mina rolls out
```
**Push both together, always** (owner, 2026-09-26: "push both together always") — no waiting on Taheri's rollout before
Mina's. Keep `taheri`'s `main` level too: it is where every cloud session starts (it was 7 commits behind on 2026-09-27). `main` here is the shared working branch (the old dead
`main` is kept as tag `old-main-2026-06`). `website-checkout` is retired.

**Running a house locally:** `npm run env:taheri` or `npm run env:mina` writes `.env.<house>.local`
from the YAML files (secrets left blank to fill from Secret Manager), then `npm run dev:taheri`
(port 3000) or `npm run dev:mina` (port 3001). `.env.local` is a hand-kept Taheri file that plain `npm run dev` uses.
Next reads `.env.local` / `.env.development.local` even under `dev:mina` and fills any variable the process lacks, so the
generator writes every variable that isn't the house's as **empty** (Next then leaves it alone). Re-run `npm run env:mina`
after changing either YAML — a stale `.env.mina.local` is how a local Mina showed Taheri's Post a Piece, Investments and
Photo Weights on 2026-09-25. `.env.local` is not Taheri's on every machine (on the second laptop it is Mina's, with Mina's
service-account key): when it names another Firebase project, `env:taheri` blanks its variables too, so a local Taheri never
signs in to Mina's project (2026-09-26).

## House of Mina's catalogue (catalogue.houseofmina.store)

A separate site in its own repo, **mina-catalogue** (`~/Projects/mina-catalogue`, github.com/Ammar282828/mina-catalogue,
private) — built 2026-09-23; read its CLAUDE.md. It publishes `catalog-tree.json`, and `/api/website/photos` reads a
site's own tree before anything else (taheri.shop publishes none, so Taheri's picker is unchanged).
**Live on the server since 2026-09-23** (Hostinger website created through the Hostinger API on the Business plan,
order 1008754559, beside taheri.shop; first deploy shipped 2,319 files). Mina's `apphosting.mina.yaml` carries the
website variables and `WEBSITE_UPLOAD_SECRET` (hom-pos Secret Manager, same value as
`~/domains/catalogue.houseofmina.store/.website-upload-secret`; sha256 prefix `c6701cb1`). DNS was added through the
GoDaddy API (`A catalogue → 145.79.26.82`; houseofmina.store's DNS stays at GoDaddy) and Hostinger issued the
certificate itself; the site is **live over HTTPS** and Mina's Add Photos reads its categories from it — since
2026-09-23 five, one level, like taheri.shop's (Rings & Bands, Wristwear, Chains & Pendants, Sets, Earrings), each
offered as one folder `Category/Category`, plus a **Men's** section with four sub-folders (`Men's/Men's Rings`,
`Men's/Natural Ruby Rings`, `Men's/Men's Chains`, `Men's/Men's Bracelets & Cuffs`)), and since 2026-09-24 **Wristwear** with three
(`Wristwear/Bangle & Ring Sets`, `Wristwear/Bangles & Cuffs`, `Wristwear/Bracelets`; an old `Wristwear/Wristwear` drop is
sorted by its file name). Add Photos names and links to **this house's** website
(`NEXT_PUBLIC_STORE_WEBSITE_URL`; a site tree's `path` when it gives one), never a hardcoded taheri.shop.
`KNOWN_TREE` in the photos route is taheri.shop's folder list and is only ever offered for that origin.
Since 2026-09-25 the catalogue has **customer accounts** like taheri.shop's (Google sign-in on hom-pos's own Firebase
project; `catalogue.houseofmina.store` added to its authorised domains), talking to Mina's POS `/api/public/me` — no POS
change was needed (Mina's `WEBSITE_ORIGIN` already allows the catalogue; see the table above for the key shape).

## In progress

- **Editing existing website pieces from the POS** (owner, 2026-09-26: "fix/crop/add logo weight overlay to existing,
  change desc etc in taheri.shop or catalogue.houseofmina.store"). Mapped across the POS, taheri-site and mina-catalogue,
  designed, **not built**, four questions open for the owner: **`docs/edit-website-pieces.md`**.
- **Meta app settings for Ads** (2026-09-26): Connect stopped at Facebook's "Can't load URL — the domain of this URL isn't
  included in the app's domains". Fix is in the Meta app (1075984878628188), not the POS: App domains `taheri.shop` +
  `houseofmina.store`, Client and Web OAuth login on, both `https://pos.<house>/api/ads/callback` as redirect URIs.
  Ads → Setup step 1 now lists exactly these with copy buttons. Connecting works now (both houses have an ad account and Page).
  **Next: the app must go Live** (2026-09-28): the first new ad came back "Ads creative post was created by an app that is in
  development mode. It must be in public to create this ad." Read off the app that day: no privacy policy, no category,
  Meta's stock icon, terms pointing at facebook.com. taheri.shop now has `/privacy` and `/data-deletion` (taheri-site), the icon
  is `public/brand/meta-app-icon-1024.png`; the owner fills those in App settings → Basic and flips App Mode → Live.
  **And the login configuration lacks two permissions** (2026-09-29, New ad → A post answered "(#10) Application does not
  have permission for this action"): both houses' tokens hold ads_management, ads_read, business_management, pages_show_list,
  pages_read_engagement, instagram_manage_comments — **no instagram_basic, no pages_manage_ads**. Facebook grants only what the
  configuration names, so reconnecting alone changes nothing: add both to the configuration (FLfB → Configurations →
  Permissions; instagram_basic appears once the Instagram use case with Facebook Login is added), then Connect again in each
  ERP. Until then Taheri lists its posts through the story login (no boost answer), Mina can't list them, and the Studio's
  competitor look-ups fail. Setup now counts instagram_basic as required and says to edit the configuration.
  Reconnected 20:52 with both: posts now list through Meta with their boost answer. **The Studio's competitor look-ups
  (Business Discovery) also need `instagram_manage_insights`** (Meta's reference: instagram_basic + instagram_manage_insights
  + pages_read_engagement) — #10 even for @instagram without it; now in SCOPES and Setup's list.
- **Meta's own Ads connector in Claude** (2026-09-30, owner added it at claude.ai/customize/connectors: `https://mcp.facebook.com/ads`,
  Meta's first-party Ads MCP): a chat session sees every ad account the owner's Facebook login holds (Taheri Main 28476788078639222,
  House of Mina 2078697546326565, plus two personal ones) and can read, pause, edit and create ads — through Meta's app, so it is not
  held back by our app's Development mode. Its **Ad Library search covers Pakistan's commercial ads** (our Graph API route doesn't): the
  Studio's rivals now carry `adPageId`/`adPageName` found that way (10 of 14; Chhotanis, Kiran and Sherezad have run no Meta ads), and
  "Their live ads" opens the Page's ads (`adLibraryUrl(name, pageId)`) instead of a word search that matched a magazine and a salon for
  "Al Syed". The ERP itself cannot call the connector; it is the chat's. Its token also asks for `ads_mcp_management`, which is why that
  permission showed on the ERP's login configuration — the ERP doesn't need it.

## Security: Mina's repo is public (found 2026-09-27)

- **gemstrack-pos is a public repository** and its `main` is this exact history, so everything here (code, this file,
  every script ever committed) is public; taheri-pos being private protects nothing. Making gemstrack-pos private breaks
  nothing we use: cloud-deploy reaches it over SSH with `HOM_DEPLOY_KEY`, App Hosting through its GitHub app.
- **hom-pos's Firebase admin key was committed** in `scripts/cleanup-shopify-customers.mjs`, `migrate-silver-hisaab.mjs`
  and `pitr-restore-invoices.mjs` (commit 3aea1ff, 2026-09-25) and so published. Those scripts now use
  `applicationDefault()`; the key is still in the history and **must be deleted in IAM**:
  `gcloud iam service-accounts keys list --iam-account firebase-adminsdk-fbsvc@hom-pos-52710474-ceeea.iam.gserviceaccount.com --project hom-pos-52710474-ceeea --managed-by=user`,
  then `… keys delete <KEY_ID>`. It bypasses Firestore rules. The second laptop's Mina `.env.local` may use that key.
  cloud-deploy now refuses a tree with a PEM private key in it (a push from a Mac is not checked).
- The `client_id`/`client_secret` in about a dozen scripts is the Firebase CLI's own OAuth client, public by design (the
  refresh token is read from the local CLI config).

## Open items after the reconvergence (2026-09-22)

- `NEXT_PUBLIC_STORE_TAKEN_BY` in `apphosting.mina.yaml` is a guess (Mina, Ammar, Murtaza) — Mina's fork never had
  "Taken by". Ask the owner for Mina's counter names and correct it.
- `website-checkout` is retired but not deleted; delete it once nobody has it checked out elsewhere.
- Mina's `firestore.rules` and Taheri's differ (Taheri's are open); App Hosting does not deploy rules, so each
  project keeps whatever was last deployed with the Firebase CLI.

## Decisions already made (don't reopen unless asked)

- **The dashboard is the morning glance** (redrawn 2026-09-27, owner: "simple and effective, don't add shortcut buttons"):
  four figures — taken today, this month (against last), owed to you, on the bench — then **Needs you** (late promises as one
  row, overdue pieces by karigar, unassigned, the three largest unpaid + the rest summed, repairs ready and uncollected 3+
  days, birthdays/anniversaries), **Due to customers** (open orders *and* repairs in the shop by their promised date — late,
  today, soonest, undated by age; `orderTiming` for both) and **Recent sales**; the 30-day line at the bottom. No buttons:
  New Sale is the sidebar's.
- **Liquid Glass is a choice** (2026-09-27, owner: "add liquid glass from apple to the pos, use apples exact design guides …
  this will be a dropdown option from the normal ui"): Settings → Appearance → **Interface style**, Standard (default) or Liquid
  Glass, the shop's (`settings.uiStyle`, cached per device as `gemstrack:ui-style` for the first paint, like the theme). It is one
  class, `ui-glass` on `<html>` (`applyUiStyleToDocument`, and the boot script in the head), and every rule lives under it at the end
  of `globals.css` — Standard is untouched. Built from Apple's HIG (Materials; Adopting Liquid Glass; Color; Layout), each rule
  quoted in the CSS: glass only on the navigation and control layer (sidebar, the top bar's controls and page tabs, mobile bottom
  bars, sheets, dialogs, menus, popovers, tooltips, toasts, the two floating buttons), never on content (cards, tables, forms stay
  opaque); the regular variant only (the clear one is for controls over photos — not used); sidebars more opaque; one tinted
  control, New Sale; the top bar is transparent with a **scroll edge effect** instead of a strip; windows inset from the edge with a
  1.75rem radius; section headers in title style; Reduce Transparency / Increase Contrast / no backdrop-filter get a solid
  version. Components carry inert hook classes (`glass`, `glass-window`, `glass-popover`, `glass-bar`, `glass-fab`, `glass-ctl`,
  `glass-toolbar`, `app-header`, `app-tabs`, `app-inset`; and on the content layer `btn`, `ui-field`, `card`, `alert`, `tabs-list`,
  `tabs-trigger`, `sidebar-search`); the material itself is the house's popover colour at low opacity over a fixed ambient glow of
  the house's primary, so both houses get their own glass.
  **The sweep of 2026-09-27** (owner: "assess and refine liquid glass in every page, every feature"): every route shot in headless
  Chromium at 1280 px dark and 390 px light with glass on, plus the sidebar sheet, command palette, select, dialog, alert, popovers,
  drawer, tooltip, the Ads helper and the designer. What it changed: **the content layer takes Apple's shapes without becoming
  glass** — buttons are capsules (44 px and taller, and buttons drawn as fields such as a picker's trigger, are 0.875rem rounded
  rectangles, as the system's large buttons are; a split button keeps its shared edge), fields 0.625rem, cards and alerts 1rem,
  in-page tabs a pill like the top bar's — so a 0.5rem card no longer sits beside a 1.75rem pane; light glass carries an outer
  hairline so it reads over a white page; the dark ambient glow is stronger so the pane has something behind it; windows (sheets,
  dialogs, alerts, the helper's panel) and popovers are more opaque than a control, and on a phone a dialog or alert is a rounded
  window inset from the edges instead of an edge-to-edge box (`glass-full` marks the two that fill the width: the command palette
  and the helper's panel); the sidebar's search is a field cut into the glass, its rows
  0.625rem, New Sale a capsule; the floating discs draw their symbol in the foreground colour (the Ads helper's was white on white
  glass). Every page with chrome of its own is on the hooks: Hisaab's sticky search and the contact import's bar are floating
  toolbars, the karigar's My work header a scroll edge, Edit a piece's save foot glass, the customer and SKU autocomplete lists
  popovers, the designer's long-press menu a sheet over a dimmed page. The designer's own bars stay standard: they sit beside the
  canvas, not over it, so there is nothing for glass to show. Not on a real phone.
  **The pane floats** (2026-09-28, owner: "there shouldn't be a cut at all … the sidebar should be floating", then "cut comes back
  … when scrolling down"): on a computer the pane sits above the top bar (z 45, between the bar's 40 and the windows' 50), and
  the bar's scroll edge runs under it across the whole window (`inset … -100vw`) and appears only once the page scrolls
  (`data-scrolled` from `useScrolled`) — starting at the pane's edge, or drawn always, its tint made a vertical step at the
  pane. The pane has no drawn outline: a soft shadow and a specular edge (`::after`, a masked gradient ring bright at the top
  left, fading down the side). Bottom bars (`.glass-bar`) start after the pane on a computer, open or folded.
- **The sidebar is by what the shop does** (re-audited 2026-09-27, owner: "reaudit the separation entirely"): **New Sale** is a
  button of its own under Search; Home (Dashboard, Calendar); **Sales** — Orders, Invoices, Repairs, Customers; **Workshop &
  stock** — Workshop (Jobs, Karigars, Given items) and **Stock** (Pieces, Add in bulk; back in the sidebar — Mina keeps ~100
  pieces; owners only, the pages read Firestore directly); **Marketing** — Posts, Website, Ads (no longer sharing a heading with
  the workshop); **Finance** — Money and Analytics (Overview, Products, Customers, Categories as tabs — the last three were only
  reachable from card titles); Settings in the footer gains Labels and Recently removed. Twelve rows and a button, as the
  2026-09-25 "way too crowded" cut asked; sibling pages stay tabs in the top bar (`navGroups` in `app-layout.tsx`).
- **It's called the ERP** (owner, 2026-09-27: "my system isn't a traditional pos anymore … rename it erp everywhere"). Every
  word people read says ERP — screens, errors, WhatsApp alert labels (`*Taheri ERP* · …`, Mina's `NEXT_PUBLIC_STORE_NOTIFY_LABEL`
  "House of Mina ERP"), the manifest. **Kept as POS on purpose:** the Shopify order notes and codes (`POS Invoice INV-…`,
  `POS-DISCOUNT`, `POS Item`) — the orders webhook matches old Shopify orders by that text; code names, repos, project ids.
  **Addresses:** `erp.taheri.shop` (gemstrack-pos) and `erp.houseofmina.store` (hom-pos) are App Hosting custom domains beside
  pos.* (which keep answering — taheri-site and the Mina catalogue call pos.* for `/api/public/*`); both are Firebase Auth
  authorised domains. DNS: taheri.shop at **Hostinger** (A → 35.219.200.5), houseofmina.store at **GoDaddy** (A → 35.219.200.7),
  each with the `fah-claim` TXT and the `_acme-challenge_…` CNAME App Hosting lists (`…/backends/studio/domains/<host>`).
  `NEXT_PUBLIC_APP_URL` moves to erp.* only once erp.* serves with a certificate, together with the Meta redirects
  (`https://erp.<house>/api/ads/callback`, Taheri's `…/api/instagram/callback`) — OAuth returns to that address.
- **One Vertex AI key for all AI, both houses** (2026-09-29, owner: "use this key for everything now", after Murtaza's
  project lost billing). Post a Piece, the website captions, retouch's check, the Ads helper, voice, the bill/order scanners
  and the gold update all send `x-goog-api-key` to Vertex's keyed endpoint (`aiplatform.googleapis.com/v1/publishers/google/
  models/<model>:generateContent`, no project in the path; `src/lib/ai-key.ts`), billed to the key's own project — number
  847960974510, not Taheri's, Mina's or Jewel Gen. The key lives **only** in Secret Manager `vertex-ai-key` in gemstrack-pos,
  read at run time (never declared in the YAML — a missing secret is "not set up", not a failed rollout; never in any committed
  file — gemstrack-pos is public); Mina reads the same one (`VERTEX_AI_KEY_SECRET` = `projects/gemstrack-pos/secrets/vertex-ai-key`).
  Readers: `firebase-app-hosting-compute@` both projects and `claude-cloud@gemstrack-pos`. Kept 5 min, a missing one re-asked
  after 1 min — so creating or rotating it needs no deploy. No key → the old signed path (IMAGE_AI_PROJECT / VERTEX_PROJECT).
  `VERTEX_AI_KEY` (or `GEMINI_API_KEY`) as a variable wins, for local runs. Every model in use answers through it
  (gemini-3-pro-image, 3.1-pro-preview, 3.8-flash, 3.6-flash, 2.5-flash; 3.5-pro still 404). The checks panel says which
  way the AI is billed; `diagnose` names the project Google complains about and knows a refused key.
  **Its project's per-minute quota is tiny** (measured 2026-09-29: a handful of calls a minute, then 429 "Resource has been
  exhausted (e.g. check quota)" with no details, on the keyed and the global route alike). So `call()` waits out a 429
  (5 s, 15 s, 30 s) instead of failing, and the checks panel's ping (thinking `low`, no retries — left alone it thought for
  up to 5 s and, with a retry, blew the panel's 8 s) shows a rate limit as a warning, not "timed out". The fix is the key
  project owner's: raise its Vertex AI per-minute quota (IAM & Admin → Quotas).
- **The scanners read with Gemini 3.1 Pro and copy the paper's own hisaab** (2026-09-29, owner: "scan a parchi feature should
  also use ai"). Scan a parchi (`/api/vision/order`) and Read a written bill (`/api/vision/bill`) ask for `scanModel()`
  (`lib/vision/scan-model.ts`: `SCAN_AI_MODEL`, else **gemini-3.1-pro-preview**; one Google doesn't serve falls back to voice's
  gemini-2.5-flash), wait out the key's rate limit (`patient`), and read every text part of the answer (the first alone could be
  half a JSON — the 236 s "Could not read that back" of 2026-09-26). Both prompts now copy **wastage in grams** (`wastageG`, turned
  into the percent the ERP prices with by `lib/vision/wastage.ts`, tested), the weight **before** a stone weight comes off (the
  ERP subtracts `stoneWeightG` itself), and the bill scanner the **rate** (per line or once at the top) — `billRates` sets that
  karat's box in the cart — and its **discount**, so a scanned estimate lands at the paper's own total instead of being
  re-priced at today's rate. Measured on the two Taheri estimates of 2026-09-29: 2.5-flash and 3.1 Pro read every figure
  (10/10, 17/17; Pro ≈ 5 s once the rate limit lets it through), **gemini-3.8-flash returned no lines at all** — never use it here.
- **Drafts** (`/drafts`, Sales in the sidebar with a live count; 2026-09-27, owner: "drafts should have a separate section
  (order/invoice drafts) and be saved there, dont draft ongoing orders … deal with them smartly"). Firestore `drafts`, one
  document per unfinished form, seen on every device (`src/lib/work-drafts.ts`, tested; `components/drafts/use-work-drafts.ts`).
  **Only a new order form and a new sale are drafted** — never an order being edited or invoiced, an invoice on screen, an
  estimate being changed. Written a second after typing stops, only when something changed and something is there (a
  blank form's rates, promised date and row ids don't count); removed the moment the order or invoice is saved and never
  written after (`finish()` — the old device-only drafts kept writing while the page navigated away, and kept a sale's
  customer while its invoice was on screen, which is how saved orders and sales showed up as "unfinished"); removed when
  the form is emptied; forgotten after 30 days. Each form is its own draft: an order's id rides in `?draft=`, the cart
  remembers its sale in `gemstrack:sale-draft` and carries its pieces, so `/cart?draft=…` continues a sale on another
  device. Opening an invoice over a sale in progress keeps that sale in Drafts. The old `gemstrack:draft:` browser drafts
  are moved over once per device, minus those saved afterwards. Settings' switch (`autoDraftForms`) turns it all off.
- **Post a Piece remembers** (2026-09-27, owner: "post a piece should have proper memory and have drafts and continue where
  left off"). Every piece being made is a draft **on this device** (IndexedDB `taheri-post-drafts`, `src/lib/social/post-drafts.ts`:
  `drafts` holds the words, both designs, the collection, where it goes, the caption and what has already gone out —
  `uploaded`/`sent`, so a publish picked up again never sends twice; `photos` holds each photo's file once, by draft and photo
  id — every `Photo` carries its `blob`). Saved 1.5 s after any change; the page opens on the piece being made last ("Picked up
  where you left off" + New piece); **Drafts** in the header lists them with thumbnails — Continue (the piece on the page is
  saved first), New piece (it stays in Drafts), Delete. A piece leaves once published or queued, and after 30 days. Not in
  Firestore on purpose: camera photos are megabytes. A new piece starts where this device usually posts (`taheri_post_prefs`:
  WhatsApp groups/channel, Instagram, website, weight line).
- **Add Photos needs no sign-in** under open access — the owner overruled an auth gate on 2026-09-20.
- The order-actions route keeps its always-verify gate: it moves money.
- **Invoices show wastage in grams only** (no rupee value, no percentage); the workshop slip keeps the percentage.
- Copy: never "Najmi Market" or "Saddar" in anything a customer reads; hours are Sat–Thu 11:00–21:00, **Fri 15:30–20:00**.
- Photo Weights' preview draws the weight with the overlay tool's geometry (Futura LT Light, 143/3000 of the width, inset 120/3000).
- Number fields (`AmountInput`) select their contents on focus, and the sale-flow ones (order items, product form,
  cart edit) show a 0 as blank (`zeroAsEmpty`) — the counter asked for no pre-filled zeros to delete.
- **Repairs** (`/repairs`, under Invoices): a ticket = one customer + **any number of pieces** (piece, what to do,
  weight, price) + ready-by + optional advance; karigar / taken by / shop note fold away under "More". Deliberately
  simple (owner's ask): three steps, **In the shop → Ready → Collected** — Ready is one tap, Hand back only takes the
  balance. `REP-000001` numbering from `lastRepairNumber` in settings. Money taken is written to **Extra Revenue** in
  the same transaction with `repairId`; deleting a repair deletes those rows. Receipt: `src/lib/repair-pdf.ts`.
- **Analytics money reads in lac and crore** (`src/lib/money.ts`: `pkrLac`, `lacCrore`, `axisLac`): exact below 1 lac,
  then `4.5 lac` / `1.25 crore` to two decimals, chart axes `50k · 2.5L · 1.2Cr`. Grams, tola and counts are untouched.
- **Exchange gold counts as cash** in Analytics' Cash In (owner, 2026-09-25: "count exchange gold as cash only"): every exchange —
  at the counter, on an open order, on an invoice made from an order, inside an older invoice's lumped "Advance from Order.
  Cash: X. Exchange: Y" payment — is a Cash In part of its own ("Exchange gold"). Each advance is counted once: on the order
  while it is open, on the invoice once an order is invoiced (either side's link counts). `src/lib/analytics/cash-in.ts`, tested.
  **Revenue counts it too** (2026-09-29, owner: "are taheri analytics correct, feeling stale"): an invoice's `grandTotal` is
  subtotal − discount − exchange, so every revenue figure (Analytics' totals, day chart, months, years, customers, coins; the
  dashboard's month) counted a part-exchange sale at its cash part and an all-exchange sale at 0 — Taheri's five such sales
  (1.47M) and 5.29M of exchange in all were missing. They now sum `invoiceSaleValue` (`lib/analytics/sale-value.ts`, tested:
  grandTotal + the exchange fields; an older invoice whose exchange sits inside a lumped payment has no field and adds nothing).
  Kept on purpose: an invoiced order still counts on the order's date, and an open order at its full `subtotal`. A rolling
  range (last 30/90 days, this year) re-anchors when the day turns on a page left open.
- In a component, no hook after an early `return` (the `/orders/add` crash of 2026-09-22 was exactly that).
- **The WhatsApp reports send themselves** (2026-09-30, owner: "fix this" on Settings → Notifications' "Send failed — While
  sign-in is off, messages can only go to the numbers saved in Settings"). Cause: `/api/notifications/send` and `/run` read *the
  first document* of `app_settings`, which since 29 Sep is `ad_studio_assess` (the Ad studio's lease sorts before `global`), so
  every live alert was refused and every scheduled report skipped — with a 200, so no job showed red. **Read
  `app_settings/global` by name** (`readNotifSettings` in `lib/notifications/dispatch.ts`), never `limit(1)`. The reports had
  also needed `node notifications-scheduler.js` on a computer, so only Mina's 9 pm report and the ads summary ever went; now
  `lib/notifications/schedule.ts` (tested) sets the times — checklist + overdue orders + given items at the checklist time,
  end of day, the daily report at `notifDailyReportTime` (21:00), Mondays the weekly report and karigar balances, ads 09:30,
  all Karachi time — and the `social-queue-tick` sends what is due in both projects (before its Post a Piece gate). Each goes
  once a day: a transaction claim `notif_runs/<date>_<task>` shared with `/run`, so the `ads-daily-summary` and
  `mina-daily-report` jobs can't double-send; one that reached nobody is retried at the next ticks (3 tries), up to 60 min
  late. Settings shows each report's time and last send, and **Send now** (open like the test button: only to saved numbers).
  The builders (`lib/notifications/reports.ts`, no longer `@ts-nocheck`) had never run, and were broken: the checklist threw
  (`fresh` undefined), given items and karigar batches were read by fields that don't exist, and every revenue figure summed
  completed orders instead of invoices. Now sales are invoices at `invoiceSaleValue`, a completion is dated by its invoice,
  lateness is by promised date, and karigars come from Hisaab (Taheri's is gold only, last entry July; Mina has none — it
  pays karigars through expenses).
- **The monthly report PDF** (2026-09-30, owner: "add proper monthly report pdfs with all listed sales"): `lib/reports/monthly.ts`
  (pure, tested) builds a Karachi month on **Analytics' own rules** so the totals always match it — jewellery invoices at
  `invoiceSaleValue` on their order's date, open orders at their subtotal, other income; coins apart; cash in by
  `cashInForPeriod`; business expenses (drawings shown, not counted) — and lists **every** invoice (refunds greyed and not
  counted, coin sales marked), every open order taken, every payment by method, other income and every expense, with the
  month before for comparison. `monthly-pdf.ts` draws it A4 with the invoices' furniture (`pdf-chrome.ts`; `plain()` keeps text
  to what Helvetica can print); `monthly-server.ts` reads Firestore and the wordmark from `public/`. Two ways out: **Analytics →
  Monthly PDF** (any of the last 24 months; `/api/reports/monthly?month=2026-09`, open under open access), and the WhatsApp
  report **`monthly-report`** (`notifMonthlyReport`, off until the owner switches it on in Settings → Notifications): on the **1st at the checklist time**, the month before,
  as a PDF document (`sendWhatsAppFile` → WAHA `/api/sendFile`) with a short caption. jsPDF and its table plugin are
  `serverExternalPackages`, so the server takes jsPDF's Node build rather than bundling the browser one.
- **Staff open an invoice at `/cart?invoice_id=<id>`** (payment, edit, print); `/view-invoice/<id>` is the customer's page, with
  no shell and only downloads, and is only ever sent to customers. There is no `/view-invoice` without an id: the dashboard's
  Recent sales and unpaid rows linked `/view-invoice?invoiceId=` and opened "not found" until 2026-09-29; the workshop's invoice
  links sent staff to the customer's page.
- **One invoice PDF builder**: `src/lib/invoice-pdf.ts` (`saveInvoicePdf`) draws the customer's copy for the invoices list,
  the cart's post-sale screen and `/view-invoice`. `perPiece` prints a multi-piece invoice as one invoice per piece on its
  own page ("Piece 2 of 3"); discount, exchange, adjustments and paid are shared pro rata by piece price, the last piece
  absorbs rounding, payment history is left off the pieces. The split button is `components/shared/print-button.tsx`.
- **Post a Piece** (`/website/post`, 2026-09-24): photos + headline + weight → a 1080×1920 Instagram story drawn on a canvas in
  the shop's story style (photo full bleed, Sofia Sans Extra Condensed 800 headline, Figtree weight/details line
  `21K Yellow Gold | Stones | 45.350g`, wordmark top-right; `src/lib/social/story.ts`), the WhatsApp caption
  (`src/lib/social/caption.ts`: the jewelry-post format **without the address**), and the website photo **stamped with the
  weight** in the overlay tool's geometry (Futura LT Light, `public/fonts/futura-lt-light.woff2`). Stamping, not
  `website_pieces`, because a just-dropped photo is not in `catalog-attributes.json` yet and `/api/website/pieces` refuses it.
  Publish sends to the website (Add Photos relay; per-photo Site/WA ticks), set of the day, the Instagram story (when
  connected) and the community's **announcements group** (`120363360668200388@g.us`, Green API line +92 326 2275554 is
  admin) after a confirm. The WhatsApp channel is **share-sheet by hand** (owner's choice); Green API documents no channels.
  **AI** (owner: "extremely advanced", 2026-09-24): Enhance, Extend to 9:16/4:5/1:1, New setting (7 scenes from the shop's own
  stories + free text), Make it with AI (caption + plan + re-staged 9:16), AI lettering (read back and verified), Write with
  AI (WhatsApp + Instagram captions; the route rebuilds the caption frame if the model drops the weight or a number).
  Prompts in `src/lib/social/prompts.ts` follow the nanobanana rules (piece first, never name the metal, avoid-list last).
  Models: `gemini-3-pro-image` (Nano Banana Pro; the `-preview` name 404s on Vertex now), `gemini-3.1-pro-preview`,
  `gemini-3.8-flash`. **Billing (since 2026-09-29): the Vertex AI key** — see "One Vertex AI key" below; what follows is
  the fallback. Murtaza's project `jewelgen-mm-e3d43ecb` (owner offered it; its billing was off on 2026-09-29); this Mac's ADC
  (potatomasta501) has no access there, so local dev signs AI calls with `IMAGE_AI_CREDENTIALS` =
  `~/.config/gcloud/legacy_credentials/mmurtaza1970@gmail.com/adc.json` in `.env.development.local`. Production needs
  `roles/aiplatform.user` for `firebase-app-hosting-compute@gemstrack-pos` on that project. Timings: an image op ≈ 40–65 s
  incl. the check, captions ≈ 30 s (Cloud Run timeout is 300 s). **Instagram** needs a Meta app (Instagram Login, dev mode,
  @collectionstaheri as tester), `INSTAGRAM_APP_ID`, secret `instagram-app-secret`, redirect
  `https://pos.taheri.shop/api/instagram/callback`, and secret `instagram-token` with secretAccessor + secretVersionAdder
  for the runtime account.
- **Post a Piece checks** (2026-09-25, owner: "thorough checks … with a very obvious solution"): `src/lib/social/health.ts`
  tests every dependency live (site up; upload key via an empty POST to upload.php — 400 = key right, 401 = wrong; set of
  the day; Green API signed in, line is admin of the community, send queue; Instagram app set, token-secret IAM, token
  valid + days left + publishing quota, public image route reachable; AI ping + image model served + today's cap) and
  `src/lib/social/diagnose.ts` turns any error into title + fix + action (link or gcloud command), with the real messages
  from setup pinned in tests. Failures are logged to Firestore `social_errors` (server routes log their own; the page
  reports website/featured failures). The panel sits atop the page; the publish confirm lists failing checks for the
  chosen destinations. Locally the website checks fail — this Mac can't resolve taheri.shop — not a real outage.
- **Story editor** (2026-09-25, owner: "a lot more features and freedom in prompts and positions"): the story is a layer
  document (`src/lib/social/editor.ts`: text bound to the piece's fields or free, wordmark, arrow/line/circle/box, photo
  insets; presets Left stack / Centred / Split / Bottom / Headline only; fonts condensed, Figtree 300/400/700, Bodoni Moda,
  Futura) edited in `src/app/website/post/story-editor.tsx` (tap to select, drag, corner to resize, top dot to rotate,
  pinch, centre/margin snapping, undo/redo, layouts saved per device). AI prompts: Ask AI (free instruction, op `custom`),
  every prompt editable before sending (`rawPrompt`), a brief for Make it with AI (`sceneBrief`), a style for AI lettering.
  **Instagram music:** the API can't add music; Share story opens Instagram's own editor for the music sticker. A video
  story with a licensed track baked in was offered, not built (owner to choose).
- **WhatsApp and taheri.shop only ever get 1:1** (owner, 2026-09-25). The page has two editors on one component: **Story
  9:16** (Instagram) and **Square 1:1** (WhatsApp + website): one set of square layers for every ticked photo, a crop per photo
  (`StoryDoc.placements`), rendered with `renderDocTo` at up to 3000 px for the site and 1600 px for WhatsApp. Square presets
  (`SQUARE_PRESETS`): weight + wordmark (the overlay tool's geometry — weight top-left in Futura LT Light, the mark bottom-right,
  both **auto colour** per photo), weight + t mark, weight only, name + weight + wordmark (Didone italic like the grid posts), clean.
  **Marks are SVGs** (owner: "the logo should be an svg so I can change colour"): `public/brand/taheri-wordmark.svg` (from
  taheri-post-kit/taheri_logo.svg, cropped to its letters) and `public/brand/taheri-t.svg` (the t monogram), filled with any
  colour through their shape (`drawMark`); `NEXT_PUBLIC_STORE_MARK_SVG` / `_MONOGRAM_SVG` per house (Mina: its PNG logo, no
  monogram). A text "TAHERI / COLLECTIONS" stamp was tried and rejected. WhatsApp no longer offers "send the story image".
- **The designer** (2026-09-25, owner: "add canva like design functionality to the story and post editor", then "OPTIMIZE HEAVILY
  FOR MOBILE, ALSO FOR DESKTOP"): **Design** on the story or the square opens a full-screen, Canva-style editor of the same document
  (`Designer` in `story-editor.tsx`; panels in `editor-panels.tsx`; shapes, frames, photo filters, align/distribute and magnetic
  guides in `src/lib/social/design.ts`, tested). Rail: Templates (thumbnails drawn from the real piece via `previewPreset`), Elements
  (shapes, lines, frames = a photo cut to a shape, stickers, the marks), Text (heading/subheading/body, the bound fields, font
  combinations), Photos & uploads (uploads stored as data URLs so saved layouts carry them), Brand, Layers, Background. Selection
  toolbar, 8 text effects + curved text, filters by pixel maths (Safari has no `ctx.filter`), multi-select/group/lock, copy/paste
  between story and square, PNG/JPG download, 5 extra fonts (`fonts.ts`, loaded on first use). **Phones:** bottom bar = the rail or
  the selection's tools; panels are bottom sheets and the design refits above them and above the keyboard (`visualViewport`);
  long-press = menu; tap selected words again = type; two-finger pinch + twist; the typing box is never under 16 px (iOS zooms into
  smaller fields). The app's global coarse-pointer rule gives every `<button>` `min-height: 2.75rem` — round buttons need
  `min-h-0` — and `[@media(pointer:coarse)]:` classes must be written out literally (Tailwind can't see interpolated ones).
  Checked in headless Chrome as an iPhone and at 1440 px (puppeteer with the Mac's own Chrome as `executablePath`; the cached
  puppeteer Chrome is broken) through the gate's dev-only `?dev=1`.
- **Story + post together** (2026-09-25, owner: "the workflow is usually story and post together … optimize this workflow, allow for
  either or workflows"): Post a Piece opens on **Story + post / Story only / Post only** (`FormatPicker`, remembered per device in
  `taheri_post_formats`); the choice hides the other design and everything only it needs (website + WhatsApp cards, caption and Site/WA
  ticks for the post; the Instagram card and story AI for the story) and gates `siteOn`/`waOn`/`igOn`. Both designs live in one
  `PairEditor` (`story-editor.tsx`): live thumbnails of each as tabs, one open in the small editor, one designer with a Story/Post switch
  in its header, and **Copy to the post / story** on any selection (`carryLayers` in `editor.ts`, tested: same place on the page, ×0.75
  going to the square, never bigger going back). The starred photo leads both (the post follows it). A story Instagram won't take by
  itself (not connected — always on Mina — or switched off for music) is Publish's last step, **by hand** (a Share button in the step
  list); story only then makes the main button "Share the story"; the queue refuses until it has been shared or saved (it would be lost
  when the page clears). "Save the story and the post" hands every image to the share sheet at once (Photos on a phone).
  **Layout** (owner: "quite cluttered and hard to navigate"): five numbered steps — Photos, The piece, The story and the post, Where it
  goes, Send. On a phone they run in that order (the two columns are `contents` below `lg`, sections carry `order-*`), so the designs
  show right after the headline; on a computer 3 and 5 sit beside the form. Folded until asked for: the piece's metal/stones/small line
  ("More details"), the website name ("Change"), the caption's extra line, the editor's "Photo & colours". One tool row per design
  (Layouts · Add · AI menu · Design; the AI menu holds Make the whole story, New setting, Extend, Ask AI, AI lettering and "remove tags");
  "From your phone" is one button plus a More menu. Each step is a card of its own with a numbered badge (`STEP`, owner: "requires
  more separation"); panels inside a step are tinted, not bordered. On a phone the design toolbar is four equal tiles, icon over word.
  WhatsApp never just disappears: with no settings (a local copy) or a failed load, its card says why.
- **Posts → From the website** (`/website/from-site`, 2026-09-25; owner: "give me an option to take any post from taheri.shop (or
  randomize) … add the post link to whatsapp community from right there", then the same for House of Mina): opens on **New arrivals**
  (owner: "by default show new arrivals"; `src/lib/website/new-arrivals.ts`, tested — the catalogue's own shelf, `newArrival` in
  `catalog-pieces.json`; taheri.shop: added in the last 30 days, never fewer than the newest 24, from the `added` each photo carries in
  `catalog-attributes.json` since taheri-site 72bcde3), everything newest first; search, collection chips,
  **Shuffle** (skips pieces sent in the last 30 days — `social_posts.sitePiece`), the photo as it is on the site (it already carries the
  house's marks: weight top-left + wordmark top-right on taheri.shop, the MINA mark on the catalogue), the caption from `sitePieceCaption`
  (name, weight, facts, 🌐 the piece's link, then `NEXT_PUBLIC_STORE_POST_FOOTER` or "Ask for today's price" + numbers; Mina also
  `_POST_TAGLINE`), **Write with AI** for both houses (`/api/website/site-pieces/caption`: the model writes only a line and the facts, in
  the house's voice with its own community posts as examples; the POS builds the frame), a **weight overlay** (stampPhoto, on by default
  only where the site photo doesn't show the weight — `weightSource !== 'label'`), and where it goes: any of the community's groups
  (`WHATSAPP_POST_GROUPS`, Label=chat id; Taheri: Announcements, Diamonds, Gemstones, Investments, Exclusives, Watches), the channel, or
  **Both** — `/api/website/post` with `targets` (keys, never chat ids; Post a Piece sends with `targets` too since 2026-09-25).
  Mina's POS got the page as a port onto its branch (c045a60; recorded in main with a `-s ours` merge, the other session's way).
  Both sites were changed to publish links: taheri-site's prerender adds `path` to `catalog-attributes.json` (2,565 of 2,601 photos have a
  page); mina-catalogue's prerender writes `catalog-pieces.json` (599 pieces). `NEXT_PUBLIC_STORE_SITE_POSTS` (default on); Mina's
  community is `120363422611483809@g.us`. The community's own posts were read through WAHA to match their look.
  **Crop & design** (2026-09-27, owner: "for post a piece from the website, add an ability to crop the photo or redesign etc like the
  rest of the space"): the photo in Edit a piece's square editor (`from-site/piece-design.tsx`; layouts and starting layout in
  `lib/social/site-design.ts`, tested) — taheri.shop's as the site shows it on "Nothing added" (Weight if the page was stamping it), Mina's
  from its `photoSource` with the MINA mark back on; while in use it is the WhatsApp square (1600 px) and the story's photo, the weight
  stamp steps aside, and "Use the photo as it is" drops it. No AI there yet (Edit a piece has it).
  **New uploads too** (2026-09-29, owner: "new stone sets not visible in post from the website"): taheri.shop's drops (Add
  Photos, uploads not yet adopted) are offered with their address, `dropPath` (`lib/website/drop-path.ts`, tested — the site's
  own slug rules), which taheri.shop's `api/piece.php` now serves as a real page (named, previewed); before, a drop's address
  answered 404 and posting left drops out.
- **Photos from the website** (2026-09-29, owner: "for post a piece let me add any pic from the website and then fix it up
  there"): Post a Piece's Photos step has **Website** (`site-picker.tsx`: the From the website list — New arrivals first, newest
  first, search, collections, up to 10 at once). Each photo comes through `/api/website/site-pieces/image` at 3000 px
  (`lib/website/site-photo.ts`, tested: the catalogue's unmarked source with `original=1`, so the post marks it once;
  taheri.shop's photo as the site shows it) and then is an ordinary photo — Enhance, Retouch, Extend, the designer. It carries
  `from` (kept in drafts and on every AI version of it): WhatsApp on, the Site tick off (it is on the site already; ticking it
  adds a second copy), the first one names the piece when the headline/weight are empty, and the caption links the piece's own
  page instead of its collection. taheri.shop's photos carry its marks: AI → Enhance with "remove tags" clears them first.
- **Post a Piece: channel tick, queue, and House of Mina** (2026-09-25, owner: "make a post on houseofmina pos also, same style" /
  "incorporate channel option and bulk sending"). Where the squares go is a tick per destination — the community's groups
  (`WHATSAPP_POST_GROUPS`) and the channel, first group + channel on by default — and each is its own publish step, sent with `targets`,
  so a failure is retried alone. **Queue** ("several pieces in one go"): *Add to queue* renders the piece exactly as Publish would (site
  squares ≤ 3000 px, WA squares 1600 px, story, a 240-px thumb), uploads them to `social_queue` / `social_queue_media` (900 KB parts) and
  clears the page; the panel then does **Send all now** (one confirm; the page calls `/queue/[id]/send` per piece) or **Spread over the
  day** (evenly between two times, default now+10 min → 30 min before closing; per-piece time / hold / remove). Server:
  `src/lib/social/queue.ts` (claim in a transaction, every single send recorded in `done`, so a retry sends only what didn't go;
  `sendItem` takes fake senders for tests), pure planning in `queue-plan.ts` (tested). The tick (`/api/website/post/queue/tick`, Cloud
  Scheduler `social-queue-tick` every 5 min in **both** projects, Bearer `CRON_SECRET`) sends due pieces, three tries, and sweeps
  drafts > 6 h and sent pieces > 7 days. Website relay and Instagram story are shared helpers (`src/lib/website/upload.ts`,
  `src/lib/social/story-post.ts`). **House of Mina** has Post a Piece (`NEXT_PUBLIC_STORE_POST_PIECE "1"`): catalogue + community
  announcements from its own line, no Instagram app, no channel, no set of the day; the caption and "Write with AI" close with
  `_POST_TAGLINE` / `_POST_FOOTER` in Mina's voice (`captionSystem(shop, house)`); its AI bills to Murtaza's `jewelgen-mm-e3d43ecb`
  like Taheri's (`IMAGE_AI_PROJECT` in `apphosting.mina.yaml`; `firebase-app-hosting-compute@hom-pos-52710474-ceeea` was granted
  `roles/aiplatform.user` there, with the mmurtaza1970 gcloud account on this Mac). Mina's voice stays on `VERTEX_PROJECT`.
  Locally both houses sign AI with Murtaza's ADC (`IMAGE_AI_CREDENTIALS`, which `env-for-house` never blanks).
- **The Maisons from the counter** (2026-09-26, the owner: "add pos functionality for maison"): taheri.shop's collection of the
  great houses' genuine pieces (Wristwear/The Maisons; the site's side is in taheri-site's CLAUDE.md). **Add Photos**: choosing The
  Maisons gives every photo a house picker and an official-name field; it goes up as `"<House> — <Model>.jpg"`
  (`src/lib/website/maisons.ts`, tested — the house list must match the site's `MAISON_HOUSES`), which the site reads so it shows
  under its house at once. **Post a Piece**: the same when its website collection is The Maisons (house picker; the name is the
  official one; the metal line moves to 18K). `quotePiece` refuses a house piece (`maison_enquire`: by `house` in the attributes or
  the folder), so neither the site nor checkout can price one by the gram.
- **Investments by Taheri in the POS** (`/website/investments`, 2026-09-25): the daily gold post is written by the owner's
  scheduled **Cowork routine on claude.ai** ("Investments by Taheri — daily post", 11:00; not editable from Claude Code) whose last
  step POSTs the four deliverables to `/api/investments` (multipart post/teaser/square/story, `Authorization: Bearer` the token in
  `taheri-post-kit/.pos-ingest-token` = secret `investments-ingest-token`). Filed per day in `investment_posts/{date}` + cards in
  `investment_media` (JPEG ≤ 900 KB). The page sends: post + square → `INVESTMENTS_GROUP_CHAT_ID` (120363362406867247@g.us, 469,
  admin-only, line is super admin; caption if ≤ 1024 chars else card then text), teaser → community announcements, story →
  Instagram (`/api/public/investments/[id]/story` via hosted.app). Each target once; resend asks. Manual add on the page too.
  **Automatic sending** (2026-09-25, owner: "automate the investment by taheri post sending … decide and choose when and how often"):
  the owner's schedule (`app_settings/investments_schedule`, rules in `src/lib/investments-schedule.ts`, tested) — on/off, days of the
  week, per part (group, **channel** — the post + card to `WHATSAPP_CHANNEL_ID`, WAHA only — teaser, Instagram) on/off and a Karachi
  time or "as soon as it arrives", a late cut-off, and "send by itself" or "wait for my OK". Cloud Scheduler job `investments-tick`
  (us-central1, `*/5 * * * *` Asia/Karachi, Bearer `CRON_SECRET`; the Cloud Scheduler API was enabled for it) calls `/api/investments/tick`,
  which sends only today's post, each part once (a Firestore-transaction claim guards overlaps), tries a failure three times, and writes
  `lastTick` (the page warns when it's over 15 min old). Ships **off**. Per day: Hold / Let it send, Approve, Try again; **Send all**
  sends every unsent part in order after one confirm. Both paths share `src/lib/investments-send.ts`.
- **Edit a piece** (`/website/edit`, Website menu, both houses; 2026-09-27, owner: "in both pos let me also fix/crop/add logo
  weight overlay to existing, change desc etc in taheri.shop or catalogue.houseofmina.store"). Any piece already on the house's
  site: the photo re-made in Post a Piece's square editor (`SoloEditor` in `story-editor.tsx`; its own shape or square; layouts
  Nothing / Weight / Weight + logo / Weight + t / Name, weight + logo — `applySquarePreset` now lays out on any frame height;
  crop by drag/pinch, filters, the designer; AI Enhance, Enhance and clear old labels, Ask AI), and the words: name,
  description, taheri.shop's tags (stone/metal/karat/cut/style) or the catalogue's facts, weight, hide. **Always edited from the
  original** (the site keeps it: `catalog-edit/originals/`; the image route's `original=1`, up to 3000 px), and the last design is
  kept in Firestore `website_edits` (per key, no AI photo), so re-opening shows it as left and nothing is stamped twice; a log in
  `website_edits_log`. The site keeps the change (`api/override.php` in taheri-site and mina-catalogue, secret
  `WEBSITE_UPLOAD_SECRET`): words in `catalog-overrides.json`, the photo **written over its own files** (a photo's path is the
  piece's identity) with a new `?v`. **The sites publish their own words; every reader lays the changes over them live** —
  `site-pieces.ts` (`withChange`; posting never offers a hidden piece), `getCatalogAttributes()` (prices follow a corrected
  stone/metal/karat at once; `{ own: true }` for the site's own), both sites' apps and prerenders — so "Undo every change" is
  exact at once. taheri.shop's weights stay in `website_pieces` (prices, WeightLabel); Mina's go in its change. A stamped photo
  sets `weightOnPhoto` so taheri.shop stops drawing the weight itself. `NEXT_PUBLIC_STORE_SITE_EDIT` (default on).
  **New drops too** (2026-09-27): taheri.shop's photos still in its drop folder (`api/catalog.php`, not yet in its attributes)
  are listed for the editor as `drop` pieces (no page yet, so posting never offers them); the site writes a re-made one over
  the drop's own file. **The website quote refuses platinum and silver** (`metal_enquire`): every metal but palladium used to
  be priced as gold at the full weight, which would have priced the Gents Ruby Rings ("925 Silver & 21K Gold") as solid gold.
  **The house's mark:** taheri.shop's photos carry the wordmark top-right (rings) or bottom-right (chains) — both are layouts
  (`catalogue-top`, `catalogue`). The Mina catalogue burns the MINA mark on at build (top right, maroon on light), so Mina's
  editor starts from the photo's **source** before framing and marking (`catalog-pieces.json` `source`, Shopify CDN or
  `catalog-src/`) and puts the mark back (`mark` layout, `/brand/mina-wordmark.svg`, `NEXT_PUBLIC_STORE_SITE_MARK_SVG` /
  `_INK` — derived from `STORE_BRAND`; `Assets.ink` is the dark ink auto colour uses). Changes show within about a minute
  (`catalog.php` is cached 30 s, taheri.shop keeps it 60 s per tab). Design notes: `docs/edit-website-pieces.md`.
- **.shop outage 2026-09-24 ~16:18 UTC:** GMO Registry answered NXDOMAIN for every .shop domain (taheri.shop, pos., links.).
  The POS stayed usable at **https://studio--gemstrack-pos.us-central1.hosted.app** (App Hosting's own address; open access,
  data loads). Instagram fetches story images from `SOCIAL_MEDIA_ORIGIN` (that address) so posting never depends on .shop.
- **The link page, both houses** (`/links`; links.taheri.shop, and **links.houseofmina.store** since 2026-09-26): what the one
  "Our links" QR on invoices, order slips and repair receipts opens (`storeLinksUrl()` ← `NEXT_PUBLIC_STORE_LINKS_URL`, else
  the POS's own `/links`). Words and links are variables (`STORE_LINKS`, `STORE_LINKS_PAGE` in `store-config.ts`: tagline,
  welcome, the top row `"lead|tail|line"`, website label, footer `visit`; TikTok, a separate online shop); the dress follows
  `STORE_BRAND` (Taheri #0A1111 / gold / Bodoni; Mina #140B0B / rose #E8A5AE / Newsreader). The top row is the **WhatsApp
  channel**, or the community for a house without one. Taheri's six community rows were removed (owner, 2026-09-25: "remove
  all community links"). Mina's: the Exclusive Sterling Silver community on top, Instagram, TikTok, a chat with +92 316 1930960
  (`NEXT_PUBLIC_STORE_WHATSAPP_URL`; the community moved to `_WA_COMMUNITY_URL`), the catalogue, houseofmina.store (Shopify),
  "Studio open daily, 12:30 – 8 pm · Karachi". links.houseofmina.store is an App Hosting custom domain on hom-pos; its DNS
  (A → 35.219.200.7, `fah-claim` TXT, ACME CNAME) was added through the GoDaddy API.
  **Redrawn 2026-09-29** (owner: "aesthetically improve links.taheri.shop and houseofmina's link page"): a **server page**
  (`force-dynamic`, no page JS). The layout had sent both customer pages (links, `/view-invoice`) as an empty `<body>` until the
  ERP's store hydrated; public paths now render at once. Header with the accent tagline and a hairline-and-diamond ornament; the
  top row is one card with the page's only filled button ("Follow / Join on WhatsApp"); **Just in** — 8 of the site's new
  arrivals, a spread across collections (`lib/website/showcase.ts`, tested; never a file name like "DSC…" or "Untitled design"),
  from `getSitePieces()` on the server (hidden pieces left out, 4 s cap, streamed in its own Suspense so the links never wait);
  the rest as one grouped list; "Come and see us" with tappable numbers. Colours in `LINKS_DRESS` (store-config), class names
  `lk-…` (the Liquid Glass sheet styles `.btn`/`.card`; glass is never applied on customer pages). Taheri's footer default is
  now its hours (no Najmi Market/Saddar). Shared on WhatsApp it previews as the shop — `<title>`, description and
  `og:image` `public/brand/links-share-<brand>.png` (1200×630, drawn in headless Chromium) — and `/view-invoice/<id>` as
  "INV-… · <house>", "Your invoice from …" (both said "Jewellery ERP"). The Zebra label-printer script loads only in the ERP.
- **Light / dark is per device** (owner, 2026-09-25: "switching is buggy"): the sun/moon in the top bar sets this device's
  mode (`gemstrack:theme-device` in localStorage, `writeDeviceTheme` in `src/lib/theme-cache.ts`) and switches at once; the
  **Shop mode** in Settings (Firestore, live on every screen) only decides devices that never chose. `<html>` carries `.dark`
  **only on the dark palette** now (`applyThemeToDocument`, and the boot script before paint) — it used to be there always, so
  every `dark:` style showed in light mode — plus `color-scheme` and the first-paint class, kept in step on every switch.
  **The body's `theme-default` is set the same way, never from React's className** (2026-09-27, owner: "switches to white
  again and again"): the server rendered the body light, a device with the shop's dark theme cached hydrated it dark, React 18
  leaves an attribute that differs at hydration as it is, and every later render computed the class React believed was
  already there — so `<html>` was dark and `<body>` white on every cold load until a toggle changed the string. The body's
  className now carries no theme (identical on server and client), and `applyThemeToDocument` toggles `theme-default` on it in
  a layout effect, before paint. Reproduced and re-checked in headless Chromium in five cache states (`gemstrack:theme` /
  `gemstrack:theme-device`).
- **Exchange gold is one set of rows everywhere** (2026-09-25, owner: "make the exchange gold field uniform and add the
  ability to add another"): `components/shared/exchange-rows.tsx` in the order form and the cart — what it is, karat, grams,
  rate/g, value (grams × rate until typed), **Add another exchange**. Stored as `exchanges` on orders and invoices
  (`lib/exchange.ts`); every write also keeps the old fields as totals (`advanceInExchangeValue`/`Description` on orders,
  `exchangeAmount1` + `exchangeDescription` on invoices), so balances, analytics, Shopify and the per-piece split read them
  unchanged. Old documents are read through `orderExchanges` / `invoiceExchanges`. PDFs and the order slip print a line each.
- **An order carries everything to its invoice** (2026-09-25, owner: "carry over all details from order to invoice, such
  as advances, exchange gold"): exchange rows become the invoice's exchange (off its total, like the cart), each cash
  advance a payment of its own with its date and method (`orderAdvancePayments` in `lib/order-payment.ts`; `Order.advances`
  is written by Record an advance, `advanceMethod` by the order form), plus discount, taken by, delivery, notes (as the
  invoice's never-printed `internalNote`), hide-rates, source and item plating. Until then exchange and advances were one
  lumped "Advance from Order" payment. Re-saving an invoice from the cart keeps `sourceOrderId`, Shopify links and source
  (`INVOICE_PROVENANCE`). Payments can also be taken in the cart as the invoice is written (`generateInvoice(…, payments)`).
- **An order's advance method is optional, and a refused save is never silent** (2026-09-28, owner: "paid by how? causing
  issue when not specified"): an order saved without an advance stores `advanceMethod: null` (the edit path clears it that way),
  and the form's `.optional()` refused null on the next edit — with no message under the field, so Update order simply did
  nothing. The schema is `.nullish()`, the edit form never seeds a null, the method is written only with an advance and only
  when one was chosen (the invoice's payment then prints "—" for it), the placeholder says "Not recorded", and `onInvalid` on the
  order form toasts the first refusing field by name, since its sections fold away.
- **Exchange is one line** (2026-09-26, owner: "a general exchange without details like just description and cash amount …
  make it super simple"): each exchange row in the order form and the cart is what it is + the amount; "+ Weight & rate" folds
  open grams and rate (and karat only where `defaultMetal` is gold). Labels say "Exchange", not "Exchange gold".
- **A walk-in sale makes no customer** (2026-09-29; Taheri's book had 17 "Walk-in Customer" records, most left behind when the
  counter billed first and edited the real name in afterwards). `src/lib/walk-in.ts`, tested: the invoice goes out with **no
  `customerId`** (like a walk-in order) and "Walk-in Customer" as its name; generateInvoice makes a customer only for a real name
  (`shouldCreateCustomer`). A typed name or number is still a person and a new customer, **except a number already on file**: then it
  is that customer (same name or none typed; a number shared by people of different names is left alone), so typing instead of tapping
  no longer copies anyone. A picked old "Walk-in Customer" is read as a walk-in, so re-saving its invoice lets go of it. Readers:
  Analytics keys every walk-in (no id, the placeholder name, or an old walk-in record) as one row (`saleCustomerKey`); **Hisaab shows
  `entityId: 'walk-in'` balances as one "Walk-in Customer" row** (it used to drop them — they only showed because each had a record
  of its own), its invoices linked; its sync never name-matches the placeholder; the customer picker, voice and both scanners skip
  placeholder records. Cleanup that day: the 5 records nothing pointed at went to Recently removed; 11 are the customer of the invoice
  that made them (INV-000021 and INV-000042 still owe 39,000 under them) and one is a voice alias's target, so 12 stay. Mina has 11 too
  (not touched).
- **From the website → Instagram story** (2026-09-26): the square site photo whole on the house's ground with its mark, name and
  metal · weight (`src/lib/social/site-story.ts`), posted through `/api/instagram/story` when connected, else the share sheet.
- **Retouch** (2026-09-26, owner: "photo retouching … jewelry and background and photo … magnific api open ai model image", then
  "magnific only", then "magnific api should use open ai image gen"; Post a Piece and Add Photos): op `retouch` on
  `/api/website/post/ai` → `src/lib/social/retouch.ts`, all on the **Magnific API** (one key): GPT Image 2.5 Edit (OpenAI's model,
  `sunburst` variant, quality high; square photos at 2k, others 1k with `auto` to keep their shape) cleans piece, background and
  light with the piece pinned (and removes tags when "remove tags and strings" is ticked), then Magnific Precision only when the
  edit came back under 2000 px — a bonus: its queue can stall, and then the GPT result is kept. Then the usual "same piece?" check.
  Key `magnific-api-key` in each project's Secret Manager (created 2026-09-26; App Hosting compute account: accessor + viewer),
  read at runtime. GPT Image ≈ 55 s. Add Photos: Retouch / Original (undo) per photo. Locally the key is in `.env.development.local`.
- Every dropdown with 7+ options (`Select`, `SearchablePicker`) shows this device's last five picks under **Recent**
  (`src/lib/recents.ts`, localStorage). Items are *moved* up, never duplicated — Radix prints a duplicated selected
  value twice in the trigger. Lists that change over time carry a `recentsKey`; the karigar picker opts out (it ranks itself).
- **Ads** (`/ads`, 2026-09-26; owner: "connect my Ad account api and have all ad related functionality for both
  @collectionstaheri and @houseofmina__ on each respective pos"): Overview (spend, reach, results vs the period before, day by
  day, top ads, age/gender · placement · region, flagged ads), Campaigns (tree with run/pause switches, budget, end date,
  audience, rename, duplicate, archive, delete, Meta's previews and review notes), New ad, Audiences, Rules, Setup. Owner's
  answers: **open like the rest of the POS** (no sign-in to spend), and **ad spend stays out of the books** (no expenses,
  not in Analytics). One Meta app for both houses (`META_APP_ID` 1075984878628188 in the base yaml, the same app Taheri's
  Instagram stories use); each POS connects its own Facebook login (`/api/ads/connect` → `callback`, redirect
  `https://<pos>/api/ads/callback` registered with the app) and keeps the token in **its own project's** Secret Manager
  `meta-ads-token` (runtime account: accessor + version adder; a system-user token pasted raw also works); the app secret is
  read at runtime from `meta-app-secret`, so neither is declared in the yaml and a missing one is a Setup step, never a
  failed rollout (`src/lib/secret-manager.ts`). Ad account / Page / Instagram chosen on Setup (`app_settings/meta_ads`);
  `META_ADS_INSTAGRAM` per house picks the house's own account and flags the other house's; every object route checks
  the object is this house's ad account. **Meta needs a Facebook Page behind every new ad** (even Instagram-only) — reading
  and running existing ads needs none. New ads (`src/lib/ads/plan.ts`, tested): goals WhatsApp chats, Instagram messages,
  website visits, profile visits (least documented), engagement (existing posts only), reach; one campaign → one ad set →
  one ad, created paused and switched on bottom-up only if asked, the half-made campaign deleted on any failure
  (`create.ts`); `is_adset_budget_sharing_enabled: false` (required since v24); `targeting_automation` always sent
  (Advantage+ fixes age_max 65 and a firm age_min ≤ 25; the asked range goes in as `age_range`); no Explore placement
  (v26 refuses it). **Photos are never changed by Meta:** every Advantage+ creative feature is `OPT_OUT`
  (`NO_ENHANCEMENTS`; an unknown key Meta rejects is dropped and retried). Audiences: POS customers by segment
  (all / bought / last year / lapsed), SHA-256 on the server (`audience-rows.ts`, tested), Instagram engagers, lookalikes.
  Rules are Meta's own automated rules (`adrules_library`). Every change is logged in Firestore `ads_log` (shown on Rules).
  Not yet run against the live API when shipped — field names come from Meta's v25/v26 docs; errors show Meta's own words.
  **The Ads helper** (2026-09-27, owner: "an ai helper in the ads account tab … context from the ad account … float around in
  the ads tab only and use gemini latest pro model"): a floating button on every Ads page only (`src/app/ads/layout.tsx` →
  `assistant.tsx`; above the voice button; bottom sheet on a phone), chat kept per device (`taheri_ads_chat`), following the
  page's range. `/api/ads/assistant` → `src/lib/ads/assistant.ts`: a snapshot of the account for the range (totals vs before,
  daily, every campaign → ad set → ad with results, top ads, age/gender · placement · region, flagged ads, audiences, rules,
  `ads_log`) in the system prompt, plus two **read-only** tools (`get_insights` any range/level/breakdown, `get_details`);
  `chatTurn` in `social/ai.ts` sends Gemini 3's signed tool calls back unchanged. Billed like Post a Piece's AI
  (`IMAGE_AI_PROJECT`, Murtaza's; locally his ADC). Model: `ADS_AI_MODEL`, else **gemini-3.5-pro**, else 3.1 Pro — 3.5 Pro's
  card exists but the project gets 404 (2026-09-27), so it answers with `gemini-3.1-pro-preview` (~20–30 s) and moves up by
  itself when access opens. Capped `ADS_AI_DAILY_CAP` (200) a day + 40/h per caller.
  **Everything visible, and in Ads Manager** (2026-09-27, owner: "all ad sets / pic / ads / creatives should be easily visible and
  appear on ad manager"): the ERP makes ordinary objects in the ad account, so they are in Ads Manager (uploads in its media
  library) by nature; every row and card has **Open in Ads Manager** (`adsManagerUrl`, tested). Campaigns opens with every
  campaign and ad set unfolded (Fold all / Open all) and 64-px pictures, and has an **Ads & pictures** view: every ad as a card
  with its picture (the creative's `image_url`, or a 480-px `thumbnail_url` for boosted posts and videos), words, button, place,
  numbers, run/pause. New ad → New photos can reuse any picture already in the account (`/api/ads/library` → `act/adimages`).
  **Improvements of 2026-09-27** (owner: "add any improvements to the ads manager"): **Needs a look** on the Overview
  (`src/lib/ads/attention.ts`, pure, tested — the account on hold or near its spending limit, nothing running, rejected /
  flagged, spent 2 days' budget with no result → *Pause*, cost per result 2.5× the account's median, frequency ≥ 3, learning
  limited, ending within 3 days, a paused ad set that was cheaper than what runs → *Run again*; bad → warn → tip), the
  **month's pace** line (spent so far → projected, vs last month), **▲▼ against the period before** on every campaign row
  (`campaignTotals`), the gallery's **sort** (spent / results / cheapest result / click-through / name) under the same status
  filter, **Make one like this** on any ad (`/api/ads/template?ad=` → New ad `?from=`: same photos by hash or the same post,
  words, button, link, audience, budget), and the **daily WhatsApp ads summary** (`src/lib/ads/digest.ts`, tested; task
  `ads-daily` in `/api/notifications/run`; Cloud Scheduler `ads-daily-summary` 09:30 Asia/Karachi in **both** projects, at the
  hosted.app addresses, Bearer `CRON_SECRET`; sent only when Settings → Notifications → **Ads Summary** (`notifAdsDaily`) is
  on — ships off). The Ads helper's snapshot carries the same attention list.
  **Connecting needs, in the Meta app** (all hit on 2026-09-26): App domains `taheri.shop` + `houseofmina.store` and both
  `…/api/ads/callback` under Facebook Login for Business → Valid OAuth redirect URIs (else "Can't load URL"), and a **login
  configuration** (FLfB → Configurations: User access token + the ads/pages permissions) whose ID is pasted on Ads → Setup
  (`app_settings/meta_ads.loginConfigId`, or `META_LOGIN_CONFIG_ID`) — the app is Business-type and answers a plain `scope` list
  with "Invalid Scopes: ads_management, …". **New ads need the app Live** (2026-09-28): a new ad's photos and words become a post
  the app makes, and Meta runs an app's post only once the app is Live ("…created by an app that is in development mode. It must
  be in public", subcode 1885183) — reading, pausing and ads from an existing Instagram post work in Development mode. `metaError`
  turns that refusal into `APP_NOT_LIVE`; Setup step 1 reads what the switch asks for with the app token (`appLiveReadiness`:
  privacy policy URL, category, a real icon — Meta exposes no mode field) and gives the values (`APP_PAGES`: taheri.shop's
  `/privacy` and `/data-deletion`, `META_APP_PRIVACY_URL` / `_DATA_DELETION_URL` to change them).
- **Ad studio** (`/ads/studio`, an Ads tab; both houses — `NEXT_PUBLIC_STORE_AD_STUDIO` (Mina "1" since the evening of 2026-09-29); 2026-09-29, owner: "a curated
  ad analysis guide + maker + competitor searcher + builder for just taheri … assessing all images from taheri.shop and from my
  google drive … recommend, fix, assess and build + help create like in canva ad creatives"). Sections are `?v=`:
  **Picks · Library** — every taheri.shop photo (`getSitePieces`) and every image in the Drive folders shared with the server's own
  service account (`lib/ads/studio/drive.ts`: `sharedWithMe`, walked recursively, logos kept aside, HEIC → JPEG, cached 10 min;
  `/api/ads/studio/image` serves any of them). Each is assessed once by the vision model (`assess.ts`, **ten photos a call** at 640 px
  — the Vertex key's per-minute quota made one a call a day's work; `/api/ads/studio/assess` runs ~200 s slices while the page is
  open, capped `AD_STUDIO_DAILY_CAP` 400 calls) into `ad_assets` (`assessment.ts`, tested: score, fit per 1:1/4:5/9:16, quality,
  burned-in text, brand risks, fixes, a headline); `rankForAds` makes the picks. A photo's sheet runs its fixes through Post a
  Piece's `/api/website/post/ai` (extend 4:5/9:16, clear labels, enhance, retouch, new setting — each checked "same piece?"),
  chaining on the version shown. **Make** — Post a Piece's `SoloEditor` + designer on a Meta frame (`templates.ts`: 4:5, 1:1,
  9:16, 1.91:1 drawn 1080×565 and exported 1200×628; six layouts in the vault's dress; stories keep words, piece and mark between
  the top 14% and bottom 35%, which are shaded). **taheri.shop's photos carry a burned-in wordmark**, so the layouts add none to
  them (`photoMarked`) until an edit that clears labels (the check flagged the double mark on the first run). AI words
  (`/api/ads/studio/copy`, `breaksHouseRule` drops any karat, weight, price, "shop now", hashtag or number after the model), a
  pre-flight check (`/check`: the rules one by one, craft, fixes, and the sacred days the run would cross — decided by
  `calendar.ts`, not the model), then **Use it in a new ad**: `/api/ads/images` + `ad_studio_creatives`, and `/ads/new?studio=<key>`
  reads the picture and words from sessionStorage (`lib/ads/studio/handoff.ts`). **Competitors** (`research.ts`, `ad_competitors`):
  found by Gemini with Google Search (flash model, low thinking — the pro model spent 3 min thinking and ran out of tokens),
  looked up by **Instagram Business Discovery** through the house's own connection (public business/creator accounts only, kept a
  day), read by the model from their best and weakest posts; their ads are a link to the public Ad Library (Meta's API has no
  commercial ads for Pakistan). **Guide** — the ad days (`calendar.ts`, tested: `islamic-tbla` in Karachi matches the vault's
  2025 anchors; Ashara 1–10 Moharram + 5 days before, both Eids, the Mazoon's birthday, Ghadeer + 1 day before; the lunar 1st
  quiet; Urs/Dawat dates are not in the vault and not guessed), **what the account's own ads say** (last 180 days, cheapest vs
  dearest results by `splitWinners`, pictures to the model; `app_settings/ad_studio_winners`), the playbook (`playbook.ts`) and the
  vault's rules (`brand.ts` — every studio prompt carries `brandBrief()`; kept in code on purpose so an Obsidian edit can't change
  what the model approves). Studio AI calls other than assessing are capped `AD_STUDIO_AI_DAILY_CAP` (200) + 60/h per caller.
  **Drive needs two owner steps** (the Setup card on Picks says so): enable `drive.googleapis.com` in gemstrack-pos, and share
  "taheri content", "TC" and the Vault's logos with `firebase-app-hosting-compute@gemstrack-pos.iam.gserviceaccount.com` (Viewer;
  `claude-cloud@` too for cloud sessions). Nothing ever writes to Drive. Business Discovery and the winners reading were not run
  live when shipped (they use the Meta token); the search, assessing, fixes, words and check were.
  **Rules changed by the owner** (2026-09-29: "all are incorrect now, i have zero issues with these"): **prices, karats, weights,
  carats, grading and direct calls to action ("Shop now", phone numbers, urgency) are allowed in ads.** What replaces them is
  accuracy: `inventedFigures` (prompts.ts, tested) drops any AI line with a figure the ERP didn't give, and the check lists them;
  still blocked: sale/discount language and hashtags (`breaksHouseRule`), the sacred-date rules, "investment" for diamonds, bridal
  copy. Each website photo carries its **specs line** from the ERP (`specs.ts`, tested: tagged karat/metal, stone, weight) — every
  layout prints it under the headline (an empty line takes no room) — and the owner may type a price. The vault in Drive still
  states the old rules; `brand.ts` is what the studio follows.
  **The logo:** taheri.shop's files have the wordmark burned in. Drive holds the same frames unmarked under the camera name
  (site `DSC09342.webp` = Drive `DSC09342.JPG` / `DSC09342-retouched 2.png`), so `originals.ts` (tested) matches them and the sheet
  and the maker start from the Drive original (retouched first) — no AI erasing. Without one, **Remove the logo** in the maker is
  one tap (enhance with tidy). The Drive listing keeps a failure 30 s only (it once held "API disabled" for 10 minutes after the
  owner had enabled it); the Drive card has "check again".
  **Make it with AI** (owner: "it should just make an ad creative using ai and the photo/details"): `/api/ads/studio/auto`
  op `direct` — the art director picks the layout and writes kicker/headline/CTA and the ad's texts from the photo + the ERP's
  specs (never repeating the specs line), while the photo is cleaned or extended to the frame in parallel; the maker lays it out
  and runs the check (≈30 s + the check). Op `paint` — Nano Banana paints the whole ad around the photographed piece, then the
  lettering is read back and the piece compared ("same piece?"); on the first run it redrew the stones and the check caught it,
  so the prompt now forbids re-rendering the piece and a flagged one says "Use it anyway".
  **Assessing runs in the background** (owner: "should run in the background"): `assess-run.ts` — one slice runner with a lease in
  `app_settings/ad_studio_assess` (so the tick and the page never double-pay), paced 12 s between batches because the Vertex key's
  per-minute quota is shared with the counter. It rides the existing **`social-queue-tick`** (every 5 min, 300 s deadline) after
  the queue's own work — this session can only view Cloud Scheduler, not create a job; a dedicated `ad-assess-tick` job would be
  cleaner. Pause/resume and "Assess now" on the page. ~350 photos an hour.
  **The whole scene** (owner, 2026-09-29: "target whatsapp channel/insta/dm/whatsapp/website the full scene", after research by
  two agents that day — the houses' sites, their Google ads, TikTok, and Meta's docs; `market.ts` keeps the dated findings, shown
  in the Guide): a **Plan** tab of plays (`plays.ts`) by funnel stage — piece at today's price → WhatsApp (always on), WhatsApp or
  Instagram (Meta picks per person), today's gold rate → the WhatsApp channel, Since 1989 → the profile, the piece → taheri.shop,
  investment gold (no making, no wastage), come back (engagers + customers); "Make this" opens the maker set up for it. New layouts
  `rate` (the ERP's rates per tola, rounded to the hundred — `rateBoard`, tested; `/api/ads/studio/rates`) and `investment`. The
  maker has **Where a tap goes** and sends **both sizes as one ad** (the 9:16 version uploaded too). New ad (plan.ts, tested) gained
  goals **`messages`** (`MESSAGING_INSTAGRAM_DIRECT_WHATSAPP`, creative `asset_feed_spec` with `DOF_MESSAGING_DESTINATION`) and
  **`channel`** (Meta has no channel-follow objective: a traffic link ad to `NEXT_PUBLIC_STORE_WA_CHANNEL_URL`), `source.vertical`
  (placement asset customisation: labelled images + `asset_customization_rules`, feed vs story/reels), the WhatsApp welcome message
  in Meta's documented VISUAL_EDITOR shape with three ice breakers (`welcomeMessage`; it was a bare string), website ads on
  `LANDING_PAGE_VIEWS` once `pixelLive`, and a warning when the dates cross the Bohra calendar's quiet days. None of the new
  creative shapes has run against Meta yet (new photo ads wait on the app going Live). **Instagram Business Discovery is refused**
  for the shop ("(#10) Application does not have permission") because the Facebook login configuration lacks `instagram_basic` (found
  by another session the same day — see Setup); the ten researched houses are saved in `ad_competitors` with Instagram and Ad
  Library links and look up once it is added and Meta reconnected.
  Research facts worth knowing: taheri.shop has **no Meta pixel** (nine rival sites do); @collectionstaheri ~2,061 followers
  against 16k–308k; nobody claims the Bohra community; only Fazal and Al Syed show rate × weight.
  **The Ads re-audit** (owner: "reaudit/reorganize/optimize/add new features the ad studio and entire ad bar"): Studio now sits
  before New ad in the tabs (the creative comes first); the Overview has a **readiness strip** (`readiness.tsx`: the app not Live,
  permissions the login lacks, the website pixel) — only what is missing; Setup step 8 is **the website pixel** (`lib/ads/pixel.ts`:
  list/make the ad account's pixels, choose one → `app_settings/meta_ads.pixelId`, "live" = `last_fired_time` within a week, and
  whether the site's HTML loads it); the website reads the id from **`/api/public/pixel`** (CORS, 5 min) so changing it needs no
  site deploy — **taheri.shop does not load it yet** (taheri-site needs the loader); `planContext` passes `pixelLive`, which moves
  website ads to landing-page views. "Make one like this" reads asset-feed ads (both sizes, two apps) and channel links. The Ads
  helper's prompt carries the plays, the house rules and the market gaps (Taheri only, with the studio).
  **House of Mina has the studio too** (owner, 2026-09-29: "after youre done with taheri, do the same thing for houseofmina";
  `NEXT_PUBLIC_STORE_AD_STUDIO "1"` in `apphosting.mina.yaml`). One code path, the house chosen by `STORE_BRAND`: `brand.ts` holds a
  `HouseBrand` per house (Mina's from what the ERP already says in her name — the caption prompts' voice, the link page, the post
  footer, her palette #140B0B / rose #E8A5AE and MINA mark; no vault) with `calendar` (the Bohra quiet days: Taheri only), `banned`
  (Taheri: sale words + hashtags; Mina: hashtags), the competitor brief and the Drive hint; the layouts take the house's colours,
  heritage line ("Since 1989" / "House of Mina") and badge ("HRD Antwerp certified" / "925 Sterling Silver"), and the rate and
  investment layouts are Taheri's only; `plays.ts` has Mina's own (DM or WhatsApp — Instagram-native buyers —, houseofmina.store,
  the catalogue, the men's line, the profile, come back) with the Plan's stages per house; `playbook.ts` and `market.ts` per house.
  Mina's photos are the catalogue's 619, **572 of them with the catalogue's unmarked source** (`source:<id>` assets, Shopify CDN or the
  site's own `catalog-src/` only), and their specs line is "925 Sterling Silver · stones · plating". Mina's Drive needs the same two
  steps in hom-pos (the Drive card names the project and the account).
  **Mina's market** (research of 2026-09-29, `market.ts`): her median piece is Rs 14,000 (Zanvari 23,250, Zumorrud 17,500) with the
  same made-to-order / buy-back / repolish; 164 of 209 Shopify pieces are 21k gold-plated; 4.81★ from 138 reviews; free delivery only
  over Rs 20,000; no Google ads; **the catalogue carries no pixel**; both sites link TikTok to **@houseofmina, a US beauty/fashion
  blog — not hers** (owner, 2026-09-30: "the tiktok isnt hers"): `NEXT_PUBLIC_STORE_TIKTOK_URL` is gone from `apphosting.mina.yaml`,
  so links.houseofmina.store has no TikTok row; the Shopify theme and the catalogue carry their own copy of the link. Her plays: the gold look at the silver
  price (always on), a real review, the Ring Builder (`path` on a play), bangle-and-ring sets, natural ruby for him, the shop, the
  catalogue, the profile, and the promises for come-back.
  **The pixel a site already carries, and Online orders** (2026-09-29): **houseofmina.store already has Meta pixel 1429906491670575**
  through Shopify's Facebook & Instagram app — a web pixel, not `fbq`, so the old check missed it and would have had Mina make a
  second. `pixelState` now reads every site the house sells from (`NEXT_PUBLIC_STORE_SHOP_URL` and the website), finds the pixels
  each carries (`pixel-read.ts`, tested: `fbq('init')` and Shopify's escaped `"pixel_id"`), and what the chosen one received this
  week (`/{pixel}/stats?aggregation=event`). Setup offers the carried pixel first (and says how to share it with the ad account when
  a shop app made it under another business); making a second asks first. New goal **`sales` — "Online orders"**: `OUTCOME_SALES`,
  `OFFSITE_CONVERSIONS` with `promoted_object { pixel_id, custom_event_type: PURCHASE }`, the link defaulting to the online shop;
  New ad says how many orders the pixel saw this week against Meta's ~50 to learn. Results read as purchases
  (`RESULT_FOR_GOAL.OFFSITE_CONVERSIONS`).
  **Post it** (owner: "let me also post any made ads to story/whatsapp channel / community / add it to the website"): the maker's
  `post-it.tsx` sends the made ad the ordinary way — the 9:16 version to the Instagram story (`/api/instagram/story`, or the share
  sheet as its own tap when the house has no connection), the **1:1** version to any of the community's groups and the channel
  (`/api/website/post` with `targets`) and into a website collection (Add Photos' `/api/website/photos`). WhatsApp and the website
  only ever get 1:1 (owner, 2026-09-25).
  **Ad sets** (`/ads/adset`, an Ads tab; owner: "i need to be able to design adsets"): one to six ad sets — each its own name, goal,
  audience and places (the AudienceEditor), budget and dates — into a campaign the account has (its objective limits the goals;
  a campaign holding the budget gives its ad sets none) or a new one, filled with **copies of ads already made** (`/{ad}/copies`
  with `adset_id`) or a boosted Instagram post (a creative per goal). "Another ad set" starts as a copy of the last, so a test
  changes one thing. `lib/ads/adset-design.ts` (tested) builds each ad set with New ad's own `adsetParams`; `/api/ads/adsets`
  checks every object is this house's, and on any failure deletes what it made. Reached from Campaigns (a campaign's "Add ad
  sets", an ad set's "Copy and change", an ad's "Into new ad sets") and New ad's "Test it on another audience".
  **Saved** (Studio → Saved; owner: "an ad container with folders etc where i can store ads and see exisiting ads stored"):
  Make's **Save** keeps the ad — the picture, the photo it is drawn on and the layout document, plus its words, frame, layout,
  goal and link — in Firestore `ad_saved` (+ files in `ad_saved_media`, 900 KB parts; `lib/ads/studio/saved.ts`), in the owner's
  folders (`ad_folders`; deleting one leaves its ads unfiled). "Open in Make" puts it back exactly as left, and Save then writes
  over it ("As new" makes a copy). **In the ad account** lists every ad Meta holds (all time), and any can be kept in a folder
  (its picture and words; `fromAd`). What a save may carry is cleaned by `saved-shape.ts` (tested). Checked end to end in
  headless Chromium on 2026-09-29 (folder → make → save → reopen); the test's folder and ad were deleted after.
  **Less text** (owner: "reaudit/simply and detext/hide text/lessen text noise from the ad studio in general"): measured by the words
  each tab shows (Plan 738 → 246, Picks 889 → 239, Library 1,843 → 527, Make 436 → 194, Guide 1,239 → 511). The rule since:
  a heading or a control names itself; the explanation is its `title` (hover) or behind a fold — no subtitle, no paragraph under
  a heading, tiles show the name only (the model's description and fixes are on hover and in the sheet), a play card shows
  title → destination and its chips (why/who/how much fold), field labels are one word, playbook and rules start folded.
  **Drive, as it stands (read with the owner's Drive connector, 2026-09-29):** only "taheri content" is shared with the runtime
  account — and it is shared with **anyone with the link as an editor** (anyone holding the link can change or delete the shoots;
  the owner should make it Viewer). **TC** is Murtaza's (hmurtaza55@), open to anyone with the link as a viewer, and the owner
  (potatomasta501) isn't an editor on it, so it can't be shared on — the studio now takes **folders by link**
  (`drive-link.ts`, tested; `app_settings/ad_studio_drive.folders`, never in the code since gemstrack-pos is public; the Drive
  card's "add a folder by link", `/api/ads/studio/drive`), and TC (63 photos) was added that way. The Vault's logos
  (Taheri Vault / attachments / logos) are private to the owner and not shared.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` is installed with pipx (`pipx install graphifyy`); `graphify-out/cache/` and the dated backup folders are gitignored, the graph itself is committed.
