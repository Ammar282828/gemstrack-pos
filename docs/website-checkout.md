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
| **Confirmed** (or declined) | WhatsApp: bank details + the price held 24 h (`WEBSITE_HOLD_HOURS`); the same link now shows them and takes the slip. Declined: the reason, "nothing has been charged" | Orders → **Online — to confirm** (top of the hub; sidebar count; dashboard's Needs you). Confirm writes the products and an `ORD-` order through `createOrder`, stamped with the **quoted** rates, `source: 'website'`, `website.onlineId`, items fixed at the quoted price (`isManualPrice`). The card shows what the same pieces cost today. Two people pressing Confirm make one order (claimed in a transaction) |
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

## Before the switch goes on

1. **Bank details, in the environment** (never Firestore: nothing that writes to the database can
   change where a customer's money goes). `NEXT_PUBLIC_STORE_BANK_LINE` = "Bank — Account title", or
   the title alone with the bank in `WEBSITE_BANK_NAME` — Taheri's line is a console `overrideEnv`
   ("Taheri Collections", which beats the YAML), so its bank goes in `apphosting.taheri.yaml` as
   `WEBSITE_BANK_NAME` — and `NEXT_PUBLIC_STORE_IBAN` (or `WEBSITE_BANK_ACCOUNT`). Confirm refuses
   while they are empty. The help pages promise the title reads **Taheri Collections**.
2. **Publish `firestore.rules`** (owner, console). With the book open anyone can write orders.
3. **Pricing** in Settings → Integrations (set: making 1,500/g, delivery Rs 500, free over 300,000),
   then the switch on.
4. **Rates set daily** at the counter — the price book quotes whatever is there.
5. **Leopards** (optional): `LEOPARDS_API_KEY`, `LEOPARDS_API_PASSWORD`; without them a CN is typed in.

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
