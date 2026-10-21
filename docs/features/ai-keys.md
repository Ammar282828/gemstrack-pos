# AI keys — Connect an AI

The owner, 2026-10-21: "an API key thing so that I can use other AI to go into the ERP and make posts for me and stuff."
The decision is [AI keys](../decisions.md#ai-keys). Both houses have it, from their own variables (name, ERP address, flags);
nothing new to configure and no new secret.

## What it is

- **Settings → Connect an AI** (`/settings/ai`, owners only): make a key for one AI — a name ("ChatGPT"), what it may do, and
  when it stops (never, 30 or 90 days, a year). The key is shown **once**, with copy-paste setup for Claude, ChatGPT, Gemini CLI and
  Cursor. The list shows every key (the Studio's too): what it may do, who made it, last used, calls, connectors signed in, Revoke.
- **Two doors, one list of tools.** MCP at **`/api/agent/mcp`** (Streamable HTTP, JSON answers) and a REST twin at
  **`/api/agent/v1/<tool>`** (POST, the tool's input as the body), described by **`/api/agent/openapi.json`** (OpenAPI 3.1, the
  house's own ERP address as the server, bearer auth; `?scopes=read,posts:draft` narrows it to one key's tools — a GPT takes 30
  actions at most). All three come from `src/lib/agent/tools.ts`.
- **What the AI did** is in Settings → Activity under the key's name: every call (reads included, as `ai.read`; filter **AI keys**),
  and every change to the books as the write's own line ending "· via ChatGPT".

## Scopes

| Scope | Default | Lets the AI |
|---|---|---|
| `posts:draft` Make posts | on | find photographs, make a story and a square post in the house's layouts, see them, queue them **for the owner's OK** |
| `posts:publish` Send posts | off | send or schedule queued posts (its send is the OK) |
| `read` Read the books | on | Home's figures, Today's cash, what is owed, orders, invoices, customers, repairs, stock with today's price, rates, a month's figures |
| `write:shop` Change the shop | off | customers, order status, repairs, given items, the team note; deleting a repair or given item with the delete code |
| `write:money` Take money | off | sales (invoices from stock), payments, order advances, repair payments, expenses, rates; deleting a payment, advance or invoice with the delete code |
| `studio` Ad studio boards | off | the board agent's fifteen tools, as `studio_<tool>` (houses with the Ad studio) |

A repair taken in with an advance needs `write:money` as well. A key stops when its maker loses the role it needs (owner; a marketing
account's Studio key keeps only `studio`).

## The tools

- **Always:** `get_guide` — the house brief (`ads/studio/brand.ts`: voice, hard rules, marks, visual, Mina's ad style), the caption
  rules (`social/prompts.ts`: never "Najmi Market" or "Saddar", no urgency), the hours, the Maisons, how to work, and this key's tools.
- **Posting:** `find_photos`, `view_photo`, `list_destinations`, `make_post`, `view_post`, `list_posts`, `queue_post`, `list_queue`,
  `withdraw_post` (its own, while waiting); with `posts:publish`: `send_post`, `schedule_post`.
- **Reading:** `shop_summary`, `todays_cash`, `whats_owed`, `find_orders`, `get_order`, `find_invoices`, `get_invoice`,
  `find_customers`, `get_customer`, `find_repairs`, `find_stock`, `gold_rates`, `month_summary`.
- **The shop:** `add_customer`, `update_customer`, `set_order_status`, `add_repair`, `set_repair_status`, `add_given_item`,
  `mark_given_returned`, `set_team_note`, `delete_repair`, `delete_given_item`.
- **Money:** `create_invoice`, `record_payment`, `record_order_advance`, `record_repair_payment`, `add_expense`, `set_rates`,
  `delete_invoice_payment`, `delete_order_advance`, `delete_invoice`.

## How a post goes (the owner's one tap)

1. `make_post { photo, format: both|story|square, template?, headline?, kicker?, details?, specs?, caption? }` lays the design out
   and draws it on the server with the board's renderer (`ads/studio/server-draw.ts`, about 4 s for both pages), and keeps it as a
   Design on the Saved shelf (`designs`, kind piece/story/post, by "ChatGPT (AI)") — the owner can open and change it in Posts › Design.
   The specs line is the ERP's own; the caption defaults to the house's (the Hub's for a website piece). Words are checked first
   (`agent/house-rules.ts copyProblems`): sale words or hashtags, a market or area name, urgency, a figure the ERP didn't give, a
   Maisons piece priced by the gram — refused with the reason.
2. `queue_post { post, whatsapp: [keys], instagram_story }` puts its square (WhatsApp) and story (Instagram, where connected) in the
   post queue as **held**, with `proposedBy` (the key's label) and `design`.
3. In **Posts** the queue shows "Made by ChatGPT — look at it, then send it or give it a time"; the thumbnail opens larger. Its own Send
   or clock is the approval (`approvedBy`, `approvedAt`); **Send all** and **Spread** leave it out. The tick never sends it unapproved
   (`claimItem`, `dueItems`), nor does a schedule without someone named (`changeItem`). The native apps' queue sends go through the same
   route, so a send there approves too. A key with `posts:publish` may `send_post` / `schedule_post` itself.
4. The website is not offered to an AI: its collections, names and the Maisons stay with people (Design, Add photos).

## Setting up each AI

The settings page gives each of these with the key filled in.

- **claude.ai / the Claude app:** Settings → Connectors → Add custom connector → `https://<erp>/api/agent/mcp` → Connect; the ERP's
  page asks for the key once. **Claude Code:** `claude mcp add --transport http <house>-erp https://<erp>/api/agent/mcp --header "Authorization: Bearer tk_…"`.
- **ChatGPT connector** (Developer mode → Create): the same MCP address, authentication OAuth; paste the key on the ERP's page.
  **Custom GPT:** Configure → Actions → Import from URL `https://<erp>/api/agent/openapi.json?scopes=…`, Authentication → API key →
  Bearer. Instructions: "Call get_guide first." Pictures come back as addresses that work for an hour (`/api/agent/preview/<token>`).
- **Gemini CLI** (`~/.gemini/settings.json`): `{"mcpServers": {"<house>-erp": {"httpUrl": "https://<erp>/api/agent/mcp", "headers": {"Authorization": "Bearer tk_…"}}}}`.
- **Cursor** (`~/.cursor/mcp.json`): the same with `"url"`.

### Signing a connector in (no header)

claude.ai's and ChatGPT's connectors speak OAuth 2.1, so the ERP is its own small authorization server (`agent/oauth.ts`):
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, dynamic registration
(`/api/agent/oauth/register`), `/api/agent/oauth/authorize` (a plain page: who is asking, where the answer goes, a box for the key),
`/api/agent/oauth/token` (PKCE S256; a one-use 5-minute code). The token is a key of its own for the same record (`addToken`): same
scopes, limit and log, and revoking the key stops it. The MCP 401 names the metadata (`WWW-Authenticate: Bearer resource_metadata=…`).

## Security

- The key is `tk_<house>_<id>_<secret>`; the record (`app_private/ai_key__<id>`, Admin SDK only under the locked rules) holds only
  SHA-256 hashes, compared with `timingSafeEqual`. Keys are never logged: the log keeps argument names and short values, never a
  code, token or picture. A key for another house says so.
- Scopes are checked on every call on the server (`registry.ts runTool`), then the input against the tool's zod schema; a tool the key
  may not use answers 403 with the scope it needs.
- 600 calls an hour per key (`website/ratelimit`, `ai-key__<id>`), as the Studio's agent had.
- Writes run the iPhone app's route code (`app/api/app/write/run-op.ts`) as the key's maker: the same roles, the database lock, the
  request id (money changes carry `ai-<key>-<request_id>`, so a retry is recorded once), the shared write, the follow-ups (the WhatsApp
  alert by `sendLiveAlert`, the Shopify sync by its route's handler in-process), and the **delete code** for any delete
  (`passDeleteCode`, the same tries and logging).
- No browser CORS on any of it: the AIs call from their servers. `openapi.json` and the OAuth metadata are public and hold nothing
  secret (the code is public anyway).

## Where the code is

`src/lib/agent/` — `scopes.ts` (the table), `keys.ts` (keys), `registry.ts` (the tool type and `runTool`), `tools.ts` (the list and
`get_guide`), `tools-posts.ts`, `tools-read.ts`, `tools-write.ts`, `tools-studio.ts`, `house-rules.ts`, `call.ts` (key, limit,
log), `mcp.ts`, `openapi.ts`, `oauth.ts`, `previews.ts`, `json-schema.ts` (zod 3 → JSON Schema). Routes: `src/app/api/agent/`
(`mcp`, `v1/[tool]`, `openapi.json`, `preview/[token]`, `keys`, `oauth/*`), `src/app/.well-known/*`. The page:
`src/app/settings/ai/page.tsx`. The queue's approval: `src/lib/social/queue.ts` (`proposedBy`, `awaitingApproval`), the Posts queue
panel (`app/website/post/queue-panel.tsx`). The Studio: `ads/studio/board.ts` (`createAgentKey` makes a `studio` key; `checkAgentKey`
takes both kinds). Tests: `src/lib/agent/*.test.ts` (scopes, revoked and expired keys, the rate limit, a draft post through MCP and
REST with the queue's approval, a payment through the shared write beside `/api/app/write`, MCP shapes, OpenAPI from the registry).

## Checked

2026-10-21, locally against Taheri's Firestore with a one-hour key: initialize → tools/list (23 tools for draft + read) → get_guide →
find_photos → make_post on a website ring (both pages drawn, framed layout) → view_post → queue_post (held, awaiting the OK) → send_post
refused without publish → withdraw_post; the REST twin; the OAuth sign-in end to end. The design, the key, the client and the log
rows were deleted after.

## Not done

- Website uploads from an AI (see above). Instagram feed posts by API (the publish sheet has them; the queue carries stories only).
- The Android app's icon map has no `Bot` (it falls back to its default); the iPhone's maps it to `sparkles`.
- The iPhone app's own server writes still log only the server's shape, which Settings → Activity doesn't read (found with this;
  an AI's writes log both shapes).
