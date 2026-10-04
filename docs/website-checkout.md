# Selling from taheri.shop — how it works, and what must be true before it is switched on

The public site is a catalogue of photographs. This feature lets a visitor buy one without the
site ever knowing a price: the site asks the ERP, the ERP answers from the piece's weight and
today's rate through the same `calculateProductPrice` an invoice uses. Nothing exists in the book
until the shop has confirmed the order.

## The flow (confirm-first, 2026-10-04)

The owner: "label online orders (they will always need to be confirmed before they get fully
integrated)". Payment is only ever a full advance by bank transfer.

| step | the customer | the ERP |
|---|---|---|
| **Placed** | checkout: name, WhatsApp number, address, a size for every ring/bangle/kara ("Not sure" allowed), the terms ticked. Told: nothing is paid now, we confirm on WhatsApp, **no bank details yet** | `online_orders/ONL-XXXXXX` (`lib/website/online.ts`): the re-quoted lines, sizes, the rates quoted, and the order and products it *would* write (`draft`). Nothing in `orders`, `customers` or `products`. The shop gets the PDF alert; the customer a WhatsApp "received" |
| **Confirmed** (or declined) | WhatsApp: "confirmed", the price held 24 h (`WEBSITE_HOLD_HOURS`), and that the bank details are coming — **the shop sends them itself on WhatsApp** (owner, 2026-10-04: "bank details will come from us through whatsapp"); the link shows the amount and takes the slip. Declined: the reason, "nothing has been charged" | Orders → **Online — to confirm** (top of the hub; sidebar count; dashboard's Needs you). Confirm writes the products and an `ORD-` order through `createOrder`, stamped with the **quoted** rates, `source: 'website'`, `website.onlineId`, items fixed at the quoted price (`isManualPrice`), then offers **Send bank details on WhatsApp** (the customer's chat, amount and reference written in; also on the order's Online panel). The card shows what the same pieces cost today. Two people pressing Confirm make one order (claimed in a transaction) |
| **Slip** | uploads a photo/PDF from the order page (shrunk to a JPEG in the browser) | `website_slips/{id}` (bytes, ≤ 900 KB, type checked by its first bytes); `paymentStatus: slip_sent`; the shop gets a PDF **with the slip in it**. A slip is not money |
| **Paid** | WhatsApp "received"; page shows Paid → being made | hub stage **Awaiting transfer** → *Check transfer* / *Slip in — check* → **Transfer received**: the pieces as a dated **Bank Transfer** advance (`advances`, so Cash In / Today's cash count it that day), the delivery charge as **extra revenue**, balance 0. The order then sits in *Not started* to give out |
| **Hold over** | a reminder 4 h before (waking hours only) | the tick (`sweepOnline`) tells the shop once; **nothing lapses on its own** — people pay and forget the slip. *Let it lapse* (after checking the bank) cancels and tells the customer |
| **Shipped / Delivered** | tracking on the page and WhatsApp | Leopards API or a CN typed in, as before |

Until its transfer is in, an online order is **not a sale**: `bookedAsSale` (`lib/order-stage.ts`)
keeps it out of the dashboard's Taken today, Analytics and the monthly PDF; it is not on the
workshop's list or "Due to customers". (Counted, a stranger's two-million basket was "Taken today".)

The customer keeps one reference, the ONL- number: `/order/ONL-…?t=` works before and after
confirming and shows the shop's ORD- number once there is one. The Orders search finds an order by
its ONL- number.

A finished piece that weighs differently is settled at the order's rate, either way, before it is
sent (taheri.shop/payment): Finalize & invoice starts from the paid price; untick the fixed price to
let the weight price it.

## The parts

| where | what |
|---|---|
| `src/lib/website/pricing.ts` | `quotePiece` — gold, palladium, coloured stones; diamonds and the Maisons are enquiries; no weight → no price |
| `src/lib/website/price-book.ts` + `GET /api/public/prices` | every piece's price in one answer, built at most once a minute per instance and cached at Google's edge (`s-maxage=120, stale-while-revalidate=600`). The site reads it once per visit: browsing costs the ERP nothing however many people are on the site |
| `src/lib/website/checkout.ts` | `buildWebsiteOrder` (pure, tested): every piece re-quoted server-side; a moved rate refuses with the new total. `publicOrderView` |
| `src/lib/website/online.ts` | place, list, confirm, decline, the customer's view, the account's list, `sweepOnline` (on the five-minute tick) |
| `src/lib/website/slips.ts`, `fulfilment.ts` | slips; transfer received, lapse, ship, delivered |
| `src/app/api/public/{prices,quote,checkout,order/[id],order/[id]/slip}` | the site's routes: CORS to `WEBSITE_ORIGIN`, per-caller limits (an in-memory one for the reads), honeypot |
| `src/app/api/website/online[/id]`, `orders/[id][/slips/[slipId]]` | the shop's — owner or staff, **always** signed in (`staff-gate.ts`) |
| `components/order/online-inbox.tsx`, `website-order-panel.tsx` (`TransferDialog`) | the inbox cards; the order's Online panel and the hub's transfer check |
| `firestore.rules` | `online_orders`, `website_slips`: no client access (Admin SDK only) |

## Switched on (2026-10-04)

- **Bank details: the shop's, on WhatsApp.** Nothing in the system holds them for Taheri; the confirmation
  says they are coming and the order page says they come from +92 335 2275553. If a whole account is ever
  put in the environment (`NEXT_PUBLIC_STORE_BANK_LINE` "Bank — Title", or the title with
  `WEBSITE_BANK_NAME`, plus `NEXT_PUBLIC_STORE_IBAN`), the message and the page show it (`bankComplete`).
- **Only at a fresh rate.** The site prices and checkout takes orders only while the counter's gold rate
  was set in the last 36 hours (`maxRateAgeHours` in `app_settings/website`; `ratesFresh`). Older, every
  piece is "ask on WhatsApp" and the dashboard's Needs you says to set the rate (the rate sheet's gold.pk
  fetch is one tap). The rate was 3½ days old the day selling went on. A rate that did not move is set
  with the sheet's **Same today — confirm** (`store.confirmRates`): Save does nothing when no figure changed,
  so before it an unchanged rate could not be re-set and the site would have paused for it.
