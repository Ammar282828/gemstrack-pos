# Investments by Taheri

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Investments

- **Investments by Taheri in the POS** (`/website/investments`, 2026-09-25): the daily gold post is written by the owner's
  scheduled **Cowork routine on claude.ai** ("Investments by Taheri — daily post", 11:00; not editable from Claude Code) whose last
  step POSTs the four deliverables to `/api/investments` (multipart post/teaser/square/story, `Authorization: Bearer` the token in
  `taheri-post-kit/.pos-ingest-token` = secret `investments-ingest-token`). Filed per day in `investment_posts/{date}` + cards in
  `investment_media` (JPEG ≤ 900 KB). The page sends: post + square → `INVESTMENTS_GROUP_CHAT_ID` (120363362406867247@g.us, 469,
  admin-only, line is super admin; caption if ≤ 1024 chars else card then text), teaser → community announcements, story →
  Instagram (`/api/public/investments/[id]/story` via hosted.app). Each target once; resend asks. Manual add on the page too.
  **Automatic sending** (2026-09-25, owner: "automate the investment by taheri post sending … decide and choose when and how often"):
  the owner's schedule (`app_settings/investments_schedule`, rules in `src/lib/investments-schedule.ts`, tested) — on/off, days of the
  week, per part (group, **channel** — the post + card to `WHATSAPP_CHANNEL_ID`, WAHA only — teaser, Instagram) on/off and a Karachi
  time or "as soon as it arrives", a late cut-off, and "send by itself" or "wait for my OK". Cloud Scheduler job `investments-tick`
  (us-central1, `*/5 * * * *` Asia/Karachi, Bearer `CRON_SECRET`; the Cloud Scheduler API was enabled for it) calls `/api/investments/tick`,
  which sends only today's post, each part once (a Firestore-transaction claim guards overlaps), tries a failure three times, and writes
  `lastTick` (the page warns when it's over 15 min old). Ships **off**. Per day: Hold / Let it send, Approve, Try again; **Send all**
  sends every unsent part in order after one confirm. Both paths share `src/lib/investments-send.ts`.
