# Ads

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

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
