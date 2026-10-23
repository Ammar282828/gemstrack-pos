# Decisions already made

Don't reopen these unless the owner asks. Each is kept as it was written in CLAUDE.md, under a heading so the index can link to it.

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

## Navigation and the look

### The map

- **The map** (the audit of 2026-10-01, which reopened the sidebar, Settings, Analytics and Ads decisions; the rows are
  the ones people learned — what changed is underneath). **One registry, `src/lib/nav.ts`:** the sidebar, the top-bar
  tabs, the Ctrl+K palette (same role rule and house flags) and `PageShell`'s headings all read it; `nav.test.ts` fails when
  a page under `src/app` is in no entry, an entry has no page, or two rows of a group share a name. Add a page there or it
  is nowhere. **One tab row per screen** — no in-page `Tabs` under the top bar's. **Grouped tabs** (2026-10-23, the owner: "why are some analytics
  somewhere and other analytics in other places. make the analytics page one where all analytics live under sub sections …
  do this for any other sections that might need it"): a tab may name a `section`; the bar's row is then the sections
  and the lit section's own pages are one segmented row at the top of the page. **Analytics** (beside Home) holds every
  report: Sales (the books' five pages), Website (Visitors and Live, was Website → Interest), Social (Instagram and Facebook,
  was the Insights row), Ads (Ad results, was Ads → Overview; Ads keeps running them). Addresses unchanged. Staff see
  Website; the marketing account Website, Social and Ads (tabs marked `marketing`). **Settings**: Shop (Shop, Bank accounts,
  Alerts), Connections (Integrations, Connect an AI, Voice), Records (Data, Activity); the phone's index uses the same headings. **On a phone** (2026-10-10, the owner:
  "too cluttered on my phone with a weird tab bar on the top") the bar is menu · rate chip · search, and the tabs are their
  own full-width segmented row under it (up to three share the width; more scroll, the page's centred); light/dark moves
  into the menu's footer. From md the tabs sit beside the menu as before. Sticky toolbars use `--app-header-h`.
  **Home's New** (same day; since the app-matching shell, 2026-10-12): a floating mic and "+" above the phone tab bar
  (`components/layout/create-menu.tsx`, `tab-bar.tsx`) open New invoice / New order and the rest; the old
  `new-bubble.tsx` is gone. The sidebar's New sale keeps repair, scan a tag, read a bill.
  ```
  [Search ⌘K] [New sale: Invoice · Order · Repair; Scan a tag · Read a written bill · Scan a parchi]   top bar: rate chip
  Home        Dashboard · Calendar · Today’s cash (owners)
  SALES       Orders · Invoices · Repairs · Customers · Drafts (count)
  WORKSHOP &  Workshop (Jobs · Karigars · Given items) · Stock (Pieces · Add in bulk · Labels · Scan) — Stock owners only
  STOCK
  MARKETING   Posts (Hub · Design · Investments) · Website (Add photos · Edit a piece · Photo weights)
              · Ads (Overview · Campaigns · Plan · New ad · Setup; Ad sets lights Campaigns, Audiences/Rules are cards on Setup)
              (2026-10-12: Design replaced Post a piece and the Ads Studio tab — see Design below)
  MONEY       Money (Expenses · Extra revenue · Overheads · Hisaab · Shareholders) · Analytics (Overview · Sales · Products ·
              Customers · Categories — the range rides in `?range=`, `lib/analytics/range-param.ts`, and carries across tabs)
  footer      Settings (Shop · Alerts · Bank accounts · Integrations · Data · Activity · Voice)
  ```
  Settings' tabs are routes (`/settings`, `/settings/alerts`, `/settings/integrations`, `/settings/data`, `/activity-log`
  with the sign-in log and Emergency lock); an old `/settings?tab=` link redirects, `?tab=rates` opens the rate sheet. Names:
  the sidebar's word is the name everywhere (sentence case) — Invoice, Order, Finalize & invoice, Stock/piece, Hisaab, Pay
  batch (a karigar's), Extra revenue, Bank accounts, Design; never the Shopify note strings (`POS Invoice`, `POS-DISCOUNT`,
  `POS Item`).

### Web matches the app

- **The web ERP wears the iPhone/iPad app's look** (owner, 2026-10-12: "re-skin the web ERP to match the native app as much as
  possible"; the spec is `docs/features/web-matches-app.md`, built in six work packages; this entry is WP-A, the tokens and
  primitives). **Dark was already the app's palette; light is new.** Per house and mode the four colours (ground, card, accent,
  on-accent) are the app's `Assets.xcassets` values and `lib/tones.test.ts` keeps the two copies equal: Taheri light is a grey
  `#F2F3F6` ground, white cards and a **deep gold `#8A6B42` accent (it was near-black navy)**; Mina light has its own cream
  neutrals (`#F4EFE8`, `#FFFDF9`, maroon `#380000`) instead of inheriting Taheri's. **Dark-mode text is system white**
  (`0 0% 100%`), not each house's warm off-white. The houses are still the body's `brand-<house>` class and the variables: no
  fork. **Cards are flat** (22px, no border, no shadow; tone separates them), buttons, chips and tabs are capsules, fields 12px,
  sheets 28px, menus and popovers 14px; headings are semibold and untracked; **colour means something** (`lib/tones.ts`:
  late red, owed amber, settled green, credit teal, working blue; text uses the `-ink` variant, fills the base), and one badge at
  most per card. **Accent text under 17px/semibold goes on cards, not on the ground** (`#8A6B42` is 4.4:1 on the grey), and page
  titles are the label colour, not the accent. Light `--destructive`/`--success`/`--warning` are now the tones' inks.
  Structural rules hang on a constant `app-look` body class; `ledger-rows` marks an inset-rows card whose fields are filled.
  **Dark text white, tables stay at `lg+`, phone Settings an index, "Due" grouping ported** were answered in the spec.
  **Amends:** *The map* (on a phone the hamburger sheet and its bar are replaced by a tab bar, a Search sheet that is the whole
  map, and a back chevron; the segmented tab row under the bar stays; light/dark stays in the account block; **Home's New**
  bubble becomes a create cluster on the four tab roots; WP-C); *Dashboard* (figures and sections unchanged, the no-scroll
  `lg:h-[100dvh]` layout goes and the stat cards stay visible; WP-D); *Light and dark* (mechanism untouched; every light screen
  changes colour); *Signed-in defaults* (phone cards say "You" instead of the tinted row and bar; desktop rows keep the tint);
  *Orders hub* (the app's "Due" grouping is added); *Liquid Glass* (radii raised to 22/12px; see its doc). **Not changed:**
  *Motion* (the curves are the app's), *Fonts* (the system font; no new file), `/view-invoice/<id>` (customer-facing, its own
  dress, though it reads the new tokens) and `/links`.

### The name ERP

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

### Number fields

- Number fields (`AmountInput`) select their contents on focus, and the sale-flow ones (order items, product form,
  cart edit) show a 0 as blank (`zeroAsEmpty`) — the counter asked for no pre-filled zeros to delete.

### Hooks

- In a component, no hook after an early `return` (the `/orders/add` crash of 2026-09-22 was exactly that).
  Again 2026-10-05: voice's `useRef`/`useEffect` (added 2026-10-01) sat below the order form's *Loading* return, so New
  order crashed whenever it opened before the shop's data had loaded (a refresh, a link, voice's new order); the return
  is now below every hook.

### Fonts

- **Fonts ship in the repo; never `next/font/google`** (2026-09-30): House of Mina's build failed twice that day in
  `website/post/fonts.ts` ("An error occurred in `next/font`… Cannot read properties of null (reading '1')") — now and then
  Google hands the builder a font address with no `.woff2` ending, which Next 15's Google loader can't read, and that house
  stays on its old code until the next push. Every face (Inter; the links page's Bodoni Moda / Newsreader; the story, post and
  ad faces) is Google's own latin woff2 in `src/fonts/`, loaded with `next/font/local` with the same weights, styles and
  fallback font, so the build fetches nothing. A new face: download its latin woff2 there (README), never the Google loader.
  (The ERP's screens are in the system font — `font-sans` beats globals.css's `'Inter'`; Inter only reaches `/links`.)

### Light and dark

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

### Motion

