# Two houses, one codebase: what the variables drive

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

- What the variables drive: `src/lib/store-config.ts` (name, contacts, bank, links, allowed emails,
  default metal, margin, **brand**, logo, its aspect and its height in the sidebar (`NEXT_PUBLIC_STORE_LOGO_SIDEBAR_HEIGHT`, Mina 18 — its
  spaced capitals fill their file, so Taheri's 26 px was a banner; 2026-09-28), **counter staff** for "Taken by"); `globals.css`
  (`.dark .brand-mina:not(.theme-default)` is Mina's dark palette — muted burgundy with the catalogue's dusty rose
  #E8A5AE as the accent, 2026-09-25 (since 2026-10-25 a near-black wine ground #090405 and the rose #EBA9B3; values in web-matches-app.md a.1) — and `.brand-mina.theme-default` gives its light theme Mina's maroon #380000; Taheri's
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
  Invoices: `NEXT_PUBLIC_STORE_INVOICE_BY_CUSTOMER` ("Invoice - <customer>.pdf", never the number) and
  `_INVOICE_WHATSAPP_PDF` (Send via WhatsApp sends the PDF from the shop's line) are Taheri's (owner, 2026-10-05: "these
  are instructions for taheri pos"); Mina sets both "0" and keeps `Invoice-INV-….pdf` and the wa.me message with its link.
  The margin (`NEXT_PUBLIC_STORE_COST_RATTI_LESS`, default 6: gold costs the 24k rate less 6 ratti; decisions.md#margin) is
  Taheri's; Mina sets "none" — no 24k ask, no margin shown, Analytics keeps its `NEXT_PUBLIC_STORE_EST_MARGIN`.
  The order form's *save this size to the profile?* (`NEXT_PUBLIC_STORE_SIZE_TO_PROFILE`) is Taheri's; Mina sets "0".
  The Workshop list's starting filter (`NEXT_PUBLIC_STORE_WORKSHOP_START`, "you" | "anyone", default "you") is the signed-in person
  at Taheri; Mina sets "anyone" (owner, 2026-10-15). `/api/app/me` carries it as `shop.workshopStart` for the iPhone app.
  **Expense categories** are `NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES` (`lib/expense-categories.ts`; Taheri's list by default,
  Mina's own 15 since 2026-09-25, worked out from all its expenses); Partner Drawings, Partner Salary and Other are always
  added — `lib/partnership.ts` reads the first two by name. The expenses filter also offers any other name an expense carries.
  **WhatsApp alerts name their POS** (`lib/notify-label.ts`, owner 2026-09-26: "I get both"): every alert to the owner —
  live ones through `/api/notifications/send`, the scheduled reports, a website order to the shop — starts `*Taheri POS* · …`,
  or Mina's `NEXT_PUBLIC_STORE_NOTIFY_LABEL` ("House of Mina POS"). Messages to customers and the gold updates are not labelled.
- **One native app, many businesses** (`GET /api/app/business`, public, `Cache-Control: public, max-age=300`): the merged iPhone
  app (bundle `shop.taheri.erp`) asks any ERP address who it is before sign-in. It answers `{version:1, id, name, shortName,
  serverURL (the request's own https origin), metal, margin ({kind:"rattiLess",ratti} when `NEXT_PUBLIC_STORE_COST_RATTI_LESS`
  is a number, else {kind:"percent"} from `_EST_MARGIN`), palette {light,dark}{accent,ground,card,onAccent}, logo {light,dark,aspect},
  icon, ios {googleClientId, firebase}, flags}`. `flags` is `shopFlags()` (`lib/app-shop.ts`), the same function `/api/app/me`'s
  `shop` block spreads, so the two agree. New variables: `NEXT_PUBLIC_STORE_PALETTE` (compact JSON, `{"light":{…},"dark":{…}}`, each side accent / ground / card / elevated / onAccent as #RRGGBB (elevated added 2026-10-25: sheets, popovers, rows inside cards);
  Taheri's colours are the code's defaults, a missing or malformed colour falls back to them) and, run time only,
  `APP_IOS_GOOGLE_CLIENT_ID`, `APP_IOS_FIREBASE_API_KEY`, `APP_IOS_FIREBASE_APP_ID` (the iOS sign-in identifiers; defaults are Taheri's;
  `APP_ANDROID_FIREBASE_APP_ID` and `APP_ANDROID_GOOGLE_WEB_CLIENT_ID` do the same for the Android app, answered as `android: {…}` beside `ios`: a house that has not
  registered `shop.taheri.erp` writes `"none"` in both (Mina does, `apphosting.mina.yaml`) and is answered `android: null`;
  project, sender and bucket come from `NEXT_PUBLIC_FIREBASE_*`). All public identifiers. Mina's `APP_IOS_*` are the old
  `store.houseofmina.erp` app's until the owner registers `shop.taheri.erp` in Mina's Firebase project. Push needs nothing:
  `/api/push/devices` accepts any bundle id shaped like one (no allow-list), and the APNs key is team-scoped, so topic
  `shop.taheri.erp` works on Mina's server too.
- **Each ERP has its own icons** (2026-09-30, owner: "update favicons for each pos"; both showed the project template's
  orange flame, `src/app/favicon.ico`). `scripts/make-icons.mjs` writes `public/icons/<brand>/` — favicon.ico (16/32/48),
  icon-192/512, apple-touch-icon, maskable-512: Taheri's t (`public/brand/taheri-t.svg`) in white on #0A1111, Mina's
  interlocking monogram (the catalogue's icon, `public/brand/mina-monogram*.png`) in maroon #3A0000 on cream #FAF7F2. The
  layout links them by `STORE_ICONS` (store-config), `next.config.ts` rewrites `/favicon.ico` and `/apple-touch-icon.png` to
  them, and `src/app/manifest.ts` is the installed app ("Taheri ERP" / "House of Mina ERP", `POS_LABEL`) — the old
  `public/manifest.json` was linked from nowhere and pointed at icons that didn't exist. `env-for-house.mjs` now quotes
  values: unquoted, dotenv read `#1C1114` as a comment, so every colour variable was empty locally.

## Dated notes (moved from CLAUDE.md, 2026-10-05)

- Taheri's console `overrideEnv`: on 2026-09-26 its `NEXT_PUBLIC_STORE_WHATSAPP_URL` (the Collections community invite) was
  removed so the YAML's `wa.me` chat applies.
- A stale `.env.mina.local` gave a local Mina Taheri's menus (2026-09-25): re-run `npm run env:mina` after changing either YAML.
- `.env.local` is Mina's on the second laptop: when it names another Firebase project, `env:taheri` blanks its variables too
  (2026-09-26).
- The old `main` (before the forks reconverged) is the tag `old-main-2026-06`.
- Taheri's console `overrideEnv` (19 variables) holds the Firebase config, `NEXT_PUBLIC_STORE_NAME` "Taheri", contacts,
  the bank line and Instagram.
