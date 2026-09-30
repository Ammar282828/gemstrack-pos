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
