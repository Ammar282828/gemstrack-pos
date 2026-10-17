# Insights

<a id="insights"></a>
**Insights** (`/insights`, 2026-10-17; owner: "all analytics possible to track on the instagram and facebook for both
business, the metrics through ads and organically"). A sidebar row in Marketing, beside Ads, for owners and the marketing
account (`adsGate`). Three tabs: **Overview · Posts · Audience**. Code: `src/lib/social-insights/` (`shape.ts` pure and
tested, `fetch.ts` Meta, `snapshot.ts` the hourly keep), `/api/insights?part=overview|posts|audience&range=`, `src/app/insights/`.

**No new login or permission.** It reads through the Ads connection (`meta-ads-token`); both houses' logins already hold
`read_insights`, `instagram_manage_insights` and `pages_read_engagement` (checked 2026-10-17). The Instagram account and
Page are the ones chosen on Ads → Setup (`app_settings/meta_ads`). Taheri's Page "Taheri Collections" has **no Instagram
linked**; @collectionstaheri is reached through the Taheri business, which works for insights.

**What Meta gives, probed live on both houses (v25/v26, 2026-10-17)** — Meta retires metrics often, so re-probe before
adding one:
- Instagram account, `metric_type=total_value`, ≤ 30 days a call: reach, views, accounts_engaged, total_interactions,
  likes, comments, shares, saves, replies, reposts, profile_views, website_clicks, profile_links_taps,
  follows_and_unfollows. Breakdowns: `media_product_type` (POST, CAROUSEL_CONTAINER, REEL, STORY, **AD**) on reach, views,
  total_interactions — that is the **paid / organic split**; `follow_type` on reach, views (followers vs new people) and
  follows_and_unfollows (FOLLOWER = follows, NON_FOLLOWER = unfollows); `contact_button_type` on profile_links_taps.
  Day by day (`period=day`): only reach and follower_count. Gone: impressions, plays, email/phone/directions taps.
- Audience (`period=lifetime`, no history): follower_demographics, reached_ and engaged_audience_demographics
  (`timeframe=this_month`) by age, gender, city, country; online_followers (hours in Pacific time; moved to Karachi;
  empty for both houses so far — Meta withholds it from smaller accounts).
- Each post: reach, views, likes, comments, shares, saved, total_interactions, profile_visits, follows; reels add
  ig_reels_avg_watch_time and facebook_views (cross-posted). Stories: reach, views, replies, shares, navigation… only
  **while the story is up**.
- Facebook Page (Page token from the user token): page_media_view, page_total_media_view_unique,
  page_post_engagements, page_views_total, page_daily_follows_unique / unfollows, page_video_views. Posts:
  post_media_view, post_total_media_view_unique, post_clicks + reactions/comments/shares counts. **Gone:**
  page_impressions*, page_fans*, page fan demographics, post_impressions*; no paid/organic split on Page views.
- Paid: Ads Insights by `publisher_platform` (`paidByPlatform`), against the period before.

**Each group of metrics is one call, retried one metric at a time if Meta refuses it**, so a retired metric loses its
own number; what Meta refused is listed under the page ("Meta didn't answer for…").

**What Meta forgets, kept** (`snapshot.ts`, hourly from the five-minute `social-queue-tick` — the cloud sessions can't
create Scheduler jobs): `social_daily/<YYYY-MM-DD>` (Instagram and Page follower counts — the follower line), and
`social_stories/<id>` (each live story's numbers, re-read hourly, the last read before it ends is its count; its picture
copied to Storage `social-stories/<id>.jpg` because Meta's link dies with it). State: `app_settings/social_insights_snapshot`.

**What it says** (`findings()`, tested): ads' share of the reach (≥ 70% warns), reels vs photo posts by median reach,
how little reached new people, follower growth or loss, profile visits that don't tap the link, followers outside
Pakistan, days since the last post, an older post carrying the range, the busiest online hours. Each only when the
data behind it is big enough.

**Ranges**: 7, 14, 28 days, this month (≤ 30: Instagram's limit). Cached 5 minutes per part and range; Refresh asks again.
**Posts** lists the latest 50 Instagram posts and reels with lifetime numbers (an older one still being watched is marked
— House of Mina's month of 2026-10 was carried by reels from before it), the range's Facebook posts, and the stories.

**iPhone app**: the native app (`apps/iphone`) has its own Insights screens on the same route (`InsightsScreens.swift`);
the Capacitor shell shows the web page.
