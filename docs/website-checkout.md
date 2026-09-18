# Selling from taheri.shop — how it works, and what must be true before it is switched on

The public site is a catalogue of photographs with no prices. This feature lets a
visitor buy one without the site ever knowing a price: the site asks the POS, the
POS answers from the piece's burned-in weight and today's rate through the same
`calculateProductPrice` an invoice uses, and at checkout the POS creates the product
and the order together. Nothing exists in inventory until it is bought.

## The parts

| where | what |
|---|---|
| `src/lib/website/pricing.ts` | `quotePiece` — gold, palladium, coloured stones; diamonds are enquiries by default; no readable weight → no price |
| `src/lib/website/checkout.ts` | `buildWebsiteOrder` (pure, tested) → `placeWebsiteOrder`. Every piece is re-quoted server-side; a moved rate refuses with the new total |
| `src/lib/website/fulfilment.ts` | transfer received → ship (Leopards API, or a CN typed in) → delivered; each tells the customer on WhatsApp |
| `src/app/api/public/{quote,checkout,order/[id]}` | the site's three routes. CORS to `WEBSITE_ORIGIN` only, per-caller rate limits, honeypot |
| `src/app/api/website/orders/[id]` | the shop's actions — owner or staff, **always** signed in. Deliberately does not follow `NEXT_PUBLIC_OPEN_ACCESS`: it marks money received and goods shipped |
| **Website → Photo Weights** (`/website/weights`) | record the weight of photographs that do not carry one in their corner. One photo at a time, one field, Enter saves and moves on. The site draws it onto the photo like the burned-in ones and prices from it. Stored in `website_pieces`; read through `/api/website/pieces` |
| Settings → Integrations → *Selling on taheri.shop* | the switch, default and per-collection pricing, diamond policy, delivery, the POS category |
| Orders | a **Website** badge in the list; the order page carries payment state, the three moves, and the customer's link |

The site reads `/catalog-attributes.json` (published by its build) for weights; the
POS reads the same file — never the values a browser sends.

## Before the switch goes on

1. **Bank details, in the environment.** `NEXT_PUBLIC_STORE_BANK_LINE`
   ("Meezan Bank — Taheri Jewellers") and `NEXT_PUBLIC_STORE_IBAN` in apphosting.yaml.
   Both are declared and **empty** today. They are read from the environment on purpose:
   nothing that can write to the database can change where a customer's money goes.
2. **Close the database.** `firestore.rules` is `allow read, write: if true` (opened
   2026-09-07). While it is, anyone can create orders directly and edit the pricing
   document. Restore `firestore.rules.locked` (it already contains the website rules)
   and deploy the ruleset. Selling online with the book open is not safe.
3. **Set the pricing** in Settings → Integrations: a POS category for website products,
   the default making charge per gram, wastage, and any per-collection rows. Until a
   making charge is set the site shows no prices.
4. **Weights.** 1,215 of 2,272 pieces carry a readable weight; only those get a price.
   The rest stay "Inquire" until a weight is added.
5. **Leopards** (optional): `LEOPARDS_API_KEY`, `LEOPARDS_API_PASSWORD` as secrets.
   Without them the order page takes a consignment number typed in by hand.
6. Deploy both: merge `website-checkout` here (App Hosting rolls out on push to main)
   and `checkout` on the site (its workflow deploys on push to main).

## Testing locally

Run the POS under **Node 20** (`POS (node 20)` in `.claude/launch.json`): on Node 26
the Google auth library's fetch fails against `oauth2.googleapis.com`. A dev-only
`.env.development.local` with `WEBSITE_NOTIFY=off`,
`WEBSITE_ORIGIN=http://localhost:5180`,
`WEBSITE_CATALOG_URL=http://localhost:5180/catalog-attributes.json` and test bank
values lets a checkout run end to end against the live book without messaging anyone.
To exercise the shop's actions without signing in, add `WEBSITE_ACTIONS_DEV_BYPASS=1`
to that same dev-only file — it is server-only and refused in production.
Delete the test order, its `WEB-` product and customer afterwards, and put
`lastOrderNumber` back. `npm test` covers the pure parts.
