# Ads

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

> **2026-10-12:** Ads is **Overview · Campaigns · Plan · New ad · Setup**. The Studio tab is gone — its research half is **Ads › Plan**,
> its design half is **Posts › Design** ([design.md](design.md)). New ad still reads `?piece=` and `?studio=<key>`; Design's Publish
> sheet hands a design to it (both sizes) for owner and marketing.

### Ads

- **Ads** (`/ads`, 2026-09-26; owner: "connect my Ad account api and have all ad related functionality for both
  @collectionstaheri and @houseofmina__ on each respective pos"): Overview (spend, reach, results vs the period before, day by
  day, top ads, age/gender · placement · region, flagged ads), Campaigns (tree with run/pause switches, budget, end date,
  audience, rename, duplicate, archive, delete, Meta's previews and review notes), New ad, Audiences, Rules, Setup. Owner's
  answers: **open like the rest of the POS** (no sign-in to spend — superseded 2026-09-30, both houses sign in), and **ad spend stays out of the books** (no expenses,
  not in Analytics). One Meta app for both houses (`META_APP_ID` 1075984878628188 in the base yaml, the same app Taheri's
  Instagram stories use); each POS connects its own Facebook login (`/api/ads/connect` → `callback`, redirect
  `https://<pos>/api/ads/callback` registered with the app) and keeps the token in **its own project's** Secret Manager
  `meta-ads-token` (runtime account: accessor + version adder; a system-user token pasted raw also works); the app secret is
  read at runtime from `meta-app-secret`, so neither is declared in the yaml and a missing one is a Setup step, never a
  failed rollout (`src/lib/secret-manager.ts`). Ad account / Page / Instagram chosen on Setup (`app_settings/meta_ads`);
  `META_ADS_INSTAGRAM` per house picks the house's own account and flags the other house's; every object route checks
  the object is this house's ad account. **Meta needs a Facebook Page behind every new ad** (even Instagram-only) — reading
  and running existing ads needs none. New ads (`src/lib/ads/plan.ts`, tested): goals WhatsApp chats, Instagram messages,
  website visits, profile visits (least documented), engagement (existing posts only), reach; one campaign → one ad set →
  one ad, created paused and switched on bottom-up only if asked, the half-made campaign deleted on any failure
  (`create.ts`); `is_adset_budget_sharing_enabled: false` (required since v24); `targeting_automation` always sent
  (Advantage+ fixes age_max 65 and a firm age_min ≤ 25; the asked range goes in as `age_range`); no Explore placement
  (v26 refuses it). **Photos are never changed by Meta:** every Advantage+ creative feature is `OPT_OUT`
  (`NO_ENHANCEMENTS`; an unknown key Meta rejects is dropped and retried). Audiences: POS customers by segment
  (all / bought / last year / lapsed), SHA-256 on the server (`audience-rows.ts`, tested), Instagram engagers, lookalikes.
  Rules are Meta's own automated rules (`adrules_library`). Every change is logged in Firestore `ads_log` (shown on Rules).
  Not yet run against the live API when shipped — field names come from Meta's v25/v26 docs; errors show Meta's own words.
  **The Ads helper** (2026-09-27, owner: "an ai helper in the ads account tab … context from the ad account … float around in
  the ads tab only and use gemini latest pro model"): a floating button on every Ads page only (`src/app/ads/layout.tsx` →
  `assistant.tsx`; above the voice button; bottom sheet on a phone), chat kept per device (`taheri_ads_chat`), following the
  page's range. `/api/ads/assistant` → `src/lib/ads/assistant.ts`: a snapshot of the account for the range (totals vs before,
  daily, every campaign → ad set → ad with results, top ads, age/gender · placement · region, flagged ads, audiences, rules,
  `ads_log`) in the system prompt, plus two **read-only** tools (`get_insights` any range/level/breakdown, `get_details`);
  `chatTurn` in `social/ai.ts` sends Gemini 3's signed tool calls back unchanged. Billed like Post a Piece's AI
  (`IMAGE_AI_PROJECT`, Murtaza's; locally his ADC). Model: `ADS_AI_MODEL`, else **gemini-3.5-pro**, else 3.1 Pro — 3.5 Pro's
  card exists but the project gets 404 (2026-09-27), so it answers with `gemini-3.1-pro-preview` (~20–30 s) and moves up by
  itself when access opens. Capped `ADS_AI_DAILY_CAP` (200) a day + 40/h per caller.
  **Everything visible, and in Ads Manager** (2026-09-27, owner: "all ad sets / pic / ads / creatives should be easily visible and
  appear on ad manager"): the ERP makes ordinary objects in the ad account, so they are in Ads Manager (uploads in its media
  library) by nature; every row and card has **Open in Ads Manager** (`adsManagerUrl`, tested). Campaigns opens with every
  campaign and ad set unfolded (Fold all / Open all) and 64-px pictures, and has an **Ads & pictures** view: every ad as a card
  with its picture (the creative's `image_url`, or a 480-px `thumbnail_url` for boosted posts and videos), words, button, place,
  numbers, run/pause. New ad → New photos can reuse any picture already in the account (`/api/ads/library` → `act/adimages`).
  **Improvements of 2026-09-27** (owner: "add any improvements to the ads manager"): **Needs a look** on the Overview
  (`src/lib/ads/attention.ts`, pure, tested — the account on hold or near its spending limit, nothing running, rejected /
  flagged, spent 2 days' budget with no result → *Pause*, cost per result 2.5× the account's median, frequency ≥ 3, learning
  limited, ending within 3 days, a paused ad set that was cheaper than what runs → *Run again*; bad → warn → tip), the
  **month's pace** line (spent so far → projected, vs last month), **▲▼ against the period before** on every campaign row
  (`campaignTotals`), the gallery's **sort** (spent / results / cheapest result / click-through / name) under the same status
  filter, **Make one like this** on any ad (`/api/ads/template?ad=` → New ad `?from=`: same photos by hash or the same post,
  words, button, link, audience, budget), and the **daily WhatsApp ads summary** (`src/lib/ads/digest.ts`, tested; task
  `ads-daily` in `/api/notifications/run`; Cloud Scheduler `ads-daily-summary` 09:30 Asia/Karachi in **both** projects, at the
  hosted.app addresses, Bearer `CRON_SECRET`; sent only when Settings → Notifications → **Ads Summary** (`notifAdsDaily`) is
  on — ships off). The Ads helper's snapshot carries the same attention list.
  **Connecting needs, in the Meta app** (all hit on 2026-09-26): App domains `taheri.shop` + `houseofmina.store` and both
  `…/api/ads/callback` under Facebook Login for Business → Valid OAuth redirect URIs (else "Can't load URL"), and a **login
  configuration** (FLfB → Configurations: User access token + the ads/pages permissions) whose ID is pasted on Ads → Setup
  (`app_settings/meta_ads.loginConfigId`, or `META_LOGIN_CONFIG_ID`) — the app is Business-type and answers a plain `scope` list
  with "Invalid Scopes: ads_management, …". **New ads need the app Live** (2026-09-28): a new ad's photos and words become a post
  the app makes, and Meta runs an app's post only once the app is Live ("…created by an app that is in development mode. It must
  be in public", subcode 1885183) — reading, pausing and ads from an existing Instagram post work in Development mode. `metaError`
  turns that refusal into `APP_NOT_LIVE`; Setup step 1 reads what the switch asks for with the app token (`appLiveReadiness`:
  privacy policy URL, category, a real icon — Meta exposes no mode field) and gives the values (`APP_PAGES`: taheri.shop's
  `/privacy` and `/data-deletion`, `META_APP_PRIVACY_URL` / `_DATA_DELETION_URL` to change them).

### Ads Manager gaps closed (2026-10-16)

Owner: "check if there is absolutely anything that i can do on the ad manager that i cant do in my erp and add it".
Checked against six months of Mina's activity log (the agency, xMedia House, works in Power Editor; the owner in the ERP)
and every campaign: all are Sales, Advantage+ audience, automatic bidding, optimising for Purchase.

- **Sales and ROAS** (`salesOf`, `roasText` in `shape.ts`, tested): insights now ask for `action_values`, so purchases carry
  their order value. Overview: Sales from ads · ROAS · Cost per purchase tiles when anything sold, and purchases lead
  `mainAction` (it used to fall back to link clicks on a sales account). Campaigns: sales and ROAS on every campaign, ad set and
  ad row, "Best ROAS" in the gallery sort; Overview's top ads show ROAS. Purchases are the biggest of `omni_purchase`,
  `offsite_conversion.fb_pixel_purchase`, `purchase`, `onsite_web_purchase` (one purchase, several names), never their sum.
- **Website audiences** (`websiteRule` in `audience-rows.ts`, tested; `createWebsiteAudience`; Audiences → Website visitors):
  from the chosen pixel, 7–180 days: every visitor, viewed a piece, added to cart, started checkout, bought, and added to cart
  but did not buy (Purchase excluded). Lookalikes take any of them as the source, as the agency's "Lookalike – pixel –
  Website using Purchase" audiences did.
- **UTM tags** (`URL_TAGS` in `plan.ts`, tested): every website/sales creative the ERP makes carries
  `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}`,
  so Shopify reports which ad a visit and an order came from. Chat ads carry none.
- Already covered, no change: Advantage+ audience's hard minimum age (`age_min` ≤ 25) and custom audiences as suggestions
  (Meta treats them so when `advantage_audience` is 1).
- **The rest, second pass (2026-10-16, owner: "Add all the other features")**. Meta's request shapes were checked against
  the v25 docs and the official Python SDK; Meta can still refuse one the docs leave unclear, and it answers in its own words.
  - **New video** (New ad → New video; `/api/ads/videos`, `graphUpload` in `meta.ts`): Meta's resumable upload
    (start / transfer the byte range Meta asks for / finish) on graph-video.facebook.com, one piece per request so any size
    passes the server's limit (≤ 1 GB, a piece ≤ 28 MB); then a status poll, and Meta's preferred cover frame is put in the
    image library (a video creative needs a cover; Meta's CDN links aren't meant for creatives). Creative: `video_data` with
    `image_hash`, with `video_auto_crop`, `video_uncrop`, `video_filtering` opted out too. Not for "WhatsApp or Instagram chats".
  - **A creator's post / partnership ads** (New ad → A creator's post; `/api/ads/partner`): the creator's ad code is checked
    on `/{business}/partnership-ads-advertisable-content` (the old `branded_content_advertisable_medias` edge goes on
    2026-12-01), and the creative is `branded_content.instagram_boost_post_access_token` + `ad_format: 1` (both names in the
    header) with the brand as sponsor on Instagram and Facebook. Runs as it is, like a boosted post.
  - **Catalogue ads** (New ad → Catalogue, "Online orders" only; `/api/ads/catalog`): the business's catalogues
    (owned + client) and their product sets; the campaign promotes the catalogue, the ad set the set (with the pixel's
    Purchase); "Bring back lookers" = ViewContent or AddToCart in 14 days and no Purchase (`product_audience_specs`), "Find new
    buyers" = everyone but 14-day buyers (`excluded_product_audience_specs`). Creative: `template_data` with
    `{{product.name}}` / `{{product.price}}`, no enhancements (Meta: none for catalogue ads). OUTCOME_SALES with a campaign
    catalogue is the documented replacement in practice, not in words (PRODUCT_CATALOG_SALES is deprecated).
  - **A/B tests** (Ads → Setup → A/B tests, `/ads/tests`; `study.ts`, tested): 2–5 existing ad sets, an even split
    (`evenSplit`), 1–30 days, optionally judged on the pixel's purchases (retried without if Meta refuses the objective). Made on
    `/{business}/ad_studies` (Meta has no create edge on the ad account). Each side's spend, results, cost per result and
    ROAS from Insights over the test's dates; "ahead" is the lowest cost per result so far, Meta's verdict with its confidence
    stays in Ads Manager → Experiments (linked).
  - **Bid strategy and hours** (New ad → Budget → Advanced; `biddingParams`, `scheduleParams`, tested): most results, cost per
    result cap (`COST_CAP`), bid cap (`LOWEST_COST_WITH_BID_CAP`), minimum ROAS for "Online orders"
    (`LOWEST_COST_WITH_MIN_ROAS`, `roas_average_floor` ×10,000, optimising for VALUE); set days and whole hours in the viewer's
    time zone (`adset_schedule`), which Meta allows only with a total budget.
  - **CSV export** (Campaigns → Download (CSV); `export.ts`, tested): every campaign, ad set and ad in the range, with spend,
    results, purchases, sales and ROAS; opens in Excel and Google Sheets.
  - **Conversions API: nothing to add.** Mina's pixel (1429906491670575) gets server events from Shopify's Facebook &
    Instagram app in real time; Purchase match quality 9.3/10 (email, phone, name, city all sent). The gap is elsewhere: only
    ~25% of purchases carry Meta's click id (`fbc`), and orders closed on WhatsApp or by cash-on-delivery in the ERP never reach
    Meta at all, so chat ads look worse than they are. Sending ERP orders to Meta (offline Purchase events) is the next lever,
    an owner's decision because it hands customer records to Meta.
  - Not added: editing the bid strategy or hours of an ad set made elsewhere (Ads Manager), Meta's lift studies.

## Speed (2026-10-23)

The owner: "the erp refresh times for meta ads is laggy and unresponsive". Measured on Cloud Run over 14 days: Overview p90 3.5 s
(Mina 6.5 s, one 30 s), Insights p90 10.9 s. Every Ads page waited on `/api/ads/status` (three Meta trips in a row) before asking
for its numbers, and Overview made 3–4 trips in a row. Now: a page opens on the tab's last status and loads its numbers alongside;
status runs its checks at once, with the login check kept 2 minutes and the app's Live details 10; the ad account's details are
kept a minute and shared; Overview is one parallel step (its campaign tree without ad-level numbers or big pictures), kept 90 s and
then served at once for 10 minutes while refreshed behind (`lib/ads/swr.ts`, which also shares one trip between callers asking
at once). Campaigns runs its calls together and keeps no cache (actions reload it). Refresh, Check again and Try again always ask
Meta now. `minInstances: 0` still means a cold start can be slow; that is a cost choice.

