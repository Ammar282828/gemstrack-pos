# AI: the key and the scanners

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Vertex AI key

- **One Vertex AI key for all AI, both houses** (2026-09-29, owner: "use this key for everything now", after Murtaza's
  project lost billing). Post a Piece, the website captions, retouch's check, the Ads helper, voice, the bill/order scanners
  and the gold update all send `x-goog-api-key` to Vertex's keyed endpoint (`aiplatform.googleapis.com/v1/publishers/google/
  models/<model>:generateContent`, no project in the path; `src/lib/ai-key.ts`), billed to the key's own project — number
  847960974510, not Taheri's, Mina's or Jewel Gen. The key lives **only** in Secret Manager `vertex-ai-key` in gemstrack-pos,
  read at run time (never declared in the YAML — a missing secret is "not set up", not a failed rollout; never in any committed
  file — gemstrack-pos is public); Mina reads the same one (`VERTEX_AI_KEY_SECRET` = `projects/gemstrack-pos/secrets/vertex-ai-key`).
  Readers: `firebase-app-hosting-compute@` both projects and `claude-cloud@gemstrack-pos`. Kept 5 min, a missing one re-asked
  after 1 min — so creating or rotating it needs no deploy. No key → the old signed path (IMAGE_AI_PROJECT / VERTEX_PROJECT).
  `VERTEX_AI_KEY` (or `GEMINI_API_KEY`) as a variable wins, for local runs. Every model in use answers through it
  (gemini-3-pro-image, 3.1-pro-preview, 3.8-flash, 3.6-flash, 2.5-flash; 3.5-pro still 404). The checks panel says which
  way the AI is billed; `diagnose` names the project Google complains about and knows a refused key.
  **Its project's per-minute quota is tiny** (measured 2026-09-29: a handful of calls a minute, then 429 "Resource has been
  exhausted (e.g. check quota)" with no details, on the keyed and the global route alike). So `call()` waits out a 429
  (5 s, 15 s, 30 s) instead of failing, and the checks panel's ping (thinking `low`, no retries — left alone it thought for
  up to 5 s and, with a retry, blew the panel's 8 s) shows a rate limit as a warning, not "timed out". The fix is the key
  project owner's: raise its Vertex AI per-minute quota (IAM & Admin → Quotas).

### Scanners

- **The scanners read with Gemini 3.1 Pro and copy the paper's own hisaab** (2026-09-29, owner: "scan a parchi feature should
  also use ai"). Scan a parchi (`/api/vision/order`) and Read a written bill (`/api/vision/bill`) ask for `scanModel()`
  (`lib/vision/scan-model.ts`: `SCAN_AI_MODEL`, else **gemini-3.1-pro-preview**; one Google doesn't serve falls back to voice's
  gemini-2.5-flash), wait out the key's rate limit (`patient`), and read every text part of the answer (the first alone could be
  half a JSON — the 236 s "Could not read that back" of 2026-09-26). Both prompts now copy **wastage in grams** (`wastageG`, turned
  into the percent the ERP prices with by `lib/vision/wastage.ts`, tested), the weight **before** a stone weight comes off (the
  ERP subtracts `stoneWeightG` itself), and the bill scanner the **rate** (per line or once at the top) — `billRates` sets that
  karat's box in the cart — and its **discount**, so a scanned estimate lands at the paper's own total instead of being
  re-priced at today's rate. Measured on the two Taheri estimates of 2026-09-29: 2.5-flash and 3.1 Pro read every figure
  (10/10, 17/17; Pro ≈ 5 s once the rate limit lets it through), **gemini-3.8-flash returned no lines at all** — never use it here.
