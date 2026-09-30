# Two houses, one codebase: what the variables drive

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

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
- **Each ERP has its own icons** (2026-09-30, owner: "update favicons for each pos"; both showed the project template's
  orange flame, `src/app/favicon.ico`). `scripts/make-icons.mjs` writes `public/icons/<brand>/` — favicon.ico (16/32/48),
  icon-192/512, apple-touch-icon, maskable-512: Taheri's t (`public/brand/taheri-t.svg`) in white on #0A1111, Mina's
  interlocking monogram (the catalogue's icon, `public/brand/mina-monogram*.png`) in maroon #3A0000 on cream #FAF7F2. The
  layout links them by `STORE_ICONS` (store-config), `next.config.ts` rewrites `/favicon.ico` and `/apple-touch-icon.png` to
  them, and `src/app/manifest.ts` is the installed app ("Taheri ERP" / "House of Mina ERP", `POS_LABEL`) — the old
  `public/manifest.json` was linked from nowhere and pointed at icons that didn't exist. `env-for-house.mjs` now quotes
  values: unquoted, dotenv read `#1C1114` as a comment, so every colour variable was empty locally.