- **How the ERP moves** (2026-10-07, owner: "audit all animations, make smooth ones wherever needed"). Measured first —
  production build, phone size, CPU 4x slower, every frame timed (`motion-bench`, scratch) — so the change went where it
  was felt, not where it looked wrong in the code.
  - **Three curves** (`tailwind.config.ts`): `ease-enter` (0.22, 1, 0.36, 1) for what arrives, `ease-exit` (0.4, 0, 1,
    1) for what leaves, `ease-sheet` (0.32, 0.72, 0, 1, the iOS sheet) for what travels. Dialogs 200 ms in / 150 ms out;
    sheets — the phone's menu — 300 / 200 (they were 500 ms ease-in-out, slow to start and slow to land); menus,
    pickers and tooltips out in 100 ms; the desktop sidebar on the sheet curve, not linear. `transition-all` is named
    properties everywhere.
  - **Nothing vanishes.** 17 dialogs closed half-empty or not at all: content read the value that closing had just
    cleared (a payment's balance fell to 0 and its "more than the balance" warning flashed as it faded; a status
    confirm lost its status), or the dialog was unmounted on close (New sale's piece editor, Hand back, Queue).
    `hooks/use-lingering.ts` keeps what a dialog shows until it has gone; its buttons still act on the live value, so
    a second tap during the fade does nothing. The piece editor starts a fresh draft on each opening.
  - **What snapped now eases:** an order's piece and the phone's filters (fade + 4 px); buttons press (98%); charts
    draw in 600 ms, not 1.5 s (`lib/chart-motion.ts`).
  - **Swipe-to-delete** (Hisaab, Expenses) follows the finger without React, and decides after 8 px whether it is a
    swipe or a scroll: a thumb scrolling the list no longer drags rows sideways. A flick counts.
  - **The stall behind dialogs:** opening any dialog or the menu restyles the whole page (Radix's body pointer-events
    and scroll-lock stylesheet), so it froze in proportion to the list behind it — 5,320 elements restyled twice,
    up to 217 ms, under 120 invoices. `.cv-list` (globals.css) skips off-screen sections on Invoices, Orders and
    Customers: 815 elements, worst frame 50–100 ms.
  - **Reduce Motion is honoured everywhere** (it was only on the glass controls); spinners still turn, slower.
  - **Glass:** its light is a fixed layer, not `background-attachment: fixed` — which iPhones ignore (the glow
    scrolled away) and Chrome repaints on every scroll frame.
  - Left: the desktop sidebar's width animation reflows the table each frame (fine at full speed); the piece
    editor's first render (~130 ms at 4x); Invoices and Customers render the phone list and the hidden desktop table
    both, every keystroke in the search box.

### Recent picks

- Every dropdown with 7+ options (`Select`, `SearchablePicker`) shows this device's last five picks under **Recent**
  (`src/lib/recents.ts`, localStorage). Items are *moved* up, never duplicated — Radix prints a duplicated selected
  value twice in the trigger. Lists that change over time carry a `recentsKey`; the karigar picker opts out (it ranks itself).

## Home and the day

### Dashboard

- **The dashboard is the morning glance** (redrawn 2026-09-27, owner: "simple and effective, don't add shortcut buttons"):
  four figures — taken today, this month (against last), owed to you, on the bench — then **Needs you** (late promises as one
  row, overdue pieces by karigar, unassigned, the three largest unpaid + the rest summed, repairs ready and uncollected 3+
  days, birthdays/anniversaries), **Due to customers** (open orders *and* repairs in the shop by their promised date — late,
  today, soonest, undated by age; `orderTiming` for both) and **Recent sales**; the 30-day line at the bottom. No buttons:
  New Sale is the sidebar's.

### Rate chip

- **The rate is set in the top bar, and only on purpose** (2026-10-01 audit, Phase 1): the chip `21K 35,000 · 9:40 Ammar`
  (Mina: `Silver …`; `lib/rates.ts` `mainRate`) sits on every page, amber when not set on Karachi's today, and opens the rate
  sheet (`components/rates/rate-chip.tsx`, the same `RatesForm` as Settings → Rates; the cart shows one line when stale, never
  blocks). `updateSettings` stamps `ratesUpdatedAt`/`ratesUpdatedBy` and logs `rates.update` (old → new main rate) whenever a
  rate moves, from any screen; `/api/public/quote` returns that time as `ratesAt`. **The cart writes back only a new invoice's
  hand-typed rates** (`ratesToKeep`): editing an invoice loads its own old rates and a scanned bill the paper's, and saving
  either used to make that rate today's. The Settings form no longer carries rates, so saving shop details can't write back a
  stale one.

### Team note

- **A shared note for the team** (2026-10-12, with the native app's update): one short note in the app layout (`TeamNote`,
  `components/shared/team-note.tsx`), kept in `app_settings/global.teamNote`, at most 600 characters. **Owners write it, staff
  read it**: the write is `updateSettings` on `/api/app/write` (owners only; staff and Marketing get 403, a longer note 400, the
  server holds the limit in `lib/writes/settings.ts`), and every screen, the iPhone app and the widget read the same live
  setting. Clearing it saves an empty string. It is not a chat: one note, the last writer wins.

### One screen per question

- **One screen per question** (2026-10-01 audit, Phase 4). **Owed to you** is one rule, `lib/owed.ts` (tested): every invoice
  not refunded with `balanceDue` > 0.5, walk-ins and typed names included (under `WALK_IN_ENTITY` / `name:` keys, as Analytics
  keys them) — the dashboard, the customer list (it had dropped walk-ins and typed names), Invoices' subtitle and Hisaab's "On
  invoices" line all read it and agree to the rupee. **Since 2026-10-03 it adds the hisaab's hand-written balances** (the owner,
  on his father's Easy Khata: "yes add dads"): each customer's ledger rows that no invoice keeps (`linkedInvoiceId` unset; not
  karigars), counted when the customer owes the shop — on the dashboard (its tile then opens Hisaab and says how much is from
  there) and the customer list; Invoices' subtitle and Hisaab's "On invoices" line stay invoices only. A customer with hisaab
  rows is never offered as spam. **The khata itself** (imported 2026-10-03 from his "Khatay ki Report" PDF, 3,863 rows; the owner
  checked a review first): rows already in the ERP were skipped, and payments the ERP lacked went on their invoices (reference
  "Easy Khata"). Each row is a hisaab entry with `source: 'easy-khata'`, its `khataName` and `khataPage`, described "Given…" /
  "Received… (khata)", under the fixed id `khata-<sha1(date|name|side|amount|nth same row)[:16]>`. A name not already a customer
  became one, `cust-khata-<sha1(name)[:12]>`, name only. The next export can therefore be imported over the top: existing ids are
  skipped, and only rows after 2 Oct 26 need checking against the ERP. **Today's cash** (`/today`, a Home tab, owners only;
  `lib/analytics/todays-cash.ts`, tested) is Karachi's day: money in by method (invoice payments, advances on orders not yet
  invoiced, repair money with the repair's own method, other income "Not recorded"), exchange apart, expenses the business paid,
  and **the drawer = Cash − expenses**; it is built on `cash-in.ts`, so it matches Analytics, and the 9 pm daily report's "Net
  cash" is the same function (it had counted invoice payments only, card and bank as cash, on UTC days). **The karigar page**
  opens on **Now** (`lib/karigar-position.ts`, tested): his bench (`buildWorkshopJobs`, Pending included; links to
  `/workshop?karigar=<id>`, which opens on his whole bench with Taken by on Anyone for that visit only), the pieces' estimated
  weight **beside** the Gold khata (never summed — two measures), given items still out (by `recipientId`, else his name), and
  the Hisaab cash balance (positive: he holds ours) with the open pay batch. Read only; ticking "Given" on a job still posts
  nothing to Hisaab (the owner's call).

## Selling: invoices, orders, repairs

### Drafts

- **Drafts** (`/drafts`, Sales in the sidebar with a live count; 2026-09-27, owner: "drafts should have a separate section
  (order/invoice drafts) and be saved there, dont draft ongoing orders … deal with them smartly"). Firestore `drafts`, one
  document per unfinished form, seen on every device (`src/lib/work-drafts.ts`, tested; `components/drafts/use-work-drafts.ts`).
  **Only a new order form and a new sale are drafted** — never an order being edited or invoiced, an invoice on screen, an
  estimate being changed. Written a second after typing stops, only when something changed and something is there (a
  blank form's rates, promised date and row ids don't count); removed the moment the order or invoice is saved and never
  written after (`finish()` — the old device-only drafts kept writing while the page navigated away, and kept a sale's
  customer while its invoice was on screen, which is how saved orders and sales showed up as "unfinished"); removed when
  the form is emptied; forgotten after 30 days. Each form is its own draft: an order's id rides in `?draft=`, the cart
  remembers its sale in `gemstrack:sale-draft` and carries its pieces, so `/invoices/new?draft=…` continues a sale on another
  device. Opening an invoice over a sale in progress keeps that sale in Drafts. The old `gemstrack:draft:` browser drafts
  are moved over once per device, minus those saved afterwards. Settings' switch (`autoDraftForms`) turns it all off.
  A sale's draft keeps its held rate boxes (`rates`, `typedRates`), so it is priced at the rates it was quoted at.
  **The iPhone app** (2026-10-09) keeps its own copy on the phone and writes the same work to Drafts, in the web form's
  shape, through `/api/app/drafts` (no request claim or activity log: it is not the books); the contract cases hold a phone
  draft opened at the counter to the figures the phone showed. A phone draft finished or discarded at the counter is
  cleared from the phone when its screen next opens, so it is never saved twice. Drafts begun on the web open in the web
  form inside the app (Drafts on the New screen).

### Order actions gate

- The order-actions route keeps its always-verify gate: it moves money.

### Wastage in grams

- **Invoices show wastage in grams only** (no rupee value, no percentage); the workshop slip keeps the percentage.

### Repairs

- **Repairs** (`/repairs`, under Invoices): a ticket = one customer + **any number of pieces** (piece, what to do,
  weight, price) + ready-by + optional advance; karigar / taken by / shop note fold away under "More". Deliberately
  simple (owner's ask): three steps, **In the shop → Ready → Collected** — Ready is one tap, Hand back only takes the
  balance. `REP-000001` numbering from `lastRepairNumber` in settings. Money taken is written to **Extra Revenue** in
  the same transaction with `repairId`; deleting a repair deletes those rows. Receipt: `src/lib/repair-pdf.ts`.

### Invoice pages

- **Staff open an invoice at `/invoices/<id>`** (2026-10-01 audit, Phase 5; `components/invoice/invoice-viewer.tsx`: print, send,
  payment, discount, refund, New sale — it never touches the cart), change it at `/invoices/<id>/edit`, and sell at
  `/invoices/new` (both `components/sale/sale-page.tsx`, the old cart). `/cart` only redirects (307 in `middleware.ts`, and
  `app/cart/page.tsx`): `?invoice_id=` → the invoice, anything else → `/invoices/new` with its query. Opening an invoice used to
  clear the sale in progress, and its Refund button did nothing (its dialog was drawn only in the cart's other mode). An edit
  marks the cart (`gemstrack:cart-editing`) so a reload re-opens it and a new sale never inherits its pieces; a sale in progress
  when an edit opens is set aside (`gemstrack:cart-held`, and Drafts) and comes back in New sale; with Drafts off it asks first.
  The cart's piece lines are priced at the rate boxes, like its totals (they showed today's rate on an edit or a scanned bill).
  `/view-invoice/<id>` is the customer's page, with
  no shell and only downloads, and is only ever sent to customers. There is no `/view-invoice` without an id: the dashboard's
  Recent sales and unpaid rows linked `/view-invoice?invoiceId=` and opened "not found" until 2026-09-29; the workshop's invoice
  links sent staff to the customer's page.

### Invoice PDF

- **One invoice PDF builder**: `src/lib/invoice-pdf.ts` (`saveInvoicePdf`) draws the customer's copy for the invoices list,
  the invoice screen (`/invoices/<id>`) and `/view-invoice`. `perPiece` prints a multi-piece invoice as one invoice per piece on its
  own page ("Piece 2 of 3"); discount, exchange, adjustments and paid are shared pro rata by piece price, the last piece
  absorbs rounding, payment history is left off the pieces. The split button is `components/shared/print-button.tsx`.
- **Taheri's, not Mina's** (owner, the same day: "these are instructions for taheri pos"): the next two follow
  `NEXT_PUBLIC_STORE_INVOICE_BY_CUSTOMER` and `_INVOICE_WHATSAPP_PDF`, which Mina's file sets to "0" — its invoices keep
  `Invoice-INV-….pdf` and its Send via WhatsApp the device's wa.me message with the estimate's ID and link.
- **The customer never gets the number as its name** (owner, 2026-10-05: "don't give the invoice numbered name to the
  customer … say invoice and then customer name"): every download, print and send is **`Invoice - <customer>.pdf`** (a
  walk-in's carries its day), and the PDF's own title says the same, so WhatsApp's preview does too (`lib/invoice-share.ts`).
  The number stays printed inside, where the shop finds the sale when the customer comes back.
- **Send via WhatsApp sends the PDF itself** (same day: "directly send a pdf of the invoice to the customer instead of a
  link"). The invoice screen draws the PDF Print saves and posts it to `/api/invoices/[id]/whatsapp` (owner or staff, signed
  in), which sends it from the shop's own line (WAHA — Taheri 0326 2275554, Mina 0316 1930960) with what is owed written
  under it: no number, no link. WAHA is asked first whether the number is on WhatsApp (a send to one that isn't vanishes
  and reports success). The invoice keeps `sentOnWhatsApp` {at, to, by}, shown under the button so nobody sends it twice;
  an edit drops it. If the line can't send, the error toast offers **Send a link** — the old wa.me message. Voice's "send
  the invoice" now asks before it runs, because it really sends.

### Exchange rows

- **Exchange gold is one set of rows everywhere** (2026-09-25, owner: "make the exchange gold field uniform and add the
  ability to add another"): `components/shared/exchange-rows.tsx` in the order form and the cart — what it is, karat, grams,
  rate/g, value (grams × rate until typed), **Add another exchange**. Stored as `exchanges` on orders and invoices
  (`lib/exchange.ts`); every write also keeps the old fields as totals (`advanceInExchangeValue`/`Description` on orders,
  `exchangeAmount1` + `exchangeDescription` on invoices), so balances, analytics, Shopify and the per-piece split read them
  unchanged. Old documents are read through `orderExchanges` / `invoiceExchanges`. PDFs and the order slip print a line each.

### Order to invoice

- **An order carries everything to its invoice** (2026-09-25, owner: "carry over all details from order to invoice, such
  as advances, exchange gold"): exchange rows become the invoice's exchange (off its total, like the cart), each cash
  advance a payment of its own with its date and method (`orderAdvancePayments` in `lib/order-payment.ts`; `Order.advances`
  is written by Record an advance, `advanceMethod` by the order form), plus discount, taken by, delivery, notes (as the
  invoice's never-printed `internalNote`), hide-rates, source and item plating. Until then exchange and advances were one
  lumped "Advance from Order" payment. Re-saving an invoice from the cart keeps `sourceOrderId`, Shopify links and source
  (`INVOICE_PROVENANCE`). Payments can also be taken in the cart as the invoice is written (`generateInvoice(…, payments)`).
- **Finalize & invoice takes the final wastage and making** (owner, 2026-10-05: "allow me to change the wastage and
  making … without having to re-edit it"). Wastage was not in the dialog — the order's percentage went to the invoice as
  it was, and 2 of the 26 rate-priced pieces invoiced from orders had been corrected by editing the invoice after. Each
  piece now has weight (to 3 places), **wastage as % and as grams** (one figure two ways: the grams the karigar writes,
  "6.500 + 0.650", on the metal less its stones), making, stones and diamonds (silver's rate holds its making and wastage,
  so silver asks for neither); its price as typed beside "on the order …"; and Pieces − discount − exchange − advances =
  balance due, at the order's booked rate. The dialog and the invoice share one calculation (`lib/order-finalize.ts`), so
  the preview is the invoice. The order keeps its estimates. A diamond charge typed for a piece the order hadn't ticked as
  having diamonds now counts (it was dropped).

### Orders hub

- **The Orders list is the orders hub; the pieces move an order on** (2026-10-04, owner: "take the same approach for the entire
  pos" — the Posts hub's: read how the shop really works, then merge what is split). The audit (both houses' activity log, 60
  days): each order saved ~4.4 times after it was made — status typed by hand (Taheri 45, Mina 88), "Details updated" through the
  whole edit form (Taheri 72), Completed then Finalize as two steps; 5 of Taheri's and 10 of Mina's finished orders never
  invoiced. Now: **`lib/order-stage.ts`** (tested) — every piece with a karigar → In Progress, every piece finished → Completed,
  on every path (the karigar pickers, bulk assign, a piece ticked or unticked, the edit form, a new order); forward only, never an
  invoiced, cancelled or refunded order. **The list opens grouped by stage** — Ready to hand over · With karigars · Not started ·
  Awaiting payment (the invoice still owed, from `generatedInvoices`) · Done and Cancelled folded — and **each card carries its next
  step** (`components/order/next-step.tsx`): Give out (the karigar pickers, `give-out-dialog.tsx`), Mark ready, Finalize & invoice
  (the order page's dialog, now `components/order/order-dialogs.tsx`), Take PKR … (the invoice), and an Advance from any order being
  made. Finalize is offered from In Progress too (it completes the order). The status pill offers no bare "Refunded" (list, order
  page, the staff route): Refund order does a refund; Cancel asks first on the order page as on the list. **An advance typed into
  the edit form is dated today** — it joins `advances` (`store.updateOrder`); before, `orderAdvancePayments` dated it to the day the
  order was made, on the invoice and in Today's cash. "Status" grouping became "Stage" (the status filter stays). Found on the way:
  `<main>`'s `overflow-auto` made every `sticky` inert (see Posts hub).

- **Invoiced orders are greyed, and money is taken on the invoice only** (2026-10-06, owner: "grey out all orders that have
  been converted to invoice in orders page and stop showing take money option since its only from invoice"; both houses).
  Every order with an invoice is greyed in the list, paid or not; its card's next step is a quiet *Invoiced · INV-…* link,
  never *Take PKR …* or *Advance*; the order page hides *Record an advance* once invoiced (it showed it at the foot of the
  totals regardless), and `recordOrderAdvance` refuses an invoiced order, so voice can't either. Checked when it shipped:
  no advance had been recorded on an order after its invoice (Taheri 20 invoiced orders, Mina 122).
### Name a sale

- **Who a sale was for is set on the invoice, and an edit is an edit** (2026-10-04). A quarter of invoices were re-saved after the
  sale (Taheri 24 of 92, Mina 50 of 253), a quarter of those to change the customer — a walk-in named once the bill was out (see
  Walk-ins) — through Edit invoice, which re-prices every piece. **Name them / Change** beside the name on the invoice
  (`components/invoice/set-customer-dialog.tsx` → `store.setInvoiceCustomer`): picks or makes the customer, moves the sale's
  hisaab line to them, re-prices nothing. And a full edit no longer loses what the cart doesn't know: each line keeps its
  `karigarId`, tick, category, plating and a silver piece's own rate (`InvoiceItem.silverRatePerGram`; Mina's Shopify sales lost
  their karigar on every re-save), the delivery is loaded back, palladium 18k/12k rates reach the save, and the log says
  `invoice.update` with the old → new total (it said `invoice.create`, which read as a second sale and carried the activity log's
  Revert — a delete of the whole invoice, behind the delete code).

### Online orders

- **Every online order is confirmed by a person before it is anything** (2026-10-04, owner: "connect the backend to
  pos.taheri.shop fully and label online orders (they will always need to be confirmed before they get fully integrated)";
  payment "will only always be through advance bank transfer"). Placing writes only `online_orders/ONL-XXXXXX` — no ORD- number,
  customer or product, and **no bank details to the customer**, so no money moves on an order nobody has looked at. Orders opens on
  **Online — to confirm** (count in the sidebar, a line in Needs you, a PDF alert; the card shows the price at today's rate beside the
  quoted one). Confirm writes the ORD- order (labelled **Online**, the quoted rates, pieces fixed at the paid price) and starts a 24-hour
  hold; Decline sends the reason. **Until the transfer is in an online order is not a sale** (`bookedAsSale`): out of Taken today,
  Analytics, the monthly PDF, the workshop and Due to customers. **Transfer received** books it as the counter books money: a dated
  Bank Transfer advance and the delivery as extra revenue — it was writing the total into `advancePayment` and leaving
  `grandTotal` (the ERP's *balance*) at the full amount, so a paid order would have shown as owing it all. **Nothing lapses on its
  own**: the tick reminds the customer and tells the shop; *Let it lapse* is a person's call after checking the bank. Slips are
  uploaded from the order page and reach the shop inside the PDF. **Bank details are the shop's to send, on WhatsApp**
  (owner: "bank details will come from us through whatsapp") — never on the site; Confirm opens the customer's chat with the
  amount written in. **The site sells only at a rate set in the last 36 hours** (it was 3½ days old when selling went on), and
  the website's making and wastage are the counter's own medians, not the test values that were there. The design, the parts
  and testing on the emulator: `docs/website-checkout.md`.

### Shopify notices

- **Shopify's notices keep a pulled-in web order current, and never rewrite it** (2026-10-06, House of Mina; found while
  checking the rhodium bands reached the ERP). Every notice had been refused (401) since at least 2026-09-06: the ERP checked
  them with `SHOPIFY_API_SECRET`, the secret of another Shopify app than "HOM POS", whose token (`SHOPIFY_ACCESS_TOKEN`)
  registered all 12. So web orders froze as the pull brought them in — of 47, 45 behind: 5 paid on Shopify (Rs 95,300) still
  owed, 40 shipped still in the Workshop, 3 cancelled still sales. Fixing the secret alone would have been worse: the handler
  rewrote the whole invoice on each update (`paymentHistory: []`, every piece gold 21k), and 183 of 187 web invoices carry the
  shop's own payments and karigars. Now (`lib/shopify-mirror.ts`, `app/api/shopify/_order-mirror.ts`):
  - a notice gives only the order's id; the order and its transactions are **read back from Shopify** with the token, so no
    secret is needed and duplicates (each notice goes to two addresses: `pos.houseofmina.store` and the hosted.app one, kept as
    the spare the .shop outage argued for) or out-of-order ones end in Shopify's latest word;
  - only an invoice the ERP already has changes (a new web order is imported by its create notice, below) — the pull stays the catch-up, for orders, customers and stock (their notices
    do nothing; the products one would have made a stock row for each of the Birthstone Stack's 1,824 variants);
  - Shopify's successful sale/capture becomes a payment once (`shopifyTransactionIds`, kept through an edit by
    `INVOICE_PROVENANCE`), only up to what is owed, never Cash (the drawer never saw it: COD and bank deposit are Bank Transfer,
    Safepay Card), in the same transaction as the ledger; `amountPaid` never goes down;
  - fulfilment and payment state as Shopify words them; a web sale **cancelled there with nothing paid is voided**
    (`status: 'Refunded'`), with money taken only marked (`shopifyCancelledAt`);
  - an order the ERP pushed out itself (`pos-import`) is left alone: its note "POS Invoice INV-…" made the old handler mark
    the invoice paid in full on any Shopify edit (INV-000228 owed Rs 29,000).
  Catch-up for missed notices: `npx tsx --env-file=.env.mina.local scripts/shopify-mirror-orders.ts` (dry run; `--apply`).
  - **A new web order now arrives on its own** (2026-10-15, owner: "cant see shopify orders in ios app"; House of Mina's
    #1440 never reached the ERP because the notice only updated invoices already there and the pull is manual). An
    `orders/create` or `orders/updated` notice with no invoice yet **imports that one order through the pull's own code**
    (`importShopifyOrder` in `_order-mirror.ts`, which the pull calls too: `mapInvoice`, id `SHOPIFY-<n>`, orders above #1381),
    create-if-absent in a transaction (no `SHOPIFY-<n>`, no invoice with that `shopifyOrderId`/`#<n>`), so duplicate notices
    and retries import it once; then the mirror adds its payments (`shopifyTransactionIds`) and the "New Shopify order"
    alert goes out as before. `pos-import` orders and checkout-link orders are still left alone; products and customers notices
    still do nothing. The pull remains for catch-up: `npx tsx --env-file=.env.mina.local scripts/shopify-missing-orders.ts --since 2026-10-09` (dry run; `--apply`).

### Advance method

- **An order's advance method is optional, and a refused save is never silent** (2026-09-28, owner: "paid by how? causing
  issue when not specified"): an order saved without an advance stores `advanceMethod: null` (the edit path clears it that way),
  and the form's `.optional()` refused null on the next edit — with no message under the field, so Update order simply did
  nothing. The schema is `.nullish()`, the edit form never seeds a null, the method is written only with an advance and only
  when one was chosen (the invoice's payment then prints "—" for it), the placeholder says "Not recorded", and `onInvalid` on the
  order form toasts the first refusing field by name, since its sections fold away.

### Exchange line

- **Exchange is one line** (2026-09-26, owner: "a general exchange without details like just description and cash amount …
  make it super simple"): each exchange row in the order form and the cart is what it is + the amount; "+ Weight & rate" folds
  open grams and rate (and karat only where `defaultMetal` is gold). Labels say "Exchange", not "Exchange gold".

### Sizes to the profile

- **A size on an order is offered to the customer's profile** (owner, 2026-10-05: "show a popup to save the size in the
  customer bio for the future if the customer size is not already in their bio. If it is in the bio then no popup").
  The order form reads each piece's size by category (`lib/customer-sizes.ts`): rings, bands and a set's ring →
  `ringSize`; bangles and a locket set's bangle → `bangleSize`; bracelets, a loose bracelet and a set's bracelet →
  `braceletSize`. A size the profile doesn't hold, or holds differently ("The profile says 11 — this replaces it"),
  brings up *Save to <name>'s profile?* a moment after it is picked (a set's two parts come as one question); the same
  size gives none. *Not now* is final for that size on that order. A customer on file is saved to then; a new one (a
  typed name) is asked when a size is picked — never while the name is being typed — and saved once the order makes
  them; sizes picked before the name are offered by a toast as the order is created. Opening an order to edit asks
  nothing about the sizes it already had; a walk-in is never asked. Taheri's: Mina sets `NEXT_PUBLIC_STORE_SIZE_TO_PROFILE` "0".
- **Only a loose bracelet is sized in inches** (owner, 2026-10-05: "only do inches for loose bracelets. rest of those
  bracelet options change back"): its picker offers 4.5" to 9" in quarter inches; Bracelets and a set's bracelet keep
  1.1–3.0, the scale they share with bangles (`SIZE_SCALES`, store.ts). The profile check reads 7, 7" and 7 in as one size.

### Walk-ins

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

### Saves are one trip

- **Every save is one trip to the database, and orders don't carry photos** (2026-10-01, owner: "why is all updating an
  invoice/adding advance/whatever update … so slow"). Both databases are in `nam5` (Iowa); every trip from Karachi is a full
  round trip, and saves were 4–6 of them in a row: the transaction, the invoice-number check, the activity log, the ledger
  lookup, the ledger write, the order's balance. Now: `addActivityLog` is never waited on (queued on the device's Firestore
  cache); the invoice/order number check reads the number this device expects alongside the settings (a second read only
  when the counter moved); the ledger (`hisaab`) rows and the source order's balance commit **inside** the same transaction
  as the invoice, payment, discount or refund, their lookup running in parallel (`lib/writes/invoice-payment.ts`, tested to
  commit once). **Sample photos live in `order_photos/<id>`** (`lib/order-photos.ts`, tested; the item keeps
  `samplePhotoId`): 2.65 MB of Taheri's 2.71 MB of orders were 23 inline photos (biggest order 471 KB), rewritten on every
  tick, assignment, advance and edit and pulled back by every open device and the karigar portal. Readers take either shape
  (`components/order/order-photo.tsx`; the karigar and staff routes put photos back inline, `order-photos-server.ts`);
  `scripts/move-order-photos.mjs <project> --apply` moved the old ones (one transaction per order, checked after). Found
  with it: the order form's schema dropped every piece's `givenAt` (the Workshop's "Given") on each edit, and the order,
  Hisaab account and product pages never loaded their own data, so opened from a link or a reload they said "not found".

## Money and analytics

### Invoice credit

Owner, 2026-10-07: "allow invoices to go into credit". An invoice may be paid past its total; the
balance below zero is the customer's credit (`lib/invoice-credit.ts`).

- **Only for a named customer.** Credit lives on their hisaab, where it nets against what they owe and
  shows as owed to them. A walk-in has no hisaab, so money over the total from nobody in particular is
  change to hand back: the payment is refused until the invoice is given a name. The server's
  overpayment check in `generateInvoice` follows the same rule.
- **Where it can happen:** recording a payment (the Invoices list, and the invoice page, which
  takes one for a named customer even once it is paid), New Sale's payment rows, and Finalize, which already allowed advances over the bill.
- **The ledger in the same commit.** One row per invoice, `Credit held for Invoice <id>`, cashCredit =
  the amount over (`followCredit` in `lib/writes/invoice-payment.ts`, and `generateInvoice`). It moves
  with later payments and goes when a deleted payment brings the invoice back under its total. The
  sync's old text, `Excess advance returned for Invoice <id>`, is still read as a credit row and is
  rewritten in the new words when it changes.
- **How it reads:** "Credit to customer" on the invoice page, the PDF ("Credit to Customer") and the
  customer's page ("Credit to you"), and "Credit to you" in the WhatsApp caption, never a negative
  Balance due. Under half a rupee either way counts as settled.
- **Not built yet:** spending the credit. It sits on the hisaab; using it against a later invoice is
  done by hand for now.

### Whole rupees

- **Money has no decimals** (owner, 2026-10-17: "there should be no decimals"). Found in the lines: metal = weight × rate, and wastage = a percentage, made paise that flowed into subtotals, balances and "PKR 297,000.00". Now every amount is rounded where it is worked out (`lib/money-round.ts`: Math.round half up per line, piece = sum of rounded lines, subtotal = sum of pieces; discount, exchange, payments, advances, refunds are integers) so a printed bill adds up. Weights, per-gram rates and percentages keep theirs. The shared writes (`lib/writes/*`, so `/api/app/write` and the apps too) round what they are sent. Inputs take whole rupees (numeric keypad); nothing shows ".00".
- **Under a rupee is settled** (`isSettled`/`owesMoney`/`isCredit`, replacing the half-rupee tests): an older bill's paise are not a debt in Due to customers, invoice status, hisaab or credit. Scan 2026-10-17 (read-only): Taheri 19 of 159 invoices and 9 of 62 orders hold fractions, Mina 1 line; none show unpaid only for under a rupee. Nothing was rewritten.

### Round-off

- **The bill is offered round** (owner, 2026-10-17: "offer discount options to round the bill for any amount under 5000"). Beside the discount field (New sale, invoice discount, Finalize & invoice, the order form): up to 3 chips "Round to 270,000 · −2,340", the roundest round-downs to 10,000/5,000/1,000/500/100 that cost under 5,000 more, coarsest first (272,340 offers 270,000 · 272,000 · 272,300; a target two steps reach is listed once); tap adds it to the typed discount, tap again undoes. At payment time (invoice, an order's advance) a remainder under 5,000 offers "Settle — give the remaining PKR X off", which raises the discount, never a payment that was not made. Rule and tests: `lib/money-round.ts`; chips `components/shared/round-off-chips.tsx`.
  **Settle is owner-only and atomic** (2026-10-17): giving a discount is the owner's (`updateInvoiceDiscount` is owner-only), so staff may record the payment and never see Settle (`SettleOffer` hides it, `lib/use-can-discount.ts`). Before, the web recorded the payment and *then* raised the discount as a second write; a staff account's second write was refused, leaving the payment taken and the balance still X. Now one write each, `lib/writes/settle.ts`, ops in `/api/app/write` (`ops-settle.ts`), all **owner-only**: `settleInvoicePayment {invoiceId, amount, extra, method?, reference?, date?}` (payment + discount + ledger row + order balance in one transaction), `settleOrderAdvance {orderId, amount, extra, method?, notes?}` (advance + discount, one transaction), `raiseOrderDiscount {orderId, extra}` (only discount, balance and `updatedAt`; no `statusFromPieces`, so the stage never moves; refused on an invoiced order). `extra` is what is ADDED to the discount on file, rounded to whole rupees, refused past the subtotal. The order's Settle no longer goes through `updateOrder`.

### Lac and crore

- **Analytics money reads in lac and crore** (`src/lib/money.ts`: `pkrLac`, `lacCrore`, `axisLac`): exact below 1 lac,
  then `4.5 lac` / `1.25 crore` to two decimals, chart axes `50k · 2.5L · 1.2Cr`. Grams, tola and counts are untouched.

### Margin

- **What the shop earns, on every order and sale — never for the customer** (owner, 2026-10-05). Its gold costs it "the
  weight … in 24 karat minus 6 ratti": a tola is 96 ratti, so a gram of jewellery costs the 24k rate × 90/96 (93.75%).
  The 24k rate is **asked for** as the order or sale is made — New sale's *For the shop* card, the order form's totals,
  Finalize & invoice (starting from the order's own) — empty, with the rate sheet's one tap away — **typed per tola**
  (same day: "let me add the tola rate instead, and then you can calculate the per-gram rate"; ÷ 11.664, `lib/units.ts`)
  and stored per gram as `costRate24k` on the order or invoice. Given, the margin is worked out (`lib/margin.ts`): each gold piece with a weight
  at its metal (less stones) × that cost, its stone and diamond charges at what they were charged, a piece without a
  weight or not gold at 10%. **Not given, 10%** — and every order and sale recorded before 2026-10-05 stays at 10%
  ("for all the previous recorded stuff keep the profit as 10 percent"); the 24k rate kept on old sales is not used
  (on 92 sales the stored 24k had drifted from the 21k the counter prices by: 0.88–0.91 of it, some equal, one 7×).
- **A fixed price keeps its weight** (2026-10-07, owner: "when we make an invoice for a fixed price, still allow us to add
  the weight"). New sale's piece editor shows *Weight (g)* beside *Price* when the piece is *Fixed price*, and Finalize &
  invoice shows it for a fixed-price piece too (it wrote 0 g there, dropping the order's weight). It prints on the bill and
  the PDF and moves nothing — the price is the price (`pricing.ts`). For the margin, plain gold at a fixed price is now costed
  from its gold; **with diamonds or stones in it, it stays at 10%** (their cost is inside the price and written nowhere, so
  gold alone would read a diamond ring as ~90%). So a fixed-price line keeps `hasDiamonds`/`hasStones`, and an edit reads
  them (and the details) back, since its charges are 0.
- **Who sees it:** owners and staff (owner: "tell owners and staff … just make sure the customer does not get any of this
  info"). It shows as *We earn* on New sale, the order form, Finalize, an invoice's and an order's page, **blurred until
  tapped** — the counter turns its screen to show a customer the bill — and the figure is not in the page until then.
  Never in a PDF, the WhatsApp message, the website, or the customer's invoice link (`/api/public/invoice` strips
  `costRate24k`). **Analytics' Est. profit** is each sale's own margin (10% where no rate; extra revenue at 10%), and
  says how many sales had a rate; the yearly table likewise. Mina (silver): `NEXT_PUBLIC_STORE_COST_RATTI_LESS` "none".
- `STORE_EST_MARGIN` and the ratti read an empty variable as unset: the env generator writes Mina-only variables empty
  for a local Taheri, and `Number('')` made every local estimate 0%.

### Exchange as cash

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
  range (this month, last 30/90 days, this year) re-anchors when the day turns on a page left open.

### Analytics default: this month

- **Every analytics screen opens on this month, the 1st to today** (owner, 2026-10-12: "all analytic should default to that month rather than 30 days"). `lib/analytics/range-param.ts` (`this-month` is first in `QUICK_RANGES` and is `DEFAULT_RANGE_KEY`, so a plain /analytics keeps a clean URL; Last 30 days stays one tap away) and the quick buttons in `analytics-view.tsx` read that one list. Home's collapsed ledger section is "This month" (revenue, expenses, net since the 1st). Expenses already defaulted to This month. Left as they were: the iPhone app (`apps/iphone`, native Swift: `AnalyticsDates.swift` `defaultKey`), the Ads page's own presets, and the new-arrivals 30-day window.

## People and sign-in

### Add photos sign-in

- ~~**Add Photos needs no sign-in** under open access — the owner overruled an auth gate on 2026-09-20.~~ Superseded 2026-09-30: every house signs in (below).

### Taheri sign-in

- **Taheri signs in: four owners** (2026-09-30, owner: "taheri being open to all is a bit dangerous, enable taheri on these
  gmails"): potatomasta501, mmurtaza1970, unknownuser80, hmurtaza55. `NEXT_PUBLIC_OPEN_ACCESS` is "0"; the list is
  `NEXT_PUBLIC_STORE_OWNER_EMAILS` in apphosting.taheri.yaml, read before `ALLOWED_EMAILS` because Taheri's **console override**
  pins that one to potatomasta501 + minakhalid00 (dead now; delete it in the console when convenient) — and the same four in
  **`firestore.rules`**, Taheri's locked rules, which the owner publishes in the Firebase console (this session has no rules
  permission; never the CLI from here — `.firebaserc` defaults to Mina's project). **Until they are published the database is
  still open**: on 2026-09-30 an anonymous request with the public key listed Taheri's invoices. Found and closed with it: the ten
  Shopify routes had no check at all (push orders, delete Shopify customers…) — now `erpUserOrCron` (`lib/erp-gate.ts`; the
  store's calls send the login, the Shopify callback and the scripts `CRON_SECRET`); and the customer's `/view-invoice/<id>` read
  Firestore directly, so on Mina (locked) customers' links never opened. Every invoice now carries **`shareToken`**
  (`lib/share-token.ts`: written with it, kept on edits via `INVOICE_PROVENANCE`, added by the cart's Send when an older one has
  none); the link is `/view-invoice/<id>?t=<key>` and **`/api/public/invoice/[id]`** serves that one invoice for the key (tested;
  no shop notes, admin notes or karigars). Links sent before 2026-09-30 have no key: once the rules are published they say to ask
  the shop again (a signed-in owner still opens them).
  **AI keys wait for these rules** (2026-10-21): while an anonymous list of `app_private` answers 200, every AI key is refused
  (`lib/agent/rules-guard.ts`; [AI keys](#ai-keys)) — a key record there could be forged. Publishing the rules turns them on.

### Signed-in defaults

- **Workshop start is a house setting** (2026-10-15, owner: "for houseofmina Workshop default should be anyone"):
  `NEXT_PUBLIC_STORE_WORKSHOP_START` "you" (default, Taheri: the signed-in person) or "anyone" (Mina); `STORE_WORKSHOP_START` in
  `lib/store-config.ts` → the web `/workshop` and `/api/app/me` `shop.workshopStart` → the iPhone Workshop board. Only the starting
  filter; it stays shown and changeable.
- **Given by** (2026-10-10, owner: "when adding something to given items … also register who from taheri gave those items"):
  a given item carries `givenBy`, a Taken by name, on the Given page (form, list, a filter), the iPhone app's Given items and
  voice's "give something out". It starts on the signed-in person and is always shown and changeable; `/api/app/write`
  takes only the house's names and falls back to the signed-in person, so an older app still records it.
- **The ERP starts on whoever is signed in** (2026-09-30, owner: "taken by defaults to ammar when potatomasta is logged in /
  workshop filters to ammar / orders filter to ammar"): `NEXT_PUBLIC_STORE_PEOPLE` per house ("email=Name,…"; Taheri:
  potatomasta501=Ammar, unknownuser80=Mansoor, mmurtaza1970=Murtaza, hmurtaza55=Huzaifa, Mohammad has no account; Mina:
  potatomasta501=Ammar, minakhalid00=Mina) → `lib/people.ts` (tested; a name must be on the house's `TAKEN_BY`). **Taken by**
  starts on them for a new order, sale or repair (never an edited one), and the **Orders, Invoices and Workshop** filters start
  on them (`useMineFilter`: a choice, Anyone included, holds for the visit in sessionStorage). Only a default, always shown —
  on a device handed across the counter it would otherwise credit everyone's sales to one login. Found with it: editing an
  invoice in the cart never loaded its Taken by, so a re-save dropped it; it loads now.
- **Orders and Invoices start on everyone, not the signed-in person** (2026-10-05, owner: "remove the default filter for every
  account when looking at orders and invoice page … default should be by day … if its my account my orders should be
  highlighted rather than sorted"; both houses). `useMineFilter(list, { startOnMe: false })`: they open on *Anyone*, and a
  choice still holds for the visit. The signed-in person's own rows are **highlighted in place** — tinted, with a bar down
  the left (`mineRowClass`, lib/utils.ts; "Taken by you" on hover) — never filtered or moved. Orders open **grouped by day**
  (Invoices already did); Stage is a tap away. The Workshop still starts on the signed-in person.

### Delete code

- **Every delete asks for a code first** (2026-10-01, owner: "add ability to delete invoices/advances/orders or anything —
  just make it a verification thing to do that [code]"). One dialog (`components/shared/delete-code-dialog.tsx`), asked in
  the store's delete actions themselves (`requireDeleteCode` → `lib/delete-code.ts`), so every way in is covered: pages, the
  activity log's undo, swipe-to-delete on a phone, a delete inside another, the voice assistant's undo. A right code holds two
  minutes (a row of deletes, or a refund that deletes its invoice, asks once); a refused one throws `NOT_DELETED`, and pages
  show it instead of "deleted". **The code is never in the repo** (gemstrack-pos is public) or the browser: each house keeps a
  salted SHA-256 at `app_private/delete_code`, the server compares (`/api/auth/delete-code`, owners and staff, 8 wrong tries per 15
  minutes per account, wrong tries logged). Change it: `node scripts/set-delete-code.mjs <project> <code>`. A deliberate-action
  check, not the database's boundary: an owner can still write Firestore directly. Gated: invoices (Delete beside Refund, the
  refunds), **one payment on an invoice** (an order's advance carried over included — `removeInvoicePayment`, the payment
  transaction run backwards), **one advance on an open order** (`withoutOrderAdvance`), **an order** (Delete order; refused
  while it has an invoice, and its sample photos go with it), order items and undoing an invoice, customers (and merge, and
  emptying Recently removed), karigars and their batches and silver, products (and "delete latest"), ledger, expenses, extra
  revenue, given, repairs, workshop jobs, shareholder entries. Found with it: deleting one of two invoices for the same order
  cleared the order's link (the advance counted as revenue again) — it now keeps the other; a duplicate's pieces stay sold.
  Not gated: drafts (they have Undo), settings lists, ads and website items (outside the books).

### Marketing role

The owner, 2026-10-05: unknownuser80@gmail.com should have "access only to the marketing section" of House of Mina's ERP.
A fourth role beside owner, staff and karigar (`lib/roles.ts`), named by `NEXT_PUBLIC_STORE_MARKETING_EMAILS`
(`apphosting.mina.yaml`; Taheri names nobody). An owner or staff listing always wins.

- **What it sees:** the Marketing group whole (Posts, Website, Ads with the Studio) and nothing else: no dashboard, sales,
  orders, customers, stock, money, analytics or settings (`forRole(…, 'marketing')` in `lib/nav.ts`). Any other address,
  the dashboard included, sends it to its first page (`app-layout.tsx`).
- **The boundary is the server, as for staff:** no direct Firestore access; its store reads only `settings` (the staff
  allow-list), `products` and `categories` through `/api/staff/collections`, stripped like staff's (`MARKETING_COLLECTIONS`).
  `adsGate`, `postGate` and the website routes let it in; the online-order routes (`staffGate`), the staff write path,
  voice and the bill scanners do not. **Customer audiences** (which send the customer book, hashed, to Meta) stay owners'
  only (`ownerOnly` in `ads/gate.ts`); Instagram-engager and lookalike audiences are open to it.
- **Two things outside the code:** Mina's Firebase has sign-up off, so the account's first sign-in needs it on for that
  minute; and Mina's Firestore rules must give database access to owners only, or a marketing account could read the
  books from the browser whatever the menu shows (see [Karigar sign-in](#karigar-sign-in)).

### Karigar sign-in

- **A karigar's Google sign-in fails on his phone, where the ERP can't see it** (2026-10-01, owner: "why cant uzair my karigar
  access his part through pos"). Uzair's work is in House of Mina (66 lines, 11 open) and his Gmail is on his Mina record, yet in
  a month of logs no sign-in of his reached `/api/karigar/me` — a signed-in account the ERP doesn't know answers 403 there, and
  there were none. Taheri's 55 karigars have no Gmail at all (the form's "Google Login" field), so none can sign in there.
  Both pos.* and erp.* are Firebase-authorised domains in both projects (checked against the public project config).
  The sign-in screen now: names the app when the page is open in one's built-in browser, where Google refuses to sign in
  (`lib/sign-in-trouble.ts`, tested: Instagram, Facebook, Android WebView `; wv)`, an iPhone web view without `Safari/`;
  WhatsApp's own links open in Chrome tabs / Safari views and pass) with **Open in Chrome** (an `intent://` link) or Safari steps
  and Copy link; says what each Firebase error means; names the Gmail it refused and the shop; and no longer calls a server that
  failed to answer (a 503) "not authorised". Every failure goes to the server log, nothing stored:
  `gcloud logging read 'textPayload:"[sign-in]"'` — `start`, `failed code=…`, `refused email=…`, `check-failed status=…`.
  Every failure is reported, "popup-closed-by-user" too, with how long Google's window was open: a window that closes without
  handing the sign-in back reads as closed by the user, which the screen used to ignore. Open 8 s or more, it now says the
  sign-in didn't finish. (Owner: "I did open in chrome" — every recorded sign-in in both houses had been Safari.)
  **The cause, from the first real try** (Uzair, Chrome on Android, pos.houseofmina.store, 2026-10-01 15:31 UTC):
  `failed code=auth/admin-restricted-operation after 11s` — House of Mina's Firebase project has new accounts switched off
  (Authentication → Settings → User actions → "Enable create (sign-up)"), so an account that has never signed in is refused
  before the ERP hears of it; the owners and staff got in because their accounts already existed. The cloud account cannot
  read that setting or Mina's rules (Mina's Firestore refuses anonymous reads; whether it checks emails is not known here, so
  sign-up may be what keeps strangers out). A new karigar's first sign-in needs sign-up on for that minute, then off again.
  The screen and the karigar form say so.

## The website and copy

### Customer copy

- Copy: never "Najmi Market" or "Saddar" in anything a customer reads; hours are Sat–Thu 11:00–21:00, **Fri 15:30–20:00**.

### Weight preview

- Photo Weights' preview draws the weight with the overlay tool's geometry (Futura LT Light, 143/3000 of the width, inset 120/3000).
- The face is really loaded (2026-10-09, owner: "the font does not look like Futura Lite"): the page named "Futura LT" without
  loading it, so a phone drew its own Futura Medium or Century Gothic. Now `next/font/local` (`website/weights/fonts.ts`), and the
  iPhone app bundles it (`App/Resources/Fonts/FuturaLT-Light.ttf`, UIAppFonts) at the same proportions.
- **Newest first, new uploads included** (same day, owner: "it's not showing me the latest rings… show me the newest stuff
  first"): `/api/website/pieces` lists by the site's `added`, and with them the uploads the site hasn't listed yet (its drop
  folder, `listDrops`), whose weight is saved under the key each keeps once listed; the site draws it until its next rebuild.

### Shop outage

- **.shop outage 2026-09-24 ~16:18 UTC:** GMO Registry answered NXDOMAIN for every .shop domain (taheri.shop, pos., links.).
  The POS stayed usable at **https://studio--gemstrack-pos.us-central1.hosted.app** (App Hosting's own address; open access,
  data loads). Instagram fetches story images from `SOCIAL_MEDIA_ORIGIN` (that address) so posting never depends on .shop.

### Community twin

2026-10-12. "Taheri Collections" hit WhatsApp's member cap, so the owner opened "Taheri Collections - II"
to carry the same groups. Every send to a group of the first community also goes to the group of the
same name in the second (`src/lib/whatsapp-twins.ts`, inside `sendWhatsAppFileToGroup` /
`sendWhatsAppTextToGroup`, so Posts, the queue, Investments and every other group send are covered).
The announcements map to the announcements. Pairs are found by name from WAHA's group list (kept ten
minutes), so a group added to the new community is reached from the next send with nothing to set.
A failure of the twin's send is logged, not thrown, because the first post has already gone.
`WHATSAPP_COMMUNITY_TWINS` (`apphosting.taheri.yaml`) names the pair of communities by parent id.
Opening Posts copies each group's description and icon to a twin that lacks them. WAHA can't create a
community's groups or link them; the owner adds them in WhatsApp, as admin of the second community.
`/links` shows the community (now the second one's invite) instead of the channel, and so does
taheri.shop's footer. Posts still go to the channel.

## Design


### Piece interest

The owner, 2026-10-22: "which ones are saved, inquired about, looked at for the longest". Both sites (taheri.shop and
the Mina catalogue) send anonymous events per piece — opened, time on the page while visible, heart on/off, a WhatsApp
enquiry naming it (a saved list counts each piece) — with `navigator.sendBeacon` as text/plain to
`POST /api/public/events`. Only the house's own `WEBSITE_ORIGIN` is counted, 400 events an hour per caller, a look capped
at ten minutes and under a second ignored. Totals and per-day counts (Karachi's day) sit in `piece_stats/<key>`, the key
being the site's own piece id (`SitePiece.id`: `mina/piece/<handle>`, or taheri.shop's photo path) with `/` as `~`.
Website → Interest ranks them (Saved, Asked about, Looked at longest with at least three looks, Opened) for 7 days,
30 days or all time. No person, cookie or account is stored. Before this, saves lived only in each browser.
### Website analytics

2026-10-23. The owner: "add by location, live visitors, everything Shopify shows for catalogue.hom and taheri.shop". Website →
**Interest** became the site's own analytics, Shopify's report adapted to sites that sell by WhatsApp; **Live** is a tab beside it.

- **Counted by the sites themselves**, in the same beacon as piece interest (`visits.js` in taheri-site and mina-catalogue →
  `POST /api/public/events`; `lib/website/site-analytics.ts`). Each ERP counts only its own `WEBSITE_ORIGIN`.
- **No person kept.** A random id in the browser's localStorage tells new from returning; no cookie, no fingerprint. The referrer
  is sent as its host. The address is used for the rate limit and the place, then dropped (`lib/website/geo.ts`): the front end's
  location headers if it ever sends any (App Hosting documents none), else a bundled table from DB-IP's free City Lite (CC BY 4.0,
  credited on the screen; `scripts/geo-build.mjs`, re-run a few times a year): city for Pakistan and the Gulf, country elsewhere.
  Do Not Track, Global Privacy Control, automated browsers and bot user agents are not counted (page and server both).
  **App Hosting's front end replaces every request's User-Agent with `Google`** (the `[sign-in]` log shows it), so the page sends
  its own `navigator.userAgent` as `ua` and devices and bots are told from that (`visitorAgent`); a beacon without one counts its
  pieces but no visit. Its own header `x-fah-client-ip` carries the visitor's address (it sends no location header): the
  place is looked up from that.
- **Cheap to keep.** No document per hit: one counter document per Karachi day (`site_days/<day>`, `FieldValue.increment`, maps by
  place, device, OS, browser, source, campaign, landing/exit/viewed page, collection, search, 404, hour), one short-lived document
  per open session (`site_live/<session>`, `expireAt`; Live deletes ones quiet for an hour too), one per visitor per day seen
  (`site_visitors/<id>`, for unique visitors over any period by count query). Bounces and exits are kept by give-and-take
  (the first page adds both, each later page moves the exit and the second takes the bounce back), so no job closes sessions.
  The rate limit is in memory (400 batches an hour per visitor, 3,000 per address), not a Firestore transaction per beacon.
- **What it shows**: Today, Yesterday, 7, 30, 90 days, all time or custom, against the period before. Sessions, visitors, page views,
  time on site, bounce rate, returning; sessions by day (by hour for one day); the funnel visit → piece → saved → WhatsApp (any wa.me
  tap counts), overall and per source; sources (direct, search, social, ads by utm_medium or click id, other sites, email) and
  utm campaigns; countries opening into cities; device, system, browser (Instagram and Facebook's in-app browsers apart); landing,
  exit and most-viewed pages, collections, searches (Mina's search box; taheri.shop has none), 404s; then the four piece rankings
  for the same days (`/api/website/interest?from&to`, added; `days` unchanged for the iPhone app). Live: people in the last five
  minutes (pages beat every 30 s while visible), where, on what, how they came, each visit, and today's totals.
- A session ends after 30 minutes away, or when the visitor arrives again from a referrer or tagged link.
### Design

2026-10-12. The owner: "make further improvements … more powerful than Canva, especially fine-tuning controls … instant resizing using
AI so any design can be converted smartly into different aspect ratios … easier and smarter parsing. The ERP is a bit cluttered in
terms of ad/post/story/whatsapp design — bring everything together smartly allowing one area where it can be posted from … Merge it
into one Design sub-tab; deal with the existing Studio in Ads smartly." The plan, settled the same day in the owner's stead per
their standing "do everything yourself": `docs/features/design-studio-plan.md`; what was built: `docs/features/design.md`.

- **One tab, one editor, one publish sheet, one shelf.** **Design** is a tab of Posts (Hub · Design · Investments), not a sidebar row
  (the map: one tab row per screen). Making is one workspace: a design is a master page plus any number of sizes made from it; every
  kind (piece, post, story, WhatsApp, website photo, ad, any size) only changes defaults. Sending is one Publish sheet; keeping is one
  Saved shelf (`designs`, with the legacy `ad_saved` read through, no migration). Board is a Design section.
- **Supersedes:** *Post a piece* as a screen (its engine, checks, queue, drafts and Maisons stand); the Ads **Studio** tab (its
  Plan is **Ads › Plan**, Photos / Make / Board / Saved are Design sections); the Posts hub's "Post a piece" button (now Design);
  the per-surface "send it somewhere" code (`post-it.tsx`, board `queuePost`, hub cards) — `lib/design/publish.ts` is the one place.
  The Post a piece and Ad studio entries elsewhere describe the engine and the history; read "Post a piece" and "Studio" as Design.
- **Roles:** staff keep Design for pieces, posts, stories, WhatsApp and website photos; the library with scores, Board, Saved ads, Plan
  and Meta ad stay owner + marketing (`designGate('post' | 'ads')`, two needs never merged).
- **One call per AI action; deterministic first.** Resize re-lays by layer role and safe zones with no AI; an optional one-call plan
  may only move what exists and is discarded on any changed word or invented id. **The jewellery is never redrawn.** Smart input holds
  every field against the pasted text: no figure appears that wasn't in it.
- **Instagram feed posts by API** are in (D4 = yes; Taheri, `instagram_business_content_publish`); Mina has no Instagram app, so story
  and post go to the share sheet. WhatsApp and the website only ever get 1:1. Video and animation are phase 2.
- **Background removal** is Magnific's `beta/remove-background` (urlencoded `image_url` through the `social_media` relay; answers
  `high_resolution`, a PNG with alpha; verified live 2026-10-12).
- **Addresses:** every old URL redirects with its query (`lib/design/redirects.ts`, table-tested); **every `/api` route keeps its
  address** (the iPhone app calls `/api/ads/studio/*` and `/api/website/post/ai`, the board's agent `/api/studio/mcp`).
  `/website/post` and `/ads/studio` stay in the map as `moved` pages so the app's native Post composer and Studio stay linked.
- **The classic screens are gone** (2026-10-12, parity pass): everything they did is in Design ([With AI](features/design.md#with-ai)).
  `/design/classic/post` and `/design/classic/ad` are redirects (with `?draft=`); a draft of the old Post a piece screen opens as a
  design ([Old drafts](features/design.md#old-drafts)).

- **Subject-aware stories** (2026-10-19; the owner: "when formatting for stories, have it be smart enough to understand the subject in the
  image and not cover it with text"). Built once in the shared engine (`src/lib/social/subject.ts`), so the web, the iPhone bundle and
  Android lay out alike. `findSubject` boxes the piece in a ~128 px copy of the photo (ground estimated from the border, row by row and
  column by column; colour distance plus edges; adaptive threshold; nearby blobs joined; null for a busy or blank picture; cached per image).
  `avoidSubject` runs after `applyPreset` and after a story-shaped photo-ground ad template: the layout's own words go as one block to the free
  band above or below the piece (inside the 14% / 20% story bands), else the photo is panned within its crop, else the words shrink (never
  under 80%); a mark on the piece moves to a clear spot; the person's own layers never move. The box is kept in `doc.meta.found`; an
  explicit `meta.subject` (an app's better box, `subject` in the bridge's message) wins. Squares and the site story are left as they were
  (corner stamps; the photo is inset whole).

### One app, many businesses

2026-10-16. The owner: one iPhone app for all his businesses, to switch between them and to add more.

- **One app, `shop.taheri.erp`, "ERP".** A business is a run-time thing, not a build: Taheri and House of Mina ship in the app, any other is added by typing
  its ERP address and is described by `GET /api/app/business`. Every difference between businesses stays a variable (the server's), as on the web.
- **Each business is its own.** Own Firebase app and sign-in, books, drafts, push registration and widget entry; switching rebuilds the screens and never
  signs anyone out. Removing a business signs it out and clears it from the phone; a built-in is hidden, not deleted.
- **The icon never changes by itself.** Taheri's is primary, Mina's an alternate; Settings → This phone sets it, because iOS alerts on every change.
- **House of Mina's own app is deprecated** (kept building until its testers move). House of Mina inside the one app needs `shop.taheri.erp` registered as an
  iOS app in its Firebase project (`docs/features/iphone-app.md`).

## Outside AI

### AI keys

2026-10-21. The owner: "an API key thing so that I can use other AI to go into the ERP and make posts for me and stuff." What was
built: `docs/features/ai-keys.md`.

- **One key system for every outside AI.** Settings → Connect an AI (owners only) makes a key per AI: a name, what it may do (scopes:
  `posts:draft` and `read` ticked; `posts:publish`, `write:shop`, `write:money` and, where the house has the Ad studio, `studio` opt-in),
  an optional expiry. Shown once (`tk_<house>_…`), kept as a SHA-256 in `app_private` (Admin SDK only), compared in constant time,
  revocable; last use and calls shown. A key stops when its maker loses the role. The Studio's board agent is the same system: Connect an
  agent now makes a `studio`-only key; the old `tstudio_` keys still work.
- **Both protocols from one registry.** MCP over Streamable HTTP at `/api/agent/mcp` (Claude, ChatGPT connectors, Gemini CLI, Cursor), a
  REST twin at `/api/agent/v1/<tool>` and `/api/agent/openapi.json` (a custom GPT's Actions) are drawn from `lib/agent/tools.ts`: no
  three copies. Scopes are checked server-side on every call; a refusal names the scope. Connectors that can only sign in use the ERP's
  own small OAuth (paste the key once on the ERP's page); their tokens die with the key. No new secret.
- **An AI's post waits for the owner.** `make_post` draws the story and the square on the server (the board's renderer) and keeps them as
  a Design on the Saved shelf; `queue_post` puts it in the post queue with `proposedBy`; it goes only after its own Approve in Posts
  (or a `posts:publish` key's send) — the server refuses a person's Send now or time before that, so no Send all, Spread, phone tray
  or tick can send it. The website stays with people.
- **Paused while the rules are open.** No key is honoured unless an anonymous probe finds `app_private` locked (`rules-guard.ts`);
  Taheri's keys start working when the owner publishes `firestore.rules`.
- **The books through the app's own writes.** Write tools run `/api/app/write`'s code (`run-op.ts`) as the key's owner: the same roles,
  lock, request id, shared writes, follow-ups (alert, Shopify) and the delete code for anything that deletes. Reads use the screens' own
  calculations (widget figures, Today's cash, owed, the monthly report). Every call is in the activity log under the key's name
  ("· via ChatGPT"; filter "AI keys"). Words for customers are held to the house rules (brand book, the caption rules, the Maisons).
