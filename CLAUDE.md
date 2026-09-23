# taheri-shop — the POS for both houses

Next.js point-of-sale serving **two shops from one codebase**:

| House | Live at | Firebase project | Backend / environment | Deploys from |
|---|---|---|---|---|
| Taheri (gold and diamond) | pos.taheri.shop | `gemstrack-pos` | `studio` / `taheri` | branch **`taheri-next`** of this repo |
| House of Mina (silver) | pos.houseofmina.store | `hom-pos-52710474-ceeea` | `studio` / `mina` | branch **`main`** of repo **gemstrack-pos** (remote `hom`) |

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

- **Node 20**, not the Mac's default: launch config "POS (node 20)" (`PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev`, port 3000). On Node 26 the Google auth library fails ("Premature close").
- The app is behind Google sign-in locally; production runs `NEXT_PUBLIC_OPEN_ACCESS=1` (the owner's
  choice since 2026-09-07, paired with open `firestore.rules`; `firestore.rules.locked` holds the real rules).
  Don't reintroduce the open-access flag for local checks — ask the user to sign in on the preview.
- Typecheck: `npx tsc --noEmit -p .`. ESLint's config is broken (v9); the build is the lint gate.

## Configuration and access

- `apphosting.yaml` holds every env var. A `secret:` it declares **must exist in Secret Manager and
  be readable by the three App Hosting service accounts** (mirror `CRON_SECRET`'s IAM) *before* it is
  declared, or the rollout fails. Names are case-sensitive: the upload secret is `website-upload-secret`.
- Firebase CLI login is broken on the owner's Mac. Use **`gcloud`** (authenticated as the owner):
  `gcloud secrets …`, `gcloud builds list`, `gcloud run revisions list` — all `--project gemstrack-pos --region us-central1`.
  Never print a secret value; compare `sha256` of trimmed values instead.
- Hostinger (the site's server) is reachable over SSH with the deploy key `~/.ssh/taheri_deploy`
  (port 65002, user in `taheri-site/.github/workflows/deploy.yml`). **The key exists only on the owner's Mac** —
  on another device use hPanel or copy the key deliberately.
- The owner is a Firebase/GCP Owner but lacks `iam.serviceAccounts.signBlob`, so `createCustomToken` fails from a laptop;
  test storage layers directly (`npx tsx`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=gemstrack-pos`).

## How the site and the POS talk

| Route | Who calls it | What it does |
|---|---|---|
| `/api/public/quote`, `checkout`, `order/:id` | taheri.shop | prices at today's rate; bank-transfer checkout; the customer's order page (token link) |
| `/api/public/featured` | taheri.shop | the set of the day (`app_settings/website_featured`), cached 60 s |
| `/api/public/me` | taheri.shop, Bearer Firebase ID token | the customer's record: profile, favourites, orders (`website_customers/{uid}`) |
| `/api/website/photos` | POS page Add Photos | relays a photo to `taheri.shop/api/upload.php` with `WEBSITE_UPLOAD_SECRET`; HEIC → JPEG on the way |
| `/api/website/pieces` | POS page Photo Weights | counter-entered weights (`website_pieces`) for photos with no burned-in label |
| `/api/website/featured` | Photo Weights / Add Photos | set or clear the set of the day |
| `/api/website/orders/[id]` | POS order page | mark paid / shipped — **always verifies a token, even under open access** |

CORS for `/api/public/*` is in `src/lib/website/cors.ts` (taheri.shop, www, and localhost:5180 in dev).
Design and go-live checklist: `docs/website-checkout.md`. Go-live of online selling is still blocked by empty
bank env vars and the open Firestore rules.

## Two houses, one codebase — the rules

- **Every difference between the shops is a variable, never a fork of the code.** The code's
  defaults are Taheri's. `apphosting.yaml` holds only what both houses share; `apphosting.taheri.yaml`
  and `apphosting.mina.yaml` hold everything that differs and are applied by App Hosting on top of the base
  for the backend whose environment name matches (an override can add or replace a variable, never remove one —
  so nothing goes in the base that only one house wants). Mina's file states every value its old fork had
  baked into code; leave one out and Mina comes up wearing Taheri's name.
- What the variables drive: `src/lib/store-config.ts` (name, contacts, bank, links, allowed emails,
  default metal, margin, **brand**, logo and its aspect, **counter staff** for "Taken by"); `globals.css`
  (`.dark .brand-mina` is Mina's maroon dark palette; Taheri's is the plain `.dark`); `layout.tsx`
  (brand class, theme-colour, links host); `app-layout.tsx` (the Website menu exists only when
  `NEXT_PUBLIC_STORE_WEBSITE_URL` is set; **Shareholder Finances** and "paid by Mina/Ammar" on an expense only when
  `NEXT_PUBLIC_STORE_PARTNERSHIP=1` — Mina's partnership book, whose ledgers live in Mina's Firestore);
  `voice/gemini.ts` (`VERTEX_PROJECT` bills Mina's voice to Taheri's project); the Website menu's **Photo Weights**
  and Add Photos' **Feature today** follow `NEXT_PUBLIC_STORE_WEBSITE_WEIGHTS` / `_FEATURED` (default on; Mina's
  catalogue has neither, so its file sets both to "0" at go-live).
- A `secret:` in the base must exist in **both** projects; one in a house file only in that project.

**Shipping a change to both houses:**
```
git push taheri main:taheri-next     # Taheri rolls out (~5 min)
git push hom main:main               # House of Mina rolls out
```
Push Taheri first, check it, then Mina. `main` here is the shared working branch (the old dead
`main` is kept as tag `old-main-2026-06`). `website-checkout` is retired.

**Running a house locally:** `npm run env:taheri` or `npm run env:mina` writes `.env.<house>.local`
from the YAML files (secrets left blank to fill from Secret Manager), then `npm run dev:taheri`
(port 3000) or `npm run dev:mina` (port 3001). `.env.local` is a hand-kept Taheri file that plain `npm run dev` uses.

## House of Mina's catalogue (catalogue.houseofmina.store)

A separate site in its own repo, **mina-catalogue** (`~/Projects/mina-catalogue`, github.com/Ammar282828/mina-catalogue,
private) — built 2026-09-23; read its CLAUDE.md. It publishes `catalog-tree.json`, and `/api/website/photos` reads a
site's own tree before anything else (taheri.shop publishes none, so Taheri's picker is unchanged).
**Live on the server since 2026-09-23** (Hostinger website created through the Hostinger API on the Business plan,
order 1008754559, beside taheri.shop; first deploy shipped 2,319 files). Mina's `apphosting.mina.yaml` carries the
website variables and `WEBSITE_UPLOAD_SECRET` (hom-pos Secret Manager, same value as
`~/domains/catalogue.houseofmina.store/.website-upload-secret`; sha256 prefix `c6701cb1`). DNS was added through the
GoDaddy API (`A catalogue → 145.79.26.82`; houseofmina.store's DNS stays at GoDaddy) and Hostinger issued the
certificate itself; the site is **live over HTTPS** and Mina's Add Photos reads its 18 collections from it.
`KNOWN_TREE` in the photos route is taheri.shop's folder list and is only ever offered for that origin.

## Open items after the reconvergence (2026-09-22)

- `NEXT_PUBLIC_STORE_TAKEN_BY` in `apphosting.mina.yaml` is a guess (Mina, Ammar, Murtaza) — Mina's fork never had
  "Taken by". Ask the owner for Mina's counter names and correct it.
- `website-checkout` is retired but not deleted; delete it once nobody has it checked out elsewhere.
- Mina's `firestore.rules` and Taheri's differ (Taheri's are open); App Hosting does not deploy rules, so each
  project keeps whatever was last deployed with the Firebase CLI.

## Decisions already made (don't reopen unless asked)

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
- In a component, no hook after an early `return` (the `/orders/add` crash of 2026-09-22 was exactly that).
- **One invoice PDF builder**: `src/lib/invoice-pdf.ts` (`saveInvoicePdf`) draws the customer's copy for the invoices list,
  the cart's post-sale screen and `/view-invoice`. `perPiece` prints a multi-piece invoice as one invoice per piece on its
  own page ("Piece 2 of 3"); discount, exchange, adjustments and paid are shared pro rata by piece price, the last piece
  absorbs rounding, payment history is left off the pieces. The split button is `components/shared/print-button.tsx`.
- Every dropdown with 7+ options (`Select`, `SearchablePicker`) shows this device's last five picks under **Recent**
  (`src/lib/recents.ts`, localStorage). Items are *moved* up, never duplicated — Radix prints a duplicated selected
  value twice in the trigger. Lists that change over time carry a `recentsKey`; the karigar picker opts out (it ranks itself).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` is installed with pipx (`pipx install graphifyy`); `graphify-out/cache/` and the dated backup folders are gitignored, the graph itself is committed.
