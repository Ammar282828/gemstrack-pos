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
  "Taheri (node 20)" (port 3000) / "Mina (node 20)" (port 3001). On Node 26 Google auth fails ("Premature close"). The per-house
  configs drop the second laptop's `GOOGLE_APPLICATION_CREDENTIALS` (`~/.zshrc`, a missing file), which breaks every Google call.
- The app is behind Google sign-in, locally and in **both** houses since 2026-09-30 (Taheri ran
  `NEXT_PUBLIC_OPEN_ACCESS=1` with open Firestore rules from 2026-09-07; owner: "taheri being open to all is a bit
  dangerous"). Don't reintroduce the open-access flag.
- Typecheck: `npx tsc --noEmit -p .`. ESLint's config is broken (v9); the build is the lint gate.

## Configuration and access

- `apphosting.yaml` holds every env var. A `secret:` it declares **must exist in Secret Manager and
  be readable by the three App Hosting service accounts** (mirror `CRON_SECRET`'s IAM) *before* it is
  declared, or the rollout fails. Names are case-sensitive: the upload secret is `website-upload-secret`.
  A variable with `value: ""` also fails the rollout ("either 'value' or 'secret' field is required") — write
  a word the code reads as off (`"none"`, `"0"`).
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
- **A bare 503 is the server dying**, not a route (routes answer JSON): out of memory kills every request on it.
  `gcloud logging read 'textPayload:"Memory limit of"'`. 1 GiB since 2026-10-01 — [why](docs/features/ad-studio.md#out-of-memory).
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
**Push both together, always** (owner, 2026-09-26: "push both together always") — no waiting on Taheri's rollout before
Mina's. Keep `taheri`'s `main` level too: every cloud session starts there. `main` here is the shared working branch (the old
`main` is tag `old-main-2026-06`).

**Running a house locally:** `npm run env:taheri` or `npm run env:mina` writes `.env.<house>.local`
from the YAML files (secrets left blank to fill from Secret Manager), then `npm run dev:taheri`
(port 3000) or `npm run dev:mina` (port 3001). `.env.local` is a hand-kept Taheri file that plain `npm run dev` uses.
Next reads `.env.local` / `.env.development.local` even under `dev:mina` and fills any variable the process lacks, so the
generator writes every variable that isn't the house's as **empty** (Next then leaves it alone). Re-run `npm run env:mina`
after changing either YAML (a stale one gave a local Mina Taheri's menus, 2026-09-25). `.env.local` is Mina's on the second
laptop: when it names another Firebase project, `env:taheri` blanks its variables too (2026-09-26).

## Cloud sessions (claude.ai/code, since 2026-09-27)

Claude Code runs these repos in the cloud too, with no Mac (owner, 2026-09-27).
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
  environment's setup script is `scripts/cloud/environment-setup.sh` (gcloud CLI), pasted into the environment. Network: Full
  (Meta, WAHA, Green API, Shopify, Magnific and the sites are off the Trusted list).
- **Going live:** a cloud session can push only its own `claude/…` branch. `.github/workflows/cloud-deploy.yml` takes any push to
  `claude/**`, merges `main`, `taheri-next` and gemstrack-pos `main` into it, runs the typecheck and tests, and pushes the result
  to `main` + `taheri-next` here and to gemstrack-pos `main` (a write deploy key there; its private half is this repo's Actions
  secret `HOM_DEPLOY_KEY`): both houses at once, **with no review** (owner, 2026-09-27). A conflict or a failed check stops
  it before any push; nothing is force-pushed. taheri-site and mina-catalogue have their own `cloud-deploy.yml`. In a cloud
  session: commit, push the branch, watch the run; on a conflict, rebase on `origin/main` and push again. "Run workflow" is a dry run.
- **Mac only:** SSH to Hostinger (the sites deploy through Actions), Google sign-in to a local ERP (typecheck, tests and the
  gate's `?dev=1` work here), the Mac's memory files (this file is the handoff), GoDaddy / Hostinger API tokens.

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
- **Taheri's Firestore is open until the owner publishes `firestore.rules`** in the Firebase console (never the CLI from here): see [Taheri sign-in](docs/decisions.md#taheri-sign-in).

## Where the rest is written down

- How taheri.shop, the Mina catalogue and the ERP talk (every `/api/public/*` and website route), and WhatsApp through WAHA: `docs/features/site-and-erp.md` (runbook `ops/waha/README.md`).
- House of Mina's catalogue (catalogue.houseofmina.store): `docs/features/mina-catalogue.md`.
- In progress (website edits, Meta app settings, Meta's Ads connector) and open items: `docs/in-progress.md`.
- The AI copies and a proposed merge: `docs/ai-merge-proposal.md`.

## Decisions already made (don't reopen unless asked)

One line each; the text is in `docs/decisions.md` and `docs/features/`. Add a new decision there and a line here.

**Navigation and the look**
- [The map](docs/decisions.md#the-map) — the sidebar rows, the one tab row per screen, and `lib/nav.ts` as the only registry
- [The name ERP](docs/decisions.md#the-name-erp) — ERP in every word people read; Shopify codes and code names stay POS
- [Number fields](docs/decisions.md#number-fields) — and sale-flow fields show 0 as blank
- [Hooks](docs/decisions.md#hooks) — the `/orders/add` crash of 2026-09-22
- [Fonts](docs/decisions.md#fonts) — every face in `src/fonts/`, `next/font/local`
- [Light and dark](docs/decisions.md#light-and-dark) — the device's choice wins; `theme-default` set outside React
- [Recent picks](docs/decisions.md#recent-picks) — last five per device

**Home and the day**
- [Dashboard](docs/decisions.md#dashboard) — four figures, Needs you, Due to customers, Recent sales; no buttons
- [Rate chip](docs/decisions.md#rate-chip) — the rate chip; the cart writes back only a new invoice's typed rates
- [One screen per question](docs/decisions.md#one-screen-per-question) — `lib/owed.ts`, Today's cash, the karigar's Now

**Selling: invoices, orders, repairs**
- [Drafts](docs/decisions.md#drafts) — only a new order or sale is drafted, in Firestore `drafts`; `finish()` on save
- [Order actions gate](docs/decisions.md#order-actions-gate) — it moves money
- [Wastage in grams](docs/decisions.md#wastage-in-grams) — the workshop slip keeps the percentage
- [Repairs](docs/decisions.md#repairs) — a ticket of many pieces; In the shop → Ready → Collected; money to Extra revenue
- [Invoice pages](docs/decisions.md#invoice-pages) — the viewer never touches the cart; `/cart` redirects; `/view-invoice/<id>` is the customer's
- [Invoice PDF](docs/decisions.md#invoice-pdf) — `saveInvoicePdf`, per-piece printing
- [Exchange rows](docs/decisions.md#exchange-rows) — `exchanges`, with the old totals kept
- [Order to invoice](docs/decisions.md#order-to-invoice) — advances as payments, exchange, discount, notes
- [Orders hub](docs/decisions.md#orders-hub) — by stage, a next step per card; pieces set status
- [Name a sale](docs/decisions.md#name-a-sale) — on the invoice, no re-price
- [Advance method](docs/decisions.md#advance-method) — `.nullish()`, `onInvalid` toasts
- [Exchange line](docs/decisions.md#exchange-line) — what + amount
- [Walk-ins](docs/decisions.md#walk-ins) — `lib/walk-in.ts`; one walk-in row everywhere
- [Saves are one trip](docs/decisions.md#saves-are-one-trip) — one commit per save; photos in `order_photos`

**Money and analytics**
- [Lac and crore](docs/decisions.md#lac-and-crore) — `lib/money.ts`
- [Exchange as cash](docs/decisions.md#exchange-as-cash) — in Cash In and in revenue (`invoiceSaleValue`)

**People and sign-in**
- [Add photos sign-in](docs/decisions.md#add-photos-sign-in) — superseded 2026-09-30: every house signs in
- [Taheri sign-in](docs/decisions.md#taheri-sign-in) — `NEXT_PUBLIC_STORE_OWNER_EMAILS`; locked `firestore.rules` for the owner to publish; invoice share keys
- [Signed-in defaults](docs/decisions.md#signed-in-defaults) — `NEXT_PUBLIC_STORE_PEOPLE`; Taken by and the Orders/Invoices/Workshop filters
- [Karigar sign-in](docs/decisions.md#karigar-sign-in) — in-app browsers; `[sign-in]` in the log
- [Delete code](docs/decisions.md#delete-code) — every delete asks; the server checks it

**The website and copy**
- [Customer copy](docs/decisions.md#customer-copy) — never "Najmi Market" or "Saddar"; the hours
- [Weight preview](docs/decisions.md#weight-preview) — the overlay tool's Futura geometry
- [Shop outage](docs/decisions.md#shop-outage) — the hosted.app address still works

**Liquid Glass** (`docs/features/liquid-glass.md`)
- [Liquid Glass](docs/features/liquid-glass.md#liquid-glass) — Settings → Appearance; Apple HIG glass on the control layer only (`ui-glass`)

**AI: the key and the scanners** (`docs/features/ai.md`)
- [Vertex AI key](docs/features/ai.md#vertex-ai-key) — `vertex-ai-key` in gemstrack-pos Secret Manager, read at run time; tiny per-minute quota
- [Scanners](docs/features/ai.md#scanners) — wastage in grams, weight before stones, the bill's rate and discount; never 3.8-flash
- [Voice](docs/features/ai.md#voice) — live words; every part editable; anything, several steps

**Post a piece and its tools** (`docs/features/post-a-piece.md`)
- [Post a piece drafts](docs/features/post-a-piece.md#post-a-piece-drafts) — on this device (IndexedDB), photos included; resumes
- [Post a piece](docs/features/post-a-piece.md#post-a-piece) — story, square, caption from one piece → site, WhatsApp, Instagram; [Paint](docs/features/post-a-piece.md#paint)
- [Checks](docs/features/post-a-piece.md#checks) — each dependency tested live, with its fix
- [Story editor](docs/features/post-a-piece.md#story-editor) — the layer document and its editor
- [Square only](docs/features/post-a-piece.md#square-only) — the square editor and SVG marks
- [Designer](docs/features/post-a-piece.md#designer) — Canva-style, phone first
- [Story and post](docs/features/post-a-piece.md#story-and-post) — Story + post / Story only / Post only; five numbered steps
- [Website photos](docs/features/post-a-piece.md#website-photos) — site photos as ordinary photos in Post a piece
- [Queue and Mina](docs/features/post-a-piece.md#queue-and-mina) — per-destination ticks, the queue and its tick, Mina's community
- [Maisons](docs/features/post-a-piece.md#maisons) — house + official name; never priced by the gram
- [Retouch](docs/features/post-a-piece.md#retouch) — Magnific (GPT Image) + Precision, then the same-piece check

**WhatsApp reports and the monthly PDF** (`docs/features/notifications.md`)
- [WhatsApp reports](docs/features/notifications.md#whatsapp-reports) — `app_settings/global` by name; daily; [PDFs only](docs/features/notifications.md#pdfs-only)
- [Monthly PDF](docs/features/notifications.md#monthly-pdf) — Analytics' rules; Analytics → Monthly PDF, and the 1st by WhatsApp

**Posts** (`docs/features/from-the-website.md`)
- [Hub](docs/features/from-the-website.md#posts-hub) — `/posts`: Today, queue, site pieces in batches
- [From the website](docs/features/from-the-website.md#from-the-website), [its story](docs/features/from-the-website.md#site-story) — the card

**Investments by Taheri** (`docs/features/investments.md`)
- [Investments](docs/features/investments.md#investments) — the routine files it; the page and the schedule send it

**Edit a piece** (`docs/features/edit-a-piece.md`)
- [Edit a piece](docs/features/edit-a-piece.md#edit-a-piece) — edit any site piece from its original; the sites keep the change

**The link page** (`docs/features/links-page.md`)
- [Link page](docs/features/links-page.md#link-page) — `/links`, server-rendered, Just in, share previews

**Ads** (`docs/features/ads.md`)
- [Ads](docs/features/ads.md#ads) — Meta ad account per house; Overview, Campaigns, New ad, Setup; the helper

**Ad studio** (`docs/features/ad-studio.md`)
- [Ad studio](docs/features/ad-studio.md#ad-studio) — eight tabs, both houses; [any shape](docs/features/ad-studio.md#any-shape)
- [Board](docs/features/ad-studio.md#board) — designs and notes on an endless canvas, Let it cook, an agent over MCP (`/api/studio/mcp`)

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — they walk the graph's edges
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` is installed with pipx (`pipx install graphifyy`); `graphify-out/cache/` and the dated backup folders are gitignored, the graph itself is committed.
