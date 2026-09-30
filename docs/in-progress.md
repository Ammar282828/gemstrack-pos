# In progress and open items

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### In progress

- **Editing existing website pieces from the POS** (owner, 2026-09-26: "fix/crop/add logo weight overlay to existing,
  change desc etc in taheri.shop or catalogue.houseofmina.store"). Mapped across the POS, taheri-site and mina-catalogue,
  designed, **not built**, four questions open for the owner: **`docs/edit-website-pieces.md`**.
- **Meta app settings for Ads** (2026-09-26): Connect stopped at Facebook's "Can't load URL — the domain of this URL isn't
  included in the app's domains". Fix is in the Meta app (1075984878628188), not the POS: App domains `taheri.shop` +
  `houseofmina.store`, Client and Web OAuth login on, both `https://pos.<house>/api/ads/callback` as redirect URIs.
  Ads → Setup step 1 now lists exactly these with copy buttons. Connecting works now (both houses have an ad account and Page).
  **Next: the app must go Live** (2026-09-28): the first new ad came back "Ads creative post was created by an app that is in
  development mode. It must be in public to create this ad." Read off the app that day: no privacy policy, no category,
  Meta's stock icon, terms pointing at facebook.com. taheri.shop now has `/privacy` and `/data-deletion` (taheri-site), the icon
  is `public/brand/meta-app-icon-1024.png`; the owner fills those in App settings → Basic and flips App Mode → Live.
  **And the login configuration lacks two permissions** (2026-09-29, New ad → A post answered "(#10) Application does not
  have permission for this action"): both houses' tokens hold ads_management, ads_read, business_management, pages_show_list,
  pages_read_engagement, instagram_manage_comments — **no instagram_basic, no pages_manage_ads**. Facebook grants only what the
  configuration names, so reconnecting alone changes nothing: add both to the configuration (FLfB → Configurations →
  Permissions; instagram_basic appears once the Instagram use case with Facebook Login is added), then Connect again in each
  ERP. Until then Taheri lists its posts through the story login (no boost answer), Mina can't list them, and the Studio's
  competitor look-ups fail. Setup now counts instagram_basic as required and says to edit the configuration.
  Reconnected 20:52 with both: posts now list through Meta with their boost answer. **The Studio's competitor look-ups
  (Business Discovery) also need `instagram_manage_insights`** (Meta's reference: instagram_basic + instagram_manage_insights
  + pages_read_engagement) — #10 even for @instagram without it; now in SCOPES and Setup's list.
- **Meta's own Ads connector in Claude** (2026-09-30, owner added it at claude.ai/customize/connectors: `https://mcp.facebook.com/ads`,
  Meta's first-party Ads MCP): a chat session sees every ad account the owner's Facebook login holds (Taheri Main 28476788078639222,
  House of Mina 2078697546326565, plus two personal ones) and can read, pause, edit and create ads — through Meta's app, so it is not
  held back by our app's Development mode. Its **Ad Library search covers Pakistan's commercial ads** (our Graph API route doesn't): the
  Studio's rivals now carry `adPageId`/`adPageName` found that way (10 of 14; Chhotanis, Kiran and Sherezad have run no Meta ads), and
  "Their live ads" opens the Page's ads (`adLibraryUrl(name, pageId)`) instead of a word search that matched a magazine and a salon for
  "Al Syed". The ERP itself cannot call the connector; it is the chat's. Its token also asks for `ads_mcp_management`, which is why that
  permission showed on the ERP's login configuration — the ERP doesn't need it.

### Open items after the reconvergence (2026-09-22)

- `NEXT_PUBLIC_STORE_TAKEN_BY` in `apphosting.mina.yaml` is a guess (Mina, Ammar, Murtaza) — Mina's fork never had
  "Taken by". Ask the owner for Mina's counter names and correct it.
- `website-checkout` is retired but not deleted; delete it once nobody has it checked out elsewhere.
- Mina's `firestore.rules` and Taheri's differ (Taheri's are open); App Hosting does not deploy rules, so each
  project keeps whatever was last deployed with the Firebase CLI.