- **Pricing from the counter.** The website's making and wastage were test values ("set your own pricing
  before enabling"); they were replaced with the counter's own medians from 180 days of invoices
  (88 invoices, 103 gold lines): default Rs 1,500/g and 12%; rings and bands Rs 1,550/g and 10%; karas and
  bangles Rs 700/g and 15%; lockets, taweez and takhti Rs 1,950/g and 15%; tops, jhumki and baali
  Rs 2,950/g and 15%; chains Rs 1,500/g and 15%. Settings → Integrations changes any of it.
- **Still the owner's:** publish `firestore.rules` in the console — with the database open, anyone can
  write to it directly, online orders included.
- **Leopards** (optional): `LEOPARDS_API_KEY`, `LEOPARDS_API_PASSWORD`; without them a CN is typed in.

## Testing — on the emulator, never the live book

Confirming takes the next ORD- number, so a test against the live book leaves a hole in the
sequence. Use the Firestore emulator (Java 21 is in the cloud container):

```
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v*.jar --host=127.0.0.1 --port=8085 &
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-taheri WEBSITE_NOTIFY=off \
  NEXT_PUBLIC_STORE_BANK_LINE='Test Bank — Test' NEXT_PUBLIC_STORE_IBAN=PK00TEST0000000000000000 \
  npx tsx scripts/online-orders-e2e.mts          # 37 checks: place → confirm → slip → paid, decline, the tick
```

(Get the jar once with `npx firebase-tools emulators:start --only firestore`.) For the screens, run the
ERP with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 NEXT_PUBLIC_FIRESTORE_EMULATOR=127.0.0.1:8085
WEBSITE_ACTIONS_DEV_BYPASS=1 WEBSITE_NOTIFY=off` (+ the bank values) `npm run dev:taheri` and open
`/orders?dev=1`; the browser's Firestore follows `NEXT_PUBLIC_FIRESTORE_EMULATOR` in development only.
The site: `VITE_POS_API=http://localhost:3000 npx vite --port 5180` in taheri-site.
