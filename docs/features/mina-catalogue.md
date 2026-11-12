# House of Mina's catalogue (catalogue.houseofmina.store)

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._


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

## The ERP keeps the last good list (2026-11-12)

Owner: "whenever I add new products to the catalogue the post feature stops loading the photos properly and doesn't
load at all". Publishing new pieces keeps the catalogue's shared Hostinger host busy, and from the ERP's servers (Google,
us-central1) it then took over 8 s to answer: Mina's log showed `/api/website/site-pieces` 502 after 16.8 s (two 8 s tries)
while `catalog-pieces.json` was replaced (12:01-12:02, file dated 12:02:52) and again at 13:20, and the Posts page's health
check timing out at 8 s each time. The ERP held the list only in each server's memory for ten minutes, so a server that had
just started had nothing to fall back on: the page failed, and every photo with it (`site-pieces/image` reads the list).

`lib/website/site-pieces.ts` now serves the last good list at once and asks the site in the background once it is a minute
old (one read at a time per server); the list is also kept in Firestore (`site_pieces_cache`, gzipped, ~90 KB) for a server
that has just started. A slow or failing catalogue only makes the list a little older; the page waits for the site only when
there has never been a list. A photo asked for a piece this server has not heard of yet (another server's copy is newer)
asks the site once before answering 404. New pieces appear within about a minute of the site answering, not ten.
